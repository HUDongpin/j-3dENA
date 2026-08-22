import { describe, expect, it } from "vitest";

import {
  DegenerateSubspaceComparisonError,
  compareDegenerateSubspacesV1,
  type CompareDegenerateSubspacesInputV1,
} from "./subspace";

function candidate(
  actualValues: number[][],
  expectedValues: number[][] = [[1, 0], [0, 1], [0, 0]],
): CompareDegenerateSubspacesInputV1 {
  return {
    schemaVersion: "3dena.degenerate-subspace-input.v1",
    blockId: "SVD1:SVD2",
    actual: {
      rowKeys: ["A & B", "A & C", "B & C"],
      columns: ["SVD1", "SVD2"],
      values: actualValues,
    },
    expected: {
      rowKeys: ["A & B", "A & C", "B & C"],
      columns: ["SVD1", "SVD2"],
      values: expectedValues,
    },
    tolerance: {
      projectionMaxAbsolute: 1e-12,
      projectionFrobenius: 1e-12,
      rankRelative: 1e-12,
    },
  };
}

describe("compareDegenerateSubspacesV1", () => {
  it("accepts an arbitrary orthogonal rotation inside a tied block without approving parity", () => {
    const inverseRootTwo = 1 / Math.sqrt(2);
    const result = compareDegenerateSubspacesV1(candidate([
      [inverseRootTwo, -inverseRootTwo],
      [inverseRootTwo, inverseRootTwo],
      [0, 0],
    ]));

    expect(result).toMatchObject({
      schemaVersion: "3dena.degenerate-subspace-comparison.v1",
      status: "candidate-pass",
      approvedForParity: false,
      rowCount: 3,
      dimension: 2,
    });
    expect(result.projectionMaxAbsoluteError).toBeLessThan(1e-15);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("accepts axis permutation, sign, and non-zero scaling when the span is unchanged", () => {
    const input = candidate([[0, -2], [3, 0], [0, 0]]);
    input.actual.columns = ["SVD2", "SVD1"];
    expect(compareDegenerateSubspacesV1(input).status).toBe("candidate-pass");
  });

  it("fails a genuinely different subspace", () => {
    const result = compareDegenerateSubspacesV1(candidate([[1, 0], [0, 0], [0, 1]]));
    expect(result.status).toBe("candidate-fail");
    expect(result.approvedForParity).toBe(false);
    expect(result.projectionMaxAbsoluteError).toBe(1);
    expect(result.projectionFrobeniusError).toBeCloseTo(Math.sqrt(2));
  });

  it("rejects row-identity drift before numerical comparison", () => {
    const input = candidate([[1, 0], [0, 1], [0, 0]]);
    input.actual.rowKeys.reverse();
    expect(() => compareDegenerateSubspacesV1(input)).toThrowError(DegenerateSubspaceComparisonError);
    try {
      compareDegenerateSubspacesV1(input);
    } catch (error) {
      expect(error).toMatchObject({ code: "ROW_IDENTITY_MISMATCH", path: "input.actual.rowKeys" });
    }
  });

  it("rejects rank-deficient and non-finite candidate bases", () => {
    expect(() => compareDegenerateSubspacesV1(candidate([[1, 2], [0, 0], [0, 0]]))).toThrow(/linearly dependent/);
    expect(() => compareDegenerateSubspacesV1(candidate([[1, 0], [0, Number.NaN], [0, 0]]))).toThrow(/must be finite/);
  });

  it("rejects unknown fields and axis-inventory drift", () => {
    const unknown = { ...candidate([[1, 0], [0, 1], [0, 0]]), secret: true };
    expect(() => compareDegenerateSubspacesV1(unknown as never)).toThrow(/not allowed/);
    const axes = candidate([[1, 0], [0, 1], [0, 0]]);
    axes.actual.columns = ["SVD1", "SVD3"];
    expect(() => compareDegenerateSubspacesV1(axes)).toThrow(/same unique axis inventory/);
  });
});
