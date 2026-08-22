import { randomUUID } from "node:crypto";

import {
  type ComputeJobRecordV1,
  ComputeServiceCore,
} from "@3dena/compute-service-core";

import type {
  PersistentLeaseClaimV1,
  PersistentLeaseCoordinatorV1,
} from "./contracts";
import { persistentError } from "./errors";

const FINAL_STATES = new Set([
  "succeeded", "failed", "cancelled", "timed_out", "expired", "deleted",
]);

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
  }

  async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted && !(await this.#ready())) {
      await abortableDelay(this.#pollIntervalMs, signal);
    }
    if (signal.aborted) return;
    await this.#coordinator.recoverExpiredClaims();
    while (!signal.aborted) {
      const didWork = await this.tick(signal);
      if (!didWork) await abortableDelay(this.#pollIntervalMs, signal);
    }
  }

  async tick(signal: AbortSignal): Promise<boolean> {
    if (signal.aborted) return false;
    if (!(await this.#ready())) return false;
    let claim = await this.#coordinator.claimNext({
      holderId: this.#holderId,
      leaseId: this.#nextLeaseId(),
      durationMs: this.#leaseDurationMs,
    });
    if (claim === null) return false;
    try {
      await this.#core.executeTask(claim.taskId, claim.lease);
      claim = await this.#watch(claim, signal);
      return true;
    } finally {
      const record = await this.#core.getTask(claim.taskId);
      if (record !== null && FINAL_STATES.has(record.state)) {
        await this.#coordinator.release(claim);
      }
      // A non-terminal record deliberately retains the durable slot until its
      // lease expires and restart recovery observes the fencing boundary.
    }
  }

  async #watch(
    initial: PersistentLeaseClaimV1,
    signal: AbortSignal,
  ): Promise<PersistentLeaseClaimV1> {
    let claim = initial;
    let cancellationRequested = false;
    while (true) {
      const record = await this.#core.getTask(claim.taskId);
      if (record === null) persistentError("RECOVERY_CONFLICT");
      if (FINAL_STATES.has(record.state)) return claim;
      if (signal.aborted) {
        if (!cancellationRequested) {
          cancellationRequested = true;
          await this.#core.cancelTask(claim.taskId);
          await this.#core.settleBackground();
        }
      }
      await abortableDelay(this.#heartbeatIntervalMs, signal);
      const afterDelay = await this.#core.getTask(claim.taskId);
      if (afterDelay === null) persistentError("RECOVERY_CONFLICT");
      if (FINAL_STATES.has(afterDelay.state)) return claim;
      if (signal.aborted) continue;
      if (!(await this.#ready())) {
        await this.#core.cancelTask(claim.taskId);
        cancellationRequested = true;
        continue;
      }
      claim = await this.#coordinator.heartbeat(claim, this.#leaseDurationMs);
    }
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
