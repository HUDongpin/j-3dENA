export type NodeComputeProcessSupervisorErrorCode =
  | "INVALID_CONFIGURATION"
  | "INVALID_LAUNCH_CONTEXT"
  | "INVALID_LAUNCH_CONTROL"
  | "LAUNCH_PAYLOAD_FAILED"
  | "LAUNCH_PAYLOAD_INVALID"
  | "CHILD_SESSION_FAILED"
  | "LAUNCH_ABORTED"
  | "LAUNCH_DEADLINE_EXPIRED"
  | "CHILD_EXITED_BEFORE_READY"
  | "CHILD_PROTOCOL_VIOLATION"
  | "CHILD_PROCESS_START_FAILED"
  | "TERMINATION_SIGNAL_FAILED";

const ERROR_MESSAGES: Readonly<
  Record<NodeComputeProcessSupervisorErrorCode, string>
> = Object.freeze({
  INVALID_CONFIGURATION: "The Node process supervisor configuration is invalid.",
  INVALID_LAUNCH_CONTEXT: "The process launch context is invalid.",
  INVALID_LAUNCH_CONTROL: "The process launch control is invalid.",
  LAUNCH_PAYLOAD_FAILED: "The process launch payload could not be prepared.",
  LAUNCH_PAYLOAD_INVALID: "The process launch payload is not clone-safe.",
  CHILD_SESSION_FAILED: "The child process session failed.",
  LAUNCH_ABORTED: "The process launch was aborted before readiness.",
  LAUNCH_DEADLINE_EXPIRED:
    "The process launch deadline elapsed before readiness.",
  CHILD_EXITED_BEFORE_READY:
    "The child process exited before the readiness handshake.",
  CHILD_PROTOCOL_VIOLATION:
    "The child process sent an invalid readiness handshake.",
  CHILD_PROCESS_START_FAILED: "The child process could not be started.",
  TERMINATION_SIGNAL_FAILED:
    "The child process termination signal could not be dispatched.",
});

export class NodeComputeProcessSupervisorError extends Error {
  readonly code: NodeComputeProcessSupervisorErrorCode;

  constructor(code: NodeComputeProcessSupervisorErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "NodeComputeProcessSupervisorError";
    this.code = code;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function nodeSupervisorError(
  code: NodeComputeProcessSupervisorErrorCode,
): never {
  throw new NodeComputeProcessSupervisorError(code);
}
