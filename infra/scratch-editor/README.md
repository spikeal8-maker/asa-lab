# ASA Lab Scratch Editor runtime — M0

This directory builds the official open-source Scratch Editor as an isolated
runtime for ASA Lab visual programming. It is intentionally not part of the
main `apps/web` dependency graph.

## Upstream lock

`upstream.env` is the source of truth for the exact upstream repository, commit
and Scratch Editor package version. The Docker build checks both the fetched
commit and the root package version before it runs `npm ci`.

M0 lock:

- repository: `scratchfoundation/scratch-editor`
- commit: `82c5fea6d3e60c781f25c09b375045f9b46a43f7`
- package version: `15.1.1`
- provenance: reviewed post-release `15.1.1` snapshot
- official `v15.1.1` tag commit for comparison: `99bcc17e0580588f181f8a87577a2f676537a487`
- upstream license at the ASA pin: `AGPL-3.0-only`

The ASA pin is intentionally nine dependency-maintenance commits after the
release tag. The reviewed tag→pin compare changes package manifests/lockfile
only and no Scratch source-code files. The current pin is retained deliberately;
it must not be described as the official tag commit.

Do not replace the commit with `develop`, `main`, `latest`, a mutable ref or an
unpinned npm range. Upstream updates must arrive as reviewed ASA Lab changes
with exact diff, compatibility, security/license and build/browser evidence.

## Build and run the isolated runtime

From the ASA Lab repository root:

```bash
docker build -f infra/scratch-editor/Dockerfile -t asa-lab-scratch-editor:m0 .
docker run --rm --name asa-lab-scratch-editor -p 127.0.0.1:4613:8080 asa-lab-scratch-editor:m0
```

Then open `http://127.0.0.1:4613/`.

The container has no ASA Lab database and no ASA Lab authentication. In M0 it
only proves that the pinned editor can be built and served behind its own build
boundary. Port `4613` is the local preview port; the container itself listens on
`8080`.

## Deliberate M0 limits

M0 does **not** claim any of the following:

- save/load integration with Project Core;
- object-storage persistence of costumes or sounds;
- `.sb3` import/export or universal historical `.sb3` compatibility;
- network independence from Scratch services;
- cloud variables;
- hardware extensions through Scratch Link;
- production reverse-proxy routing.

Those are acceptance items for later VSCR milestones. Keeping the ASA module
`coming_soon` prevents a learner from entering an editor that cannot yet persist
work safely.

Historical `.sb3` media compatibility is governed by
`docs/product/visual-programming/VSCR-D0-007-SB3-IMPORT-COMPATIBILITY-CONTRACT.md`;
canonical ASA durable media remains `svg/png/jpg/wav/mp3` until a tested import
normalisation path is accepted.

## License and branding

The runtime image copies the upstream Scratch Editor license and exact upstream
lock into `/licenses/`. Before a public branded release, ASA Lab must also review
Scratch Foundation trademark requirements and all media-asset licensing. The ASA
product remains branded as ASA Lab visual programming rather than implying an
official Scratch Foundation service.
