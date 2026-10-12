# ASA Lab — Figma UI Atlas: implementation ledger

Created: 2026-10-12
GitHub baseline: `acedf8f1c3982ae15f1e59e02385fda1f50dd538`
Figma design: https://www.figma.com/design/vbRPijeR6IeTw1F8lkfsGr

## Objective

Create a source-of-truth design atlas for responsive ASA Lab UI and a *reviewed* Figma → React/CSS change loop. Do not replace existing interactive behavior or blindly generate new components.

## Current verified work

- Figma file created and accessible.
- Three Figma pages: `01 · Токены и компоненты` (ID `0:1`), `02 · Атлас экранов` (ID `1:2`), `03 · Связь с GitHub` (ID `1:3`).
- 28 local Figma variables were derived from `apps/web/src/brand/brand.css` and `apps/web/src/styles.css` (24 colors, 4 corner radii).
- 35 inventory rows across 5 sections were added to the atlas. These are inventory entries, not 35 completed wireframes.
- Editable schematic home desktop (1440 × 900) Figma node `2:2` and home mobile (390 × 844) node `2:47`. These are **source-informed schematic prototypes**, **not** pixel-perfect captures of the live web application.
- No runtime or CSS code was modified. No production change was applied.
- Native Figma Code Connect not required; any inferred node→component association must be validated.

## Route implementation anchors

Main router: `apps/web/src/App.tsx`
Portal view routes: `apps/web/src/creator-portal/navigation.ts`
Admin sections: `apps/web/src/admin/admin-navigation.ts`
Portal shared navigation: `apps/web/src/components/PortalHeader.tsx`
Editor factory: `apps/web/src/modules/ModuleEditorHost.tsx`

| UI family | React source | Route | Access |
| --- | --- | --- | --- |
| Public landing | `apps/web/src/pages/PublicEntryPage.tsx` | `/` | anonymous |
| Sign in | `apps/web/src/pages/LoginPage.tsx` | `/#/sign-in` | anonymous |
| Sign up | `apps/web/src/pages/RegisterPage.tsx` | `/#/sign-up` | anonymous |
| Join class | `apps/web/src/pages/JoinClassPage.tsx` | `/#/join-class` | anonymous / signed-in |
| Public org sign in | `apps/web/src/pages/OrganizationLoginPage.tsx` | `/#/organization-sign-in` | anonymous |
| Home | `apps/web/src/pages/CreatorHomePage.tsx` | `/#/home` | account / seat |
| My projects | `apps/web/src/pages/MyProjectsPage.tsx` | `/#/projects` | account / seat (filtered) |
| Games | `apps/web/src/pages/GamesPage.tsx` | `/#/games` | account |
| Learning | `apps/web/src/pages/LearningPage.tsx` | `/#/learning` | account / seat |
| Knowledge | `apps/web/src/pages/KnowledgePage.tsx` | `/#/knowledge` | account |
| Knowledge course | `apps/web/src/pages/KnowledgePage.tsx` | `/#/knowledge/:courseId` | account |
| Collections | `apps/web/src/pages/CollectionsPage.tsx` | `/#/collections` | account |
| Gallery | `apps/web/src/pages/GalleryPage.tsx` | `/#/gallery` | account |
| Gallery work | `apps/web/src/pages/GalleryWorkPage.tsx` | `/#/gallery/:projectId` | account |
| Help | `apps/web/src/pages/CreatorResourcePage.tsx` | `/#/help` | account / seat |
| Account preferences | `apps/web/src/pages/AccountPage.tsx` | `/#/account` | account |
| Seat preferences | `apps/web/src/pages/SeatAccountPage.tsx` | `/#/account` | seat |
| Class hub | `apps/web/src/pages/DashboardPage.tsx` | `/#/classrooms` | classroom-management grant |
| Student class | `apps/web/src/pages/SeatClassPage.tsx` | `/#/classrooms` | seat |
| Specific class | `apps/web/src/pages/ClassroomPage.tsx` | `/#/classrooms/:id` | classroom-management grant |
| Class projects | `apps/web/src/pages/ProjectsPage.tsx` | `/#/classrooms/:id/projects` | classroom-management grant |
| Attending | `apps/web/src/pages/AttendedClassesPage.tsx` | `/#/attending` | account |
| Courses & tasks | `apps/web/src/pages/AssignmentLibraryPage.tsx` | `/#/challenges` | authoring grant |
| Invite | `apps/web/src/pages/TeacherInvitePage.tsx` | `/#/teacher-invite/:token` | invitation token |
| Electronics | `apps/web/src/modules/ModuleEditorHost.tsx` | `/projects/:id/electronics/edit` | valid project |
| 3D | `apps/web/src/modules/ModuleEditorHost.tsx` | `/#/3d/:id` | valid project |
| Blocks | `apps/web/src/modules/ModuleEditorHost.tsx` | `/#/projects/:id?module=blocks` | valid project |
| Chess | `apps/web/src/modules/ModuleEditorHost.tsx` | `/#/chess/:id` | valid project |
| Checkers | `apps/web/src/modules/ModuleEditorHost.tsx` | `/#/games/checkers/:id` | valid project |
| Admin | `apps/web/src/admin/AdminPage.tsx` | `/#/admin` and 7 subroutes | admin grant |

## Responsive baseline

- Desktop design target: 1440px
- Tablet inspection target: 768px
- Mobile design target: 390px
- Do **not** replace actual project breakpoints without checking code first:
  `portal-workspace.css` uses 1023 / 820 / 390;
  `creator-portal.css` uses 1080 / 820 / 560;
  `styles.css` uses 900 / 640.

## Verified Figma-to-code workflow (target; not yet operational)

1. Capture actual running pages into Figma as editable layers. For authenticated screens use disposable test accounts and redact student PII.
2. Tag imported screen by route, role, state, viewport width, source commit, and Figma node ID.
3. Designer edits Figma and marks individual frame as ready. Unapproved drafts must not change production.
4. Bot reads Figma node context and screenshot, compares source files at target GitHub HEAD, and maps to existing React/CSS components and tokens.
5. Bot writes isolated branch/PR; no direct production edits.
6. Run type-check/lint/unit tests and browser visual comparisons at relevant widths, plus keyboard/accessibility checks.
7. If checks pass, obtain independent review and merge through repository policy; else fix, do not silently mark complete.
8. Revalidate code vs approved Figma frame, keep provenance and change log.

## Remaining work (not claim as complete)

- Capture each real app screen, populate all desktop/mobile frame pairs and hidden states; currently only home schematic pair is created.
- Populate actual components/variants and bind layout layer properties to Figma variables.
- Build capture/test harness for authorized routes.
- Implement automated diff/PR pipeline, verify with a harmless test on one component.
- Integrate design snapshot verification into GitHub CI.
- Maintain a single-writer-per-file/one-writer-per-Figma-frame discipline when agents run in parallel.

The master file must not be treated as an already pixel-perfect reproduction of ASA Lab.
