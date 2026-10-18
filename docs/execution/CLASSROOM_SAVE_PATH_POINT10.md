# Point10: remove redundant full reopen after acknowledged draft save

Owner selected next point after9: implement, publish main, report and STOP.
Issue615, parent611/477. No deployment, working DB/load, pool/timeout tuning,
schema/SQL/rights/CAS/engine or next-point changes. Layout impact none.

## Bounded acceptance

Generic draft save currently invokes the writer then reopens the full project
just to obtain moduleKey for analysis. Repository load also reads Version list.
Reuse server-owned module metadata from the writer's existing authorized load;
retain one implementation of validation/guard/CAS/write/conflict handling.
Existing execute() callers still receive the exact ProjectDraft result. Generic
HTTP response still has the same draft/result fields and analyses the acknowledged
document. Client module hints/cache never become authority. Preserve initial
read and conflict fallback, negative access and storage-failure semantics.

Prove one initial load/no post-save full reopen in focused regressions. Run the
existing isolated backend30 baseline with a real OpenProjectUseCase call-count
oracle, retaining all60 saves/62 document reads/120 identity checks/15media reads,
mutation retry/conflict and foreign-read rejection. No live load. Latency/pool
observations do not prove all wait causes or full3000/5000 capacity. Initial
save load still includes history; removing that work is a separate decision.

Use focused units and uncached API build; independent HIGH final-source review
and exact-source isolated CI required. General gate/release/owner acceptance
remain separate. NEXT_ALLOWED_TASK: STOP after point10 report.

## Implementation and self-review

POST_STEP_REVIEW: L3_CRITICAL; layout impact none; viewport/visual evidence n/a.
One writer now returns optional server-owned module metadata to the generic
controller. Existing execute() unwraps the same acknowledged ProjectDraft;
HTTP draft/result remain unchanged. No client module authority or cached read.
Initial authorized load, storage guard, CAS, idempotency and conflict fallback
remain in the same implementation; no repository, SQL or permission changes.

Local uncached API build (16 tasks), focused114 tests, scoped ESLint and control
plane validation PASS. Tests cover one initial load, no fallible post-save open,
exact acknowledged document analysis, both legacy/metadata return contracts,
inaccessible project, existing409/400/404/503 responses and Account/Seat storage
failure with same-mutation retry. Conflict fallback still reads current state.
Self-review PASS for selected scope. Final convergence, independent HIGH review
and exact-source isolated backend30 evidence pending; report in issue615.
No deployment, browser/VM/ingress or3000/5000 capacity acceptance implied.
