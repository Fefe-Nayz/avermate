# syntax=docker/dockerfile:1.10

# Both bases are supplied by the reviewed build plan as immutable OCI digests.
# The runtime base is a separately attested toolchain image for the selected
# profile; this Dockerfile never resolves package repositories at build time.
ARG BUN_BUILD_IMAGE
FROM ${BUN_BUILD_IMAGE} AS build
ARG BUN_BUILD_IMAGE

RUN case "$BUN_BUILD_IMAGE" in *@sha256:????????????????????????????????????????????????????????????????) ;; *) exit 64 ;; esac \
  && test "$(bun --version)" = "1.4.0"

WORKDIR /build
COPY package.json bun.lock ./
COPY patches patches
COPY packages/agent-contracts/package.json packages/agent-contracts/package.json
COPY apps/sandbox-worker/package.json apps/sandbox-worker/package.json
RUN bun install --frozen-lockfile --production --ignore-scripts

COPY packages/agent-contracts/src packages/agent-contracts/src
COPY packages/agent-contracts/tsconfig.json packages/agent-contracts/tsconfig.json
COPY apps/sandbox-worker/src apps/sandbox-worker/src
COPY apps/sandbox-worker/tsconfig.json apps/sandbox-worker/tsconfig.json

RUN mkdir -p /out \
  && bun build --compile apps/sandbox-worker/src/browser-capture.ts --outfile /out/browser-capture \
  && bun build --compile apps/sandbox-worker/src/media-build.ts --outfile /out/media-build \
  && bun build --compile apps/sandbox-worker/src/manim-build.ts --outfile /out/manim-build \
  && bun build --compile apps/sandbox-worker/src/latex-build.ts --outfile /out/latex-build \
  && bun build --compile apps/sandbox-worker/src/slides-build.ts --outfile /out/slides-build

ARG WORKER_RUNTIME_IMAGE
FROM ${WORKER_RUNTIME_IMAGE} AS runtime-base
ARG WORKER_RUNTIME_IMAGE

RUN case "$WORKER_RUNTIME_IMAGE" in *@sha256:????????????????????????????????????????????????????????????????) ;; *) exit 64 ;; esac \
  && mkdir -p /workspace/input /workspace/output /workspace/tmp /opt/avermate/bin \
  && chown -R 65532:65532 /workspace

ENV HOME=/workspace/tmp \
  TMPDIR=/workspace/tmp \
  LANG=C.UTF-8 \
  LC_ALL=C.UTF-8 \
  SOURCE_DATE_EPOCH=0
WORKDIR /workspace
USER 65532:65532

FROM runtime-base AS profile-browser
COPY --from=build --chown=65532:65532 /out/browser-capture /opt/avermate/bin/browser-capture

FROM runtime-base AS profile-media
COPY --from=build --chown=65532:65532 /out/media-build /opt/avermate/bin/media-build

FROM runtime-base AS profile-manim
COPY --from=build --chown=65532:65532 /out/manim-build /opt/avermate/bin/manim-build

FROM runtime-base AS profile-latex
COPY --from=build --chown=65532:65532 /out/latex-build /opt/avermate/bin/latex-build

FROM runtime-base AS profile-slides
COPY --from=build --chown=65532:65532 /out/slides-build /opt/avermate/bin/slides-build

ARG WORKER_PROFILE
FROM profile-${WORKER_PROFILE} AS release
ARG WORKER_PROFILE
ARG WORKER_PROFILE_VERSION
ARG BUILD_INPUT_DIGEST

LABEL org.opencontainers.image.title="Avermate sandbox worker" \
  org.opencontainers.image.version="${WORKER_PROFILE_VERSION}" \
  org.opencontainers.image.revision="${BUILD_INPUT_DIGEST}" \
  org.avermate.sandbox.profile="${WORKER_PROFILE}" \
  org.avermate.sandbox.input-digest="${BUILD_INPUT_DIGEST}"

# A provider must invoke the exact reviewed entrypoint. Direct container starts
# fail closed and cannot become an accidental general-purpose worker service.
CMD ["/bin/false"]
