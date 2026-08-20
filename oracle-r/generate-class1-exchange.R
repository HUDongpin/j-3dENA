#!/usr/bin/env Rscript

# Offline wrapper around the pinned legacy trusted-native converter. Native R
# serialization is unsafe: use only the exact tracked input in the exact clean
# legacy checkout verified below.

LEGACY_COMMIT <- "d02019ad872c5ece3840be2b4028ef27af38b2ff"
INPUT_RELATIVE_PATH <- "sample_data/class1_timepoints_enaset.RData"
INPUT_SHA256 <- "16c74f4e2ab4580f5742f2c46684e24bb7ab3417c0c0b66ba99f7bb2fed9debc"
INPUT_BYTES <- 13176
CONVERTER_RELATIVE_PATH <- "tools/convert_trusted_rdata_to_ena3d_json.R"
CONVERTER_SHA256 <- "f07e28ae3c1d3209aa8d4c5171bf80f575f25534d250bd879935964ea079c7b1"
EXPECTED_EXCHANGE_SHA256 <- "704b940865fbf09a7c5e42949105c935f3a64f5831a65e9af489af04e695c909"
EXPECTED_EXCHANGE_BYTES <- 52073
EXPECTED_R_VERSION <- "4.4.1"
EXPECTED_RENA_VERSION <- "0.2.7"
EXPECTED_JSONLITE_VERSION <- "2.0.0"
EXPECTED_DIGEST_VERSION <- "0.6.37"
WRAPPER_RELATIVE_PATH <- "oracle-r/generate-class1-exchange.R"

abort <- function(message) stop(message, call. = FALSE)

script_path <- function() {
  arguments <- commandArgs(FALSE)
  file_argument <- grep("^--file=", arguments, value = TRUE)
  if (length(file_argument) != 1L) abort("Could not determine wrapper path.")
  normalizePath(sub("^--file=", "", file_argument), mustWork = TRUE)
}

usage <- function() {
  paste(
    "Usage:",
    "  Rscript oracle-r/generate-class1-exchange.R",
    "    --legacy-checkout /path/to/clean/d020-checkout",
    "    --output /explicit/review/path/class1-timepoints.ena3d.json",
    "  Rscript oracle-r/generate-class1-exchange.R",
    "    --legacy-checkout /path/to/clean/d020-checkout --preflight",
    sep = "\n"
  )
}

parse_arguments <- function(arguments) {
  result <- list(legacy_checkout = NULL, output = NULL, preflight = FALSE)
  index <- 1L
  while (index <= length(arguments)) {
    argument <- arguments[[index]]
    if (identical(argument, "--legacy-checkout")) {
      if (index == length(arguments)) abort("--legacy-checkout requires a path.")
      result$legacy_checkout <- arguments[[index + 1L]]
      index <- index + 2L
    } else if (identical(argument, "--output")) {
      if (index == length(arguments)) abort("--output requires a path.")
      result$output <- arguments[[index + 1L]]
      index <- index + 2L
    } else if (identical(argument, "--preflight")) {
      result$preflight <- TRUE
      index <- index + 1L
    } else if (argument %in% c("--help", "-h")) {
      cat(usage(), "\n")
      quit(status = 0L)
    } else {
      abort(sprintf("Unknown argument: %s\n%s", argument, usage()))
    }
  }
  if (is.null(result$legacy_checkout)) {
    abort(sprintf("--legacy-checkout is required.\n%s", usage()))
  }
  if (result$preflight && !is.null(result$output)) {
    abort("--preflight performs no writes; do not combine it with --output.")
  }
  if (!result$preflight && is.null(result$output)) {
    abort(sprintf("An explicit --output path is required.\n%s", usage()))
  }
  result
}

run_git <- function(checkout, arguments) {
  output <- suppressWarnings(system2(
    "git", c("-C", shQuote(checkout), arguments),
    stdout = TRUE, stderr = TRUE
  ))
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) {
    abort(sprintf("git %s failed:\n%s", paste(arguments, collapse = " "),
                  paste(output, collapse = "\n")))
  }
  output
}

assert_package_version <- function(package, expected) {
  if (!requireNamespace(package, quietly = TRUE)) {
    abort(sprintf("Required offline package is missing: %s", package))
  }
  actual <- as.character(utils::packageVersion(package))
  if (!identical(actual, expected)) {
    abort(sprintf("Expected %s %s, found %s.", package, expected, actual))
  }
  actual
}

sha256_file <- function(path) {
  digest::digest(file = path, algo = "sha256", serialize = FALSE)
}

assert_tracked_clean <- function(repository, relative_path, label) {
  absolute_path <- file.path(repository, relative_path)
  if (!file.exists(absolute_path)) {
    abort(sprintf("%s does not exist: %s", label, absolute_path))
  }
  if (nzchar(Sys.readlink(absolute_path))) {
    abort(sprintf("%s must be a regular tracked file, not a symlink.", label))
  }
  tracked <- run_git(
    repository,
    c("ls-files", "--error-unmatch", "--", relative_path)
  )
  if (length(tracked) != 1L || !identical(tracked[[1L]], relative_path)) {
    abort(sprintf("%s must be tracked at %s.", label, relative_path))
  }
  dirty <- run_git(
    repository,
    c(
      "status", "--porcelain=v1", "--untracked-files=all", "--",
      relative_path
    )
  )
  if (length(dirty) > 0L && any(nzchar(dirty))) {
    abort(sprintf(
      "%s differs from the wrapper Git commit; commit or restore it first.",
      label
    ))
  }
  invisible(TRUE)
}

normalized_output <- function(path, legacy_checkout) {
  parent <- normalizePath(dirname(path), mustWork = TRUE)
  output <- file.path(parent, basename(path))
  if (!grepl("\\.ena3d\\.json$", output, ignore.case = TRUE)) {
    abort("--output must end in .ena3d.json.")
  }
  legacy_prefix <- paste0(legacy_checkout, .Platform$file.sep)
  if (startsWith(output, legacy_prefix)) {
    abort("Write the exchange to an external review directory, not the legacy checkout.")
  }
  output
}

write_provenance <- function(path, provenance) {
  if (file.exists(path)) abort(sprintf("Refusing to overwrite %s.", path))
  temporary <- tempfile(
    pattern = paste0(".", basename(path), ".partial-"),
    tmpdir = dirname(path)
  )
  on.exit(unlink(temporary), add = TRUE)
  json <- jsonlite::toJSON(
    provenance, auto_unbox = TRUE, digits = 17, pretty = TRUE,
    na = "null", null = "null"
  )
  writeBin(charToRaw(paste0(enc2utf8(json), "\n")), temporary)
  if (!file.rename(temporary, path)) {
    abort(sprintf("Could not atomically write provenance to %s.", path))
  }
  path
}

arguments <- parse_arguments(commandArgs(trailingOnly = TRUE))
wrapper <- script_path()
wrapper_root <- normalizePath(file.path(dirname(wrapper), ".."), mustWork = TRUE)
expected_wrapper <- normalizePath(
  file.path(wrapper_root, WRAPPER_RELATIVE_PATH), mustWork = TRUE
)
if (!identical(wrapper, expected_wrapper)) {
  abort(sprintf(
    "Class 1 wrapper must run from the fixed repository path %s.",
    WRAPPER_RELATIVE_PATH
  ))
}
wrapper_commit <- trimws(paste(run_git(
  wrapper_root, c("rev-parse", "HEAD")
), collapse = ""))
assert_tracked_clean(
  wrapper_root, WRAPPER_RELATIVE_PATH, "The Class 1 oracle wrapper"
)
legacy <- normalizePath(arguments$legacy_checkout, mustWork = TRUE)
if (!file.exists(file.path(legacy, ".git"))) {
  abort("--legacy-checkout must name a Git checkout.")
}
head <- trimws(paste(run_git(legacy, c("rev-parse", "HEAD")), collapse = ""))
if (!identical(head, LEGACY_COMMIT)) {
  abort(sprintf("Expected legacy commit %s, found %s.", LEGACY_COMMIT, head))
}
dirty <- run_git(legacy, c("status", "--porcelain=v1", "--untracked-files=all"))
if (length(dirty) > 0L && any(nzchar(dirty))) {
  abort("Legacy checkout must be clean, including untracked files.")
}
if (!identical(as.character(getRversion()), EXPECTED_R_VERSION)) {
  abort(sprintf("Expected R %s, found %s.", EXPECTED_R_VERSION, getRversion()))
}
versions <- list(
  R = as.character(getRversion()),
  rENA = assert_package_version("rENA", EXPECTED_RENA_VERSION),
  jsonlite = assert_package_version("jsonlite", EXPECTED_JSONLITE_VERSION),
  digest = assert_package_version("digest", EXPECTED_DIGEST_VERSION)
)
wrapper_hash <- sha256_file(wrapper)

input <- file.path(legacy, INPUT_RELATIVE_PATH)
converter <- file.path(legacy, CONVERTER_RELATIVE_PATH)
if (!file.exists(input) || !file.exists(converter)) {
  abort("Pinned input or converter is missing from the legacy checkout.")
}
input_hash <- sha256_file(input)
input_bytes <- unname(file.info(input)$size)
converter_hash <- sha256_file(converter)
if (!identical(input_hash, INPUT_SHA256) || !identical(input_bytes, INPUT_BYTES)) {
  abort("Pinned Class 1 input hash/size mismatch.")
}
if (!identical(converter_hash, CONVERTER_SHA256)) {
  abort("Pinned trusted-native converter hash mismatch.")
}

if (arguments$preflight) {
  cat(
    "class1_preflight=PASS",
    paste0("wrapper_commit=", wrapper_commit),
    paste0("wrapper_sha256=", wrapper_hash),
    paste0("legacy_commit=", head),
    paste0("input_sha256=", input_hash),
    paste0("input_bytes=", format(input_bytes, scientific = FALSE)),
    paste0("converter_sha256=", converter_hash),
    paste0("expected_exchange_sha256=", EXPECTED_EXCHANGE_SHA256),
    paste0("expected_exchange_bytes=", EXPECTED_EXCHANGE_BYTES),
    sep = "\n"
  )
  cat("\n")
  quit(status = 0L)
}

output <- normalized_output(arguments$output, legacy)
checksum <- paste0(output, ".sha256")
provenance_path <- paste0(output, ".provenance.json")
if (any(file.exists(c(output, checksum, provenance_path)))) {
  abort("Refusing to overwrite an existing exchange, checksum, or provenance file.")
}

converter_output <- system2(
  file.path(R.home("bin"), "Rscript"),
  c(
    "--vanilla", shQuote(converter), "--trusted-native-input",
    shQuote(input), shQuote(output)
  ),
  stdout = TRUE,
  stderr = TRUE
)
converter_status <- attr(converter_output, "status")
if (!is.null(converter_status) && converter_status != 0L) {
  abort(sprintf("Pinned converter failed:\n%s", paste(converter_output, collapse = "\n")))
}
if (!file.exists(output) || !file.exists(checksum)) {
  abort("Pinned converter did not emit both exchange and checksum.")
}

exchange_hash <- sha256_file(output)
exchange_bytes <- unname(file.info(output)$size)
checksum_text <- trimws(paste(readLines(checksum, warn = FALSE), collapse = " "))
if (!startsWith(checksum_text, paste0(exchange_hash, " "))) {
  abort("Converter checksum sidecar does not match the generated exchange.")
}
if (!identical(exchange_hash, EXPECTED_EXCHANGE_SHA256) ||
    !identical(exchange_bytes, EXPECTED_EXCHANGE_BYTES)) {
  abort(paste(
    sprintf("Generated exchange differs from the frozen observation: %s bytes, %s.",
            exchange_bytes, exchange_hash),
    "Candidate files were retained for diagnosis; no provenance approval was written."
  ))
}

provenance <- list(
  schemaVersion = "3dena.oracle-conversion-provenance.v1",
  status = "generated-matches-frozen-observation",
  role = "offline-trusted-native-migration-only",
  wrapperCommit = wrapper_commit,
  legacyCommit = head,
  environment = c(versions, list(platform = R.version$platform)),
  wrapper = list(
    path = WRAPPER_RELATIVE_PATH,
    gitCommit = wrapper_commit,
    sha256 = wrapper_hash
  ),
  converter = list(
    path = CONVERTER_RELATIVE_PATH,
    sha256 = converter_hash
  ),
  input = list(
    path = INPUT_RELATIVE_PATH,
    bytes = input_bytes,
    sha256 = input_hash,
    trust = "exact-tracked-local-native-R-object"
  ),
  output = list(
    mediaType = "application/json",
    bytes = exchange_bytes,
    sha256 = exchange_hash
  ),
  command = paste(
    "R_LIBS_USER=<legacy-renv-library>",
    "Rscript --vanilla oracle-r/generate-class1-exchange.R",
    "--legacy-checkout <clean-d020-checkout>",
    "--output <external-review-dir>/class1-timepoints.ena3d.json"
  )
)
provenance_written <- write_provenance(provenance_path, provenance)
cat(
  "class1_generation=PASS",
  paste0("wrapper_commit=", wrapper_commit),
  paste0("wrapper_sha256=", wrapper_hash),
  paste0("legacy_commit=", head),
  paste0("input_sha256=", input_hash),
  paste0("converter_sha256=", converter_hash),
  paste0("exchange_sha256=", exchange_hash),
  paste0("exchange_bytes=", format(exchange_bytes, scientific = FALSE)),
  paste0("exchange_path=", output),
  paste0("checksum_path=", checksum),
  paste0("provenance_path=", provenance_written),
  sep = "\n"
)
cat("\n")
