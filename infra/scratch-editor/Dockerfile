FROM node:22.19.0-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/scratch-editor
COPY infra/scratch-editor/upstream.env /tmp/scratch-upstream.env

RUN set -eux; \
    . /tmp/scratch-upstream.env; \
    git init; \
    git remote add origin "$SCRATCH_EDITOR_REPOSITORY"; \
    git fetch --depth=1 origin "$SCRATCH_EDITOR_COMMIT"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "$SCRATCH_EDITOR_COMMIT"

RUN set -eux; \
    . /tmp/scratch-upstream.env; \
    test "$(node -p "require('./package.json').version")" = "$SCRATCH_EDITOR_VERSION"; \
    HUSKY=0 npm ci --no-audit --no-fund; \
    npm run build; \
    test -f packages/scratch-gui/build/index.html

FROM nginx:1.27.5-alpine

COPY infra/scratch-editor/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /opt/scratch-editor/packages/scratch-gui/build/ /usr/share/nginx/html/
COPY --from=build /opt/scratch-editor/LICENSE /usr/share/nginx/html/licenses/SCRATCH-EDITOR-AGPL-3.0.txt
COPY --from=build /tmp/scratch-upstream.env /usr/share/nginx/html/licenses/scratch-editor-upstream.env

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
