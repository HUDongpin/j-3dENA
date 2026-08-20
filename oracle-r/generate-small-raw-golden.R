#!/usr/bin/env Rscript

# Offline-only scientific-oracle generator for the governed small-raw fixture.
# This script is never invoked by the browser application or production build.

LEGACY_COMMIT <- "d02019ad872c5ece3840be2b4028ef27af38b2ff"
INPUT_RELATIVE_PATH <- "packages/parity-contracts/fixtures/small-raw.csv"
EXPECTED_INPUT_SHA256 <- "163ee849ac316d380e2664067e7389a8114e30d97877c97d6d912e3706c72f16"
EXPECTED_INPUT_BYTES <- 743L
GENERATOR_RELATIVE_PATH <- "oracle-r/generate-small-raw-golden.R"
EXPECTED_R_VERSION <- "4.4.1"
EXPECTED_RENA_VERSION <- "0.2.7"
EXPECTED_JSONLITE_VERSION <- "2.0.0"
EXPECTED_DIGEST_VERSION <- "0.6.37"
FIXTURE_SCHEMA_VERSION <- "3dena.parity-fixture.v1"
FIXTURE_ID <- "small-raw-rena-0.2.7-accumulated-back4"
JENA_COMMIT <- "2f63db4c6ccf5684afc8437ae81ed1a3ccd0c1a3"
JENA_VERSION <- "0.6.2"
DIMENSIONS <- c("SVD1", "SVD2", "SVD3")

abort <- function(message) {
  stop(message, call. = FALSE)
}

script_path <- function() {
  arguments <- commandArgs(FALSE)
  file_argument <- grep("^--file=", arguments, value = TRUE)
  if (length(file_argument) != 1L) {
    abort("Could not determine the generator script path.")
  }
  normalizePath(sub("^--file=", "", file_argument), mustWork = TRUE)
}

usage <- function() {
  paste(
    "Usage:",
    "  Rscript oracle-r/generate-small-raw-golden.R",
    "    --legacy-checkout /path/to/pinned/d020-checkout",
    "    --output /explicit/path/small-raw.rena-0.2.7.golden.json",
    "  Rscript oracle-r/generate-small-raw-golden.R",
    "    --legacy-checkout /path/to/pinned/d020-checkout --preflight",
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
    "git",
    c("-C", shQuote(checkout), arguments),
    stdout = TRUE,
    stderr = TRUE
  ))
  status <- attr(output, "status")
  if (!is.null(status) && status != 0L) {
    abort(sprintf(
      "git %s failed in %s:\n%s",
      paste(arguments, collapse = " "),
      checkout,
      paste(output, collapse = "\n")
    ))
  }
  output
}

assert_package_version <- function(package, expected) {
  if (!requireNamespace(package, quietly = TRUE)) {
    abort(sprintf("Required offline generator package is missing: %s", package))
  }
  actual <- as.character(utils::packageVersion(package))
  if (!identical(actual, expected)) {
    abort(sprintf(
      "Expected %s %s, found %s. Refusing a non-reproducible refresh.",
      package, expected, actual
    ))
  }
  actual
}

sha256_file <- function(path) {
  digest::digest(file = path, algo = "sha256", serialize = FALSE)
}

sha256_text <- function(text) {
  digest::digest(enc2utf8(text), algo = "sha256", serialize = FALSE)
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
      "%s differs from the generator Git commit; commit or restore it before refresh.",
      label
    ))
  }
  invisible(TRUE)
}

check_environment <- function(legacy_checkout, input_path, generator_path) {
  legacy_checkout <- normalizePath(legacy_checkout, mustWork = TRUE)
  if (!file.exists(file.path(legacy_checkout, ".git"))) {
    abort("--legacy-checkout must name a Git checkout of the legacy 3dENA repository.")
  }
  head <- trimws(paste(run_git(
    legacy_checkout, c("rev-parse", "HEAD")
  ), collapse = ""))
  if (!identical(head, LEGACY_COMMIT)) {
    abort(sprintf(
      "Legacy checkout must be pinned to %s; found %s.",
      LEGACY_COMMIT, head
    ))
  }
  dirty <- run_git(
    legacy_checkout,
    c("status", "--porcelain=v1", "--untracked-files=all")
  )
  if (length(dirty) > 0L && any(nzchar(dirty))) {
    abort(paste(
      "Legacy checkout is not clean. Oracle generation requires an isolated",
      "checkout so local artifacts cannot influence the result."
    ))
  }

  r_version <- as.character(getRversion())
  if (!identical(r_version, EXPECTED_R_VERSION)) {
    abort(sprintf(
      "Expected R %s, found %s. Refusing a non-reproducible refresh.",
      EXPECTED_R_VERSION, r_version
    ))
  }
  versions <- list(
    R = r_version,
    rENA = assert_package_version("rENA", EXPECTED_RENA_VERSION),
    jsonlite = assert_package_version(
      "jsonlite", EXPECTED_JSONLITE_VERSION
    ),
    digest = assert_package_version("digest", EXPECTED_DIGEST_VERSION)
  )

  if (!file.exists(input_path)) {
    abort(sprintf("Governed input fixture does not exist: %s", input_path))
  }
  generator_root <- normalizePath(
    file.path(dirname(generator_path), ".."), mustWork = TRUE
  )
  expected_input_path <- file.path(generator_root, INPUT_RELATIVE_PATH)
  if (!identical(
    normalizePath(input_path, mustWork = TRUE),
    normalizePath(expected_input_path, mustWork = TRUE)
  )) {
    abort(sprintf(
      "Oracle input must be the fixed repository fixture %s.",
      INPUT_RELATIVE_PATH
    ))
  }
  generator_commit <- trimws(paste(run_git(
    generator_root, c("rev-parse", "HEAD")
  ), collapse = ""))
  assert_tracked_clean(
    generator_root, GENERATOR_RELATIVE_PATH, "The oracle generator"
  )
  assert_tracked_clean(
    generator_root, INPUT_RELATIVE_PATH, "The governed small-raw input"
  )
  input_sha256 <- sha256_file(input_path)
  input_bytes <- unname(file.info(input_path)$size)
  if (!identical(input_sha256, EXPECTED_INPUT_SHA256)) {
    abort(sprintf(
      paste0(
        "Governed small-raw input SHA-256 mismatch: expected %s, found %s. ",
        "Refusing fixture drift."
      ),
      EXPECTED_INPUT_SHA256, input_sha256
    ))
  }
  if (!is.finite(input_bytes) ||
      as.double(input_bytes) != as.double(EXPECTED_INPUT_BYTES)) {
    abort(sprintf(
      paste0(
        "Governed small-raw input size mismatch: expected %d bytes, found %s. ",
        "Refusing fixture drift."
      ),
      EXPECTED_INPUT_BYTES, format(input_bytes, scientific = FALSE)
    ))
  }
  list(
    legacy_checkout = legacy_checkout,
    legacy_commit = head,
    versions = versions,
    input_sha256 = input_sha256,
    input_bytes = input_bytes,
    generator_sha256 = sha256_file(generator_path),
    generator_commit = generator_commit
  )
}

read_input <- function(path) {
  expected_columns <- c(
    "Group", "Lesson", "Name", "EC", "ICT", "MCO", "ATT"
  )
  data <- utils::read.csv(
    path,
    header = TRUE,
    check.names = FALSE,
    stringsAsFactors = FALSE,
    colClasses = "character",
    na.strings = character()
  )
  if (!identical(names(data), expected_columns)) {
    abort(sprintf(
      "small-raw.csv columns must be exactly [%s]; found [%s].",
      paste(expected_columns, collapse = ", "),
      paste(names(data), collapse = ", ")
    ))
  }
  if (nrow(data) == 0L) abort("small-raw.csv must contain at least one row.")
  identity_columns <- c("Group", "Lesson", "Name")
  for (column in identity_columns) {
    if (any(!nzchar(data[[column]]))) {
      abort(sprintf("Identity column %s contains a blank value.", column))
    }
  }
  for (code in c("EC", "ICT", "MCO", "ATT")) {
    value <- trimws(data[[code]])
    if (any(!value %in% c("0", "1"))) {
      abort(sprintf("Code column %s must contain only literal 0 or 1.", code))
    }
    data[[code]] <- as.numeric(value)
  }
  data
}

plain_frame <- function(value) {
  frame <- as.data.frame(value, stringsAsFactors = FALSE, optional = TRUE)
  for (column in names(frame)) {
    item <- frame[[column]]
    if (is.factor(item)) item <- as.character(item)
    if (is.character(item)) {
      item <- as.character(item)
    } else if (is.integer(item)) {
      item <- as.integer(item)
    } else if (is.numeric(item)) {
      item <- as.numeric(item)
    } else if (is.logical(item)) {
      item <- as.logical(item)
    } else {
      abort(sprintf("Unsupported oracle column type for %s.", column))
    }
    frame[[column]] <- item
  }
  frame
}

typed_string_key <- function(values) {
  tokens <- unname(lapply(as.character(values), function(value) {
    unname(c("string", enc2utf8(value)))
  }))
  as.character(jsonlite::toJSON(
    tokens, auto_unbox = TRUE, pretty = FALSE, null = "null"
  ))
}

trajectory_row_keys <- function(ena_object, row_count) {
  trajectories <- ena_object$trajectories
  required <- c("Group", "Name", "Lesson")
  if (is.null(trajectories)) return(NULL)
  trajectories <- plain_frame(trajectories)
  if (nrow(trajectories) != row_count ||
      !all(required %in% names(trajectories))) return(NULL)
  vapply(seq_len(row_count), function(index) {
    typed_string_key(c(
      trajectories$Group[[index]],
      trajectories$Name[[index]],
      trajectories$Lesson[[index]]
    ))
  }, character(1L), USE.NAMES = FALSE)
}

raw_row_keys <- function(frame) {
  required <- c("Group", "Name", "Lesson")
  if (!all(required %in% names(frame))) return(NULL)
  vapply(seq_len(nrow(frame)), function(index) {
    typed_string_key(c(
      frame$Group[[index]], frame$Name[[index]], frame$Lesson[[index]]
    ))
  }, character(1L), USE.NAMES = FALSE)
}

numeric_table <- function(value, row_keys, columns = NULL) {
  frame <- plain_frame(value)
  if (is.null(columns)) {
    columns <- names(frame)[vapply(frame, is.numeric, logical(1L))]
  }
  columns <- intersect(columns, names(frame))
  if (length(columns) == 0L) return(NULL)
  if (is.null(row_keys) || length(row_keys) != nrow(frame)) return(NULL)
  if (anyDuplicated(row_keys)) return(NULL)
  values <- lapply(seq_len(nrow(frame)), function(index) {
    unname(as.numeric(frame[index, columns, drop = TRUE]))
  })
  list(
    rowKeys = unname(as.character(row_keys)),
    columns = unname(as.character(columns)),
    values = unname(values)
  )
}

named_vector <- function(value, columns = NULL) {
  if (is.null(value) || !is.atomic(value) || !is.numeric(value)) return(NULL)
  available <- names(value)
  if (is.null(available)) return(NULL)
  if (is.null(columns)) columns <- available
  indices <- match(columns, available, nomatch = 0L)
  keep <- indices > 0L
  if (!any(keep)) return(NULL)
  list(
    columns = unname(as.character(columns[keep])),
    values = unname(as.numeric(value[indices[keep]]))
  )
}

add_if_available <- function(target, name, value) {
  if (!is.null(value)) target[[name]] <- value
  target
}

assert_finite <- function(value, path = "analysis") {
  if (is.numeric(value) && any(!is.finite(value))) {
    abort(sprintf("Non-finite numeric value found at %s.", path))
  }
  if (is.list(value)) {
    child_names <- names(value)
    for (index in seq_along(value)) {
      child <- if (!is.null(child_names) && nzchar(child_names[[index]])) {
        paste0(path, ".", child_names[[index]])
      } else {
        sprintf("%s[%d]", path, index)
      }
      assert_finite(value[[index]], child)
    }
  }
  invisible(TRUE)
}

build_analysis <- function(ena_object) {
  analysis <- list()
  trajectories <- ena_object$trajectories
  trajectory_keys <- if (!is.null(trajectories)) {
    trajectory_row_keys(ena_object, nrow(plain_frame(trajectories)))
  } else {
    NULL
  }

  if (!is.null(ena_object$connection.counts)) {
    frame <- plain_frame(ena_object$connection.counts)
    analysis <- add_if_available(
      analysis, "connectionCounts",
      numeric_table(frame, trajectory_row_keys(ena_object, nrow(frame)))
    )
  }
  if (!is.null(ena_object$model$row.connection.counts)) {
    frame <- plain_frame(ena_object$model$row.connection.counts)
    analysis <- add_if_available(
      analysis, "rowConnectionCounts",
      numeric_table(frame, raw_row_keys(frame))
    )
  }
  if (!is.null(ena_object$line.weights)) {
    frame <- plain_frame(ena_object$line.weights)
    analysis <- add_if_available(
      analysis, "lineWeights",
      numeric_table(frame, trajectory_row_keys(ena_object, nrow(frame)))
    )
  }
  if (!is.null(ena_object$rotation$center.vec)) {
    analysis <- add_if_available(
      analysis, "centerVector", named_vector(ena_object$rotation$center.vec)
    )
  }
  if (!is.null(ena_object$rotation.matrix)) {
    frame <- plain_frame(ena_object$rotation.matrix)
    row_keys <- if ("codes" %in% names(frame)) as.character(frame$codes) else NULL
    rotation_dimensions <- grep("^SVD[0-9]+$", names(frame), value = TRUE)
    analysis <- add_if_available(
      analysis, "rotationMatrix",
      numeric_table(frame, row_keys, rotation_dimensions)
    )
  }
  if (!is.null(ena_object$points)) {
    frame <- plain_frame(ena_object$points)
    analysis <- add_if_available(
      analysis, "points",
      numeric_table(frame, trajectory_row_keys(ena_object, nrow(frame)), DIMENSIONS)
    )
  }
  if (!is.null(ena_object$rotation$nodes)) {
    frame <- plain_frame(ena_object$rotation$nodes)
    row_keys <- if ("code" %in% names(frame)) as.character(frame$code) else NULL
    analysis <- add_if_available(
      analysis, "nodes", numeric_table(frame, row_keys, DIMENSIONS)
    )
  }
  if (!is.null(ena_object$model$variance)) {
    analysis <- add_if_available(
      analysis, "variance", named_vector(ena_object$model$variance)
    )
  }
  if (!is.null(ena_object$rotation$eigenvalues)) {
    eigenvalues <- ena_object$rotation$eigenvalues
    if (is.null(names(eigenvalues)) && length(eigenvalues) > 0L) {
      names(eigenvalues) <- paste0("SVD", seq_along(eigenvalues))
    }
    analysis <- add_if_available(
      analysis, "eigenvalues", named_vector(eigenvalues)
    )
  }

  # There is no meaningful fixture if rENA exposes none of the governed fields.
  if (length(analysis) == 0L) {
    abort("rENA did not expose any governed analysis fields; no fixture written.")
  }
  assert_finite(analysis)
  analysis
}

write_artifact <- function(output_path, artifact) {
  output_parent <- normalizePath(dirname(output_path), mustWork = TRUE)
  output_path <- file.path(output_parent, basename(output_path))
  if (!grepl("\\.json$", output_path, ignore.case = TRUE)) {
    abort("--output must end in .json.")
  }
  if (file.exists(output_path)) {
    abort(sprintf("Refusing to overwrite existing output: %s", output_path))
  }
  temporary <- tempfile(
    pattern = paste0(".", basename(output_path), ".partial-"),
    tmpdir = output_parent
  )
  on.exit(unlink(temporary), add = TRUE)
  json <- jsonlite::toJSON(
    artifact,
    auto_unbox = TRUE,
    dataframe = "rows",
    digits = 17,
    na = "null",
    null = "null",
    pretty = TRUE
  )
  writeBin(charToRaw(paste0(enc2utf8(json), "\n")), temporary)
  if (!file.rename(temporary, output_path)) {
    abort(sprintf("Could not atomically move generated output to %s.", output_path))
  }
  list(
    path = output_path,
    bytes = unname(file.info(output_path)$size),
    sha256 = sha256_file(output_path)
  )
}

arguments <- parse_arguments(commandArgs(trailingOnly = TRUE))
generator_path <- script_path()
project_root <- normalizePath(file.path(dirname(generator_path), ".."), mustWork = TRUE)
input_path <- file.path(
  project_root, INPUT_RELATIVE_PATH
)
environment <- check_environment(
  arguments$legacy_checkout, input_path, generator_path
)

if (arguments$preflight) {
  cat(
    "oracle_preflight=PASS",
    paste0("legacy_commit=", environment$legacy_commit),
    paste0("input_sha256=", environment$input_sha256),
    paste0(
      "input_bytes=", format(environment$input_bytes, scientific = FALSE)
    ),
    paste0("generator_sha256=", environment$generator_sha256),
    paste0("generator_commit=", environment$generator_commit),
    paste0("R=", environment$versions$R),
    paste0("rENA=", environment$versions$rENA),
    paste0("jsonlite=", environment$versions$jsonlite),
    paste0("digest=", environment$versions$digest),
    sep = "\n"
  )
  cat("\n")
  quit(status = 0L)
}

input <- read_input(input_path)
ena_object <- suppressPackageStartupMessages(rENA::ena(
  data = input,
  units = c("Group", "Name"),
  conversation = c("Lesson"),
  codes = c("EC", "ICT", "MCO", "ATT"),
  metadata = NULL,
  model = "AccumulatedTrajectory",
  weight.by = "binary",
  window = "MovingStanzaWindow",
  window.size.back = 4L,
  runTest = FALSE,
  include.plots = FALSE,
  print.plots = FALSE
))
analysis <- build_analysis(ena_object)
analysis_json <- jsonlite::toJSON(
  analysis,
  auto_unbox = TRUE,
  dataframe = "rows",
  digits = 17,
  na = "null",
  null = "null",
  pretty = FALSE
)
analysis_payload_sha256 <- sha256_text(analysis_json)

manifest <- list(
  schemaVersion = FIXTURE_SCHEMA_VERSION,
  fixtureId = FIXTURE_ID,
  status = "generated",
  availableFields = names(analysis),
  legacyCommit = LEGACY_COMMIT,
  rVersion = environment$versions$R,
  rENAVersion = environment$versions$rENA,
  jenaCommit = JENA_COMMIT,
  jenaVersion = JENA_VERSION,
  scientificOracle = list(
    role = "offline-fixture-generator-only",
    legacyProductCommit = LEGACY_COMMIT,
    R = environment$versions$R,
    rENA = environment$versions$rENA,
    jsonlite = environment$versions$jsonlite,
    digest = environment$versions$digest,
    platform = R.version$platform
  ),
  generator = list(
    path = "oracle-r/generate-small-raw-golden.R",
    gitCommit = environment$generator_commit,
    sha256 = environment$generator_sha256
  ),
  generatedAtUtc = format(
    Sys.time(), "%Y-%m-%dT%H:%M:%SZ", tz = "UTC", usetz = FALSE
  ),
  numericalRuntime = list(
    platform = R.version$platform,
    BLAS = sessionInfo()$BLAS,
    LAPACK = sessionInfo()$LAPACK
  ),
  command = paste(
    "Rscript oracle-r/generate-small-raw-golden.R",
    "--legacy-checkout <clean-d020-checkout>",
    paste0(
      "--output packages/parity-contracts/fixtures/",
      "small-raw.rena-0.2.7.golden.json"
    )
  ),
  input = list(
    path = "small-raw.csv",
    bytes = environment$input_bytes,
    sha256 = environment$input_sha256
  ),
  spec = list(
    model = "AccumulatedTrajectory",
    units = c("Group", "Name"),
    conversation = I(c("Lesson")),
    codes = c("EC", "ICT", "MCO", "ATT"),
    group = "Group",
    participant = I(c("Name")),
    time = "Lesson",
    window = "MovingStanzaWindow",
    windowSizeBack = 4L,
    windowSizeForward = 0L,
    weightBy = "binary",
    rotation = "svd",
    dimensions = 3L,
    dimensionColumns = DIMENSIONS,
    centerAlignToOrigin = TRUE
  ),
  analysisPayloadSha256 = analysis_payload_sha256,
  analysisPayload = list(
    hashAlgorithm = "sha256",
    hashScope = "compact-json-utf8-of-top-level-analysis",
    sha256 = analysis_payload_sha256
  )
)

written <- write_artifact(arguments$output, list(
  manifest = manifest,
  analysis = analysis
))
cat(
  "oracle_generation=PASS",
  paste0("fixture_id=", FIXTURE_ID),
  paste0("input_sha256=", environment$input_sha256),
  paste0("input_bytes=", format(environment$input_bytes, scientific = FALSE)),
  paste0("analysis_payload_sha256=", analysis_payload_sha256),
  paste0("artifact_sha256=", written$sha256),
  paste0("artifact_bytes=", format(written$bytes, scientific = FALSE)),
  paste0("artifact_path=", written$path),
  sep = "\n"
)
cat("\n")
