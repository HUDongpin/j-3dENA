export const AI_ENABLED_DEFAULT = false as const;
export const AI_AGGREGATE_REQUEST_VERSION_V1 = "3dena.ai-aggregate-request.v1" as const;
export const AI_AGGREGATE_ENVELOPE_VERSION_V1 = "3dena.ai-aggregate-envelope.v1" as const;
export const AI_INVOCATION_RECEIPT_VERSION_V1 = "3dena.ai-invocation-receipt.v1" as const;

export type AiAggregateMetricV1 =
  | "coordinate-mean"
  | "coordinate-standard-deviation"
  | "coordinate-mean-difference"
  | "network-edge-mean"
  | "network-edge-difference"
  | "trajectory-centroid-coordinate"
  | "trajectory-step-distance"
  | "statistics-effect-size";

export type AiAggregateSeriesV1 = "overall" | "group-a" | "group-b" | "difference";

export interface AiAggregateCellV1 {
  metric: AiAggregateMetricV1;
  series: AiAggregateSeriesV1;
  value: number;
  sampleSize: number;
  dimension?: string;
  edgeOrdinal?: number;
  periodOrdinal?: number;
}

export interface AiAggregateRequestV1 {
  schemaVersion: typeof AI_AGGREGATE_REQUEST_VERSION_V1;
  purpose: "aggregate-interpretation";
  consent: {
    schemaVersion: "3dena.ai-consent.v1";
    confirmed: true;
    policyVersion: "3dena.ai-privacy-policy.v1";
    confirmedAt: string;
  };
  suppression: {
    schemaVersion: "3dena.ai-suppression.v1";
    minimumSampleSize: number;
  };
  aggregates: AiAggregateCellV1[];
}

export interface AiAggregateEnvelopeV1 {
  schemaVersion: typeof AI_AGGREGATE_ENVELOPE_VERSION_V1;
  purpose: "aggregate-interpretation";
  policyVersion: "3dena.ai-privacy-policy.v1";
  suppression: {
    minimumSampleSize: number;
    inputCellCount: number;
    releasedCellCount: number;
    suppressedCellCount: number;
  };
  aggregates: ReadonlyArray<Readonly<AiAggregateCellV1>>;
}

export interface AiAggregateProviderV1 {
  generate(
    envelope: Readonly<AiAggregateEnvelopeV1>,
    options: { signal: AbortSignal },
  ): Promise<{ schemaVersion: "3dena.ai-provider-response.v1"; text: string }>;
}

export interface AiRateLimiterV1 {
  tryAcquire(rateLimitScopeHash: string): Promise<boolean>;
}

export interface InvokeAggregateAiOptionsV1 {
  /** Must be explicitly true. Omitting it preserves the default-off boundary. */
  enabled?: boolean;
  rateLimitScopeHash: string;
  deadlineEpochMilliseconds: number;
  rateLimiter: AiRateLimiterV1;
  provider: AiAggregateProviderV1;
}

export interface AiInvocationReceiptV1 {
  schemaVersion: typeof AI_INVOCATION_RECEIPT_VERSION_V1;
  status: "disabled" | "suppressed" | "rate-limited" | "succeeded" | "failed";
  code:
    | "AI_DISABLED"
    | "ALL_CELLS_SUPPRESSED"
    | "RATE_LIMITED"
    | "RATE_LIMIT_FAILURE"
    | "PROVIDER_FAILURE"
    | "PROVIDER_TIMEOUT"
    | "INVALID_PROVIDER_RESPONSE"
    | "SUCCEEDED";
  analysisMutated: false;
  releasedCellCount: number;
  suppressedCellCount: number;
  text: string | null;
  productStatus: "IMPLEMENTED_UNVERIFIED";
}

export class AiAggregateContractError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(`${path}: ${message}`);
    this.name = "AiAggregateContractError";
    this.code = code;
    this.path = path;
  }
}

const METRICS = new Set<AiAggregateMetricV1>([
  "coordinate-mean",
  "coordinate-standard-deviation",
  "coordinate-mean-difference",
  "network-edge-mean",
  "network-edge-difference",
  "trajectory-centroid-coordinate",
  "trajectory-step-distance",
  "statistics-effect-size",
]);
const SERIES = new Set<AiAggregateSeriesV1>(["overall", "group-a", "group-b", "difference"]);

function reject(code: string, path: string, message: string): never {
  throw new AiAggregateContractError(code, path, message);
}

function assertRecord(
  value: unknown,
  path: string,
  allowed: readonly string[],
): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    reject("INVALID_OBJECT", path, "must be an object");
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) reject("UNKNOWN_FIELD", `${path}.${key}`, "is not allowed by the aggregate-only v1 contract");
  }
}

function assertPositiveInteger(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) reject("INVALID_INTEGER", path, "must be a positive safe integer");
}

function assertOrdinal(value: unknown, path: string): asserts value is number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) reject("INVALID_ORDINAL", path, "must be a non-negative safe integer");
}

function validateAggregate(value: unknown, index: number): AiAggregateCellV1 {
  const path = `request.aggregates[${index}]`;
  assertRecord(value, path, ["metric", "series", "value", "sampleSize", "dimension", "edgeOrdinal", "periodOrdinal"]);
  if (!METRICS.has(value.metric as AiAggregateMetricV1)) reject("INVALID_METRIC", `${path}.metric`, "must use the fixed aggregate metric vocabulary");
  if (!SERIES.has(value.series as AiAggregateSeriesV1)) reject("INVALID_SERIES", `${path}.series`, "must use an ordinal series role");
  if (typeof value.value !== "number" || !Number.isFinite(value.value)) reject("NON_FINITE_VALUE", `${path}.value`, "must be finite");
  assertPositiveInteger(value.sampleSize, `${path}.sampleSize`);
  if (value.dimension !== undefined && (typeof value.dimension !== "string" || !/^SVD[1-9]\d*$/u.test(value.dimension))) {
    reject("INVALID_DIMENSION", `${path}.dimension`, "must be a canonical SVD axis");
  }
  if (value.edgeOrdinal !== undefined) assertOrdinal(value.edgeOrdinal, `${path}.edgeOrdinal`);
  if (value.periodOrdinal !== undefined) assertOrdinal(value.periodOrdinal, `${path}.periodOrdinal`);
  return {
    metric: value.metric as AiAggregateMetricV1,
    series: value.series as AiAggregateSeriesV1,
    value: value.value,
    sampleSize: value.sampleSize,
    ...(value.dimension === undefined ? {} : { dimension: value.dimension }),
    ...(value.edgeOrdinal === undefined ? {} : { edgeOrdinal: value.edgeOrdinal }),
    ...(value.periodOrdinal === undefined ? {} : { periodOrdinal: value.periodOrdinal }),
  };
}

/** Strictly validates and suppresses aggregate cells before any provider call. */
export function createAiAggregateEnvelopeV1(request: AiAggregateRequestV1): Readonly<AiAggregateEnvelopeV1> {
  assertRecord(request, "request", ["schemaVersion", "purpose", "consent", "suppression", "aggregates"]);
  if (request.schemaVersion !== AI_AGGREGATE_REQUEST_VERSION_V1) reject("UNKNOWN_VERSION", "request.schemaVersion", `must be ${AI_AGGREGATE_REQUEST_VERSION_V1}`);
  if (request.purpose !== "aggregate-interpretation") reject("INVALID_PURPOSE", "request.purpose", "must be aggregate-interpretation");
  assertRecord(request.consent, "request.consent", ["schemaVersion", "confirmed", "policyVersion", "confirmedAt"]);
  if (request.consent.schemaVersion !== "3dena.ai-consent.v1") reject("UNKNOWN_VERSION", "request.consent.schemaVersion", "must be 3dena.ai-consent.v1");
  if (request.consent.confirmed !== true) reject("CONSENT_REQUIRED", "request.consent.confirmed", "must be explicitly true");
  if (request.consent.policyVersion !== "3dena.ai-privacy-policy.v1") reject("UNKNOWN_POLICY", "request.consent.policyVersion", "must be 3dena.ai-privacy-policy.v1");
  if (typeof request.consent.confirmedAt !== "string" || Number.isNaN(Date.parse(request.consent.confirmedAt))) {
    reject("INVALID_TIMESTAMP", "request.consent.confirmedAt", "must be an ISO timestamp");
  }
  assertRecord(request.suppression, "request.suppression", ["schemaVersion", "minimumSampleSize"]);
  if (request.suppression.schemaVersion !== "3dena.ai-suppression.v1") reject("UNKNOWN_VERSION", "request.suppression.schemaVersion", "must be 3dena.ai-suppression.v1");
  assertPositiveInteger(request.suppression.minimumSampleSize, "request.suppression.minimumSampleSize");
  if (!Array.isArray(request.aggregates) || request.aggregates.length === 0 || request.aggregates.length > 5_000) {
    reject("INVALID_AGGREGATES", "request.aggregates", "must contain between 1 and 5,000 aggregate cells");
  }
  const cells = request.aggregates.map(validateAggregate);
  const released = cells
    .filter((cell) => cell.sampleSize >= request.suppression.minimumSampleSize)
    .map((cell) => Object.freeze({ ...cell }));
  return Object.freeze({
    schemaVersion: AI_AGGREGATE_ENVELOPE_VERSION_V1,
    purpose: "aggregate-interpretation",
    policyVersion: "3dena.ai-privacy-policy.v1",
    suppression: Object.freeze({
      minimumSampleSize: request.suppression.minimumSampleSize,
      inputCellCount: cells.length,
      releasedCellCount: released.length,
      suppressedCellCount: cells.length - released.length,
    }),
    aggregates: Object.freeze(released),
  });
}

function receipt(
  status: AiInvocationReceiptV1["status"],
  code: AiInvocationReceiptV1["code"],
  envelope: Readonly<AiAggregateEnvelopeV1>,
  text: string | null = null,
): Readonly<AiInvocationReceiptV1> {
  return Object.freeze({
    schemaVersion: AI_INVOCATION_RECEIPT_VERSION_V1,
    status,
    code,
    analysisMutated: false,
    releasedCellCount: envelope.suppression.releasedCellCount,
    suppressedCellCount: envelope.suppression.suppressedCellCount,
    text,
    productStatus: "IMPLEMENTED_UNVERIFIED",
  });
}

/**
 * Invokes an injected provider only after the aggregate, consent, suppression,
 * local rate-limit and deadline gates pass. It never surfaces provider errors.
 */
export async function invokeAggregateAiV1(
  request: AiAggregateRequestV1,
  options: InvokeAggregateAiOptionsV1,
): Promise<Readonly<AiInvocationReceiptV1>> {
  const envelope = createAiAggregateEnvelopeV1(request);
  assertRecord(options, "options", ["enabled", "rateLimitScopeHash", "deadlineEpochMilliseconds", "rateLimiter", "provider"]);
  if (options.enabled !== true) return receipt("disabled", "AI_DISABLED", envelope);
  if (!/^[a-f0-9]{64}$/u.test(options.rateLimitScopeHash)) reject("INVALID_RATE_LIMIT_SCOPE", "options.rateLimitScopeHash", "must be a lowercase SHA-256");
  if (!Number.isSafeInteger(options.deadlineEpochMilliseconds) || options.deadlineEpochMilliseconds <= Date.now()) {
    reject("INVALID_DEADLINE", "options.deadlineEpochMilliseconds", "must be a future epoch-millisecond safe integer");
  }
  if (!options.rateLimiter || typeof options.rateLimiter.tryAcquire !== "function") reject("INVALID_RATE_LIMITER", "options.rateLimiter", "must implement tryAcquire");
  if (!options.provider || typeof options.provider.generate !== "function") reject("INVALID_PROVIDER", "options.provider", "must implement generate");
  if (envelope.aggregates.length === 0) return receipt("suppressed", "ALL_CELLS_SUPPRESSED", envelope);
  let acquired: boolean;
  try {
    acquired = await options.rateLimiter.tryAcquire(options.rateLimitScopeHash);
  } catch {
    return receipt("failed", "RATE_LIMIT_FAILURE", envelope);
  }
  if (!acquired) return receipt("rate-limited", "RATE_LIMITED", envelope);

  const controller = new AbortController();
  const delay = options.deadlineEpochMilliseconds - Date.now();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, rejectDeadline) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      rejectDeadline(new Error("AI_PROVIDER_DEADLINE"));
    }, delay);
  });
  try {
    const response = await Promise.race([
      options.provider.generate(envelope, { signal: controller.signal }),
      deadline,
    ]);
    if (timedOut || Date.now() > options.deadlineEpochMilliseconds) return receipt("failed", "PROVIDER_TIMEOUT", envelope);
    if (
      typeof response !== "object"
      || response === null
      || Array.isArray(response)
      || Object.keys(response).some((key) => key !== "schemaVersion" && key !== "text")
      || response.schemaVersion !== "3dena.ai-provider-response.v1"
      || typeof response.text !== "string"
      || response.text.trim() === ""
      || response.text.length > 4_000
    ) {
      return receipt("failed", "INVALID_PROVIDER_RESPONSE", envelope);
    }
    return receipt("succeeded", "SUCCEEDED", envelope, response.text);
  } catch {
    return receipt("failed", timedOut ? "PROVIDER_TIMEOUT" : "PROVIDER_FAILURE", envelope);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
