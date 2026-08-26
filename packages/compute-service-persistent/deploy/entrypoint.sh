#!/bin/sh
set -eu

umask 077

case "${MAX_OPEN_FILES:-}" in
  ''|*[!0-9]*) exit 78 ;;
esac
case "${MAX_PROCESSES:-}" in
  ''|*[!0-9]*) exit 78 ;;
esac

ulimit -n "${MAX_OPEN_FILES}"
if ulimit -u "${MAX_PROCESSES}" 2>/dev/null; then
  :
elif command -v prlimit >/dev/null 2>&1; then
  prlimit --pid "$$" --nproc="${MAX_PROCESSES}:${MAX_PROCESSES}" >/dev/null 2>&1 || exit 78
else
  exit 78
fi

test -r /app/build-manifest.json
test ! -w /app
test -w "${TMPDIR}"

exec /sbin/tini -- node /app/compute-runtime.mjs "$@"
