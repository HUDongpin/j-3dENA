/**
 * Scientific runtime identity is injected by the reviewed package build.
 * Source-tree/test execution deliberately remains unbound rather than
 * pretending to be a particular jENA artifact.
 */
declare const __THREEDENA_JENA_VERSION__: string | undefined;
declare const __THREEDENA_JENA_COMMIT__: string | undefined;
declare const __THREEDENA_JENA_TARBALL_INTEGRITY__: string | undefined;
declare const __THREEDENA_SDK_VERSION__: string | undefined;
declare const __THREEDENA_BUILD_ID__: string | undefined;

function injected(value: string | undefined, fallback: string): string {
  return typeof value === "string" && value.trim() !== "" ? value : fallback;
}

export interface AnalysisBuildIdentity {
  jenaVersion: string;
  jenaCommit: string;
  jenaTarballIntegrity: string;
  sdkVersion: string;
  buildId: string;
  bound: boolean;
}

export const ANALYSIS_BUILD_IDENTITY: Readonly<AnalysisBuildIdentity> = Object.freeze({
  jenaVersion: injected(
    typeof __THREEDENA_JENA_VERSION__ === "undefined" ? undefined : __THREEDENA_JENA_VERSION__,
    "development-unbound",
  ),
  jenaCommit: injected(
    typeof __THREEDENA_JENA_COMMIT__ === "undefined" ? undefined : __THREEDENA_JENA_COMMIT__,
    "development-unbound",
  ),
  jenaTarballIntegrity: injected(
    typeof __THREEDENA_JENA_TARBALL_INTEGRITY__ === "undefined" ? undefined : __THREEDENA_JENA_TARBALL_INTEGRITY__,
    "development-unbound",
  ),
  sdkVersion: injected(
    typeof __THREEDENA_SDK_VERSION__ === "undefined" ? undefined : __THREEDENA_SDK_VERSION__,
    "development-unbound",
  ),
  buildId: injected(
    typeof __THREEDENA_BUILD_ID__ === "undefined" ? undefined : __THREEDENA_BUILD_ID__,
    "development-unbound",
  ),
  bound:
    typeof __THREEDENA_JENA_VERSION__ !== "undefined"
    && typeof __THREEDENA_JENA_COMMIT__ !== "undefined"
    && typeof __THREEDENA_JENA_TARBALL_INTEGRITY__ !== "undefined"
    && typeof __THREEDENA_SDK_VERSION__ !== "undefined"
    && typeof __THREEDENA_BUILD_ID__ !== "undefined",
});
