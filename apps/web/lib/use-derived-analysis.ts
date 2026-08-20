"use client";

import {
  useEffect,
  useRef,
  useState,
} from "react";
import type {
  AnalysisResult,
  DatasetLimitsReceiptV1,
  DatasetSchemaV1,
  PreparedSpaceResult,
} from "@3dena/analysis";
import { readCurrentBuildId } from "@/lib/app-build-identity";
import type {
  DerivedAnalysisWorkerRequest,
  DerivedTaskOwner,
  PreparedDerivedIntent,
  RawDerivedIntent,
} from "@/lib/derived-analysis-protocol";
import {
  createPreparedDatasetReceipt,
  isDerivedAnalysisWorkerRequest,
  isDerivedAnalysisWorkerResponse,
} from "@/lib/derived-analysis-protocol";
import type { AnalysisResultEnvelopeV1, AnalysisTaskResultV1 } from "@3dena/analysis";
import type { RunOwner } from "@/lib/worker-protocol";

export type DerivedRunStatus =
  | "idle"
  | "running"
  | "completed"
  | "stale"
  | "cancelled"
  | "error";

export interface RawDerivedSource {
  mode: "raw";
  name: string;
  byteLength: number;
  rows: number;
  columns: number;
  schema: DatasetSchemaV1;
  limits: DatasetLimitsReceiptV1;
  result: AnalysisResult;
}

export interface PreparedDerivedSource {
  mode: "prepared";
  result: PreparedSpaceResult;
}

export type DerivedSource = RawDerivedSource | PreparedDerivedSource;

type DerivedEnvelope = AnalysisResultEnvelopeV1<AnalysisTaskResultV1>;

export interface DerivedAnalysisState {
  status: DerivedRunStatus;
  message: string;
  envelope: DerivedEnvelope | null;
  owner: DerivedTaskOwner | null;
  errorCode: string | null;
}

const INITIAL_STATE: DerivedAnalysisState = {
  status: "idle",
  message: "Choose the analysis controls, then run this derived task.",
  envelope: null,
  owner: null,
  errorCode: null,
};

function uniqueTaskId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function sameOwner(
  left: DerivedTaskOwner | null,
  right: DerivedTaskOwner,
): boolean {
  return Boolean(
    left
      && left.datasetHash === right.datasetHash
      && left.specHash === right.specHash
      && left.runId === right.runId
      && left.taskId === right.taskId,
  );
}

export function useDerivedAnalysis(
  source: DerivedSource,
  owner: RunOwner,
): {
  state: DerivedAnalysisState;
  run: (intent: RawDerivedIntent | PreparedDerivedIntent) => Promise<void>;
  markStale: () => void;
  cancel: () => void;
} {
  const [state, setState] = useState<DerivedAnalysisState>(INITIAL_STATE);
  const workerRef = useRef<Worker | null>(null);
  const activeOwnerRef = useRef<DerivedTaskOwner | null>(null);
  const generationRef = useRef(0);

  useEffect(() => () => {
    generationRef.current += 1;
    activeOwnerRef.current = null;
    workerRef.current?.terminate();
    workerRef.current = null;
  }, []);

  function stopWorker(): void {
    workerRef.current?.terminate();
    workerRef.current = null;
    activeOwnerRef.current = null;
  }

  function markStale(): void {
    generationRef.current += 1;
    stopWorker();
    setState((current) => current.status === "idle"
      ? current
      : {
          status: "stale",
          message: "Controls changed. Run again before using or downloading this result.",
          envelope: null,
          owner: null,
          errorCode: null,
        });
  }

  function cancel(): void {
    if (state.status !== "running") return;
    generationRef.current += 1;
    stopWorker();
    setState({
      status: "cancelled",
      message: "Derived analysis cancelled. Its Worker was hard-terminated.",
      envelope: null,
      owner: null,
      errorCode: null,
    });
  }

  async function run(intent: RawDerivedIntent | PreparedDerivedIntent): Promise<void> {
    generationRef.current += 1;
    const generation = generationRef.current;
    stopWorker();
    const taskOwner: DerivedTaskOwner = {
      ...owner,
      taskId: `${intent.kind}-${uniqueTaskId()}`,
    };
    activeOwnerRef.current = taskOwner;
    setState({
      status: "running",
      message: "Running in a dedicated browser Worker…",
      envelope: null,
      owner: taskOwner,
      errorCode: null,
    });

    try {
      const buildId = await readCurrentBuildId();
      if (generation !== generationRef.current || !sameOwner(activeOwnerRef.current, taskOwner)) {
        return;
      }
      const worker = new Worker(
        new URL("../workers/derived-analysis.worker.ts", import.meta.url),
        { type: "module", name: `derived-${taskOwner.taskId}` },
      );
      workerRef.current = worker;

      worker.onmessage = (event: MessageEvent<unknown>) => {
        const response = event.data;
        if (
          generation !== generationRef.current
          || workerRef.current !== worker
        ) {
          return;
        }
        if (!isDerivedAnalysisWorkerResponse(response)) {
          worker.terminate();
          workerRef.current = null;
          activeOwnerRef.current = null;
          setState({
            status: "error",
            message: "The derived-analysis Worker returned an invalid result envelope.",
            envelope: null,
            owner: taskOwner,
            errorCode: "INVALID_DERIVED_WORKER_RESPONSE",
          });
          return;
        }
        if (!sameOwner(activeOwnerRef.current, response.owner)) {
          worker.terminate();
          workerRef.current = null;
          activeOwnerRef.current = null;
          setState({
            status: "error",
            message: "The derived-analysis Worker returned a result for a different task owner.",
            envelope: null,
            owner: taskOwner,
            errorCode: "DERIVED_OWNER_MISMATCH",
          });
          return;
        }
        worker.terminate();
        workerRef.current = null;
        activeOwnerRef.current = null;
        if (response.type === "derived-error") {
          setState({
            status: "error",
            message: response.message,
            envelope: null,
            owner: response.owner,
            errorCode: response.code,
          });
          return;
        }
        setState({
          status: "completed",
          message:
            response.type === "raw-derived-result"
              ? "Derived AnalysisTask completed with immutable ownership and a result hash."
              : "Prepared precomputed reduction completed without a raw jENA refit.",
          envelope: response.envelope,
          owner: response.owner,
          errorCode: null,
        });
      };

      worker.onerror = (error) => {
        if (
          generation !== generationRef.current
          || workerRef.current !== worker
          || !sameOwner(activeOwnerRef.current, taskOwner)
        ) {
          return;
        }
        error.preventDefault();
        worker.terminate();
        workerRef.current = null;
        activeOwnerRef.current = null;
        setState({
          status: "error",
          message: error.message || "The derived-analysis Worker stopped unexpectedly.",
          envelope: null,
          owner: taskOwner,
          errorCode: "DERIVED_WORKER_CRASH",
        });
      };

      const request: DerivedAnalysisWorkerRequest = source.mode === "raw"
        ? {
            v: 1,
            kind: "execute-raw-derived",
            owner: taskOwner,
            buildId,
            source: {
              name: source.name,
              byteLength: source.byteLength,
              rows: source.rows,
              columns: source.columns,
              schema: source.schema,
              limits: source.limits,
              result: source.result,
            },
            intent: intent as RawDerivedIntent,
          }
        : {
            v: 1,
            kind: "execute-prepared-derived",
            owner: taskOwner,
            buildId,
            source: {
              receipt: createPreparedDatasetReceipt(source.result),
              result: source.result,
            },
            intent: intent as PreparedDerivedIntent,
          };
      if (!isDerivedAnalysisWorkerRequest(request)) {
        throw new Error("The derived task does not match the immutable Worker protocol.");
      }
      worker.postMessage(request);
    } catch (error) {
      if (generation !== generationRef.current) return;
      stopWorker();
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Derived analysis could not start.",
        envelope: null,
        owner: taskOwner,
        errorCode: "DERIVED_START_FAILURE",
      });
    }
  }

  return { state, run, markStale, cancel };
}
