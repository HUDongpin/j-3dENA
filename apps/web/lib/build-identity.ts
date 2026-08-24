export function resolveBuildId(): string {
  return process.env.THREEDENA_BUILD_ID
    ?? process.env.VERCEL_GIT_COMMIT_SHA
    ?? process.env.GITHUB_SHA
    ?? "local-development";
}
