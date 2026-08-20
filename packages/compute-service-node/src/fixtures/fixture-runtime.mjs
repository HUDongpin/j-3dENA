const PROTOCOL_VERSION = "3dena.compute-node-ipc.v1";
const PRIVATE_FIXTURE_OUTPUT =
  "FIXTURE_PRIVATE_PARTICIPANT_SECRET_OUTPUT_MUST_NEVER_ESCAPE";

function sendReady(executionId, afterSend) {
  if (typeof process.send !== "function") process.exit(90);
  process.send(
    {
      version: PROTOCOL_VERSION,
      type: "ready",
      executionId,
    },
    (error) => {
      if (error) process.exit(91);
      afterSend();
    },
  );
}

function keepAlive() {
  setInterval(() => {}, 1_000);
}

export function runFixture(mode) {
  process.stdout.write(`${PRIVATE_FIXTURE_OUTPUT}:stdout\n`);
  process.stderr.write(`${PRIVATE_FIXTURE_OUTPUT}:stderr\n`);
  process.once("message", (message) => {
    if (
      typeof message !== "object" ||
      message === null ||
      message.version !== PROTOCOL_VERSION ||
      message.type !== "launch" ||
      typeof message.context !== "object" ||
      message.context === null ||
      typeof message.context.executionId !== "string"
    ) {
      process.exit(92);
    }
    const executionId = message.context.executionId;
    if (mode === "invalid-ready") {
      process.send(
        {
          version: PROTOCOL_VERSION,
          type: "ready",
          executionId,
          privateOutput: PRIVATE_FIXTURE_OUTPUT,
        },
        () => keepAlive(),
      );
      return;
    }
    if (mode === "delayed-ready") {
      setTimeout(() => sendReady(executionId, keepAlive), 10_000);
      return;
    }
    if (mode === "ignore-term") {
      process.on("SIGTERM", () => {});
    }
    if (mode === "slow-term") {
      process.on("SIGTERM", () => {
        setTimeout(() => process.exit(0), 150);
      });
    }
    if (mode === "wait") {
      process.on("SIGTERM", () => process.exit(0));
    }
    sendReady(executionId, () => {
      if (mode === "normal") {
        setTimeout(() => process.exit(0), 25);
        return;
      }
      if (mode === "crash") {
        setTimeout(() => process.exit(23), 25);
        return;
      }
      if (mode === "ignore-term") {
        keepAlive();
        return;
      }
      if (mode === "slow-term") {
        keepAlive();
        return;
      }
      if (mode === "wait") {
        keepAlive();
        return;
      }
      process.exit(93);
    });
  });
}
