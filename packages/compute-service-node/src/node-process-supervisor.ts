import {
  spawn as spawnChild,
  type ChildProcess,
  type Serializable,
} from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { constants as operatingSystemConstants } from "node:os";
import { dirname, isAbsolute } from "node:path";

import {
  COMPUTE_LEASE_VERSION,
  COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  type ComputeProcessSupervisor,
  type ObservedProcessTermination,
  type ProcessLaunchContextV1,
  type ProcessLaunchControlV1,
  type ProcessTerminationReason,
  type SupervisedChildProcess,
} from "@3dena/compute-service-core";

import {
  DEFAULT_TERMINATION_GRACE_MS,
  MAX_TERMINATION_GRACE_MS,
  NODE_COMPUTE_IPC_PROTOCOL_VERSION,
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NODE_WORKER_SESSION_ADAPTER_VERSION,
  NODE_WORKER_SESSION_VERSION,
  type NodeComputeProcessSupervisorOptionsV1,
  type NodeComputeSupervisorSnapshotV1,
  type NodeWorkerEnvironmentV1,
  type NodeWorkerLaunchMessageV1,
  type NodeWorkerSessionAdapterV1,
  type NodeWorkerSessionV1,
} from "./contracts";
import {
  NodeComputeProcessSupervisorError,
  type NodeComputeProcessSupervisorErrorCode,
  nodeSupervisorError,
} from "./errors";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const MAX_PENDING_SESSION_MESSAGES = 8;
const SIGNAL_NAMES = new Set(Object.keys(operatingSystemConstants.signals));
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ENVIRONMENT_KEYS = Object.freeze(["LANG", "LC_ALL", "TZ", "NODE_ENV"]);
const SUPERVISOR_OPTION_KEYS = new Set([
  "version",
  "workerEntry",
  "nodeExecutable",
  "environment",
  "terminationGraceMs",
]);
const LANGUAGE_VALUE_PATTERN = /^[A-Za-z0-9._@-]{1,64}$/u;
const TIME_ZONE_VALUE_PATTERN = /^[A-Za-z0-9_+\-/]{1,64}$/u;

type LaunchFailureCode = Extract<
  NodeComputeProcessSupervisorErrorCode,
  | "LAUNCH_ABORTED"
  | "LAUNCH_DEADLINE_EXPIRED"
  | "CHILD_EXITED_BEFORE_READY"
  | "CHILD_PROTOCOL_VIOLATION"
  | "CHILD_PROCESS_START_FAILED"
>;

interface ExitObservation {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
}

interface ActiveChildRecord {
  readonly childId: string;
  readonly child: ChildProcess;
  readonly executionId: string;
  readonly sessionContext: ProcessLaunchContextV1;
  readonly sessionAbortController: AbortController;
  readonly launchDeadlineAtMs: number;
  readonly termination: Promise<ObservedProcessTermination>;
  readonly resolveTermination: (
    value: ObservedProcessTermination,
  ) => void;
  readonly resolveLaunch: (value: SupervisedChildProcess) => void;
  readonly rejectLaunch: (error: NodeComputeProcessSupervisorError) => void;
  readonly onAbort: () => void;
  readonly onClose: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
  readonly onError: () => void;
  readonly onExit: (
    code: number | null,
    signal: NodeJS.Signals | null,
  ) => void;
  readonly onMessage: (message: unknown) => void;
  readonly onSpawn: () => void;
  launchDeadlineTimer: ReturnType<typeof setTimeout> | undefined;
  terminationTimer: ReturnType<typeof setTimeout> | undefined;
  launchSignal: AbortSignal | undefined;
  launchMessage: NodeWorkerLaunchMessageV1 | undefined;
  sessionMessageChain: Promise<void>;
  pendingSessionMessages: number;
  exitObservation?: ExitObservation;
  launchFailure?: LaunchFailureCode;
  ready: boolean;
  launchSettled: boolean;
  spawnObserved: boolean;
  processErrorObserved: boolean;
  terminationRequested: boolean;
  closed: boolean;
}

function exactKeys(value: object, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return (
    actual.length === wanted.length &&
    actual.every((key, index) => key === wanted[index])
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIpcSerializable(value: unknown): value is Serializable {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    (typeof value === "object" && value !== null)
  );
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function assertRegularAbsoluteFile(value: unknown): string {
  if (typeof value !== "string" || !isAbsolute(value)) {
    nodeSupervisorError("INVALID_CONFIGURATION");
  }
  try {
    const canonical = realpathSync(value);
    if (!isAbsolute(canonical) || !statSync(canonical).isFile()) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    return canonical;
  } catch {
    nodeSupervisorError("INVALID_CONFIGURATION");
  }
}

function assertEnvironment(
  value: NodeWorkerEnvironmentV1 | undefined,
): Readonly<Record<string, string>> {
  if (value === undefined) return Object.freeze({});
  if (!isRecord(value) || !Object.keys(value).every((key) => ENVIRONMENT_KEYS.includes(key))) {
    nodeSupervisorError("INVALID_CONFIGURATION");
  }
  const environment: Record<string, string> = {};
  if (value.LANG !== undefined) {
    if (!LANGUAGE_VALUE_PATTERN.test(value.LANG)) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    environment.LANG = value.LANG;
  }
  if (value.LC_ALL !== undefined) {
    if (!LANGUAGE_VALUE_PATTERN.test(value.LC_ALL)) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    environment.LC_ALL = value.LC_ALL;
  }
  if (value.TZ !== undefined) {
    if (!TIME_ZONE_VALUE_PATTERN.test(value.TZ)) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    environment.TZ = value.TZ;
  }
  if (value.NODE_ENV !== undefined) {
    if (value.NODE_ENV !== "production" && value.NODE_ENV !== "test") {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    environment.NODE_ENV = value.NODE_ENV;
  }
  return Object.freeze(environment);
}

function assertLaunchControl(control: ProcessLaunchControlV1, now: number): void {
  if (
    !isRecord(control) ||
    !exactKeys(control, ["version", "deadlineAtMs", "signal"]) ||
    control.version !== COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION ||
    !Number.isSafeInteger(control.deadlineAtMs) ||
    control.deadlineAtMs < 0 ||
    typeof control.signal !== "object" ||
    control.signal === null ||
    typeof control.signal.aborted !== "boolean" ||
    typeof control.signal.addEventListener !== "function" ||
    typeof control.signal.removeEventListener !== "function"
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTROL");
  }
  if (control.signal.aborted) nodeSupervisorError("LAUNCH_ABORTED");
  if (control.deadlineAtMs <= now) {
    nodeSupervisorError("LAUNCH_DEADLINE_EXPIRED");
  }
}

function assertOwner(value: unknown): asserts value is ProcessLaunchContextV1["owner"] {
  if (
    !isRecord(value) ||
    !exactKeys(value, [
      "contractVersion",
      "datasetHash",
      "specHash",
      "runId",
      "taskId",
    ]) ||
    value.contractVersion !== COMPUTE_TASK_OWNER_CONTRACT_VERSION ||
    typeof value.datasetHash !== "string" ||
    !SHA256_PATTERN.test(value.datasetHash) ||
    typeof value.specHash !== "string" ||
    !SHA256_PATTERN.test(value.specHash) ||
    !isNonEmptyString(value.runId) ||
    !isNonEmptyString(value.taskId)
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
}

function assertObjectDescriptor(value: unknown): void {
  if (
    !isRecord(value) ||
    !exactKeys(value, ["key", "sha256", "byteLength"]) ||
    !isNonEmptyString(value.key) ||
    typeof value.sha256 !== "string" ||
    !SHA256_PATTERN.test(value.sha256) ||
    !isNonNegativeSafeInteger(value.byteLength)
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
}

function assertLaunchContext(context: ProcessLaunchContextV1): void {
  if (
    !isRecord(context) ||
    !exactKeys(context, [
      "owner",
      "taskRef",
      "request",
      "lease",
      "executionId",
      "resultObjectKey",
    ]) ||
    !isNonEmptyString(context.taskRef) ||
    !isNonEmptyString(context.executionId) ||
    !isNonEmptyString(context.resultObjectKey)
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
  assertOwner(context.owner);
  if (
    !isRecord(context.request) ||
    !exactKeys(context.request, [
      "version",
      "owner",
      "taskKind",
      "input",
      "deadlineAtMs",
      "expiresAtMs",
    ]) ||
    context.request.version !== COMPUTE_TASK_REQUEST_VERSION ||
    !isNonEmptyString(context.request.taskKind) ||
    !isNonNegativeSafeInteger(context.request.deadlineAtMs) ||
    !isNonNegativeSafeInteger(context.request.expiresAtMs)
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
  assertOwner(context.request.owner);
  if (
    context.request.owner.contractVersion !== context.owner.contractVersion ||
    context.request.owner.datasetHash !== context.owner.datasetHash ||
    context.request.owner.specHash !== context.owner.specHash ||
    context.request.owner.runId !== context.owner.runId ||
    context.request.owner.taskId !== context.owner.taskId
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
  assertObjectDescriptor(context.request.input);
  if (
    !isRecord(context.lease) ||
    !exactKeys(context.lease, [
      "version",
      "leaseId",
      "holderId",
      "epoch",
      "issuedAtMs",
      "expiresAtMs",
    ]) ||
    context.lease.version !== COMPUTE_LEASE_VERSION ||
    !isNonEmptyString(context.lease.leaseId) ||
    !isNonEmptyString(context.lease.holderId) ||
    !isNonNegativeSafeInteger(context.lease.epoch) ||
    !isNonNegativeSafeInteger(context.lease.issuedAtMs) ||
    !isNonNegativeSafeInteger(context.lease.expiresAtMs)
  ) {
    nodeSupervisorError("INVALID_LAUNCH_CONTEXT");
  }
}

function copyLaunchContext(
  context: ProcessLaunchContextV1,
): ProcessLaunchContextV1 {
  return {
    owner: {
      contractVersion: context.owner.contractVersion,
      datasetHash: context.owner.datasetHash,
      specHash: context.owner.specHash,
      runId: context.owner.runId,
      taskId: context.owner.taskId,
    },
    taskRef: context.taskRef,
    request: {
      version: context.request.version,
      owner: {
        contractVersion: context.request.owner.contractVersion,
        datasetHash: context.request.owner.datasetHash,
        specHash: context.request.owner.specHash,
        runId: context.request.owner.runId,
        taskId: context.request.owner.taskId,
      },
      taskKind: context.request.taskKind,
      input: {
        key: context.request.input.key,
        sha256: context.request.input.sha256,
        byteLength: context.request.input.byteLength,
      },
      deadlineAtMs: context.request.deadlineAtMs,
      expiresAtMs: context.request.expiresAtMs,
    },
    lease: {
      version: context.lease.version,
      leaseId: context.lease.leaseId,
      holderId: context.lease.holderId,
      epoch: context.lease.epoch,
      issuedAtMs: context.lease.issuedAtMs,
      expiresAtMs: context.lease.expiresAtMs,
    },
    executionId: context.executionId,
    resultObjectKey: context.resultObjectKey,
  };
}

function isReadyMessage(value: unknown, executionId: string): boolean {
  return (
    isRecord(value) &&
    exactKeys(value, ["version", "type", "executionId"]) &&
    value.version === NODE_COMPUTE_IPC_PROTOCOL_VERSION &&
    value.type === "ready" &&
    value.executionId === executionId
  );
}

function normalizeExitCode(value: number | null): number | null {
  return Number.isSafeInteger(value) ? value : null;
}

function normalizeSignal(value: NodeJS.Signals | null): string | null {
  return typeof value === "string" && SIGNAL_NAMES.has(value) ? value : null;
}

export class NodeComputeProcessSupervisor implements ComputeProcessSupervisor {
  readonly #workerEntry: string;
  readonly #nodeExecutable: string;
  readonly #environment: Readonly<Record<string, string>>;
  readonly #terminationGraceMs: number;
  readonly #sessionAdapter: NodeWorkerSessionAdapterV1 | undefined;
  readonly #children = new Map<string, ActiveChildRecord>();

  constructor(
    options: NodeComputeProcessSupervisorOptionsV1,
    sessionAdapter?: NodeWorkerSessionAdapterV1,
  ) {
    if (
      !isRecord(options) ||
      Object.keys(options).some((key) => !SUPERVISOR_OPTION_KEYS.has(key)) ||
      options.version !== NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION
    ) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    this.#workerEntry = assertRegularAbsoluteFile(options.workerEntry);
    this.#nodeExecutable = assertRegularAbsoluteFile(
      options.nodeExecutable ?? process.execPath,
    );
    this.#environment = assertEnvironment(options.environment);
    const terminationGraceMs =
      options.terminationGraceMs ?? DEFAULT_TERMINATION_GRACE_MS;
    if (
      !Number.isSafeInteger(terminationGraceMs) ||
      terminationGraceMs < 1 ||
      terminationGraceMs > MAX_TERMINATION_GRACE_MS
    ) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    this.#terminationGraceMs = terminationGraceMs;
    if (
      sessionAdapter !== undefined &&
      (!isRecord(sessionAdapter) ||
        sessionAdapter.version !== NODE_WORKER_SESSION_ADAPTER_VERSION ||
        typeof sessionAdapter.prepareLaunchPayload !== "function" ||
        typeof sessionAdapter.handleMessage !== "function")
    ) {
      nodeSupervisorError("INVALID_CONFIGURATION");
    }
    this.#sessionAdapter = sessionAdapter;
  }

  async spawn(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): Promise<SupervisedChildProcess> {
    assertLaunchContext(context);
    const now = this.#now();
    assertLaunchControl(control, now);
    const sessionContext = copyLaunchContext(context);
    const payload = await this.#prepareLaunchPayload(sessionContext, control);
    const launchMessage: NodeWorkerLaunchMessageV1 = {
      version: NODE_COMPUTE_IPC_PROTOCOL_VERSION,
      type: "launch",
      context: copyLaunchContext(sessionContext),
      payload,
    };

    let child: ChildProcess;
    try {
      child = spawnChild(this.#nodeExecutable, [this.#workerEntry], {
        cwd: dirname(this.#workerEntry),
        detached: false,
        env: { ...this.#environment },
        serialization: "advanced",
        shell: false,
        stdio: ["ignore", "ignore", "ignore", "ipc"],
        windowsHide: true,
      });
    } catch {
      nodeSupervisorError("CHILD_PROCESS_START_FAILED");
    }

    const childId = `node-child-${randomUUID()}`;
    let resolveTermination!: (value: ObservedProcessTermination) => void;
    const termination = new Promise<ObservedProcessTermination>((resolve) => {
      resolveTermination = resolve;
    });

    let resolveLaunch!: (value: SupervisedChildProcess) => void;
    let rejectLaunch!: (error: NodeComputeProcessSupervisorError) => void;
    const launched = new Promise<SupervisedChildProcess>((resolve, reject) => {
      resolveLaunch = resolve;
      rejectLaunch = reject;
    });

    const record = {} as ActiveChildRecord;
    Object.assign(record, {
      childId,
      child,
      executionId: context.executionId,
      sessionContext,
      sessionAbortController: new AbortController(),
      launchDeadlineAtMs: control.deadlineAtMs,
      launchSignal: control.signal,
      termination,
      resolveTermination,
      resolveLaunch,
      rejectLaunch,
      ready: false,
      launchSettled: false,
      spawnObserved: false,
      processErrorObserved: false,
      terminationRequested: false,
      closed: false,
      launchDeadlineTimer: undefined,
      terminationTimer: undefined,
      launchMessage,
      sessionMessageChain: Promise.resolve(),
      pendingSessionMessages: 0,
      onAbort: () => {
        this.#failPendingLaunch(record, "LAUNCH_ABORTED", "launch_timeout");
      },
      onClose: (code: number | null, signal: NodeJS.Signals | null) => {
        this.#observeClose(record, code, signal);
      },
      onError: () => {
        this.#observeProcessError(record);
      },
      onExit: (code: number | null, signal: NodeJS.Signals | null) => {
        record.exitObservation = { code, signal };
      },
      onMessage: (message: unknown) => {
        this.#observeMessage(record, message);
      },
      onSpawn: () => {
        record.spawnObserved = true;
        if (record.launchFailure !== undefined || record.closed) return;
        const message = record.launchMessage;
        if (message === undefined) {
          this.#failPendingLaunch(
            record,
            "CHILD_PROCESS_START_FAILED",
            "orchestration_failure",
          );
          return;
        }
        try {
          record.child.send(message, (error) => {
            record.launchMessage = undefined;
            if (error !== null) {
              this.#failPendingLaunch(
                record,
                "CHILD_PROCESS_START_FAILED",
                "orchestration_failure",
              );
            }
          });
        } catch {
          record.launchMessage = undefined;
          this.#failPendingLaunch(
            record,
            "CHILD_PROCESS_START_FAILED",
            "orchestration_failure",
          );
        }
      },
    } satisfies Partial<ActiveChildRecord>);

    this.#children.set(childId, record);
    child.once("spawn", record.onSpawn);
    child.on("message", record.onMessage);
    child.once("error", record.onError);
    child.once("exit", record.onExit);
    child.once("close", record.onClose);
    control.signal.addEventListener("abort", record.onAbort, { once: true });
    this.#armLaunchDeadline(record);
    if (control.signal.aborted) record.onAbort();

    return launched;
  }

  async requestTermination(
    childId: string,
    _reason: ProcessTerminationReason,
  ): Promise<void> {
    const record = this.#children.get(childId);
    if (record === undefined || record.closed || record.terminationRequested) {
      return;
    }
    const dispatched = this.#requestTermination(record);
    if (
      !dispatched &&
      record.exitObservation === undefined &&
      record.child.exitCode === null &&
      record.child.signalCode === null
    ) {
      nodeSupervisorError("TERMINATION_SIGNAL_FAILED");
    }
  }

  snapshot(): NodeComputeSupervisorSnapshotV1 {
    const children = [...this.#children.values()];
    return Object.freeze({
      version: "3dena.compute-node-supervisor-snapshot.v1" as const,
      activeChildren: children.length,
      launchingChildren: children.filter((child) => !child.ready).length,
      readyChildren: children.filter((child) => child.ready).length,
      terminationRequestedChildren: children.filter(
        (child) => child.terminationRequested,
      ).length,
      retainedLaunchSignals: children.filter(
        (child) => child.launchSignal !== undefined,
      ).length,
      armedLaunchTimers: children.filter(
        (child) => child.launchDeadlineTimer !== undefined,
      ).length,
      armedTerminationTimers: children.filter(
        (child) => child.terminationTimer !== undefined,
      ).length,
    });
  }

  #now(): number {
    return Date.now();
  }

  async #prepareLaunchPayload(
    context: ProcessLaunchContextV1,
    control: ProcessLaunchControlV1,
  ): Promise<unknown> {
    const adapter = this.#sessionAdapter;
    if (adapter === undefined) return null;
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let rejectControlled!: (error: NodeComputeProcessSupervisorError) => void;
    const controlledFailure = new Promise<never>((_resolve, reject) => {
      rejectControlled = reject;
    });
    const onAbort = (): void => {
      if (settled) return;
      rejectControlled(new NodeComputeProcessSupervisorError("LAUNCH_ABORTED"));
    };
    const armDeadline = (): void => {
      const remaining = control.deadlineAtMs - this.#now();
      if (remaining <= 0) {
        rejectControlled(
          new NodeComputeProcessSupervisorError("LAUNCH_DEADLINE_EXPIRED"),
        );
        return;
      }
      deadlineTimer = setTimeout(() => {
        deadlineTimer = undefined;
        if (control.deadlineAtMs > this.#now()) {
          armDeadline();
          return;
        }
        rejectControlled(
          new NodeComputeProcessSupervisorError("LAUNCH_DEADLINE_EXPIRED"),
        );
      }, Math.min(remaining, MAX_TIMER_DELAY_MS));
    };
    control.signal.addEventListener("abort", onAbort, { once: true });
    armDeadline();
    try {
      const prepared = Promise.resolve()
        .then(() => adapter.prepareLaunchPayload(context, control))
        .catch(() => {
          throw new NodeComputeProcessSupervisorError("LAUNCH_PAYLOAD_FAILED");
        });
      const value = await Promise.race([prepared, controlledFailure]);
      try {
        return structuredClone(value);
      } catch {
        nodeSupervisorError("LAUNCH_PAYLOAD_INVALID");
      }
    } finally {
      settled = true;
      control.signal.removeEventListener("abort", onAbort);
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
    }
  }

  #armLaunchDeadline(record: ActiveChildRecord): void {
    if (record.closed || record.ready || record.launchFailure !== undefined) return;
    const remaining = record.launchDeadlineAtMs - this.#now();
    if (remaining <= 0) {
      this.#failPendingLaunch(
        record,
        "LAUNCH_DEADLINE_EXPIRED",
        "launch_timeout",
      );
      return;
    }
    record.launchDeadlineTimer = setTimeout(() => {
      record.launchDeadlineTimer = undefined;
      if (record.launchDeadlineAtMs > this.#now()) {
        this.#armLaunchDeadline(record);
        return;
      }
      this.#failPendingLaunch(
        record,
        "LAUNCH_DEADLINE_EXPIRED",
        "launch_timeout",
      );
    }, Math.min(remaining, MAX_TIMER_DELAY_MS));
  }

  #observeMessage(record: ActiveChildRecord, message: unknown): void {
    if (record.closed || record.launchFailure !== undefined) return;
    if (record.ready) {
      this.#handleSessionMessage(record, message);
      return;
    }
    if (!isReadyMessage(message, record.executionId)) {
      this.#failPendingLaunch(
        record,
        "CHILD_PROTOCOL_VIOLATION",
        "orchestration_failure",
      );
      return;
    }
    record.ready = true;
    record.launchSettled = true;
    record.launchMessage = undefined;
    this.#clearLaunchControls(record);
    record.resolveLaunch(
      Object.freeze({
        childId: record.childId,
        termination: record.termination,
      }),
    );
  }

  #handleSessionMessage(record: ActiveChildRecord, message: unknown): void {
    const adapter = this.#sessionAdapter;
    if (adapter === undefined || record.sessionAbortController.signal.aborted) {
      return;
    }
    if (record.pendingSessionMessages >= MAX_PENDING_SESSION_MESSAGES) {
      this.#requestTermination(record);
      return;
    }
    record.pendingSessionMessages += 1;
    record.sessionMessageChain = record.sessionMessageChain
      .then(async () => {
        if (record.closed || record.sessionAbortController.signal.aborted) return;
        const session: NodeWorkerSessionV1 = Object.freeze({
          version: NODE_WORKER_SESSION_VERSION,
          childId: record.childId,
          executionId: record.executionId,
          context: copyLaunchContext(record.sessionContext),
          signal: record.sessionAbortController.signal,
          send: (reply: unknown) => this.#sendSessionMessage(record, reply),
          requestTermination: (reason: ProcessTerminationReason) =>
            this.requestTermination(record.childId, reason),
        });
        await adapter.handleMessage(session, message);
      })
      .catch(() => {
        if (!record.closed) this.#requestTermination(record);
      })
      .finally(() => {
        record.pendingSessionMessages -= 1;
      });
  }

  async #sendSessionMessage(
    record: ActiveChildRecord,
    message: unknown,
  ): Promise<void> {
    if (
      record.closed ||
      record.terminationRequested ||
      record.sessionAbortController.signal.aborted
    ) {
      nodeSupervisorError("CHILD_SESSION_FAILED");
    }
    let clone: unknown;
    try {
      clone = structuredClone(message);
    } catch {
      nodeSupervisorError("CHILD_SESSION_FAILED");
    }
    if (!isIpcSerializable(clone)) nodeSupervisorError("CHILD_SESSION_FAILED");
    await new Promise<void>((resolve, reject) => {
      try {
        record.child.send(clone, (error) => {
          if (error === null) resolve();
          else reject(new NodeComputeProcessSupervisorError("CHILD_SESSION_FAILED"));
        });
      } catch {
        reject(new NodeComputeProcessSupervisorError("CHILD_SESSION_FAILED"));
      }
    });
  }

  #observeProcessError(record: ActiveChildRecord): void {
    if (record.closed) return;
    record.processErrorObserved = true;
    if (!record.spawnObserved && record.child.pid === undefined) {
      record.launchFailure = "CHILD_PROCESS_START_FAILED";
      this.#observeClose(record, null, null);
      return;
    }
    if (!record.ready) {
      this.#failPendingLaunch(
        record,
        "CHILD_PROCESS_START_FAILED",
        "orchestration_failure",
      );
    }
  }

  #failPendingLaunch(
    record: ActiveChildRecord,
    code: LaunchFailureCode,
    _reason: ProcessTerminationReason,
  ): void {
    if (record.closed || record.ready || record.launchFailure !== undefined) return;
    record.launchFailure = code;
    this.#clearLaunchControls(record);
    this.#requestTermination(record);
  }

  #requestTermination(record: ActiveChildRecord): boolean {
    if (record.closed || record.terminationRequested) return true;
    record.sessionAbortController.abort();
    if (
      record.exitObservation !== undefined ||
      record.child.exitCode !== null ||
      record.child.signalCode !== null
    ) {
      return true;
    }
    record.terminationRequested = true;
    let dispatched = false;
    try {
      dispatched = record.child.kill("SIGTERM");
    } catch {
      dispatched = false;
    }
    if (!record.closed) {
      record.terminationTimer = setTimeout(() => {
        record.terminationTimer = undefined;
        if (record.closed) return;
        try {
          record.child.kill("SIGKILL");
        } catch {
          // No raw adapter error is retained or logged. Close remains authoritative.
        }
      }, this.#terminationGraceMs);
    }
    return dispatched;
  }

  #observeClose(
    record: ActiveChildRecord,
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void {
    if (record.closed) return;
    record.closed = true;
    record.launchMessage = undefined;
    record.sessionAbortController.abort();
    this.#clearLaunchControls(record);
    if (record.terminationTimer !== undefined) {
      clearTimeout(record.terminationTimer);
      record.terminationTimer = undefined;
    }

    const exitCode = normalizeExitCode(code);
    const normalizedSignal = normalizeSignal(signal);
    const exitMatchesClose =
      record.exitObservation === undefined ||
      (record.exitObservation.code === code &&
        record.exitObservation.signal === signal);
    const validExclusiveOutcome = !(
      exitCode !== null && normalizedSignal !== null
    );
    let kind: ObservedProcessTermination["kind"];
    if (record.terminationRequested) {
      kind = "terminated";
    } else if (
      exitMatchesClose &&
      validExclusiveOutcome &&
      !record.processErrorObserved &&
      exitCode === 0 &&
      normalizedSignal === null
    ) {
      kind = "completed";
    } else {
      kind = "crashed";
    }

    const observed = Object.freeze({
      kind,
      observedAtMs: this.#now(),
      exitCode,
      signal: normalizedSignal,
    });
    record.resolveTermination(observed);
    if (!record.launchSettled) {
      record.launchSettled = true;
      record.rejectLaunch(
        new NodeComputeProcessSupervisorError(
          record.launchFailure ?? "CHILD_EXITED_BEFORE_READY",
        ),
      );
    }
    this.#children.delete(record.childId);
    this.#removeChildListeners(record);
  }

  #clearLaunchControls(record: ActiveChildRecord): void {
    record.launchSignal?.removeEventListener("abort", record.onAbort);
    record.launchSignal = undefined;
    if (record.launchDeadlineTimer !== undefined) {
      clearTimeout(record.launchDeadlineTimer);
      record.launchDeadlineTimer = undefined;
    }
  }

  #removeChildListeners(record: ActiveChildRecord): void {
    record.child.removeListener("spawn", record.onSpawn);
    record.child.removeListener("message", record.onMessage);
    record.child.removeListener("error", record.onError);
    record.child.removeListener("exit", record.onExit);
    record.child.removeListener("close", record.onClose);
  }
}
