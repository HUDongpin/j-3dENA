# @3dena/analysis

Framework-independent, synchronous TypeScript facade for one complete 3D ENA
model plus shared-space group/time centroid trajectories.

```ts
import { analyzeRows, selectTrajectoryDisplay } from "@3dena/analysis";

const result = analyzeRows({
  rows,
  mapping: {
    units: ["Group", "Name"],
    conversation: ["Lesson"],
    codes: ["EC", "ICT", "MCO", "ATT"],
    trajectory: {
      participant: ["Name"],
      group: "Group",
      time: "Lesson",
      timeOrder: ["Lesson 1", "Lesson 2"],
      cohortPolicy: "available"
    }
  },
  config: {
    model: "AccumulatedTrajectory",
    window: "MovingStanzaWindow",
    weightBy: "binary",
    windowSizeBack: 4,
    windowSizeForward: 0,
    centerAlignToOrigin: true
  }
});

const oneGroup = selectTrajectoryDisplay(result.trajectory!, {
  groups: [result.trajectory!.groupOrder[0]!.canonical]
});
```

`AnalysisResult` is structured-clone safe. It contains three-coordinate points
and nodes, ordered edges and normalized point weights, variance, the full shared
rotation, diagnostics, neutral baseline identifiers, and optional precomputed
participant-period/centroid/path rows.

## Browser execution

Call `analyzeRows()` inside a dedicated module Worker. It is synchronous by
design. The numerical model stage cannot guarantee cooperative interruption,
so cancel and timeout must terminate the Worker, observe termination, discard
the immutable run owner, and construct a fresh Worker. Do not put `AbortSignal`
or callback functions in the structured-clone request.

A recommended versioned envelope is:

```ts
type Request = { v: 1; kind: "analyze"; runId: string; input: AnalyzeRowsInput };
type Response =
  | { v: 1; kind: "progress"; runId: string; phase: "validating" | "modeling" | "trajectory" | "complete"; percent: number }
  | { v: 1; kind: "result"; runId: string; result: AnalysisResult }
  | { v: 1; kind: "error"; runId: string; message: string };
```

Progress around the synchronous model call is phase progress, not proof that
the model can stop between percentages. The Worker supervisor owns real hard
cancellation and stale-result protection.

## Scientific boundaries

- one call fits one SVD across every unit-step point;
- participant-period duplicates are averaged before group-time centroids;
- `available` and `complete` cohort policies are distinct;
- an explicit unobserved period is a path gap, never a zero coordinate;
- `selectTrajectoryDisplay()` receives no raw rows or model configuration and
  cannot refit or recompute the scientific result;
- exact source versions and unresolved numerical evidence live in the separate
  development-only parity contract package.
