# Mixed-circuit Servo observation — baseline and bounded repair

Issue 862. Before production edits, `oracle.mjs.txt` compiles the actual engine,
presenter and **batched** Worker evaluator. It retains all five legacy fixtures
and 25 full advances from 861: 144,673 raw bytes, unchanged SHA256
`b98bfe1f9115686632fb5c4d4cebc6d3528750a67eb4fe4034f745a816b2d36c`.
One legacy fixture contains a Servo sketch on an Uno without a physical Servo;
that case proves runtime compatibility, not physical Servo observation.

The additional direct-DC fixture has an actual Servo, Uno, independent D3 signal,
5V/common ground and a deterministic 45/135-degree program. Removed component
wires are also removed. Its five full advances include real observed 45/135
poses and confirm `dc-inputs-v1`.

The mixed fixture reuses the complete saved failure from 861, including actual
Worker requests and old continuations. Batched evaluation matches every captured
full advance byte for byte. Five full mixed advances cover H0/1000/26000/51000/
100000 microseconds; decoded state is valid but projected angle is absent.
The full data and raw-byte receipt are retained as `before.json.gz` and
`before-receipt.json`. No equations, scheduler, decoder, UI or kernel source was
changed to record this baseline.

Execution state, later acceptance and selected work remain in `current.yaml`.
This baseline is not a repaired-model or installed/server acceptance claim.
