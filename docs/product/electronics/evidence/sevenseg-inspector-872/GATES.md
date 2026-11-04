# Live seven-segment inspector delivery proof

Candidate: db232e8c436dc44d6029b8f1c45bea13cf8373e4.
Fresh independent source/native verdict: APPROVE, no actionable findings.

The existing readout leaf now subscribes directly to the stable committed
ComponentResult. The production parent supplies the selected id and native port
only while simulation is running. Pause retains committed values; Stop preserves
the existing fallback. No controller, store, physics, protocol, clock, ACK or
other inspector change; no per-frame parent/editor rerender.

Independent full native16/16 PASS:1440/390, common anode/cathode and four physical
masks including digit2 and DP. Actual production Worker results, Stage and the
whole parent inspector agree on mask, finite currents and brightness. Selection,
pause, real Stop/restart and retired response rejection pass. Proposal and render
isolation checks are explicitly synthetic and separate from physical evidence.
All16 cases report quality.passed=true and no page errors. Critical desktop and
mobile digit2/all+DP images were visually reviewed.

Canonical `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1`: PASS exit0.
Core1420/62files + Web1145/67files =2565 tests. All71 Nx tasks executed afresh:
SDK1 + types/dependencies43 + builds27; all three invocations cache skipped.
All8 fixed bundle caps PASS: Editor187859/222000, Arduino1999925/2000000,
initial graph555957/600000. Logs and independent raw/image archive are retained
in controller/. Independent manifest SHA256:
44d9333a29e168be9cd5b3cf25fcd04a42f46bfd47963373c2bdb4a62612223b.
Independent receipt SHA256:
625863fa7e1dafcf3e4a6945e6fc3b8b11ce90a53d9d3a409b398bee72e44428.

The original canonical trace JPEG is preserved, plus reproducible immutable6edb
BEFORE and actual Worker request/response provenance. Initial capture preceded
the edit; test-only BEFORE publication followed local edits and explicitly used
the immutable baseline. The harness-only restart timeout from mixing synthetic
port mutation with live lifecycle was preserved and corrected by isolation/order,
without a product runtime change. Final independent16 cases used the corrected
frozen harness. Root imported all8 candidate paths with matching Git blob ids.

Original MATH-6E oracle is unchanged. This isolated production-component proof is
not installed Save or owner acceptance. General41050784162 Governance/Code were
successful; Data/Access remained pending at preparation, so no whole General or
repository PASS is inferred. No server, Docker, live DB, dependency, protected
asset, refactor or foreign change. Arduino cleanup remains deferred.

Controller follow-up: General41050784162 subsequently completed SUCCESS in all
four jobs on exactdb232. Source integrated in main0e96139d2, with only unrelated
AI metadata convergence and identical reviewed product bytes. No source changed
after independent verification; installed/owner/release acceptance stays separate.
