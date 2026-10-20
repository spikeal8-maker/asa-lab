---
task_id: TASK-ELECTRONICS-GOVERNANCE-011
kind: maintenance
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Controller selection accepted on main before workflow authoring
  - Exact source artifact exceeds the connected download transport limit
acceptance_boundary: slice
review: independent
---

# Read-only cloud intake of existing D2 evidence

Issue659, parent649, programme452. Owner-authorised cloud transport only:
the existing 630584469-byte ZIP exceeds the connector's 536870912-byte limit.
This repairs no simulator, D2 infrastructure or product gate.

## Exact input

Hard-bind repository `spikeal8-maker/asa-lab`, run `39422409394`, artifact
`12266831251`, source `24c4acf6c369ba695bf74684ec1bd7f26a70266b`, size
`630584469`, ZIP SHA256
`813ae15b73de655f5854e688f1a6367a2f7289f31bf0425095958c9cc3f8d90d`.
Validate metadata and actual size/digest; mismatch or expiry fails closed.

## One author, one temporary workflow

After main accepts selection, `/root/d2_source_review` authors only
`.github/workflows/electronics-artifact-intake.yml` on
`codex/electronics-evidence-intake-649`. `/root/pr651_intake` independently
reviews security; `/root` alone integrates and maintains this card/own lane.
The workflow remains globally shared; root assigns its only writer explicitly.
Do not author the workflow in the selection commit.

Trigger only automatic `pull_request` changes to its exact own path, with
same-repository and exact task-branch guards; no `workflow_dispatch` or
`pull_request_target`. The workflow never enters main/production. Permissions
are only `actions: read` and `contents: read`; job timeout is 10 minutes.

No checkout, execution/import of artifact content, app stack, ports, database,
owner assets or secrets. Fetch the API redirect without following it; fetch the
resulting allowlisted HTTPS blob URL separately without Authorization. Never
forward/log the token or signed URL. Pin external actions to reviewed immutable
revisions. Treat every downloaded member as untrusted data.

Allowlist only exact D2 ledger/raw JSON, its error-context and native PNG members.
Reject unsafe paths, duplicates and links; cap selected members at 64, each at
128 MiB and total decompressed bytes at 512 MiB; verify CRC. No recursive archives.
Upload a compact package below 256 MiB with input hashes, selected
member names/sizes/CRCs and clear original-source provenance; fail if caps exceed.

## Verification and stop

Validate workflow syntax, fixed bindings, token isolation, redirect/path/size/CRC
negative cases, task routing and control plane. Obtain independent security
review before the read-only job runs. Existing programme gates, source, profiles,
qualifiers, skips/retries and all other lanes/blockers remain unchanged.

Never merge the workflow into main. Accept only verified transport output and
close only this task. Historical frames are not AFTER or a new live test.
Do not accept D2/FET/PR651 or repeat unrelated product gates. Author/reviewer STOP;
controller continues the programme.
