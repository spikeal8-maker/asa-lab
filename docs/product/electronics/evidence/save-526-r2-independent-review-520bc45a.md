# Independent exact-SHA review — Electronics526 R2

VERDICT: **REQUEST_CHANGES**

Reviewed published HEAD `520bc45afaad32b89d142fbcf313561c1170d72d`, tree `ec3e6483cbaa73c4bf3ff7a217e0889dbb86d855`, parents `c15e6e13dab91f72619c28ba0adc552a96fa2d77` and canonical main `c920c5c0921498d8872d3914b7f627ca98db85b2`. New independent reviewer, neither author nor earlier526/529 reviewer. No product/repository edits, stack or database operations, reruns, downloads, acceptance, integration or closure were performed. Only an independent temporary evidence reader and this report were written outside the repository.

## Entry and source verification

Actual GitHub main c920 and published task branch520 verified independently. Preflight: SAFE_TO_START; selected TASK-ELECTRONICS-SAVE-RECOVERY-001, in_progress, R2 checkpoint; dirty0, blockers0, overlaps0, CONTROL_PLANE PASS. Main0/task4 divergence. Full candidate16-path diff2022+/234− and all production persistence paths were reviewed, together with meaningful mounted/shared/browser consumers, canonical task/router/review/UI contracts and original BEFORE evidence. Current.yaml, workflows, dependencies, solver/Arduino runtime and protected artwork have no diff against canonical main. Canonical529 changes/receipts remain inherited.

Source challenge found no independently established product defect in this candidate. Verified user/project/identity-kind scoped schema3 records reject wrong identity and do not adopt/delete historical unscoped schema1/2 bytes; Chess/Checkers default schema2 callers remain compatible. Per-edit local write/readback success is separate from server confirmation and matches the exact latest document. A failed write retains in-memory work and an older valid local copy, offers whole-document JSON and retracts a durability claim. Serial save queue uses CAS and confirmed revisions; late/superseded callbacks cannot clear a newer live document or mutate a new scope. Transient retries back off5/10/20/40/60 seconds, then at most once per minute; auth/permanent/conflict failures stop automatic sending and edits do not erase the unresolved failure. Manual/safety/cadence and existing local runtime boundaries are preserved.

R2 scoped CSS uses one emergency-copy class and a4-line width/flex override. The accepted529 five mounted behavioral cases adapt only to verified user/scoped storage. Its browser immediate fill/action/<260ms/full-document/reopen checks and raw physical exports remain strict. Browser coverage actual LF SHA256 `54f0d1cfec0268e8d57a528936946a842ada1ec090d0dbaa90d725bb22c04c0f` matches; all other generated fields equal main.

## Required changes

### P1 — SAV02/08 renderer crash has not been demonstrated

Source `e2e/electronics-simulation.spec.ts:4426` waits for a crash event;4429 injects `chrome://crash`. Actual original trace call3984 starts255250.242ms and rejects with `net::ERR_ABORTED` at255266.234ms, about16ms later. No crash event arrives; the unchanged120000ms test budget expires. Both the job log and original trace independently confirm this. No `after-renderer-crash.json` is present. The scenario therefore cannot establish abrupt termination, absence of a safety submission, exact recovery and subsequent server confirmation.

The browser/injection cause is unresolved; this failure is not proof that the product lost work. A bounded repair must investigate this injection in the pinned actual CI browser and obtain an actually observed renderer termination and all existing full-document assertions. Do not increase timeout, skip/weaken the crash expectation, replace it with graceful reload/pagehide, or call a navigation error crash evidence. Do not modify product persistence without a separately proved defect.

### P1 — SAV10 fixture changes a hash while the first canonical project path remains authoritative

Source `e2e/electronics-simulation.spec.ts:4750` only sets `window.location.hash=/home/<secondProject>`, then4753 calls ui(...70...). Original post-action frame snapshots retain `/projects/<firstProject>/electronics/edit?returnTo=%23%2Fhome#/home/<secondProject>`; error context still names **E01 SAV10 A first** and shows222.2. The strict5000ms expectation for70 fails. Actual `creatorViewFromLocation` in navigation.ts418–436 gives the canonical Electronics pathname precedence over the hash; App.tsx226–241 normalizes a resolved Electronics editor into that pathname. This proves the fixture did not switch projects. It does not prove cross-project document leakage. The actor-B part is not reached and no complete `after-project-account-isolation.json` exists.

Bounded repair should use the actual supported same-renderer navigation boundary, preserving the held old response, and independently establish the new canonical project identity before testing its unchanged document. Preserve real account logout/login, actor-A draft retention, held reply delivery, actor-B isolation, denied old-project access and complete raw evidence. Do not reload away the held response, weaken expected70 or extend5000ms. No Portal or persistence product change is justified by this fixture failure.

## Exact CI and original artifact verification

General [37859012428](https://github.com/spikeal8-maker/asa-lab/actions/runs/37859012428): terminal SUCCESS, all4 jobs on520. Independently read original ZIP369075 bytes, SHA256 `6c823e93f76dba3ad95f75fe050ae29f2efc9fec474e47b97d2b71f24459c66b`, CRC61 members PASS:3192 Vitest,16 RLS,652 synthetic,10 Access,284 layout. Code96/Data43/Access27 =166 fresh Nx tasks,0 cache hits; literal NX_SKIP_NX_CACHE=true and frozen install verified.

Ordinary Electronics [37859024247](https://github.com/spikeal8-maker/asa-lab/actions/runs/37859024247): terminal FAILURE on520. Focused113590068121 SUCCESS, benchmark113590998552 SUCCESS, browser113590998565 FAILURE, review-images113595714331 SKIPPED. Focused original log101854 bytes SHA256 `78158fcc423983fdbb67e44e72384e38743be23ec5f6b9f7efb22b7443ca4b9b` proves633 engine+399 editor PASS; module1/types42/build27 =70 fresh tasks,0 hits. Browser original log267277 bytes SHA256 `6993dd976bfb9793afbefa8c77d37644edee056d8643ce3329ff9827b2abaf74` proves125 PASS/2 FAIL. Original browser ZIP42839587 bytes SHA256 `10eb920521beb6d772e4b703883134dcbec597df516a1598a08c0648db9fc9ab`, CRC149 members PASS, both targeted trace ZIPs independently read. Original artifacts were reused from root's single cache, not downloaded again.

Local83 directed PASS and type/build outputs were read as local history. One full local focused FAIL at the unchanged697-asset hash test6076ms/5000ms remains a recorded FAIL, not rewritten as PASS or assigned a proven host cause. The new remote exact focused gate passed this unchanged source.

## Actual positive evidence preserved

Independent JSON comparisons and direct viewing of all4 original denial PNGs confirm:

| Boundary | Exact520 outcome |
|---|---|
| SAV01/03 | Quiet recovery4911ms after transport restoration,2 requests/1 HTTP200 reply; full last PUT equals server schema4/document/sketch, revision3; second profile exact server document/revision preserved. No new edit/event/reload/fake clock in this recovery case. |
| SAV02/08 | Mandatory real crash/recovery unverified: failed injection and missing final receipt. |
| SAV04 | Same-actor real reauthentication; retained attributed work/schema/sketch188.8, confirmed revision3. |
| SAV05/09 | Existing delayed-reply/real departure case now PASS:3 serial requests; final full document equals final PUT,333.3/latest sketch, revision5. |
| SAV06 | Conflict remains explicit after another edit; local666.6 and server555.5, revision3. |
| SAV07 | Older50/original-sketch local bytes retained; latest166.7/changed-sketch whole emergency JSON equals the pre-attempt copy; memory-only/error wording truthful. |
| SAV10 | Incomplete: fixture stayed on first project; actual project/account switch/late reply proof missing. |
| SAV11 | Existing Stop/Run semantics source unchanged and registered browser cases pass. New E04 power-supply setpoint persistence remains a separately selected future repair. |
| SAV12 | Existing minute-browser case and sustained mounted cadence/backoff cases pass; no school cohort frequency/load claim. |
| Accepted529 compatibility | New combined-version raw Save79.1ms and genuine departure84.9ms, each<260ms; input/action local documents, expected document, single PUT and server document deeply equal; exact reopen assertions PASS. |
| Scoped UI | Whole JSON caption fits at1440/1024/390/320, no own-action obstruction/indicator overlap/page overflow, no adjacent-button overlap. Original images independently inspected. Existing1024 toolbar Run extends right as also present in c15; this is not a claim of complete editor visual acceptance. |

Original causal BEFORE tracked JSON hashes independently match `eb2e44af4a18f91270c26791ae106a356e632325db5e3fbbc9269592f29c04e5` and `8bcc0ac77000845082d4519ec4998f76fecc357a7b989ae0df50cdef16f0e4bc`; no BEFORE measurements were repeated. Old c15 three failures were read only as preserved historical evidence, not acceptance of520.

## Limits and disposition

No526 acceptance/closeout is permitted: required full browser gate is red, mandatory SAV02/08 and SAV10 complete evidence is missing, review-image job is SKIPPED. Preserve published520 and all positive evidence; repair these two independently classified existing test/evidence boundaries in a separate bounded cycle, then obtain new exact gates and a NEW independent reviewer for the new final SHA.

No claim of historical lost-work recovery, whole-class stability, school incident frequency, full E01/E04/E14 joint acceptance or deployment. Shared same-user/project storage remains one draft slot rather than independent per-tab archival. Client session GET then PUT is not an atomic server-side actor binding. True shutdown server sending is best effort; memory-only work cannot promise crash recovery. Separate180ms Blocks generation delivery, school K0 version/full backups, real-device T3 and owner/class acceptance remain pending.

NEXT_ALLOWED_TASK: **STOP** for this reviewer. The programme controller manages any separate bounded repair; this verdict selects no next task.
