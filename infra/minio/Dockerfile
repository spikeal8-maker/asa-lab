# syntax=docker/dockerfile:1

# The upstream container registries no longer serve these historical images.
# Keep the exact server/client releases and verify the official GitHub assets
# before they enter the image. This image also supplies mc to minio-init.
FROM alpine:3.22@sha256:5291449c3df73caf6ed85e649dec1b9e818b39a5d8c871e97afc13e9cd5e8fa8

RUN apk add --no-cache ca-certificates curl

ADD --checksum=sha256:fa42dfb43019e71731c10d70cc24057f6af63f22d76c4722614056514739fc97 \
    https://github.com/minio/minio/releases/download/RELEASE.2024-09-13T20-26-02Z/minio.linux-amd64.RELEASE.2024-09-13T20-26-02Z \
    /usr/local/bin/minio
ADD --checksum=sha256:9a9e7d32c175f2804d6880d5ad3623097ea439f0e0304aa6039874d0f0c493d8 \
    https://github.com/minio/mc/releases/download/RELEASE.2024-09-16T17-43-14Z/mc.linux-amd64.RELEASE.2024-09-16T17-43-14Z \
    /usr/local/bin/mc

RUN chmod 0755 /usr/local/bin/minio /usr/local/bin/mc \
    && mkdir -p /data \
    && chown 1000:1000 /data

ENV MC_CONFIG_DIR=/tmp/.mc
USER 1000:1000
ENTRYPOINT ["/usr/local/bin/minio"]
