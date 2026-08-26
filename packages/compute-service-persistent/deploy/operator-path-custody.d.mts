export interface OperatorReadSnapshotV1 {
  readonly dev: bigint;
  readonly ino: bigint;
  readonly size: bigint;
  readonly mtimeNs: bigint;
  readonly ctimeNs: bigint;
}

export function portableOperatorPath(value: unknown): value is string;

export function operatorReadSnapshotIsStable(
  before: OperatorReadSnapshotV1,
  after: OperatorReadSnapshotV1,
  current: OperatorReadSnapshotV1,
  byteLength: number,
): boolean;

export function canonicalOperatorCustodyRoot(
  sourceRoot: string,
  errorMessage: string,
): Promise<string>;

export function readOperatorCustodiedFile(
  rootRealPath: string,
  requestedPath: string,
  maximumBytes: number,
  errorMessage: string,
): Promise<Buffer>;
