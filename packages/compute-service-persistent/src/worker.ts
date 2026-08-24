import { randomUUID } from "node:crypto";

import {
  type ComputeJobRecordV1,
  type ComputeProcessSupervisor,
  ComputeServiceCore,
  type ProcessLaunchContextV1,
  type ProcessLaunchControlV1,
  type ProcessTerminationReason,
  type SupervisedChildProcess,
} from "@3dena/compute-service-core";

import type {
  PersistentLeaseClaimV1,
  PersistentLeaseCoordinatorV1,
} from "./contracts";
import { persistentError } from "./errors";

const FINAL_STATES = new Set([
  "succeeded", "failed", "cancelled", "timed_out", "expired", "deleted",
]);

/**
 * API/control-plane adapter: the core CAS is the durable stop intent. The API
 * process never claims that it signalled a child owned by another runtime; the
 * owning worker observes the persisted `cancelling` record and dispatches the
 * real termination request through its local supervisor.
 */
export class DurableControlPlaneProcessSupervisor
  implements ComputeProcessSupervisor
{
  async spawn(
    _context: ProcessLaunchContextV1,
    _control: ProcessLaunchControlV1,
  ): Promise<SupervisedChildProcess> {
    throw new TypeError("The durable control plane cannot launch scientific children.");
  }

  async requestTermination(
    _childId: string,
    _reason: ProcessTerminationReason,
  ): Promise<void> {
    // Intentionally empty: accepting this call means only that the preceding
    // repository CAS durably recorded the intent. It is not an observation of
    // process termination or distributed-capacity release.
  }
}

export interface PersistentComputeWorkerOptionsV1 {
  readonly holderId: string;
  readonly core: ComputeServiceCore;
  readonly coordinator: PersistentLeaseCoordinatorV1;
  readonly leaseDurationMs: number;
  readonly heartbeatIntervalMs: number;
  readonly pollIntervalMs?: number;
  readonly nextLeaseId?: () => string;
  /** Synchronizes server time and verifies exact-build readiness before work. */
  readonly beforeCycle?: () => Promise<boolean>;
  /** Fixed, non-sensitive signal; the caught error is deliberately not exposed. */
  readonly onCycleFailure?: (
    stage: "recovery" | "claim" | "heartbeat" | "task" | "cycle",
  ) => void;
}

function abortableDelay(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (): void => {
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener("abort", settle);
      resolve();
    };
    timer = setTimeout(settle, milliseconds);
    signal.addEventListener("abort", settle, { once: true });
  });
}

export class PersistentComputeWorker {
  readonly #holderId: string;
  readonly #core: ComputeServiceCore;
  readonly #coordinator: PersistentLeaseCoordinatorV1;
  readonly #leaseDurationMs: number;
  readonly #heartbeatIntervalMs: number;
  readonly #pollIntervalMs: number;
  readonly #nextLeaseId: () => string;
  readonly #beforeCycle: () => Promise<boolean>;
  readonly #onCycleFailure: (
    stage: "recovery" | "claim" | "heartbeat" | "task" | "cycle",
  ) => void;

  constructor(options: PersistentComputeWorkerOptionsV1) {
    if (!/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(options.holderId) ||
        !Number.isSafeInteger(options.leaseDurationMs) || options.leaseDurationMs < 1 ||
        !Number.isSafeInteger(options.heartbeatIntervalMs) || options.heartbeatIntervalMs < 10 ||
        options.heartbeatIntervalMs * 3 >= options.leaseDurationMs) {
      persistentError("CONFIGURATION_INVALID");
    }
    this.#holderId = options.holderId;
    this.#core = options.core;
    this.#coordinator = options.coordinator;
    this.#leaseDurationMs = options.leaseDurationMs;
    this.#heartbeatIntervalMs = options.heartbeatIntervalMs;
    this.#pollIntervalMs = options.pollIntervalMs ?? 250;
    this.#nextLeaseId = options.nextLeaseId ?? (() => `lease-${randomUUID()}`);
    this.#beforeCycle = options.beforeCycle ?? (async () => true);
    this.#onCycleFailure = options.onCycleFailure ?? (() => undefined);
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !(await this.#ready())) {
      await abortableDelay(this.#pollIntervalMs, signal);
    }
    if (signal.aborted) return;
    while (!signal.aborted) {
      let didWork = false;
      try {
        didWork = await this.tick(signal);
      } catch {
        this.#onCycleFailure("cycle");
      }
      if (!didWork) await abortableDelay(this.#pollIntervalMs, signal);
    }
  }

  async tick(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    if (!(await this.#ready())) return false;
    try {
      await this.#coordinator.recoverExpiredClaims();
    } catch {
      this.#onCycleFailure("recovery");
      return false;
    }
    let claim: PersistentLeaseClaimV1 | null;
    try {
      claim = await this.#coordinator.claimNext({
        holderId: this.#holderId,
        leaseId: this.#nextLeaseId(),
        durationMs: this.#leaseDurationMs,
      });
    } catch {
      this.#onCycleFailure("claim");
      return false;
    }
    if (claim === null) return false;
    let capacityReleased = false;
    try {
      await this.#core.executeTask(claim.taskId, claim.lease);
      const watched = await this.#watch(claim, signal);
      claim = watched.claim;
      capacityReleased = watched.capacityReleased;
      return true;
    } finally {
      const record = await this.#core.getTask(claim.taskId);
      if (!capacityReleased && record !== null && FINAL_STATES.has(record.state)) {
        if (!(await this.#releaseObserved(claim))) {
          persistentError("RECOVERY_CONFLICT");
        }
      }
      // A non-terminal record deliberately retains the durable slot until its
      // lease expires and restart recovery observes the fencing boundary.
    }
  }

  async #watch(
    initial: PersistentLeaseClaimV1,
    signal: AbortSignal,
  ): Promise<Readonly<{
    claim: PersistentLeaseClaimV1;
    capacityReleased: boolean;
  }>> {
    let claim = initial;
    let cancellationRequested = false;
    while (true) {
      let record: ComputeJobRecordV1;
      try {
        record = await this.#core.sweepTask(claim.taskId);
      } catch {
        this.#onCycleFailure("task");
        await abortableDelay(this.#pollIntervalMs, signal);
        continue;
      }
      if (FINAL_STATES.has(record.state)) {
        return { claim, capacityReleased: false };
      }
      if (record.state === "deleting") {
        if (!(await this.#releaseObserved(claim))) {
          persistentError("RECOVERY_CONFLICT");
        }
        await this.#core.deleteTask(claim.taskId);
        return { claim, capacityReleased: true };
      }
      if (
        record.state === "cancelling" &&
        (record.pendingStopOutcome === "cancelled" ||
          record.pendingStopOutcome === "deleted")
      ) {
        await this.#core.cancelTask(claim.taskId);
      }
      if (signal.aborted) {
        if (!cancellationRequested) {
          cancellationRequested = true;
          await this.#core.cancelTask(claim.taskId);
          await this.#core.settleBackground();
        }
      }
      await abortableDelay(this.#heartbeatIntervalMs, signal);
      let afterDelay: ComputeJobRecordV1;
      try {
        afterDelay = await this.#core.sweepTask(claim.taskId);
      } catch {
        this.#onCycleFailure("task");
        await abortableDelay(this.#pollIntervalMs, signal);
        continue;
      }
      if (FINAL_STATES.has(afterDelay.state)) {
        return { claim, capacityReleased: false };
      }
      if (afterDelay.state === "deleting") {
        if (!(await this.#releaseObserved(claim))) {
          persistentError("RECOVERY_CONFLICT");
        }
        await this.#core.deleteTask(claim.taskId);
        return { claim, capacityReleased: true };
      }
      if (afterDelay.state === "cancelling") {
        if (
          afterDelay.pendingStopOutcome === "cancelled" ||
          afterDelay.pendingStopOutcome === "deleted"
        ) {
          await this.#core.cancelTask(claim.taskId);
        }
        continue;
      }
      if (signal.aborted) continue;
      if (!(await this.#ready())) {
        await this.#core.cancelTask(claim.taskId);
        cancellationRequested = true;
        continue;
      }
      try {
        claim = await this.#coordinator.heartbeat(claim, this.#leaseDurationMs);
      } catch {
        this.#onCycleFailure("heartbeat");
        await abortableDelay(this.#pollIntervalMs, signal);
      }
    }
  }

  async #releaseObserved(claim: PersistentLeaseClaimV1): Promise<boolean> {
    return this.#coordinator.reconcileObservedTermination === undefined
      ? this.#coordinator.release(claim)
      : this.#coordinator.reconcileObservedTermination(claim);
  }

  async #ready(): Promise<boolean> {
    try {
      return await this.#beforeCycle();
    } catch {
      return false;
    }
  }
}

export function isPersistentWorkerTerminal(record: ComputeJobRecordV1): boolean {
  return FINAL_STATES.has(record.state);
}
