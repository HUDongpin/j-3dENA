export function parsePublicPackageSmokeArguments(arguments_) {
  const result = {};
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (argument !== "--tarball" && argument !== "--receipt") {
      throw new Error(`PUBLIC_PACKAGE_SMOKE_FAILED: unknown argument ${argument}`);
    }
    const value = arguments_[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`PUBLIC_PACKAGE_SMOKE_FAILED: ${argument} requires a value`);
    }
    const key = argument === "--tarball" ? "tarballPath" : "receiptPath";
    if (result[key] !== undefined) {
      throw new Error(`PUBLIC_PACKAGE_SMOKE_FAILED: ${argument} may be supplied only once`);
    }
    result[key] = value;
    index += 1;
  }
  if (result.tarballPath === undefined) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: --tarball is required");
  }
  if (result.receiptPath === undefined) {
    throw new Error("PUBLIC_PACKAGE_SMOKE_FAILED: --receipt is required");
  }
  return result;
}
