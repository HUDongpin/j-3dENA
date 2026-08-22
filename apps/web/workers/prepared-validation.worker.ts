/// <reference lib="webworker" />

import {
  decodeEna3dExchangeV1WithSha256,
  Ena3dExchangeDecodeError,
} from "@3dena/io";
import { inspectPreparedExchange } from "@/lib/prepared-class1";
import {
  isPreparedValidationWorkerRequest,
  type PreparedValidationWorkerResponse,
} from "@/lib/worker-protocol";

const workerScope: DedicatedWorkerGlobalScope =
  self as DedicatedWorkerGlobalScope;

function post(response: PreparedValidationWorkerResponse): void {
  workerScope.postMessage(response);
}

function errorMessage(error: unknown): string {
  if (error instanceof Ena3dExchangeDecodeError) {
    return `${error.code}: ${error.message}`;
  }
  return error instanceof Error
    ? error.message
    : "The prepared exchange could not be validated.";
}

workerScope.addEventListener("message", async (event: MessageEvent<unknown>) => {
  if (!isPreparedValidationWorkerRequest(event.data)) return;
  const request = event.data;
  try {
    const artifact = await decodeEna3dExchangeV1WithSha256(
      request.input.bytes,
    );
    const summary = inspectPreparedExchange(artifact.exchange);
    post({
      type: "prepared-validated",
      requestId: request.requestId,
      receipt: {
        ...summary,
        sha256: artifact.sha256,
        byteLength: artifact.byteLength,
      },
    });
  } catch (error) {
    post({
      type: "prepared-validation-error",
      requestId: request.requestId,
      message: errorMessage(error),
    });
  }
});

export {};
