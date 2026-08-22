import { describe, expect, it, vi } from "vitest";

import {
  AI_ENABLED_DEFAULT,
  AiAggregateContractError,
  createAiAggregateEnvelopeV1,
  invokeAggregateAiV1,
  type AiAggregateRequestV1,
} from "./index";

function request(): AiAggregateRequestV1 {
  return {
    schemaVersion: "3dena.ai-aggregate-request.v1",
    purpose: "aggregate-interpretation",
    consent: {
      schemaVersion: "3dena.ai-consent.v1",
      confirmed: true,
      policyVersion: "3dena.ai-privacy-policy.v1",
      confirmedAt: "2026-08-21T00:00:00.000Z",
    },
    suppression: { schemaVersion: "3dena.ai-suppression.v1", minimumSampleSize: 5 },
    aggregates: [
      { metric: "coordinate-mean", series: "group-a", dimension: "SVD1", value: 0.25, sampleSize: 8 },
      { metric: "network-edge-difference", series: "difference", edgeOrdinal: 2, value: -0.1, sampleSize: 3 },
    ],
  };
}

describe("aggregate-only AI v1", () => {
  it("is default-off and never calls the limiter or provider", async () => {
    expect(AI_ENABLED_DEFAULT).toBe(false);
    const rateLimiter = { tryAcquire: vi.fn(async () => true) };
    const provider = { generate: vi.fn(async () => ({ schemaVersion: "3dena.ai-provider-response.v1" as const, text: "ok" })) };
    const result = await invokeAggregateAiV1(request(), {
      rateLimitScopeHash: "a".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter,
      provider,
    });
    expect(result).toMatchObject({ status: "disabled", code: "AI_DISABLED", analysisMutated: false });
    expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("suppresses small cells before the frozen envelope reaches a provider", async () => {
    const provider = { generate: vi.fn(async (envelope: unknown) => {
      expect(Object.isFrozen(envelope)).toBe(true);
      expect(JSON.stringify(envelope)).not.toContain("network-edge-difference");
      return { schemaVersion: "3dena.ai-provider-response.v1" as const, text: "Aggregate interpretation." };
    }) };
    const result = await invokeAggregateAiV1(request(), {
      enabled: true,
      rateLimitScopeHash: "b".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter: { tryAcquire: async () => true },
      provider,
    });
    expect(result).toMatchObject({
      status: "succeeded",
      code: "SUCCEEDED",
      releasedCellCount: 1,
      suppressedCellCount: 1,
      text: "Aggregate interpretation.",
      productStatus: "IMPLEMENTED_UNVERIFIED",
    });
    expect(provider.generate).toHaveBeenCalledOnce();
  });

  it("rejects raw rows, participant identifiers, labels, prompts, and unknown fields", () => {
    for (const [field, value] of [
      ["rawRows", [{ participantId: "secret" }]],
      ["participantId", "secret"],
      ["fileName", "private.xlsx"],
      ["prompt", "private research context"],
    ] as const) {
      expect(() => createAiAggregateEnvelopeV1({ ...request(), [field]: value } as never)).toThrowError(AiAggregateContractError);
    }
    expect(() => createAiAggregateEnvelopeV1({
      ...request(),
      aggregates: [{ ...request().aggregates[0]!, groupLabel: "private cohort" }],
    } as never)).toThrow(/not allowed/);
  });

  it("returns a suppression receipt without rate-limit or provider traffic", async () => {
    const suppressed = request();
    suppressed.suppression.minimumSampleSize = 100;
    const rateLimiter = { tryAcquire: vi.fn(async () => true) };
    const provider = { generate: vi.fn(async () => ({ schemaVersion: "3dena.ai-provider-response.v1" as const, text: "no" })) };
    const result = await invokeAggregateAiV1(suppressed, {
      enabled: true,
      rateLimitScopeHash: "c".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter,
      provider,
    });
    expect(result).toMatchObject({ status: "suppressed", code: "ALL_CELLS_SUPPRESSED", releasedCellCount: 0 });
    expect(rateLimiter.tryAcquire).not.toHaveBeenCalled();
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("enforces local rate limiting", async () => {
    const provider = { generate: vi.fn(async () => ({ schemaVersion: "3dena.ai-provider-response.v1" as const, text: "no" })) };
    const result = await invokeAggregateAiV1(request(), {
      enabled: true,
      rateLimitScopeHash: "d".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter: { tryAcquire: async () => false },
      provider,
    });
    expect(result).toMatchObject({ status: "rate-limited", code: "RATE_LIMITED" });
    expect(provider.generate).not.toHaveBeenCalled();
  });

  it("isolates provider exceptions and invalid responses without exposing their messages", async () => {
    const secret = "participant-123 private context";
    const failed = await invokeAggregateAiV1(request(), {
      enabled: true,
      rateLimitScopeHash: "e".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter: { tryAcquire: async () => true },
      provider: { generate: async () => { throw new Error(secret); } },
    });
    expect(failed).toMatchObject({ status: "failed", code: "PROVIDER_FAILURE", text: null, analysisMutated: false });
    expect(JSON.stringify(failed)).not.toContain(secret);

    const invalid = await invokeAggregateAiV1(request(), {
      enabled: true,
      rateLimitScopeHash: "f".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 10_000,
      rateLimiter: { tryAcquire: async () => true },
      provider: { generate: async () => ({ schemaVersion: "wrong" as never, text: "x", secret } as never) },
    });
    expect(invalid).toMatchObject({ status: "failed", code: "INVALID_PROVIDER_RESPONSE", text: null });
    expect(JSON.stringify(invalid)).not.toContain(secret);
  });

  it("aborts and returns when a provider does not settle before the deadline", async () => {
    let observedSignal: AbortSignal | undefined;
    const result = await invokeAggregateAiV1(request(), {
      enabled: true,
      rateLimitScopeHash: "1".repeat(64),
      deadlineEpochMilliseconds: Date.now() + 20,
      rateLimiter: { tryAcquire: async () => true },
      provider: {
        generate: async (_envelope, options) => {
          observedSignal = options.signal;
          return await new Promise<never>(() => undefined);
        },
      },
    });
    expect(result).toMatchObject({ status: "failed", code: "PROVIDER_TIMEOUT", text: null });
    expect(observedSignal?.aborted).toBe(true);
  });
});
