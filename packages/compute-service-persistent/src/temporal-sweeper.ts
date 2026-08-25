import { ComputeServiceCore } from "@3dena/compute-service-core";

export interface PersistentTemporalSweepReceiptV1 {
  readonly examined: number;
  readonly finalizedOrUpdated: number;
  readonly failed: number;
}

export type PersistentTemporalWorkItemV1 = Readonly<{
  kind: "task" | "http-deletion" | "http-reconcile" | "http-purge";
  id: string;
}>;

export interface PersistentTemporalDueSourceV1 {
  /** Returns one server-time selected, bounded page under a singleton lease. */
  claimDue(): Promise<readonly PersistentTemporalWorkItemV1[]>;
}

function delay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const timer = setTimeout(settle, milliseconds);
    function settle(): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", settle);
      resolve();
    }
    signal.addEventListener("abort", settle, { once: true });
  });
}

export async function runPersistentTemporalSweepLoop(input: Readonly<{
  sweeper: Readonly<{ sweep(): Promise<PersistentTemporalSweepReceiptV1> }>;
  signal: AbortSignal;
  intervalMs: number;
  beforeCycle?: () => Promise<void>;
  onCycleFailure?: () => void;
}>): Promise<void> {
  if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1) {
    throw new TypeError("Temporal sweep interval must be a positive safe integer.");
  }
  const beforeCycle = input.beforeCycle ?? (async () => undefined);
  const onCycleFailure = input.onCycleFailure ?? (() => undefined);
  while (!input.signal.aborted) {
    try {
      await beforeCycle();
      await input.sweeper.sweep();
    } catch {
      onCycleFailure();
    }
    if (!input.signal.aborted) await delay(input.intervalMs, input.signal);
  }
}

/**
 * Executes only the bounded work page selected by PostgreSQL server time. One
 * poison task/job is isolated and cannot prevent the rest of the page from
 * receiving deadline, TTL, or durable deletion reconciliation.
 */
export class PersistentTemporalTaskSweeper {
  readonly #source: PersistentTemporalDueSourceV1;
  readonly #core: ComputeServiceCore;
  readonly #reconcileHttpDeletion: (jobId: string) => Promise<boolean>;
  readonly #reconcileHttpJob: (jobId: string) => Promise<boolean>;
  readonly #purgeHttpJob: (jobId: string) => Promise<boolean>;
  readonly #onTaskFailure: () => void;

  constructor(input: Readonly<{
    source: PersistentTemporalDueSourceV1;
    core: ComputeServiceCore;
    reconcileHttpDeletion?: (jobId: string) => Promise<boolean>;
    reconcileHttpJob?: (jobId: string) => Promise<boolean>;
    purgeHttpJob?: (jobId: string) => Promise<boolean>;
    onTaskFailure?: () => void;
  }>) {
    this.#source = input.source;
    this.#core = input.core;
    this.#reconcileHttpDeletion = input.reconcileHttpDeletion ?? (async () => false);
    this.#reconcileHttpJob = input.reconcileHttpJob ?? (async () => false);
    this.#purgeHttpJob = input.purgeHttpJob ?? (async () => false);
    this.#onTaskFailure = input.onTaskFailure ?? (() => undefined);
  }

  async sweep(): Promise<PersistentTemporalSweepReceiptV1> {
    const work = await this.#source.claimDue();
    let finalizedOrUpdated = 0;
    let failed = 0;
    for (const item of work) {
      try {
        if (item.kind === "http-deletion") {
          if (await this.#reconcileHttpDeletion(item.id)) finalizedOrUpdated += 1;
          continue;
        }
        if (item.kind === "http-reconcile") {
          if (await this.#reconcileHttpJob(item.id)) finalizedOrUpdated += 1;
          continue;
        }
        if (item.kind === "http-purge") {
          if (await this.#purgeHttpJob(item.id)) finalizedOrUpdated += 1;
          continue;
        }
        const before = await this.#core.getTask(item.id);
        if (before === null) throw new TypeError("Due task is missing.");
        const after = before.state === "deleting" || before.state === "expired"
          ? (await this.#core.deleteTask(item.id)).record
          : await this.#core.sweepTask(item.id);
        if (after.revision !== before.revision || after.state !== before.state) {
          finalizedOrUpdated += 1;
        }
      } catch {
        failed += 1;
        this.#onTaskFailure();
      }
    }
    return Object.freeze({
      examined: work.length,
      finalizedOrUpdated,
      failed,
    });
  }
}
