# Public project detail — native player layout preview, 2026-11-01

TASK: TASK-PROJ-DETAIL-LAYOUT-PREVIEW-001; Issue211; owner visual acceptance pending.
Supersedes both rejected local visual proposals. This is a layout-only candidate,
not a production release or acceptance of the entire Publications programme.

## Result

Bounded title/back header; native working surface on the left and public author,
module, instructions, tags and collapsed license information on the right. Existing
copy/like/link actions remain immediately beneath the viewer. Below900px the
sidebar follows the working area. Controls stay with the native renderer. No mock
comments, new API, permissions, simulation engine or Scratch protocol changes.
Only PublicProjectPage consumes the changed layout selectors; catalog unaffected.
Shared native styles/fullscreen selectors retained, sizing overrides scoped to the
project stage column. Real photo avatar is still unavailable in the public DTO;
existing initials fallback is retained, without inventing a public avatar field.

## Live local evidence

Isolated disposable `asa_detail_preview_test` PostgreSQL and private test MinIO,
new synthetic author and genuine persisted/publicly published test projects.
The published artifacts, native Scratch VM/assets and canonical Electronics worker
are REAL; API responses, counters, runtime and solver were not mocked. The required
preview snapshot is a blank test PNG but is NOT used in either demonstrated viewer.
Zero likes/copies are actual test-database counters. Copy permissions remain off;
there is no invented enabled acquisition action.

- Scratch: b06c5b7f-c844-4104-933e-af2f16744e86. Actual repository SVG rendered on
  native canvas; flag advances monitor0→412, stop leaves419 stable across subsequent
  layout checks. Green flag/stop belong to the native isolated Scratch host.
- Electronics: 532f82d8-dbde-45a2-8f17-08e039490858. Published Arduino program,
  Start/Stop, code expansion; real pointer press on button yields aria-pressed=true
  and LED brightness0→70; release yields false and brightness0. No editor mounted.
- Eight native layout checks: both modules at1440/1024/390/320; viewport width equals
  document scrollWidth; author/notes beside stage on desktop, below it on phones.
- Fullscreen was attempted in the embedded browser but an active fullscreen DOM
  element was NOT confirmed. No fullscreen PASS is claimed. Existing functionality
  was not changed to bypass browser restrictions.

Artifacts: `F:/Asa-Lab/operations/reports/detail-native-20261101/`:
`layout-checks.json`, `scratch-{width}.png`, `electronics-{width}.png`,
`electronics-running-1440.png`. Desktop/mobile native screenshots inspected.
Test fixtures are clearly synthetic content, not real production user activity.

## Checks and boundaries

- `pnpm exec vitest run apps/web/src/projects-public/PublicProjectPage.spec.ts`:
  10PASS (loading/error/retry/unavailable, long title/description, clipboard,
  absent cover/description/tags). No Nx cache involved.
- `pnpm exec tsc -p apps/web/tsconfig.json --noEmit`: PASS.
- Focused ESLint and diff check: PASS.
- API and16 prerequisite build tasks executed with NX_SKIP_NX_CACHE=true: PASS.
  First build failed because this checkout's existing workspace links lacked
  installed dependencies; frozen-lockfile install fixed links without source or
  lockfile changes. Build then passed. No full Scratch/Terser rebuild performed.
- Full publication/data/repository CI not run for this local visual preview.
- No deployment, production schema/data changes, Yandex upload or Main integration.
  Existing untracked Arduino reports preserved.

Ports: loopback-only Vite4612, test API4611, test PostgreSQL25432, test MinIO19000.
Existing pinned Scratch host4613 reused read-only; production4610 unchanged.
Disposable preview containers have no persistent volumes; retained temporarily for
owner review together with the two local browser examples. Separate source branch;
owner acceptance of the visual is still required before treating it as accepted.

POST_STEP_REVIEW: L0_LOCAL_UI. Functional native playback demonstrated; visual
candidate shown for owner review. No permissions/identity/domain mutations changed.
UNVERIFIED: embedded-browser fullscreen; complete repository/CI release acceptance.

## Owner refinement: visible feedback and code panel

Likes/copy count moved into the top heading (desktop right, mobile above viewer).
Catalog gradient narrowed to the image edges and lightened. Existing single-like
policy preserved; no unimplemented dislike/emotion controls added.
Arduino code moved to a closable right-side panel within the viewer; grid placement
keeps it below the full toolbar even when toolbar wraps. For blocks mode an honest
notice explains that only generated source is currently published. Actual block
workspace remains explicitly excluded by the current public artifact contract;
proper read-only block publication is NOT implemented in this layout slice.
The Scratch polygon is the original test program SVG asset, not a malformed flag.
Blank catalog images are the test fixture snapshots; no production preview-loss
claim or fix is inferred from these synthetic images.

Checks:18 focused page/scene tests PASS; web typecheck/ESLint PASS. Four viewport
checks no page overflow;320 code panel starts exactly at toolbar bottom404px.
Evidence: code-drawer.png and code-drawer-320.png in the same local evidence folder.
Still a visual candidate; no deployment/Main integration. Blocks representation
and replacement of blank test fixture snapshots remain unfinished.

## Owner refinement: social actions and honest preview fixtures

Large SVG heart/count replaces anonymous underlined `0 Войти`. Guest click opens
native modal dialogue with sign-in choice, cancel/Escape and browser focus handling;
no anonymous private probe, optimistic count or like mutation. Existing authenticated
server-owned count/permissions unchanged. Link action is a compact labelled icon in
detail only; noncompact callers retain their text. Copy-count icon now means copies,
not physical export. Acquisition CTA retained only when server canCopy permits;
no permission grant, no fake enabled download. Code panel typography improved.

Focused PublicationLike + PublicProjectPage:14PASS, including guest modal/count
no-write regression. Web typecheck/ESLint PASS. Native browser at1440/1024/390/320:
no page horizontal overflow; real modal open/close demonstrated. Catalog and detail
screenshots: catalog-real-covers.png, actions-redesign.png, actions-mobile.png and
guest-like-dialog.png in the local evidence folder.

Preview fixture correction ONLY in asa_detail_preview_test: original32px blank
snapshots replaced by new correctly published fixtures with native scene screenshots.
Immutable revision update was rejected as designed, not bypassed; fresh publication
API generated new revisions. Two failed-crop fixtures and original blank fixtures
were revoked only in disposable test state. No production database touched.
Current local fixture publications: Scratch7a3014ba-e460-4317-8b18-2c8c1a347aa8;
Electronics2cab18c8-d9e6-4b68-b24d-5ee082c83cac. Acquisition remains off for these
fixtures, so no enabled add-to-projects action is claimed in screenshots.

Actual block representation remains NOT_IMPLEMENTED; public contract still excludes
workspace. Main integration/deployment/complete repository CI NOT_RUN. Visual owner
acceptance pending. No old evidence silently upgraded to a new release verdict.
