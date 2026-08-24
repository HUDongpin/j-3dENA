import type { Data, Layout } from "plotly.js";
import { describe, expect, it } from "vitest";
import {
  buildPreparedClass1PlotCandidate,
  PREPARED_CLASS1_AXIS_CONE_SIZE,
  PREPARED_CLASS1_DIRECTION_CONE_SIZE,
  PREPARED_CLASS1_DIRECTION_POSITION,
  PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
  preparedClass1TrajectorySegments,
  type PreparedClass1PlotCandidateInput,
  type PreparedClass1TraceMeta,
} from "@/lib/prepared-class1-plot-candidate";

interface TraceInspection {
  type?: string;
  mode?: string;
  x?: Array<number | null>;
  y?: Array<number | null>;
  z?: Array<number | null>;
  u?: number[];
  v?: number[];
  w?: number[];
  text?: string[];
  anchor?: string;
  sizemode?: string;
  sizeref?: number;
  connectgaps?: boolean;
  line?: { color?: string; width?: number };
  marker?: {
    symbol?: string;
    color?: string | string[];
    size?: number | number[];
    line?: { color?: string; width?: number };
  };
  colorscale?: Array<[number, string]>;
  textfont?: { color?: string; family?: string; size?: number };
  meta?: PreparedClass1TraceMeta;
}

const codeNodes = [
  {
    key: "TE",
    label: "TE",
    coordinates: [
      0.4716520478426536, 0.8131726734716076, 0.9714223899280202,
    ],
  },
  {
    key: "EX",
    label: "EX",
    coordinates: [
      1.1543081951832195, 0.7905226578120537, -1.2144782362969124,
    ],
  },
  {
    key: "IN",
    label: "IN",
    coordinates: [
      1.2856488012659597, -1.538845048065197, 0.5060561451514065,
    ],
  },
  {
    key: "RE",
    label: "RE",
    coordinates: [
      0.8152989720746988, -0.1820229374157856, 0.010606494884963215,
    ],
  },
  {
    key: "SP",
    label: "SP",
    coordinates: [
      -0.38608077570450905, 0.8863265350538209, 1.0610389969396767,
    ],
  },
  {
    key: "TP",
    label: "TP",
    coordinates: [
      -1.3110066381034107, -1.042733915465028, -0.6898638950302495,
    ],
  },
] as const;

const g1Coordinates = [
  [0.6394144884426007, -0.3792425529886641, -0.1310815174378354],
  [0.3417844482687487, 0.09671376249289439, -0.4096577891448308],
  [-0.09952644409067549, -0.27802358967294516, -0.13581309124456592],
] as const;

const preparedCandidateInput = {
  unitPoints: [
    {
      key: "Synthetic group A::participant-a::Period 1",
      label: "participant-a",
      periodLabel: "TP1",
      coordinates: [
        0.6896269162101611, -0.4182992944665577, -0.1232296652787858,
      ],
      color: "#A11B1B",
    },
    {
      key: "Synthetic group A::participant-b::Period 1",
      label: "participant-b",
      periodLabel: "TP1",
      coordinates: [
        0.4970634611306061, -0.511931679936211, -0.4942580707845609,
      ],
      color: "#A11B1B",
    },
  ],
  codeNodes,
  paths: [
    {
      key: "cohort=synthetic-alpha",
      label: "Synthetic Alpha",
      color: "#2F2F2F",
      steps: [
        {
          periodKey: "TP1",
          periodLabel: "TP1",
          timeOrder: 1,
          coordinates: g1Coordinates[0],
          participantCount: 5,
          markerColor: "#A11B1B",
        },
        {
          periodKey: "TP2",
          periodLabel: "TP2",
          timeOrder: 2,
          coordinates: g1Coordinates[1],
          participantCount: 3,
          markerColor: "#B7791F",
        },
        {
          periodKey: "TP3",
          periodLabel: "TP3",
          timeOrder: 3,
          coordinates: g1Coordinates[2],
          participantCount: 5,
          markerColor: "#1F6E5A",
        },
      ],
    },
  ],
} as const satisfies PreparedClass1PlotCandidateInput;

function inspect(trace: Data): TraceInspection {
  return trace as unknown as TraceInspection;
}

function byRole(
  traces: Data[],
  role: PreparedClass1TraceMeta["trajectory_role"],
): TraceInspection[] {
  return traces
    .map(inspect)
    .filter((trace) => trace.meta?.trajectory_role === role);
}

function expectCoordinateClose(
  actual: readonly (number | null)[] | undefined,
  expected: readonly number[],
  digits = 12,
) {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => {
    const actualValue = actual?.[index];
    expect(actualValue).not.toBeNull();
    expect(actualValue).toBeCloseTo(value, digits);
  });
}

describe("generic prepared-exchange Plotly candidate", () => {
  it("passes imported SVD coordinates through and exposes fixed reviewed ranges", () => {
    const inputBefore = structuredClone(preparedCandidateInput);
    const candidate = buildPreparedClass1PlotCandidate(preparedCandidateInput);
    const unitPoints = byRole(candidate.data, "unit_points")[0];
    const nodes = byRole(candidate.data, "code_nodes")[0];
    const geometry = candidate.audit.axisGeometry;

    expect(candidate.audit.contract).toBe(
      PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
    );
    expect(candidate.audit.dimensions).toEqual(["SVD1", "SVD2", "SVD3"]);
    expectCoordinateClose(geometry.lengths, [
      1.3856488012659597, 0.9863265350538209, 1.1610389969396767,
    ]);
    expectCoordinateClose(geometry.lower, [
      -1.4110066381034107, -1.638845048065197, -1.3144782362969124,
    ]);
    expectCoordinateClose(geometry.upper, [
      1.4856488012659597, 1.0863265350538209, 1.2610389969396767,
    ]);
    expect(geometry.ranges).toEqual([
      [geometry.lower[0], geometry.upper[0]],
      [geometry.lower[1], geometry.upper[1]],
      [geometry.lower[2], geometry.upper[2]],
    ]);

    expect(unitPoints).toMatchObject({
      type: "scatter3d",
      x: preparedCandidateInput.unitPoints.map(
        (point) => point.coordinates[0],
      ),
      y: preparedCandidateInput.unitPoints.map(
        (point) => point.coordinates[1],
      ),
      z: preparedCandidateInput.unitPoints.map(
        (point) => point.coordinates[2],
      ),
      meta: {
        candidate_contract: PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
        trajectory_role: "unit_points",
        point_count: 2,
      },
    });
    expect(nodes).toMatchObject({
      type: "scatter3d",
      x: codeNodes.map((node) => node.coordinates[0]),
      y: codeNodes.map((node) => node.coordinates[1]),
      z: codeNodes.map((node) => node.coordinates[2]),
      text: ["TE", "EX", "IN", "RE", "SP", "TP"],
    });

    const scene = candidate.layout.scene as NonNullable<Layout["scene"]>;
    expect(scene.xaxis?.range).toEqual([...geometry.ranges[0]]);
    expect(scene.yaxis?.range).toEqual([...geometry.ranges[1]]);
    expect(scene.zaxis?.range).toEqual([...geometry.ranges[2]]);
    expect(preparedCandidateInput).toEqual(inputBefore);
  });

  it("builds three audited SVD shafts, tip heads, and offset direct labels", () => {
    const candidate = buildPreparedClass1PlotCandidate(preparedCandidateInput);
    const shafts = byRole(candidate.data, "coordinate_axis_shaft");
    const heads = byRole(candidate.data, "coordinate_axis_arrowhead");
    const labels = byRole(candidate.data, "coordinate_axis_label");
    const colors = {
      SVD1: "#E00000",
      SVD2: "#0000D0",
      SVD3: "#008B00",
    } as const;

    expect(shafts).toHaveLength(3);
    expect(heads).toHaveLength(3);
    expect(labels).toHaveLength(3);
    for (const axis of ["SVD1", "SVD2", "SVD3"] as const) {
      expect(shafts.find((trace) => trace.meta?.axis === axis)).toMatchObject({
        type: "scatter3d",
        mode: "lines",
        line: { color: colors[axis], width: 4.4 },
      });
      expect(heads.find((trace) => trace.meta?.axis === axis)).toMatchObject({
        type: "cone",
        anchor: "tip",
        sizemode: "absolute",
        sizeref: PREPARED_CLASS1_AXIS_CONE_SIZE,
        colorscale: [
          [0, colors[axis]],
          [1, colors[axis]],
        ],
      });
      expect(labels.find((trace) => trace.meta?.axis === axis)).toMatchObject({
        type: "scatter3d",
        mode: "text",
        text: [axis],
        textfont: {
          color: colors[axis],
          family: "Times New Roman, Times, serif",
          size: 17,
        },
      });
    }

    const lengths = candidate.audit.axisGeometry.lengths;
    expect(shafts.find((trace) => trace.meta?.axis === "SVD1")?.x).toEqual([
      0,
      lengths[0],
    ]);
    expect(heads.find((trace) => trace.meta?.axis === "SVD2")).toMatchObject({
      x: [0],
      y: [lengths[1]],
      z: [0],
      u: [0],
      v: [1],
      w: [0],
    });
    expect(labels.find((trace) => trace.meta?.axis === "SVD1")).toMatchObject({
      x: [lengths[0]],
      y: [0.32],
      z: [-0.22],
    });
    expect(labels.find((trace) => trace.meta?.axis === "SVD2")).toMatchObject({
      x: [0],
      y: [lengths[1] - 0.02],
      z: [0.28],
    });
    expect(labels.find((trace) => trace.meta?.axis === "SVD3")).toMatchObject({
      x: [0],
      y: [0.34],
      z: [lengths[2] - 0.02],
    });
  });

  it("uses square G1 centroids and the reviewed center-anchored direction cones", () => {
    const candidate = buildPreparedClass1PlotCandidate(preparedCandidateInput);
    const path = byRole(candidate.data, "path")[0];
    const centroidNodes = byRole(candidate.data, "node_markers")[0];
    const direction = byRole(candidate.data, "direction_arrows")[0];

    expect(path).toMatchObject({
      type: "scatter3d",
      mode: "lines+markers",
      connectgaps: false,
      x: g1Coordinates.map((coordinate) => coordinate[0]),
      y: g1Coordinates.map((coordinate) => coordinate[1]),
      z: g1Coordinates.map((coordinate) => coordinate[2]),
      marker: { symbol: "square", size: 7 },
    });
    expect(centroidNodes).toMatchObject({
      type: "scatter3d",
      mode: "markers",
      marker: { symbol: "square", size: 7 },
    });
    expect(direction).toMatchObject({
      type: "cone",
      anchor: "center",
      sizemode: "absolute",
      sizeref: PREPARED_CLASS1_DIRECTION_CONE_SIZE,
      colorscale: [
        [0, "#2F2F2F"],
        [1, "#2F2F2F"],
      ],
      meta: {
        candidate_contract: PREPARED_CLASS1_PLOT_CANDIDATE_CONTRACT,
        trajectory_role: "direction_arrows",
        trajectory_key: "cohort=synthetic-alpha",
        segment_count: 2,
        segment_step_pairs: [
          [0, 1],
          [1, 2],
        ],
        position: PREPARED_CLASS1_DIRECTION_POSITION,
      },
    });
    expectCoordinateClose(direction?.x, [
      0.45488386353481247, 0.0681716950059057,
    ]);
    expectCoordinateClose(direction?.y, [
      -0.08414963739009784, -0.1356233958499261,
    ]);
    expectCoordinateClose(direction?.z, [
      -0.30379880589617253, -0.23987407644666658,
    ]);
    expectCoordinateClose(direction?.u, [
      -0.4749344888998531, -0.6890653648495266,
    ]);
    expectCoordinateClose(direction?.v, [
      0.7594934614122006, -0.5851170563961393,
    ]);
    expectCoordinateClose(direction?.w, [
      -0.4445299914803829, 0.4275826858972492,
    ]);
  });

  it("creates direction geometry only for adjacent valid periods and never bridges gaps", () => {
    const path = {
      key: "Group=gap",
      label: "Gap group",
      color: "#334155",
      steps: [
        {
          periodKey: "TP1",
          periodLabel: "TP1",
          timeOrder: 1,
          coordinates: [0, 0, 0],
        },
        {
          periodKey: "TP2",
          periodLabel: "TP2",
          timeOrder: 2,
          coordinates: null,
        },
        {
          periodKey: "TP3",
          periodLabel: "TP3",
          timeOrder: 3,
          coordinates: [9, 9, 9],
        },
        {
          periodKey: "TP4",
          periodLabel: "TP4",
          timeOrder: 4,
          coordinates: [9, 12, 13],
        },
      ],
    } as const;
    const segments = preparedClass1TrajectorySegments(path);
    const candidate = buildPreparedClass1PlotCandidate({
      unitPoints: [],
      codeNodes: [],
      paths: [path],
    });
    const pathTrace = byRole(candidate.data, "path")[0];
    const direction = byRole(candidate.data, "direction_arrows")[0];

    expect(
      segments.map(({ fromStepIndex, toStepIndex }) => [
        fromStepIndex,
        toStepIndex,
      ]),
    ).toEqual([[2, 3]]);
    expect(pathTrace).toMatchObject({
      connectgaps: false,
      x: [0, null, 9, 9],
      y: [0, null, 9, 12],
      z: [0, null, 9, 13],
      marker: { symbol: "square" },
    });
    expect(direction).toMatchObject({
      x: [9],
      y: [10.86],
      z: [11.48],
      u: [0],
      v: [0.6],
      w: [0.8],
      anchor: "center",
      sizeref: 0.13,
      meta: {
        segment_count: 1,
        segment_step_pairs: [[2, 3]],
      },
    });
  });
});
