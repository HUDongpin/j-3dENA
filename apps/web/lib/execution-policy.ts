export type WebExecutionMode = "remote" | "calibration-local";

export interface ApprovedRemoteBuildIdentity {
  readonly approvalManifestSha256: string;
  readonly releaseId: string;
  readonly gitCommit: string;
  readonly webBuildId: string;
  readonly flyImageDigest: string;
  readonly flyBuildId: string;
}

export interface WebExecutionPolicy {
  readonly mode: WebExecutionMode;
  readonly production: boolean;
  readonly computeBaseUrl: string | null;
  readonly approvedRemoteBuild: ApprovedRemoteBuildIdentity | null;
  readonly webGitCommit: string | null;
  readonly processingRegion: string;
  readonly retentionHours: 24;
  readonly blocker: string | null;
}

interface ExecutionPolicyEnvironment {
  readonly nodeEnv?: string | undefined;
  readonly requestedMode?: string | undefined;
  readonly computeBaseUrl?: string | undefined;
  readonly activeBuildApproval?: string | undefined;
  readonly webGitCommit?: string | undefined;
  readonly processingRegion?: string | undefined;
}

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_COMMIT = /^[a-f0-9]{40}$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{8,200}$/u;
const IMAGE_DIGEST = /^sha256:[a-f0-9]{64}$/u;

function normalizedHttpsOrLoopbackUrl(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    const loopback = url.protocol === "http:"
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((!loopback && url.protocol !== "https:")
      || url.username
      || url.password
      || url.search
      || url.hash) {
      return null;
    }
    url.pathname = url.pathname.replace(/\/+$/u, "");
    return url.toString().replace(/\/$/u, "");
  } catch {
    return null;
  }
}

function approvedRemoteBuild(value: string | undefined): ApprovedRemoteBuildIdentity | null {
  if (!value) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const fields = [
    "approvalManifestSha256",
    "releaseId",
    "gitCommit",
    "webBuildId",
    "flyImageDigest",
    "flyBuildId",
  ] as const;
  if (Object.keys(record).length !== fields.length
      || fields.some((field) => !Object.hasOwn(record, field))
      || typeof record.approvalManifestSha256 !== "string"
      || !SHA256.test(record.approvalManifestSha256)
      || typeof record.releaseId !== "string"
      || !OPAQUE_ID.test(record.releaseId)
      || typeof record.gitCommit !== "string"
      || !GIT_COMMIT.test(record.gitCommit)
      || typeof record.webBuildId !== "string"
      || !OPAQUE_ID.test(record.webBuildId)
      || typeof record.flyImageDigest !== "string"
      || !IMAGE_DIGEST.test(record.flyImageDigest)
      || typeof record.flyBuildId !== "string"
      || !OPAQUE_ID.test(record.flyBuildId)) {
    return null;
  }
  return Object.freeze({
    approvalManifestSha256: record.approvalManifestSha256,
    releaseId: record.releaseId,
    gitCommit: record.gitCommit,
    webBuildId: record.webBuildId,
    flyImageDigest: record.flyImageDigest,
    flyBuildId: record.flyBuildId,
  });
}

export function resolveWebExecutionPolicy(
  environment: ExecutionPolicyEnvironment = {
    nodeEnv: process.env.NODE_ENV,
    requestedMode: process.env.NEXT_PUBLIC_3DENA_EXECUTION_MODE,
    computeBaseUrl: process.env.NEXT_PUBLIC_3DENA_COMPUTE_BASE_URL,
    activeBuildApproval:
      process.env.NEXT_PUBLIC_3DENA_ACTIVE_BUILD_APPROVAL,
    webGitCommit: process.env.NEXT_PUBLIC_3DENA_WEB_GIT_COMMIT,
    processingRegion: process.env.NEXT_PUBLIC_3DENA_PROCESSING_REGION,
  },
): WebExecutionPolicy {
  const production = environment.nodeEnv === "production";
  const requested = environment.requestedMode?.trim();
  const mode: WebExecutionMode = production || requested === "remote"
    ? "remote"
    : "calibration-local";
  const computeBaseUrl = normalizedHttpsOrLoopbackUrl(
    environment.computeBaseUrl,
  );
  const approval = approvedRemoteBuild(environment.activeBuildApproval);
  const webGitCommit = environment.webGitCommit?.trim() ?? null;
  const validWebGitCommit = webGitCommit !== null && GIT_COMMIT.test(webGitCommit);
  const processingRegion = environment.processingRegion?.trim()
    || "Not configured";

  let blocker: string | null = null;
  if (production && requested === "calibration-local") {
    blocker = "Production builds cannot enable browser-local calibration execution.";
  } else if (mode === "remote" && computeBaseUrl === null) {
    blocker = "Remote compute is required, but NEXT_PUBLIC_3DENA_COMPUTE_BASE_URL is missing or unsafe.";
  } else if (mode === "remote" && approval === null) {
    blocker = "Remote compute is required, but the exact active BuildApprovalV1 identity is missing or invalid.";
  } else if (mode === "remote" && !validWebGitCommit) {
    blocker = "Remote compute is required, but the Web Git commit identity is missing or invalid.";
  } else if (mode === "remote" && approval?.gitCommit !== webGitCommit) {
    blocker = "The active BuildApprovalV1 Git commit does not match this Web build.";
  }

  return Object.freeze({
    mode,
    production,
    computeBaseUrl,
    approvedRemoteBuild: approval,
    webGitCommit: validWebGitCommit ? webGitCommit : null,
    processingRegion,
    retentionHours: 24,
    blocker,
  });
}
