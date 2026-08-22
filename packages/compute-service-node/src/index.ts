export {
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_TERMINATION_GRACE_MS,
  NODE_COMPUTE_IPC_PROTOCOL_VERSION,
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NODE_WORKER_SESSION_ADAPTER_VERSION,
  NODE_WORKER_SESSION_VERSION,
} from "./contracts";
export { NodeComputeProcessSupervisorError } from "./errors";
export { NodeComputeProcessSupervisor } from "./node-process-supervisor";
export * from "./scientific/index";

export type {
  NodeComputeProcessSupervisorOptionsV1,
  NodeComputeSupervisorSnapshotV1,
  NodeWorkerEnvironmentV1,
  NodeWorkerLaunchMessageV1,
  NodeWorkerReadyMessageV1,
  NodeWorkerSessionAdapterV1,
  NodeWorkerSessionV1,
} from "./contracts";
export type { NodeComputeProcessSupervisorErrorCode } from "./errors";
