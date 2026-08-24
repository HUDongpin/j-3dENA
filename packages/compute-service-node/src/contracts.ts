import type { ProcessLaunchContextV1 } from "@3dena/compute-service-core";
import type {
  ProcessLaunchControlV1,
  ProcessTerminationReason,
} from "@3dena/compute-service-core";

export const NODE_COMPUTE_IPC_PROTOCOL_VERSION =
  "3dena.compute-node-ipc.v1" as const;

export const NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION =
  "3dena.compute-node-supervisor-options.v1" as const;

export const NODE_WORKER_SESSION_ADAPTER_VERSION =
  "3dena.compute-node-session-adapter.v1" as const;

export const NODE_WORKER_SESSION_VERSION =
  "3dena.compute-node-session.v1" as const;

export const DEFAULT_TERMINATION_GRACE_MS = 500 as const;
export const MAX_TERMINATION_GRACE_MS = 30_000 as const;

export type NodeWorkerEnvironmentV1 = Readonly<{
  LANG?: string;
  LC_ALL?: string;
  TZ?: string;
  NODE_ENV?: "production" | "test";
}>;

export interface NodeComputeProcessSupervisorOptionsV1 {
  readonly version: typeof NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION;
  /** A fixed, absolute module path. It is canonicalized once at construction. */
  readonly workerEntry: string;
  /** Defaults to the current absolute Node executable. */
  readonly nodeExecutable?: string;
  /** Only these four explicitly modeled names may reach the child. */
  readonly environment?: NodeWorkerEnvironmentV1;
  readonly terminationGraceMs?: number;
}

export interface NodeComputeSupervisorSnapshotV1 {
  readonly version: "3dena.compute-node-supervisor-snapshot.v1";
  readonly activeChildren: number;
  readonly launchingChildren: number;
  readonly readyChildren: number;
  readonly terminationRequestedChildren: number;
  readonly retainedLaunchSignals: number;
  readonly armedLaunchTimers: number;
  readonly armedTerminationTimers: number;
}

export interface NodeWorkerLaunchMessageV1 {
  readonly version: typeof NODE_COMPUTE_IPC_PROTOCOL_VERSION;
  readonly type: "launch";
  readonly context: ProcessLaunchContextV1;
  /** Structured-clone-safe, adapter-owned payload; null for the base supervisor. */
  readonly payload: unknown;
}

export interface NodeWorkerReadyMessageV1 {
  readonly version: typeof NODE_COMPUTE_IPC_PROTOCOL_VERSION;
  readonly type: "ready";
  readonly executionId: string;
}

export interface NodeWorkerSessionV1 {
  readonly version: typeof NODE_WORKER_SESSION_VERSION;
  readonly childId: string;
  readonly executionId: string;
  readonly context: ProcessLaunchContextV1;
  /** Aborts on a requested stop or observed child close. */
  readonly signal: AbortSignal;
  send(message: unknown): Promise<void>;
  requestTermination(reason: ProcessTerminationReason): Promise<void>;
}

/**
 * Optional parent-side IPC extension. Implementations must validate every
 * post-ready message and must never log or retain raw scientific payloads.
 */
export interface NodeWorkerSessionAdapterV1 {
  readonly version: typeof NODE_WORKER_SESSION_ADAPTER_VERSION;
  prepareLaunchPayload(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): unknown | Promise<unknown>;
  handleMessage(
    session: NodeWorkerSessionV1,
    message: unknown,
  ): void | Promise<void>;
}
