import { NextResponse } from "next/server";
import {
  BUILD_INFO_SCHEMA_VERSION,
  PRODUCT_STATUS,
  RAW_EVIDENCE_SCOPE_VERSION,
  THREEDENA_APP_ID,
} from "@/lib/evidence-scope";
import { resolveBuildId } from "@/lib/build-identity";
import { resolveWebExecutionPolicy } from "@/lib/execution-policy";

export const dynamic = "force-dynamic";

export function GET() {
  const webBuildId = resolveBuildId();
  const policy = resolveWebExecutionPolicy();

  return NextResponse.json(
    {
      schemaVersion: BUILD_INFO_SCHEMA_VERSION,
      appId: THREEDENA_APP_ID,
      role: "web",
      webBuildId,
      webGitCommit: policy.webGitCommit,
      execution: {
        mode: policy.mode,
        production: policy.production,
        remoteConfigured: policy.computeBaseUrl !== null,
        blocker: policy.blocker,
      },
      activeBuildApproval: policy.approvedRemoteBuild,
      productStatus: PRODUCT_STATUS,
      evidenceScopeVersion: RAW_EVIDENCE_SCOPE_VERSION,
    },
    {
      headers: {
        "Cache-Control": "no-store",
      },
    },
  );
}
