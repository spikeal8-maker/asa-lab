FROM node:22.19.0-bookworm-slim AS build

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates git \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/scratch-editor
COPY infra/scratch-editor/upstream.env /tmp/scratch-upstream.env
COPY infra/scratch-editor/patches/0001-host-logo-prop.patch /tmp/0001-host-logo-prop.patch
COPY infra/scratch-editor/patches/0002-separate-manual-save-ui.patch /tmp/0002-separate-manual-save-ui.patch
COPY infra/scratch-editor/patches/0003-embedded-assets-and-builtin-extensions.patch /tmp/0003-embedded-assets-and-builtin-extensions.patch
COPY infra/scratch-editor/fetch-library-assets.mjs /tmp/fetch-library-assets.mjs

RUN set -eux; \
    . /tmp/scratch-upstream.env; \
    git init; \
    git remote add origin "$SCRATCH_EDITOR_REPOSITORY"; \
    git fetch --depth=1 origin "$SCRATCH_EDITOR_COMMIT"; \
    git checkout --detach FETCH_HEAD; \
    test "$(git rev-parse HEAD)" = "$SCRATCH_EDITOR_COMMIT"; \
    git apply --check /tmp/0001-host-logo-prop.patch; \
    git apply /tmp/0001-host-logo-prop.patch; \
    git apply --check /tmp/0002-separate-manual-save-ui.patch; \
    git apply /tmp/0002-separate-manual-save-ui.patch; \
    git apply --check /tmp/0003-embedded-assets-and-builtin-extensions.patch; \
    git apply /tmp/0003-embedded-assets-and-builtin-extensions.patch

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

# Verify the real patched VM: native Pen stays available, project-supplied code
# cannot execute in the shared ASA browser origin.
RUN node -e "const assert=require('node:assert/strict'); const VM=require('./packages/scratch-vm/src/virtual-machine'); const vm=new VM(); (async()=>{try{await assert.rejects(vm.extensionManager.loadExtensionURL('https://untrusted.invalid/extension.js'), /external extension code/); await vm.extensionManager.loadExtensionURL('pen'); assert.equal(vm.extensionManager.isExtensionLoaded('pen'),true);}finally{vm.quit();}})().catch(e=>{console.error(e);process.exit(1);});"

# Reuse pinned build outputs; compression does not modify source media or GUI.
COPY infra/scratch-editor/configure-artifact.mjs /tmp/configure-artifact.mjs
RUN node --input-type=module -e "import { precompressStaticAssets as pack } from '/tmp/configure-artifact.mjs'; console.log(pack('/opt/scratch-library-assets'), pack('/opt/scratch-editor/packages/scratch-gui/dist'));"

FROM nginx:1.27.5-alpine

ARG ASA_BUILD_REVISION=unknown
LABEL org.opencontainers.image.revision="${ASA_BUILD_REVISION}"
ARG ASA_BLOCKS_PARENT_ORIGIN=

# Bake the static config: the preview runtime is non-root with a read-only rootfs.
COPY infra/scratch-editor/nginx.conf.template /etc/nginx/conf.d/default.conf
COPY --chmod=0555 infra/scratch-editor/start.sh /usr/local/bin/asa-scratch-start
COPY infra/scratch-editor/host/ /usr/share/nginx/html/
COPY apps/web/public/asa-lab-mark.svg /usr/share/nginx/html/asa-lab-mark.svg
COPY apps/web/public/asa-lab-scratch-wordmark.svg /usr/share/nginx/html/asa-lab-scratch-wordmark.svg
COPY --from=build /opt/scratch-library-assets/ /usr/share/nginx/html/library-assets/
COPY --from=build /opt/scratch-editor/packages/scratch-gui/dist/ /usr/share/nginx/html/vendor/scratch/
COPY --from=build /opt/scratch-editor/LICENSE /usr/share/nginx/html/licenses/SCRATCH-EDITOR-AGPL-3.0.txt
COPY --from=build /opt/scratch-editor/packages/scratch-gui/TRADEMARK /usr/share/nginx/html/licenses/SCRATCH-GUI-TRADEMARK.txt
COPY --from=build /tmp/scratch-upstream.env /usr/share/nginx/html/licenses/scratch-editor-upstream.env

RUN set -eux; \
    printf '%s\n' "$ASA_BUILD_REVISION" > /usr/share/nginx/html/asa-commit.txt; \
    if [ -n "$ASA_BLOCKS_PARENT_ORIGIN" ]; then \
      sed -i "s#<meta name=\"asa-parent-origin\" content=\"\" />#<meta name=\"asa-parent-origin\" content=\"${ASA_BLOCKS_PARENT_ORIGIN}\" />#" /usr/share/nginx/html/index.html; \
    fi; \
    test -f /usr/share/nginx/html/index.html; \
    test -f /usr/share/nginx/html/main.js; \
    test -f /usr/share/nginx/html/recovery.js; \
    test -f /usr/share/nginx/html/asa-lab-mark.svg; \
    test -f /usr/share/nginx/html/asa-lab-scratch-wordmark.svg; \
    test -f /usr/share/nginx/html/library-assets/library-assets-manifest.json; \
    test -f /usr/share/nginx/html/vendor/scratch/scratch-gui-standalone.js; \
    ! grep -F "Scratch 3.0 GUI" /usr/share/nginx/html/index.html

EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/asa-scratch-start"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
