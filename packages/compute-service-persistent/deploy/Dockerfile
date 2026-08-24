# syntax=docker/dockerfile:1.7
# A reviewed immutable image digest is mandatory, for example:
#   --build-arg NODE_BASE_IMAGE=registry.example/node-tini@sha256:<64 hex>
#   --build-arg SOURCE_COMMIT=<40 lowercase hex Git SHA>
#   --build-arg RUNTIME_BUNDLE_DIR=output/compute-service-candidate-<release-id>
#   --build-arg EXPECTED_SDK_VERSION=<reviewed @3dena/analysis version>
#   --build-arg EXPECTED_BUILD_ID=<reviewed public package build ID>
# The selected image must contain Node >=20.9 and /sbin/tini. There is no
# mutable image or runtime-bundle default: omission deliberately fails the build.
ARG NODE_BASE_IMAGE
FROM ${NODE_BASE_IMAGE} AS runtime

ARG SOURCE_COMMIT
ARG RUNTIME_BUNDLE_DIR
ARG EXPECTED_SDK_VERSION
ARG EXPECTED_BUILD_ID

LABEL org.opencontainers.image.revision="${SOURCE_COMMIT}" \
      org.opencontainers.image.source="https://github.com/HUDongpin/j-3dENA"

ENV NODE_ENV=production \
    HOME=/nonexistent \
    TMPDIR=/tmp \
    TZ=UTC \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8 \
    NODE_OPTIONS=--disable-proto=throw \
    BUILD_MANIFEST_PATH=/app/build-manifest.json \
    SCIENTIFIC_WORKER_ENTRY_PATH=/app/scientific-worker-entry.mjs \
    MAX_OPEN_FILES=1024 \
    MAX_PROCESSES=64

WORKDIR /app

COPY --chown=10001:10001 ${RUNTIME_BUNDLE_DIR}/compute-runtime.mjs /app/compute-runtime.mjs
COPY --chown=10001:10001 ${RUNTIME_BUNDLE_DIR}/scientific-worker-entry.mjs /app/scientific-worker-entry.mjs
COPY --chown=10001:10001 ${RUNTIME_BUNDLE_DIR}/build-manifest.json /app/build-manifest.json
COPY --chmod=0555 packages/compute-service-persistent/deploy/entrypoint.sh /usr/local/bin/compute-entrypoint
COPY --chmod=0555 packages/compute-service-persistent/deploy/verify-runtime-bundle.mjs /usr/local/bin/verify-runtime-bundle

# Refuse an image without a real init and refuse accidentally bundled oracle/R
# source by filename. The release boundary scanner remains an independent gate.
RUN test -x /sbin/tini \
    && printf '%s\n' "$SOURCE_COMMIT" | grep -Eq '^[a-f0-9]{40}$' \
    && test -s /app/compute-runtime.mjs \
    && test -s /app/scientific-worker-entry.mjs \
    && test -s /app/build-manifest.json \
    && node /usr/local/bin/verify-runtime-bundle /app "$EXPECTED_SDK_VERSION" "$EXPECTED_BUILD_ID" "$SOURCE_COMMIT" \
    && ! find /app -type f \( -name '*.R' -o -name '*.rds' -o -name '*.rda' -o -name '*.RData' \) -print -quit | grep -q . \
    && chmod -R a-w /app

USER 10001:10001

EXPOSE 8080

HEALTHCHECK --interval=15s --timeout=5s --start-period=10s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:8080/readyz',{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/local/bin/compute-entrypoint"]
CMD ["api"]
