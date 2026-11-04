# Independent exact-source review

Original `3ebf0e16249e9a5c8c17e504e8179bfb6ba7b76d`: REQUEST_CHANGES after
canonical found the obsolete clock JSX assertion. That reviewer verified the
17 source blobs and both byte oracles, found no other source issue, and stopped
before independent test/native execution. The original failure remains intact.

A new independent reviewer checked repaired frozen
`fad679d57e803a38ac3a57e4abb9a6d0c926e137`: **APPROVE**.

- All 18 manifest Git blobs, byte sizes and hashes verified. The test-only
  repair preserves exact optical-port authority; prior 17 blobs are unchanged.
- Both complete default-rate oracles are byte identical.
- Independent focused verification: **382/382 tests PASS**, seven files.
- Fresh native final-production verification: **4/4 journeys PASS**, display/LED
  and separate Servo, each 1440/390. Actual pause preserves C/P, complete accepted
  state, generation, Serial and horn; queued physical/Serial input occurs once.
  Keyboard/touch, rates 0.1/1/2/10 and no rewind passed.
- Stronger independent cases passed in all four journeys: paused Reset produces
  a new H0 generation; releasing the old held Worker response changes nothing;
  resume works; Stop/Run retains zero and pauses at H0; actual rate-one action
  resumes the fresh generation.
- Actual post-layout FitScene interaction places the complete mobile Servo
  in frame. The native images were inspected; popup fits desktop and mobile.
- Canonical 2,550 tests and 71 fresh Nx tasks/three skipped-cache phases checked.
  Reviewer made no production/source edits. No remaining findings.

The independent probe adds stronger assertions and FitScene interaction to the
frozen harness; every production blob remains exact. Its full script, hash/delta,
focused/native logs, complete native receipt and eight screenshots are retained
under `independent-fad679/`. Non-image files are losslessly gzip-compressed to
preserve raw proof bytes across Git newline normalization; `artifact-index.json`
records original/durable paths and raw/stored hashes.

Issue 862 remains a separately proven mixed-circuit baseline failure. This review
does not certify that mixed model. General CI run 41003731109 subsequently
completed SUCCESS on this exact SHA with all four jobs successful. The separate
integration condition is satisfied. No installed or owner acceptance, server
update or deployment is claimed.
