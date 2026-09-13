# ASA Lab Scratch Editor runtime

This directory builds the pinned open-source Scratch Editor as an isolated runtime for ASA Lab
visual programming. Scratch GUI/VM remains outside the `apps/web` dependency graph.

## Upstream lock

`upstream.env` is the source of truth for the exact upstream repository, commit and package
version. The Docker build verifies the fetched commit and root package version before building.

Current reviewed lock:

- repository: `scratchfoundation/scratch-editor`
- commit: `82c5fea6d3e60c781f25c09b375045f9b46a43f7`
- package version: `15.1.1`
- provenance: reviewed post-release `15.1.1` snapshot
- official `v15.1.1` tag commit for comparison: `99bcc17e0580588f181f8a87577a2f676537a487`
- upstream license at the ASA pin: `AGPL-3.0-only`

The ASA pin is intentionally retained. Do not replace it with `develop`, `main`, `latest`, a
mutable ref or an unpinned npm range.

## M1-002A runtime shape

The upstream build produces the shipping standalone UMD distribution under
`packages/scratch-gui/dist/`. The runtime image packages that distribution only under:

```text
/usr/share/nginx/html/vendor/scratch/
```

The nginx root is ASA-owned and contains:

```text
index.html
main.js
protocol.js
status.js
host.css
vendor/scratch/scratch-gui-standalone.js
licenses/
```

`/` therefore serves the ASA host shell, never upstream `packages/scratch-gui/build/index.html`
or its playground pages.

`main.js` verifies the standalone integration primitives (`EditorState`, `createStandaloneRoot`,
`setAppElement`) and composes the accepted C protocol. Without a configured exact parent origin it
reports `configuration-required`; with one it waits for valid INIT and reports `init-accepted`.
The editor root remains empty. Storage/editor mount belongs to the separately selected D task.

Use `pnpm gate:blocks` for source checks and `pnpm gate:blocks --browser` against the built runtime.
Browser setup, message helpers, assertions and scenarios live in `tools/blocks/browser/`.
The browser fixture injects its exact parent origin only into the test response.

## Build and run

From the repository root:

```bash
docker build -f infra/scratch-editor/Dockerfile -t asa-lab-scratch-editor:m1-002a .
docker run --rm --name asa-lab-scratch-editor -p 127.0.0.1:4613:8080 \
  asa-lab-scratch-editor:m1-002a
```

Health endpoint:

```text
http://127.0.0.1:4613/healthz
```

## Deliberate M1-002A limits

This slice does not implement or claim:

- ASA/Scratch logo patching or removal of upstream product chrome;
- File/menu/Extensions product-control changes;
- production runtime capability authentication (C only establishes the message boundary);
- `ScratchStorage` adapter or Project Core persistence;
- autosave, recovery or `.sb3` import/export;
- public activation or sovereign/offline media libraries.

Those belong to later separately authorised slices. The Blocks module remains `coming_soon`.

## License and provenance

The runtime image preserves the upstream Scratch Editor AGPL license, Scratch GUI trademark
notice and exact `upstream.env` lock under `/licenses/`. Future pin changes require reviewed
diff, compatibility, dependency/security/license and build/browser evidence.
