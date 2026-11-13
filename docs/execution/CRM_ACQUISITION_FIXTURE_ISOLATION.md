# CRM acquisition fixture isolation

Task `TASK-CRM-ACQUISITION-FIXTURE-ISOLATION-001`, [Issue #1110](https://github.com/spikeal8-maker/asa-lab/issues/1110).
Execution state and activation authority live only in [current.yaml](current.yaml),
lane `crm-acquisition-ci-baseline`. Its controller registration must be accepted
on main before the one-file source repair begins.

## Evidence boundary

On 12 November 2026, accepted main `cb15c700253f26bf276ad69d5e45ca27c2306787`
failed [General 43313764162 / Data 131521411013](https://github.com/spikeal8-maker/asa-lab/actions/runs/43313764162/job/131521411013).
The CRM lineage/CSV case at `tests/admin/crm-acquisition.pg.spec.ts:154` took
5007 ms against its 5000 ms deadline. The file had 4 PASS / 1 FAIL; standalone
RLS was not reached. Independent diagnosis found its test/config/helper blobs
unchanged from green source `4dc1de45b13cb8f7e1d78cabccb080bf84710bda`, whose
same case took 943 ms. No query-phase, JIT, lock or infrastructure cause was measured.

The source does establish a fixture dependency: an unfiltered platform catalog
query reads the shared population although this assertion needs only the target
Account. [Historical #808](https://github.com/spikeal8-maker/asa-lab/issues/808)
reports the same case; its root cause remains unknown. [Programme #1090](https://github.com/spikeal8-maker/asa-lab/issues/1090)
is related context, with its student-progress selection preserved.

## Bounded repair and acceptance

Change only `tests/admin/crm-acquisition.pg.spec.ts` after canonical registration:
resolve the target row before the platform query, strictly guard its nonempty
unique fixture email, call
`catalog(owner.principal_id, 'platform', null, {}, row.email)`, and assert the
exact returned Account identity. Retain the private-account observation assertion.

Preserve all five cases and the 5000 ms deadline; organization/class positive and
negative lineage checks; private-account visibility; scalar CSV and registration
source facts; teacher, wrong-class and archived-class 403 checks. No weakening,
skip, retry, SQL/migration, production, configuration, workflow or dependency edit.

Registration needs metadata preflight, preservation, full governance, independent
review and required CI. The later source repair needs independent exact-source
review and fresh natural General/ASA required: all five CRM cases, full Data and
actually executed standalone RLS. Historical or narrow PASS cannot substitute for
these results. A new failure requires classification, not automatic scope growth.
No deployment, live database, local runtime, container or port action is authorized.

Registration acceptance leaves the repair issue active. Technical completion can
be recorded only with the separately integrated repair and its actual evidence;
owner acceptance and the student-progress programme remain separate.
