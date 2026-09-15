FROM node:22.19.0-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/scratch-editor
COPY infra/scratch-editor/upstream.env /tmp/scratch-upstream.env
COPY infra/scratch-editor/patches/0001-host-logo-prop.patch /tmp/0001-host-logo-prop.patch
COPY infra/scratch-editor/fetch-library-assets.mjs /tmp/fetch-library-assets.mjs

RUN set -eux; \
    . /tmp/scratch-upstream.env; \
    git init; \
    git remote add origin "$SCRATCH_EDITOR_REPOSITORY"; \
    git fetch --depth=1 origin "$SCRATCH_EDITOR_COMMIT"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "$SCRATCH_EDITOR_COMMIT"; \
    git apply --check /tmp/0001-host-logo-prop.patch; \
    git apply /tmp/0001-host-logo-prop.patch

RUN node /tmp/fetch-library-assets.mjs /opt/scratch-editor /opt/scratch-library-assets

RUN set -eux; \
    . /tmp/scratch-upstream.env; \
    test "$(node -p "require('./package.json').version")" = "$SCRATCH_EDITOR_VERSION"; \
    HUSKY=0 npm ci --no-audit --no-fund; \
    npm run build --workspace=@scratch/task-herder; \
    npm run build --workspace=@scratch/scratch-storage; \
    npm run build --workspace=@scratch/scratch-svg-renderer; \
    npm run build --workspace=@scratch/scratch-paint; \
    npm run build --workspace=@scratch/scratch-render; \
    npm run build --workspace=@scratch/scratch-vm; \
    npm run build:dist-standalone --workspace=@scratch/scratch-gui; \
    test -f packages/scratch-gui/dist/scratch-gui-standalone.js

FROM nginx:1.27.5-alpine

ARG ASA_BLOCKS_PARENT_ORIGIN=

COPY infra/scratch-editor/nginx.conf.template /etc/nginx/templates/default.conf.template
COPY infra/scratch-editor/host/ /usr/share/nginx/html/
COPY apps/web/public/asa-lab-mark.svg /usr/share/nginx/html/asa-lab-mark.svg
COPY apps/web/public/asa-lab-scratch-wordmark.svg /usr/share/nginx/html/asa-lab-scratch-wordmark.svg
COPY --from=build /opt/scratch-library-assets/ /usr/share/nginx/html/library-assets/
COPY --from=build /opt/scratch-editor/packages/scratch-gui/dist/ /usr/share/nginx/html/vendor/scratch/
COPY --from=build /opt/scratch-editor/LICENSE /usr/share/nginx/html/licenses/SCRATCH-EDITOR-AGPL-3.0.txt
COPY --from=build /opt/scratch-editor/packages/scratch-gui/TRADEMARK /usr/share/nginx/html/licenses/SCRATCH-GUI-TRADEMARK.txt
COPY --from=build /tmp/scratch-upstream.env /usr/share/nginx/html/licenses/scratch-editor-upstream.env

RUN set -eux; \
    if [ -n "$ASA_BLOCKS_PARENT_ORIGIN" ]; then \
      sed -i "s#<meta name=\"asa-parent-origin\" content=\"\" />#<meta name=\"asa-parent-origin\" content=\"${ASA_BLOCKS_PARENT_ORIGIN}\" />#" /usr/share/nginx/html/index.html; \
    fi; \
    test -f /usr/share/nginx/html/index.html; \
    test -f /usr/share/nginx/html/main.js; \
    test -f /usr/share/nginx/html/asa-lab-mark.svg; \
    test -f /usr/share/nginx/html/asa-lab-scratch-wordmark.svg; \
    test -f /usr/share/nginx/html/library-assets/library-assets-manifest.json; \
    test -f /usr/share/nginx/html/vendor/scratch/scratch-gui-standalone.js; \
    ! grep -F "Scratch 3.0 GUI" /usr/share/nginx/html/index.html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
