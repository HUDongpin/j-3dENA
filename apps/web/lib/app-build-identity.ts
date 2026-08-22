import { THREEDENA_APP_ID } from "@/lib/evidence-scope";

export async function readCurrentBuildId(): Promise<string> {
  const shell = document.querySelector<HTMLElement>("[data-app-id][data-build-id]");
  if (shell?.dataset.appId !== THREEDENA_APP_ID) {
    throw new Error("Build identity belongs to a different application.");
  }
  const buildId = shell.dataset.buildId;
  if (typeof buildId !== "string" || buildId.trim() === "") {
    throw new Error("Build identity did not include a non-empty build ID.");
  }
  if (shell.dataset.productStatus !== "IMPLEMENTED_UNVERIFIED") {
    throw new Error("Build identity carries an unexpected product status.");
  }
  return buildId;
}
