import type { PValueAdjustmentMethod } from "./types";
import { deepFreeze, reject } from "./types";

function validate(pValues: readonly number[]): void {
  pValues.forEach((value, index) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
      reject("INVALID_P_VALUE", `pValues[${index}]`, "must be finite and in [0, 1]");
    }
  });
}

export function adjustPValues(
  pValues: readonly number[],
  method: PValueAdjustmentMethod,
): number[] {
  validate(pValues);
  if (!(["none", "holm", "bh", "bonferroni"] as const).includes(method)) {
    reject("INVALID_ADJUSTMENT", "method", "must be none, holm, bh, or bonferroni");
  }
  const count = pValues.length;
  if (method === "none") return deepFreeze([...pValues]);
  if (method === "bonferroni") {
    return deepFreeze(pValues.map((value) => Math.min(1, value * count)));
  }
  const ordered = pValues
    .map((value, index) => ({ value, index }))
    .sort((left, right) => left.value - right.value || left.index - right.index);
  const adjusted = Array.from({ length: count }, () => 0);
  if (method === "holm") {
    let running = 0;
    ordered.forEach((entry, rank) => {
      running = Math.max(running, Math.min(1, entry.value * (count - rank)));
      adjusted[entry.index] = running;
    });
    return deepFreeze(adjusted);
  }
  let running = 1;
  for (let rank = count - 1; rank >= 0; rank -= 1) {
    const entry = ordered[rank]!;
    running = Math.min(running, (entry.value * count) / (rank + 1));
    adjusted[entry.index] = Math.min(1, running);
  }
  return deepFreeze(adjusted);
}
