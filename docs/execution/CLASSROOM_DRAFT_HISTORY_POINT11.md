# Classroom point11: omit unused version history while saving

Issue617, following point10/615. Owner selected point11 only: implement, publish
main, report and STOP. No deployment, live DB/load, FRP, backups or point12.

## Bounded acceptance

The draft writer's initial load and conflict-classification load do not consume
versions, but PgProjectRepository.load queries the entire version list. Add an
explicit internal includeVersions:false option. Default load/open keeps the
existing complete version history. Only SaveDraftUseCase opts out; retain its
initial authorized Project/Draft read and conflict fallback.

Keep identical project-context resolution, tenant/RLS/read predicate, draft
existence check, write authorization, document/storage validation, CAS, mutation
retries and error shapes. No schema, migrations, grants, pool/timeouts, engine,
HTTP or public draft response changes. Do not replace read policy with edit
policy or trust client metadata. Stored history is neither changed nor deleted.

Repository regressions must observe the real implementation's SQL selection:
no history SELECT when omitted, complete history by default, identical project
and draft, denial/missing draft with no history read. Writer regressions must
prove omission on initial and conflict loads; point10 no-extra-open guarantee
and existing Account/Seat storage-failure retry tests remain.

Run focused units/uncached API build, independent HIGH final-source review, then
exact-source isolated backend30 CI. Observe real repository calls for all64
draft attempts and2 conflict fallbacks, retaining60ACK saves/62 document reads/
120identity checks/15media roundtrips/retry/conflict/denial correctness and94
explicit opens with no extras. No live load or performance/3000–5000 claim.

Layout impact none. Initial read still fetches current draft JSON; this point
only removes unused history. General gate/release/owner acceptance are separate.
Canonical focused command: pnpm test:draft-save; workflow Classroom Capacity
Baseline. Evidence/report in issue617. NEXT_ALLOWED_TASK: STOP after report.
