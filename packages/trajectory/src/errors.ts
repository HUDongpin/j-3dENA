export class TrajectoryDynamicsError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "TrajectoryDynamicsError";
    this.code = code;
    this.path = path;
  }
}

export function rejectTrajectoryDynamics(code: string, path: string, message: string): never {
  throw new TrajectoryDynamicsError(code, path, message);
}
