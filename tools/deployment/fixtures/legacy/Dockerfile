# Disposable CI fixture only. Both product stages are official immutable bd804
# artifacts supplied by the verified release manifest, not rebuilt source.
ARG API_IMAGE
ARG WEB_IMAGE
FROM ${WEB_IMAGE} AS portal
FROM ${API_IMAGE}

USER root
WORKDIR /workspace
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts --no-audit --no-fund \
    && mkdir -p /workspace/apps/api /workspace/apps/web /workspace/packages/contracts /workspace/docker/certs \
    && ln -s /app/node_modules /workspace/apps/api/node_modules \
    && cp /app/certs/russian-trusted-root-ca.pem /workspace/docker/certs/russian-trusted-root-ca.pem \
    && cp /app/node_modules/@asa-lab/contracts/package.json /workspace/packages/contracts/package.json
COPY --from=portal /srv /opt/asa-legacy-portal

# The review overlay supplies the exact API watcher / genuine Vite entrypoints.
# No synthetic version or API implementation is included in this image.
# Explicit Compose entrypoints must clear this inherited workspace-image CMD.
CMD ["node"]
