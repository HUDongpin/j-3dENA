import { analyzeTrajectoryDynamicsV1 } from "./analyze";
import { rejectTrajectoryDynamics } from "./errors";
import type {
  TrajectoryIdentityComponentV1,
  TrajectoryIdentityV1,
  TrajectoryKeyV1,
  TrajectoryPathSetInputV2,
  TrajectoryPathSetResultV2,
} from "./types";

function finiteDoubleBits(value: number): string {
  const bytes = new ArrayBuffer(8);
  const view = new DataView(bytes);
  view.setFloat64(0, value, false);
  return view.getBigUint64(0, false).toString(16).padStart(16, "0");
}

function identityToken(component: TrajectoryIdentityComponentV1, path: string): [string, string, string, string] {
  if (!component || typeof component !== "object" || typeof component.name !== "string" || component.name.trim() === "") {
    rejectTrajectoryDynamics("INVALID_IDENTITY_COMPONENT", path, "must have a non-empty component name");
  }
  if (component.type === "string" && typeof component.value === "string" && component.value !== "") {
    return [component.name, "string", component.declaredType ?? "string", component.value];
  }
  if (component.type === "boolean" && typeof component.value === "boolean") {
    return [component.name, "boolean", component.declaredType ?? "boolean", component.value ? "true" : "false"];
  }
  if (component.type === "number" && typeof component.value === "number" && Number.isFinite(component.value)) {
    if (Number.isInteger(component.value) && !Number.isSafeInteger(component.value)) {
      rejectTrajectoryDynamics("UNSAFE_INTEGER_IDENTITY", `${path}.value`, "unsafe integer identities must be lossless strings");
    }
    return [component.name, "number", component.declaredType ?? "double", finiteDoubleBits(component.value)];
  }
  rejectTrajectoryDynamics("INVALID_IDENTITY_VALUE", `${path}.value`, "declared identity type must match its finite value");
}

function normalizeIdentity(identity: TrajectoryIdentityV1, path: string): TrajectoryKeyV1 {
  if (!identity || !Array.isArray(identity.components) || identity.components.length === 0) {
    rejectTrajectoryDynamics("INVALID_TRAJECTORY_IDENTITY", path, "must contain at least one typed component");
  }
  const names = new Set<string>();
  const entries = identity.components.map((component, index) => {
    const token = identityToken(component, `${path}.components[${index}]`);
    if (names.has(component.name)) {
      rejectTrajectoryDynamics("DUPLICATE_IDENTITY_COMPONENT", `${path}.components[${index}].name`, "duplicates an earlier component name");
    }
    names.add(component.name);
    return { component: { ...component }, token };
  });
  return {
    components: entries.map(({ component }) => component),
    canonical: JSON.stringify(entries.map(({ token }) => token)),
    display: entries.map(({ component }) => String(component.value)).join(" · "),
  };
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

/** Executes every valid group against one shared dimension, period and cohort contract. */
export function analyzeTrajectoryPathSetV2(input: TrajectoryPathSetInputV2): TrajectoryPathSetResultV2 {
  if (!input || typeof input !== "object" || input.schemaVersion !== "3dena.trajectory-path-set-input.v2") {
    rejectTrajectoryDynamics("UNKNOWN_TRAJECTORY_PATH_SET_VERSION", "input.schemaVersion", "must be 3dena.trajectory-path-set-input.v2");
  }
  if (!Array.isArray(input.groups) || input.groups.length === 0) {
    rejectTrajectoryDynamics("EMPTY_TRAJECTORY_GROUPS", "input.groups", "must contain at least one group");
  }
  const seen = new Set<string>();
  const groups = input.groups.map((group, index) => {
    if (!group || typeof group !== "object") {
      rejectTrajectoryDynamics("INVALID_TRAJECTORY_GROUP", `input.groups[${index}]`, "must be an object");
    }
    const key = normalizeIdentity(group.group, `input.groups[${index}].group`);
    if (seen.has(key.canonical)) {
      rejectTrajectoryDynamics("DUPLICATE_TRAJECTORY_GROUP", `input.groups[${index}].group`, "duplicates an earlier typed group identity");
    }
    seen.add(key.canonical);
    const dynamics = analyzeTrajectoryDynamicsV1({
      schemaVersion: "3dena.trajectory-dynamics-input.v1",
      namespace: group.namespace,
      dimensions: [...input.dimensions],
      selectedDimensions: [...input.selectedDimensions],
      periods: input.periods.map((period) => ({
        time: { components: period.time.components.map((component) => ({ ...component })) },
        value: { ...period.value },
      })),
      cohortPolicy: input.cohortPolicy,
      estimand: { ...input.estimand },
      points: group.points.map((point) => ({
        participant: { components: point.participant.components.map((component) => ({ ...component })) },
        time: { components: point.time.components.map((component) => ({ ...component })) },
        coordinates: [...point.coordinates],
        ...(point.weight === undefined ? {} : { weight: point.weight }),
      })),
      ...(input.limits ? { limits: { ...input.limits } } : {}),
    });
    return { group: key, dynamics };
  });
  return deepFreeze({
    schemaVersion: "3dena.trajectory-path-set.v2",
    dimensions: [...input.dimensions],
    selectedDimensions: [...input.selectedDimensions],
    cohortPolicy: input.cohortPolicy,
    estimand: { ...input.estimand },
    groups,
    summary: {
      groups: groups.length,
      participants: groups.reduce((sum, group) => sum + group.dynamics.summary.participants, 0),
      participantPeriods: groups.reduce((sum, group) => sum + group.dynamics.summary.participantPeriods, 0),
      duplicateRows: groups.reduce((sum, group) => sum + group.dynamics.summary.duplicateRows, 0),
      missingGroupPeriods: groups.reduce((sum, group) => sum + group.dynamics.summary.missingPeriods, 0),
    },
    evidence: {
      status: "IMPLEMENTED_UNVERIFIED",
      scientificAuthority: "jena-js-and-versioned-3dena-contract",
      rEnaOracle: false,
    },
  });
}
