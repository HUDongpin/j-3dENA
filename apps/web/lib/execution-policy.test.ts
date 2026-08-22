import { describe, expect, it } from "vitest";
import { resolveWebExecutionPolicy } from "./execution-policy";

const gitCommit = "a".repeat(40);
const approval = JSON.stringify({
  approvalManifestSha256: "b".repeat(64),
  releaseId: "release-20260821",
  gitCommit,
  webBuildId: "vercel-build-20260821",
  flyImageDigest: `sha256:${"c".repeat(64)}`,
  flyBuildId: "fly-build-20260821",
});

describe("resolveWebExecutionPolicy", () => {
  it("keeps local workers only as the non-production calibration default", () => {
    expect(resolveWebExecutionPolicy({ nodeEnv: "development" })).toMatchObject({
      mode: "calibration-local",
      production: false,
      blocker: null,
    });
  });

  it("forces production remote and fails closed without configuration", () => {
    expect(resolveWebExecutionPolicy({
      nodeEnv: "production",
      requestedMode: "calibration-local",
    })).toMatchObject({
      mode: "remote",
      production: true,
      blocker: "Production builds cannot enable browser-local calibration execution.",
    });
  });

  it("accepts only an HTTPS service and an exact active build approval", () => {
    expect(resolveWebExecutionPolicy({
      nodeEnv: "production",
      computeBaseUrl: "https://compute.example.test/v1/",
      activeBuildApproval: approval,
      webGitCommit: gitCommit,
      processingRegion: "Asia Pacific (Singapore)",
    })).toEqual({
      mode: "remote",
      production: true,
      computeBaseUrl: "https://compute.example.test/v1",
      approvedRemoteBuild: JSON.parse(approval),
      webGitCommit: gitCommit,
      processingRegion: "Asia Pacific (Singapore)",
      retentionHours: 24,
      blocker: null,
    });
  });

  it("rejects an unsafe remote URL", () => {
    expect(resolveWebExecutionPolicy({
      nodeEnv: "development",
      requestedMode: "remote",
      computeBaseUrl: "http://compute.example.test",
      activeBuildApproval: approval,
      webGitCommit: gitCommit,
    }).blocker).toMatch(/missing or unsafe/u);
  });

  it("rejects a mixed Web and approved Git identity", () => {
    expect(resolveWebExecutionPolicy({
      nodeEnv: "production",
      computeBaseUrl: "https://compute.example.test",
      activeBuildApproval: approval,
      webGitCommit: "d".repeat(40),
    }).blocker).toMatch(/does not match this Web build/u);
  });
});
