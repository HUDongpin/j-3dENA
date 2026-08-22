import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
  COMPUTE_TASK_OWNER_CONTRACT_VERSION,
  COMPUTE_TASK_REQUEST_VERSION,
  ComputeServiceCore,
  InMemoryComputeAuditSink,
  InMemoryComputeObjectStore,
  InMemoryComputeTaskRepository,
  SequenceComputeIdFactory,
  type ComputeClock,
  type ComputeTaskRequestV1,
  type ProcessLaunchContextV1,
  type ProcessLaunchControlV1,
} from "@3dena/compute-service-core";

import {
  NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
  NodeComputeProcessSupervisor,
  NodeComputeProcessSupervisorError,
} from "./index";

const PRIVATE_FIXTURE_OUTPUT =
  "FIXTURE_PRIVATE_PARTICIPANT_SECRET_OUTPUT_MUST_NEVER_ESCAPE";
const DATASET_HASH = "a".repeat(64);
const SPEC_HASH = "b".repeat(64);
const INPUT_HASH = "c".repeat(64);

type FixtureMode =
  | "normal"
  | "crash"
  | "wait"
  | "delayed-ready"
  | "invalid-ready"
  | "ignore-term"
  | "slow-term";

function fixtureEntry(mode: FixtureMode): string {
  return fileURLToPath(new URL(`./fixtures/${mode}.mjs`, import.meta.url));
}

function supervisor(
  mode: FixtureMode,
  terminationGraceMs = 50,
): NodeComputeProcessSupervisor {
  return new NodeComputeProcessSupervisor({
    version: NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
    workerEntry: fixtureEntry(mode),
    environment: {
      NODE_ENV: "test",
      LANG: "C.UTF-8",
      TZ: "UTC",
    },
    terminationGraceMs,
  });
}

function launchContext(suffix: string): ProcessLaunchContextV1 {
  const now = Date.now();
  const owner = {
    contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
    datasetHash: DATASET_HASH,
    specHash: SPEC_HASH,
    runId: `run-${suffix}`,
    taskId: `task-${suffix}`,
  } as const;
  return {
    owner,
    taskRef: `task-ref-${suffix}`,
    request: {
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner,
      taskKind: "fixture-compute",
      input: {
        key: `inputs/${suffix}.bin`,
        sha256: INPUT_HASH,
        byteLength: 17,
      },
      deadlineAtMs: now + 5_000,
      expiresAtMs: now + 10_000,
    },
    lease: {
      version: "3dena.compute-lease.v1",
      leaseId: `lease-${suffix}`,
      holderId: "fixture-worker",
      epoch: 1,
      issuedAtMs: now,
      expiresAtMs: now + 4_000,
    },
    executionId: `execution-${suffix}`,
    resultObjectKey: `compute-results/task-ref-${suffix}/result.bin`,
  };
}

function launchControl(
  controller = new AbortController(),
  durationMs = 2_000,
): ProcessLaunchControlV1 {
  return {
    version: COMPUTE_PROCESS_LAUNCH_CONTROL_VERSION,
    deadlineAtMs: Date.now() + durationMs,
    signal: controller.signal,
  };
}

async function waitFor(
  condition: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Condition did not settle.");
    await new Promise<void>((resolve) => setTimeout(resolve, 5));
  }
}

class SystemClock implements ComputeClock {
  now(): number {
    return Date.now();
  }
}

describe.sequential("NodeComputeProcessSupervisor", () => {
  it("requires canonical absolute entries, a closed environment allowlist, and exact launch-control version", async () => {
    expect(
      () =>
        new NodeComputeProcessSupervisor({
          version: NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
          workerEntry: "./relative-worker.mjs",
        }),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_CONFIGURATION",
      }),
    );
    expect(
      () =>
        new NodeComputeProcessSupervisor({
          version: NODE_COMPUTE_SUPERVISOR_OPTIONS_VERSION,
          workerEntry: fixtureEntry("normal"),
          environment: {
            PATH: "/private/not-allowlisted",
          },
        } as never),
    ).toThrowError(
      expect.objectContaining({
        code: "INVALID_CONFIGURATION",
      }),
    );
    const target = supervisor("normal");
    await expect(
      target.spawn(launchContext("wrong-control-version"), {
        version: "3dena.compute-process-launch-control.future",
        deadlineAtMs: Date.now() + 2_000,
        signal: new AbortController().signal,
      } as never),
    ).rejects.toMatchObject({ code: "INVALID_LAUNCH_CONTROL" });
    expect(target.snapshot().activeChildren).toBe(0);
  });

  it("accepts only an exact IPC ready handshake and maps normal and crashed exits", async () => {
    const normal = supervisor("normal");
    const normalChild = await normal.spawn(
      launchContext("normal"),
      launchControl(),
    );
    expect(normal.snapshot()).toMatchObject({
      activeChildren: 1,
      readyChildren: 1,
      launchingChildren: 0,
      retainedLaunchSignals: 0,
      armedLaunchTimers: 0,
    });
    await expect(normalChild.termination).resolves.toMatchObject({
      kind: "completed",
      exitCode: 0,
      signal: null,
    });
    expect(normal.snapshot()).toEqual({
      version: "3dena.compute-node-supervisor-snapshot.v1",
      activeChildren: 0,
      launchingChildren: 0,
      readyChildren: 0,
      terminationRequestedChildren: 0,
      retainedLaunchSignals: 0,
      armedLaunchTimers: 0,
      armedTerminationTimers: 0,
    });

    const crashing = supervisor("crash");
    const crashingChild = await crashing.spawn(
      launchContext("crash"),
      launchControl(),
    );
    await expect(crashingChild.termination).resolves.toMatchObject({
      kind: "crashed",
      exitCode: 23,
      signal: null,
    });
    expect(crashing.snapshot().activeChildren).toBe(0);
  });

  it("makes duplicate termination idempotent and cleans timers, listeners, and live registry", async () => {
    const target = supervisor("wait", 100);
    const child = await target.spawn(
      launchContext("duplicate-termination"),
      launchControl(),
    );
    await Promise.all([
      target.requestTermination(child.childId, "cancelled"),
      target.requestTermination(child.childId, "deadline"),
      target.requestTermination(child.childId, "cancelled"),
    ]);
    expect(target.snapshot()).toMatchObject({
      activeChildren: 1,
      terminationRequestedChildren: 1,
      armedTerminationTimers: 1,
    });
    await expect(child.termination).resolves.toMatchObject({
      kind: "terminated",
      exitCode: 0,
      signal: null,
    });
    await expect(
      target.requestTermination(child.childId, "cancelled"),
    ).resolves.toBeUndefined();
    expect(target.snapshot()).toMatchObject({
      activeChildren: 0,
      armedTerminationTimers: 0,
    });
  });

  it("aborts before ready, waits for observed close, and never retains abort reason or child output", async () => {
    const target = supervisor("delayed-ready", 100);
    const controller = new AbortController();
    const pending = target.spawn(
      launchContext("abort-before-ready"),
      launchControl(controller, 3_000),
    );
    await waitFor(() => target.snapshot().activeChildren === 1);
    controller.abort(`${PRIVATE_FIXTURE_OUTPUT}:abort-reason`);
    const rejected = await pending.catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(NodeComputeProcessSupervisorError);
    expect(rejected).toMatchObject({ code: "LAUNCH_ABORTED" });
    expect(String(rejected)).not.toContain(PRIVATE_FIXTURE_OUTPUT);
    expect(JSON.stringify(rejected)).not.toContain(PRIVATE_FIXTURE_OUTPUT);
    expect(Object.prototype.hasOwnProperty.call(rejected, "cause")).toBe(false);
    expect(target.snapshot()).toMatchObject({
      activeChildren: 0,
      launchingChildren: 0,
      retainedLaunchSignals: 0,
      armedLaunchTimers: 0,
      armedTerminationTimers: 0,
    });
  });

  it("fails closed on an unknown ready field without retaining IPC payload content", async () => {
    const target = supervisor("invalid-ready", 100);
    const rejected = await target
      .spawn(launchContext("invalid-ready"), launchControl())
      .catch((error: unknown) => error);
    expect(rejected).toBeInstanceOf(NodeComputeProcessSupervisorError);
    expect(rejected).toMatchObject({ code: "CHILD_PROTOCOL_VIOLATION" });
    expect(String(rejected)).not.toContain(PRIVATE_FIXTURE_OUTPUT);
    expect(JSON.stringify(rejected)).not.toContain(PRIVATE_FIXTURE_OUTPUT);
    expect(Object.prototype.hasOwnProperty.call(rejected, "cause")).toBe(false);
    expect(target.snapshot().activeChildren).toBe(0);
  });

  it("escalates an ignored SIGTERM to SIGKILL and resolves only after close", async () => {
    const graceMs = 40;
    const target = supervisor("ignore-term", graceMs);
    const child = await target.spawn(
      launchContext("sigkill-escalation"),
      launchControl(),
    );
    const requestedAt = Date.now();
    await target.requestTermination(child.childId, "cancelled");
    let settled = false;
    void child.termination.then(() => {
      settled = true;
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(settled).toBe(false);
    const termination = await child.termination;
    const elapsedMs = Date.now() - requestedAt;
    expect(elapsedMs).toBeGreaterThanOrEqual(graceMs - 10);
    expect(elapsedMs).toBeLessThan(1_500);
    expect(termination).toMatchObject({
      kind: "terminated",
      exitCode: null,
      signal: "SIGKILL",
    });
    expect(target.snapshot().activeChildren).toBe(0);
  });

  it("keeps a core capacity slot occupied until the real child close is observed", async () => {
    const processSupervisor = supervisor("slow-term", 500);
    const repository = new InMemoryComputeTaskRepository();
    const objectStore = new InMemoryComputeObjectStore();
    const clock = new SystemClock();
    const service = new ComputeServiceCore({
      repository,
      objectStore,
      processSupervisor,
      auditSink: new InMemoryComputeAuditSink(),
      clock,
      idFactory: new SequenceComputeIdFactory(),
      maxConcurrency: 1,
      maxLeaseDurationMs: 10_000,
      maxProcessLaunchDurationMs: 2_000,
    });
    const taskId = "node-slot-observation";
    const input = (
      await objectStore.putImmutable(
        `inputs/${taskId}.bin`,
        new TextEncoder().encode("private-fixture-input"),
      )
    ).descriptor;
    const now = clock.now();
    const request: ComputeTaskRequestV1 = {
      version: COMPUTE_TASK_REQUEST_VERSION,
      owner: {
        contractVersion: COMPUTE_TASK_OWNER_CONTRACT_VERSION,
        datasetHash: DATASET_HASH,
        specHash: SPEC_HASH,
        runId: "run-node-slot-observation",
        taskId,
      },
      taskKind: "fixture-compute",
      input,
      deadlineAtMs: now + 8_000,
      expiresAtMs: now + 12_000,
    };
    await service.createTask(request);
    const lease = await service.claimTask(taskId, {
      leaseId: "lease-node-slot-observation",
      holderId: "fixture-worker",
      durationMs: 5_000,
    });
    const running = await service.executeTask(taskId, lease);
    expect(running.state).toBe("running");
    expect(service.capacitySnapshot().occupied).toBe(1);

    const cancelling = await service.cancelTask(taskId);
    expect(cancelling.state).toBe("cancelling");
    expect(service.capacitySnapshot().occupied).toBe(1);
    await new Promise<void>((resolve) => setTimeout(resolve, 40));
    expect(processSupervisor.snapshot().activeChildren).toBe(1);
    expect(service.capacitySnapshot().occupied).toBe(1);

    await service.settleBackground();
    expect((await service.getTask(taskId))?.state).toBe("cancelled");
    expect(processSupervisor.snapshot().activeChildren).toBe(0);
    expect(service.capacitySnapshot().occupied).toBe(0);
  });
});
