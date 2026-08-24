import type { ComputeJobState } from "./contracts";
import { coreError } from "./errors";

const ALLOWED_TRANSITIONS: Readonly<Record<ComputeJobState, ReadonlySet<ComputeJobState>>> =
  Object.freeze({
    queued: new Set<ComputeJobState>(["leased", "cancelled", "timed_out", "expired", "deleting"]),
    leased: new Set<ComputeJobState>([
      "queued",
      "starting",
      "cancelled",
      "timed_out",
      "expired",
      "deleting",
    ]),
    starting: new Set<ComputeJobState>([
      "running",
      "cancelling",
      "queued",
      "timed_out",
      "expired",
      "failed",
    ]),
    running: new Set<ComputeJobState>([
      "cancelling",
      "queued",
      "succeeded",
      "timed_out",
      "expired",
      "failed",
    ]),
    cancelling: new Set<ComputeJobState>([
      "queued",
      "cancelled",
      "timed_out",
      "expired",
      "deleting",
      "failed",
    ]),
    succeeded: new Set<ComputeJobState>(["expired", "deleting"]),
    failed: new Set<ComputeJobState>(["expired", "deleting"]),
    cancelled: new Set<ComputeJobState>(["expired", "deleting"]),
    timed_out: new Set<ComputeJobState>(["expired", "deleting"]),
    expired: new Set<ComputeJobState>(["deleting"]),
    deleting: new Set<ComputeJobState>(["deleted"]),
    deleted: new Set<ComputeJobState>(),
  });

export function assertJobStateTransition(
  from: ComputeJobState,
  to: ComputeJobState,
): void {
  if (from === to || ALLOWED_TRANSITIONS[from].has(to)) return;
  coreError(
    "INVALID_STATE_TRANSITION",
    `Compute job state cannot transition from ${from} to ${to}.`,
  );
}

export function isProcessOwningState(state: ComputeJobState): boolean {
  return state === "starting" || state === "running" || state === "cancelling";
}

export function isTerminalState(state: ComputeJobState): boolean {
  return (
    state === "succeeded" ||
    state === "failed" ||
    state === "cancelled" ||
    state === "timed_out" ||
    state === "expired" ||
    state === "deleted"
  );
}
