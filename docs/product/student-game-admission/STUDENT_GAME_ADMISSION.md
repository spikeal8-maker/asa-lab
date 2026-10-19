# Student game admission — bounded delivery contract

## Current continuation boundary

The selected task in canonical main authorizes completion of the existing
foundation through the coordinated controller and teacher UI seams below.
The former proposal-only restrictions and pending ownership/mapping handoff in
this document are retained as foundation provenance and are superseded by this
bounded continuation; they do not relax any authorization, data, review or
deployment invariant. Execution status and observed revisions remain only in
current.yaml.

The controller assigns one author for the Games slice. Its coordinated scope is
limited to the existing ProjectsController admission seams, AppModule DI,
ModulesController session-scoped game catalogue if necessary, authenticated
game-access transport, GamesPage/open-game, class and student policy controls,
and their exact regression tests. The required project transaction boundary is
limited to `contexts/projects/application/ports.ts`, `contexts/projects/application/project.usecases.ts`,
`contexts/projects/infrastructure/pg-project.repository.ts` and the bounded type export
from `contexts/projects/index.ts`: carry only server-resolved Seat
context and enforce current admission in the same transaction as protected
reads/writes. The existing `apps/api/src/chess-live.controller.ts` and
`apps/api/src/checkers-classroom.controller.ts` may receive minimal Seat-first/online-deny
repairs if direct bypass tests demonstrate the need. New small helpers/components are permitted
only for this result. Existing rating computation, assignment lifecycle, online
game authorization and tenant/RLS identity are preserved. The navigation and
My Learning slices have different authors.

Fresh overlap checks also hand off four narrowly bounded entry seams.
`apps/api/src/gallery.controller.ts` may reject any present StudentSeat cookie
in `copy()` before Account resolution, preserving public reads and Account-only
copy behavior. `apps/web/src/modules/ModuleEditorHost.tsx` must obtain current
server game admission and project authorization before mounting either game,
including direct URLs; preserve the existing non-game editor path.
`apps/web/src/chess/ChessModuleExperience.tsx` and
`apps/web/src/chess/ChessHome.tsx` may carry the existing Seat identity into the
UI and prevent mounting or launching online play for Seats. Existing Account
play, offline engines, other Gallery operations and project ACL remain intact.
These seams require direct both-cookie, denied/revoked URL and Account
regressions; they grant no general Gallery or editor redesign.

For any shared file, inspect current main and actual pending changes before
writing; an unresolved overlap still blocks that file. Add precise missing
surface/control mappings alongside the corresponding implementation, using
existing identity/learning invariants. A scoped green preflight never replaces
that mapping, focused tests or independent review. Do not edit execution state
inside the product branch.

Completion requires real PostgreSQL/runtime-role/RLS and revocation/concurrency
evidence; direct API bypass tests, both cookies, linked learners and independent
Account regressions; teacher and learner browser journeys at 1440/1024/390/320;
and independent L3 review of the exact final SHA. Preserve the complete
storage/authorization/decision and negative-test requirements below. No game
navigation may grant playable access before those server checks are active.

The product author does not operate either existing Docker installation.
The controller may update the explicitly selected review582 test installation
at 127.0.0.1:4620 only after checking concurrent operation/identity, making a
verified backup, and verifying rollback/compatibility. Installation4610,
production databases, DNS, VPN, hosts and firewall are outside this work.
No release, owner acceptance or completed-game claim follows from foundation
tests alone. Ordinary merge occurs only after the required exact-SHA evidence
and independent review.

## Foundation proposal and original handoff record

The remaining proposal-stage wording records why the original foundation was
kept unregistered. The current continuation boundary above controls the work;
all substantive safety and verification requirements below remain binding.


Execution task, branch, status and evidence live only in
[`current.yaml`](../../execution/current.yaml). This contract selects no work by
itself. A selector proposal must be accepted on `main` before the product branch
inherits it; passing preflight for another Games task is insufficient.

## Result and scope

The eventual L3_CRITICAL result provides class policy, Seat overrides, server admission and
working teacher/learner controls for existing offline Chess and Checkers projects.
This governance proposal authorizes no end-to-end integration before the shared
boundary handoff below. Unique file ownership alone cannot deliver that result.
Games permission and SafeMode are independent. Do not change Elo, Match identity,
game rules, online authorization, navigation or Learning.

Allowed implementation seams:

- `apps/api/src/games-access*.ts`: bounded evaluator, admission controller and unit tests;
- `tests/games-admission/**`: new focused policy, API, SQL/RLS and adapter tests;
- `apps/web/src/pages/GamesPage.tsx`, `apps/web/src/games/open-game.ts`: consume current server admission;
- `apps/web/src/games/game-access-api.ts`: bounded typed admission/settings adapter using existing authenticated transport;
- additive `migrations/0222_classroom_games_policy.sql`: policy storage only, subject to the fresh number check below;
- this task document, outside the Games documentation wildcard.

The ownership schema supports exact paths and terminal `/**` only. Therefore
the `games-access*.ts` family is registered as four exact new paths:
`games-access.ts`, `games-access.controller.ts`, `games-access.spec.ts` and
`games-access.controller.spec.ts`; no parser exception or broader API ownership.

The inspected baseline contains migrations through 0217; prefix 0222 is unused.
Re-list migrations against freshly fetched main before implementation. The proposed
number is reserved only after checking actual files; never overwrite another
migration. Existing migrations are immutable. Keep new responsibilities in small
helpers; legacy controllers/pages remain orchestration. Broader paths, workflow
changes or additional seams require a bounded scope decision first.

## Storage and authorization

For each new class, educational offline Chess/Checkers default to allowed. Class mode is `allow | deny | rating_threshold`, default `allow`; numeric threshold
is nullable and must be finite and present in threshold mode. Seat override is
`inherit | allow | deny`, default `inherit`. Add versioning/audit and DB CHECKs.
Do not reinterpret `safe_mode*` or backfill a guessed rating/threshold.

Only active staff authorized for the exact class may read/change its policy or
Seat overrides. Enforce RLS and fixed SECURITY DEFINER search_path, least-privilege
function execution and cross-class denial. Protect concurrent edits with a version
check. Client class, Seat, principal and project IDs never confer authority.

Use current server-calculated participant `metrics.score` from the existing class
rating settings/period. Do not use class mean, Elo, client scores or a second
rating engine. Compare the unrounded score; equality permits admission and null
denies in threshold mode. Do not expose other students' scores, roster or identity
IDs through the learner admission response.

## One server decision

Resolve the authenticated active Seat and exact class from trusted server session
state. Suspended/revoked Seat, stale session and archived class fail closed.
Never select an Account silently as a fallback for a denied/invalid Seat request.
With both cookies, the selected server-verified learner context must remain Seat;
independent Account offline play keeps its existing Account context and ACL.
Linked Account access to a selected Seat context uses that same Seat policy.
If existing context selection cannot distinguish these paths safely inside the
declared seams, report a concrete L3 blocker before implementation or UI claims.

Evaluate activity and ACL first, then Seat `deny`, then Seat `allow`, then the
inherited class mode/threshold. Explicit Seat allow bypasses the class rule but
never activity, ACL, SafeMode or child safety. Stable reasons include `allowed`,
`class_disabled`, `seat_disabled`, `rating_below_threshold`, `rating_unavailable`;
invalid authentication uses the existing authentication mechanism.

Apply the same current evaluator to game list, create/idempotent replay, reopen,
edit, save and direct project links. Re-evaluate after policy/session revocation,
including a previously opened editor. Server-issued admission is a current decision, not a durable capability: never trust a stale client allow or a policy version as authorization. Preserve saves/history and ownership.
Existing assigned game work keeps its verified assignment ACL and lifecycle;
do not guess an assignment exception or silently broaden access. If the bounded
free-play policy cannot be separated from assigned work, report the exact blocker.

Account-only online routes retain their checks. Seat admission grants no public
matchmaking, chat, rated competition or multiplayer capability. Unsupported Seat
online paths stay unavailable with an honest reason.

## UI and regression evidence

Teacher controls persist class allow/deny/threshold and exact Seat
inherit/allow/deny, displaying the effective decision and reason. A settings-only
screen without server enforcement does not satisfy this contract.

Games shows playable cards only after admission. Deny/low/unavailable rating shows
a clear locked explanation, retry and a working return to learning/class route.
Retry refreshes current server admission; an allow response restores working play.
No unlocking based only on client state, guessed score or hidden buttons.

Required negative and positive tests cover default allow with both SafeMode
values; every class/override combination; below/equal/above threshold and null;
missing/revoked/suspended session and archived class; linked Account and both
cookies; independent Account regression; cross-class/Seat/project ID substitution;
deep links; repeated create/idempotency; reopen/edit/save after revocation;
concurrent policy writes; data minimization and existing assignment ACL.

Use one canonical targeted command set locally and in CI. The lane declares
`pnpm gate:governance`, `pnpm test tests/games-admission`, `pnpm test:games`
and browser `pnpm e2e:games`; general remains `pnpm gate:repository`.
These are requirements, not recorded PASS results. New focused tests do not yet
exist and all product/data/browser evidence is NOT_RUN. The browser command is
an existing executable regression entry point; admission-specific teacher/Seat
journeys must be added by the owning lane after handoff and run on isolated CI.
Existing Games browser coverage alone cannot prove admission enforcement.
Record actual tests and
TypeScript results; PostgreSQL/RLS and real Seat/Account browser evidence belong in
isolated CI. Validate affected UI at 1440/1024/390/320, including loading, error,
locked, retry and restored allow. No local Docker on 4620/4610, live database,
backup, restore or deployment is authorized here.

Require exact-final-SHA independent critical review of evaluator, session choice,
SQL/RLS, revocation and bypasses. Author self-review cannot replace it. Repository
gate failure forbids a release claim; classify unrelated baseline defects and do
not repair foreign modules. Missing runtime/SQL/browser evidence remains NOT_RUN.
Publish only the selected branch after checks; merge and owner acceptance remain
separate owner decisions. Complete the bounded slice, report and STOP.

## Full path coordination and entry guard

Only unique implementation paths are listed in this lane's `owned_paths`
in `current.yaml`; they grant no shared-file ownership or bypass of preflight.
The task doc itself is included there so scoped context exposes it without custom
`context_hints`. This document has no registry ID; do not invent `normative_refs`.

Before any product edits, verify this proposal is accepted on canonical main,
fetch main and the working branch, inspect divergence, exact-HEAD CI, dirty
worktrees and all intended paths, then run
`pnpm agent:preflight --scope student-game-admission --check`.
The scope selects context only. Also resolve the actual controller seams through
targeted preflight: `--path apps/api/src/projects.controller.ts` was unmapped,
and `classrooms.controller.ts` resolves to multiple identity/learning contexts.
Do not reinterpret scoped SAFE_TO_START as approval to ignore those results.
START_HERE requires a missing map alongside its implementation: until an exact
bounded map is reviewed and authorized, those product edits are blocked.
Report the mapping dependency to the controller; a separate reviewed scope may
add the precise map/contract paths. This two-file governance slice does not
authorize map or generic preflight tooling edits.

The following `coordinated_paths` are information in this selected document,
not entries in `owned_paths` and not self-authorized work:

| Existing lane | Coordinated paths and bounded seam after handoff |
| --- | --- |
| projects | `apps/api/src/projects.controller.ts` (admission orchestration preserving ACL); `apps/web/src/api.ts` (existing authenticated transport contract); `tests/portal/projects-api.spec.ts`, `tests/portal/project-integrity-contract.spec.ts` (direct project enforcement regression) |
| learning | `apps/api/src/classrooms.controller.ts` (exact class/Seat policy endpoints); `apps/api/src/app.module.ts` (necessary DI registration only); `apps/web/src/pages/ClassroomPage.tsx`, `apps/web/src/pages/ClassroomStudentPage.tsx` (teacher controls); `e2e/student-seat-access-hardening.spec.ts` (Seat revocation regression) |
| admin-auth | `tests/account/student-seat-protected-storage.pg.spec.ts`, proposed `tests/account/student-game-admission.pg.spec.ts` (existing identity/RLS contract; new policy tests instead belong under `tests/games-admission/`) |
| teacher-student-profile-ui | `e2e/classroom-student-profile.spec.ts` (teacher/Seat regression) |
| games | `docs/product/games-platform/**` (unchanged documentation boundary); `e2e/games-navigation.spec.ts` (admission browser journey through `pnpm e2e:games`) |

Other existing regression seams also require explicit handoff before edits:
`apps/api/src/classroom-seat-access.controller.spec.ts`,
`apps/api/src/classroom-seat-access.spec.ts`,
`apps/api/src/projects-save-status.spec.ts`,
`apps/web/src/games/open-game.spec.ts`, `e2e/classroom-management.spec.ts`.
Resolve each exact owning lane from fresh canonical state; no implied ownership.

Shared controller integration requires explicit owner-handoff and independent
L3 review by the existing lane. That lane must approve exact paths, bounded diff,
mapping/contract changes and enforcement evidence; this author cannot authorize
itself through this document or scope preflight. No product integration until
the boundary is resolved. Do not claim feature end-to-end readiness meanwhile.
Coordinate GamesPage and open-game with the separate UI candidate as well.
Preserve accepted main and foreign pending edits, including UI review findings.
No wholesale copying from the old worktree or UI branch. Inspect each overlap
before writing; an actual unresolved overlap requires STOP and a handoff.

`games-access.ts` is the evaluator/helper seam; `games-access.controller.ts`
and its spec are available for a server admission endpoint after authorized
integration. Existing controllers, after handoff, must delegate to this evaluator.
The new `game-access-api.ts` adapter reuses existing authenticated transport and
CSRF/error handling; it may not invent cookies, principal selection or a second
authorization channel. It consumes the same server decision as GamesPage/open-game.
DI registration and teacher pages remain shared, pending the owning lane's handoff.

Existing tests may change only after handoff for this policy's controller/UI/security assertions.
Add `tests/games-admission/student-game-admission.pg.spec.ts` for actual policy storage,
audit/version, role/RLS and cross-class negatives. Exercise direct project
list/create/open/save through existing project API specs and Seat browser specs;
mock evaluator tests alone cannot prove enforcement. No whole-directory test
ownership or unrelated spec cleanup is granted.

Use the existing server class participant rating, requiring a finite valid score
for the exact class/settings/period and threshold. Null, invalid, unavailable or
foreign-class rating denies threshold admission; comparison uses unrounded score.
Do not change rating computation, canonical authoring, module registry, module
controllers, assignments, tenant/session selection or auth middleware. If safe
enforcement needs another seam, name the exact path, reason and tests and request
a future reviewed bounded scope; do not expand to the repository.

Before SQL verification, identify the isolated target and actual runtime role;
check migration preflight, schema compatibility, RLS and function privileges.
An additive migration file and passing parser are not evidence of applying it.
No migration of the live database is asserted or authorized. Data/browser evidence
must identify the exact candidate SHA and isolated CI target. Missing evidence
stays NOT_RUN. Product acceptance requires independent L3 critical review.


## Remaining integration blocker

Exclusive lane ownership is preserved by keeping shared paths out of the new
lane and recording the dependencies above. All existing lanes remain unchanged.
Passing governance only validates this scope registration. It neither resolves
the unmapped projects controller nor classroom context ambiguity, and does not
authorize shared integration. Obtain the explicit owner-handoff, bounded mapping
resolution and independent L3 review from the existing lane before integration.
Never bypass authentication, ACL, RLS, SQL privileges or the parser to proceed.
