# Supplemental native CI transport

Manual source-only transport for the complete original mobile-properties and
block-pin-setup files. It adds no product/test assertions, case/time budgets,
workers, retries, default R4 paths or acceptance waiver. The actual nonempty case
set is discovered, then executed identically; the count is not assumed.

The workflow must first be independently reviewed and registered on canonical main.
It checks out its controller at `github.workflow_sha`, and accepts only a full
candidate SHA already ancestral to that trusted main workflow revision. Repository,
event/job/ref, both clean Git identities and fixed executable bytes are validated
before candidate execution. Candidate source is checked out separately and never
receives copied helpers. Its critical transport files must match the approved
controller compatibility closure; an incompatible release fails closed.

The unchanged public image validator is imported normally on the controller side.
Its original receipt-chain, immutable Node/Caddy/PostgreSQL identity/architecture,
layer and pulled-content checks are reused; no old workflow pair is spoofed and
no module globals are reassigned. The separate typed Compose check permits only
the original image-only PostgreSQL transport change. All Docker operations are
restricted to disposable GitHub-hosted Linux amd64, one unique loopback project.

Expected schema and exact candidate revision are exported before the existing
report permissions step. Only the fresh `reports/electronics-supplemental-native`
directory receives mode0777; fresh source/image receipts receive descriptor0644
on Linux, readable by the distinct container UID even with a private host umask.
The two native files use `testInfo.outputPath`/attachments
inside the runner's explicit `--output` directory. No legacy `e2e/artifacts` files
or tracked report files need permission changes. Every tracked candidate diff,
including an executable-bit-only change, is rejected before Docker proof.
Both rendered models include the same registry overlay; the transported model
adds only the validated PostgreSQL override. Its image is normalized solely to
the original validated receipt reference before exact whole-model comparison.
The fixed runner is mounted read-only into the candidate
test image. Strict API readiness binds actual/expected schema, synchronized=true
and candidate SHA; actual Web build metadata must match too. Workflow SHA is
recorded separately. The executable pins are trusted at the independently reviewed
controller commit; they do not claim protection against an owner rewriting the validator.
The two original files,
Playwright config and candidate tree remain unchanged. Discovery/execution,
readiness, full traces, PNGs, journals, logs, image proofs and manifests are retained
under the isolated report scope. Raw child output is captured privately.

This is a public repository: only an authenticated encrypted evidence envelope is
uploaded, never plaintext reports/traces. It uses the existing owner public RSA
recipient in `tools/web-symbols-public.pem`, RSA-OAEP-SHA256 and AES256-GCM, with a
distinct typed archive format and authenticated candidate/workflow identities.
There is no private key in CI. Limits: 2000 files,128MiB/file,256MiB total files,
384MiB plaintext JSON/decompression,320MiB ciphertext. Oversized evidence fails
closed and is never uploaded in plaintext. Paths, links, hashes/base64, wrong recipient,
corruption and relabelled provenance fail closed. Owner private-key availability
and successful private decryption are separate evidence; encrypted availability
does not imply the evidence was decoded or independently accepted.

After registration/review, the controller may select:

```text
gh workflow run electronics-supplemental-native.yml --repo spikeal8-maker/asa-lab --ref main -f candidate_revision=<full-reviewed-main-candidate-SHA>
```

For the selected final product, supply `2a28cffe7a20302f9b7231ef823bdc05f3fe43d0`.
This document authorizes no dispatch. Report workflow SHA, checked-out/runtime
candidate SHA, discovered/executed counts and conclusion separately. Full R4,
production blocker836, school updates/100-user acceptance and owner cadence WAIT
remain independent requirements. Qualification in this source slice: NOT_RUN.

The first dispatch41586603773 (candidate2a28cffe, controller2f1c1423) failed at the
model-proof step before build or native discovery. Its generic failure and
encrypted-only artifact remain historical failure evidence; no cases passed.
Source diagnosis found that the old recursive0777 grant changed executable bits
on committed PNG/JSON evidence, which the next source check correctly rejects.
The focused POSIX real-Git regression demonstrates that old prefix failing and
the new report-directory-only prefix remaining clean; byte edits and wrong file
modes are still rejected. Public failure diagnostics now expose only a closed
phase/code, never exception text, Docker output, paths or response payloads.
This source repair is not a successful rerun or decoded evidence claim.

Offline focused checks (no Docker/network):

```text
python -B tools/test_electronics_supplemental_ci.py
node --test tools/test-electronics-supplemental-native.mjs
```
