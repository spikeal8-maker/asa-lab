# Arduino 682 epoch permit clarification, 2026-10-24

This clarifies the selected private feasibility contract; every safety constraint of main8def33071c3d2e95cf9377ee4b26a8ba146c651c remains in force. No product acceptance or runtime cause is established.

Private unpublished snapshot e6d44e26973bbe870263f6217fbab997b321b54a reports112PASS1FAIL. The original acknowledged-cursor assertion requires four host reads; the prototype performs five. Original87 and private12 assertions remain byte-exact. Do not weaken the count, mask callbacks or special-case held ACK/H==C. Request593 attribution remains unproven; actual timing is3of8PASS and5FAIL.

Independent conflict review: OS Temp/arduino-682-ci/93531edc/independent-epoch-conflict-review.json, SHA256 b4b47c9a5dd13c39fca4b7e11db8260460e92b44908e0d246ae47e8b7c22ec3b. epoch-feasibility-author.json records the private failure. Old receipts/history are immutable.

## Clarified opportunity and ownership

Each admitted external epoch has one opportunity to obtain a fresh host sample AFTER an eligible ordinary positive completion. An already executed VALID NORMAL RETAINED refresh after that completion in the same captured epoch satisfies/consumes this opportunity. Existing normal read, validation, normalization, horizon and dispatch remain unchanged. This is not one TOTAL callback per epoch. Only if no valid sample has satisfied the epoch may ordinary exhaustion perform its selected one extra read.

Bind completion eligibility before public callbacks. Before a normal read capture generation, canonical document, selected target and epoch; after callback return only matching original fences and a valid sample may satisfy that OLD epoch. Reentrant newer update, Stop, Reset or input cannot have its newer permit/target/request-local bypass consumed or deleted by the older read/completion.

Initial update sampling, startup, first-positive release, input-only, yielded/continuation and internally refreshed completion do not spend ordinary post-completion opportunity or mint epochs. Invalid/null/discarded normal samples do not satisfy a valid-sample opportunity. Preserve original validation/normalization: a fractional sample is not newly declared invalid if baseline normalizes it. Exhaustion read still consumes BEFORE callback, including null/invalid/H<=C, without retry, spin or self-renewal. Refreshed completion never self-chains. Input priority, one inflight, finite25000us slicing, ACK<=delivered committed, H=min(elapsed,ACK+50000), startup timing and all8def fences remain exact.

## Required nine control categories before private repair approval

1. Original87/private12 assertions byte-exact; original acknowledged-cursor four reads and horizons unchanged. Preserve all14 new controls without relaxation.
2. Multi25000-slice retained demand: valid normal post-ordinary refresh consumes opportunity; final exhaustion adds zero callback, all normal reads/dispatches unchanged.
3. Host moving on every normal read/completion: consume once without suppressing retained refresh, finite admitted slices then idle; later explicit external update re-arms once.
4. Initial pre-completion sample does not consume; desired3000 and capped27000 cases remain unchanged and meaningful.
5. Reentrant onCommitted/onResult/normal-read newer update and external update before old inflight completion: captured old epoch cannot consume newer permit, target or local bypass.
6. Stop/Reset/structural project/document invalidation/input-bearing update during normal read or completion: no stale dispatch/newer-state deletion; one inflight and button/Serial order exact.
7. Invalid/null/NaN/fractional/negative normal samples preserve baseline validation/normalization and cannot falsely satisfy valid opportunity; eventual exhaustion read remains once-only without spin.
8. Valid unchanged H==C normal sample satisfies opportunity without held-ACK/value special case; normal and ACK-limited callbacks have identical accounting and independent ceilings.
9. Startup/first-positive/yielded/continuation/input-only/internal refreshed completion do not spend ordinary opportunity or mint epoch; refreshed completion does not chain.

## Delivery boundary

Only apps/web/src/electronics/live-simulation-worker-controller.ts and testing/live-simulation-worker-controller.spec.ts may change in the next PRIVATE repair. Freeze all-green source/self-review and obtain NEW exact source review before measurement-branch composition and ONE existing CI. No product main/acceptance, cap raise, numerical/physics/clock/hook/Worker/tolerance/timeout/cadence/asset/workflow edits or blind variants.

Docs freeze/light checks, NEW independent docs review, ordinary main publication, then automatic existing General Governance on exact published HEAD must PASS BEFORE source repair. That CI is pending until actual observation. Do not run a duplicate full local governance or manually dispatch another governance workflow.

Preserve foreign #549/Classroom/AI state, owner pending, all historical546/R27 records/blockers and protected data. No local browser/Docker/heavy build/DB/deploy/install.
