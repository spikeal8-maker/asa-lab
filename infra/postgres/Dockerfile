# syntax=docker/dockerfile:1.7
ARG POSTGRES_IMAGE=postgres:17.11-bookworm@sha256:839fbb5a4942a7758dd93e18b42ea5649807491a0545b5eeeb8f0b8bb11857a5
FROM golang:1.27.3-bookworm@sha256:d9b6a1beb9474adc2a1ce842573639b44b2a0dd49b6669f51d3821baf9ec37c9 AS security-gosu
ENV GOTOOLCHAIN=local CGO_ENABLED=0
WORKDIR /src
ADD --checksum=sha256:cd9719b775dbfedae53923c9b0dc792b66d42c51e0b36652ed6f747fbadc0164 https://codeload.github.com/tianon/gosu/tar.gz/refs/tags/1.19 /tmp/gosu.tar.gz
RUN tar -xzf /tmp/gosu.tar.gz --strip-components=1 \
    && go build -mod=readonly -trimpath -ldflags '-s -w' -o /out/gosu . \
    && go version -m /out/gosu > /out/gosu-build-info.txt

FROM ${POSTGRES_IMAGE} AS runtime
ARG ASA_BUILD_REVISION=unknown
ARG ASA_SECURITY_PATCHSET=2026-11-02
LABEL org.opencontainers.image.revision="${ASA_BUILD_REVISION}"
RUN test -n "$ASA_SECURITY_PATCHSET" \
    && apt-get update && apt-get upgrade -y \
    && rm -rf /var/lib/apt/lists/*
COPY --from=security-gosu --chmod=0755 /out/gosu /usr/local/bin/gosu
COPY --from=security-gosu /out/gosu-build-info.txt /usr/share/asa-gosu-build-info.txt
# Keep the official entrypoint/root-to-postgres behaviour for first initialization.
RUN gosu nobody sh -c 'test "$(id -u)" = 65534'
