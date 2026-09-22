# Owner administrator provisioning — evidence 2026-09-22

Task: `TASK-OWNER-ADMIN-PROVISIONING-001`, [Issue 383](https://github.com/spikeal8-maker/asa-lab/issues/383).
Reviewed source: `94d3ef933624b743bd9a91cf7b709c3448cacef0`.

## Operator result

The owner confirmed the exact email of an existing active account. One
`platform_admin` grant was applied to that account, the highest platform
administration capability implemented by ASA Lab. This does not introduce a
new role tier or revoke another administrator. Personal account identifiers
and the private before/after receipts stay on the operator machine.

The Docker wrapper returned `GRANTED`, then `VERIFIED`. Independent checks
under the runtime database role confirmed owner readiness and access to the
permitted administrative audit read function. A repeated grant returned
`changed: false`; the complete grant record, timestamp and audit record were
unchanged. Exactly one grant audit event exists for this operation. Account
UUID, email, active status, principal and active personal workspace count
matched the saved preview. The existing database still contained two accounts
and five projects at verification.

Running application revision remained
`f56a71edb41548932d47154d68fcde87b64402da`, schema 159, readiness healthy.
No application image replacement, restart, schema migration, account creation,
password change, database merge or project transfer was performed.

## Reusable mechanism

[OWNER_ADMIN.md](OWNER_ADMIN.md) documents the Windows/Linux operator procedure.
The default Docker-wrapper command only previews. A grant requires exact email,
previewed UUID and a reason, verifies the database and canonical installation,
and uses the shared maintenance lock. Private connection data travels through
stdin to the existing API container. Host Node.js and new database ports are
not needed.

The CLI checks an active unambiguous personal context and verifies both runtime
authority predicates before committing the grant and audit together. A repeat
is a no-op; regranting a revoked capability records the previous state and a new
date. A lost response is resolved by preview/verification before another grant.
The identity surface map now routes agents to this operator path and its tests.

## Review and validation

POST_STEP_REVIEW

- Change class: L3_CRITICAL, operator permission mutation.
- Invariants: IDA-ACC-001, IDA-AUTH-001, IDA-SCOPE-001.
- Layout impact: none; viewports/visual evidence: not applicable.
- Local: nine input/CLI tests, focused lint, formatting, Python compilation,
  secret scan, control-plane/test-catalog/agent-map validation passed.
- CHALLENGE_REVIEW: independent read-only review passed after correcting a test
  to use a permitted runtime entry point. Database permissions were not expanded.
- [Exact-source CI 35674222831](https://github.com/spikeal8-maker/asa-lab/actions/runs/35674222831): all four jobs passed (governance, code/build, PostgreSQL/RLS, Access A browser journeys).
- Focused suites in that CI: 9 CLI/input tests and 11 PostgreSQL transaction tests
  passed. Full data suite: 309 files / 2649 tests passed, followed by 16 explicit
  RLS tests. Negative cases include wrong UUID/database, inactive identity/context,
  unknown account and ambiguous workspace; rollback and concurrent/repeated grants
  were exercised against isolated PostgreSQL.
- Verdict: PASS. The later closure commit changes documentation/state only;
  executable-code evidence is pinned to the reviewed source SHA above.
- Limit: browser login with the real owner's credentials was not exercised;
  no session or password was fabricated. Runtime administrative authorization
  was independently verified using the existing principal.
