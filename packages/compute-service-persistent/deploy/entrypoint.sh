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
ulimit -u "${MAX_PROCESSES}" 2>/dev/null || exit 78

test -r /app/build-manifest.json
test ! -w /app
test -w "${TMPDIR}"

exec /sbin/tini -- node /app/compute-runtime.mjs "$@"
