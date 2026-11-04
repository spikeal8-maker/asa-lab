# Independent exact-source review

**APPROVE** — `84f65b41bf58bf3506e15e41e3ee4b6459b905b2`.

The new independent reviewer verified all five source-manifest Git blobs, sizes,
hashes and the exact five peripheral-map forwarding boundaries. HC-SR04/Ping
references are preserved; the Servo map is read only for pose projection. No
equation, scheduler, decoder, clock, profile or UI change was found.

- Independent focused verification: **222/222 tests PASS**, ten files, including
  real ultrasonic input/adapter regressions (8.09 seconds).
- Fresh native final-production verification: **4/4 journeys PASS**, mixed
  Arduino/physical Servo/ordinary LED/raw seven-segment, 45/135 degrees at
  1440/390 (8.44 seconds). Both the horn attribute and actual computed SVG matrix
  match the decoded pulse angle. Servo is fully in frame, LED/display still
  operate, results are finite/passed and there are no page errors. Images viewed.
- Fresh independent execution reproduced the complete AFTER oracle:
  **343,853 bytes**, SHA256
  `38445cac0490f13d95a1f2de33e6a9ca17baf06491fe791798a5151d7dbdb076`.
  All five legacy cases and physical direct DC Servo remain byte identical.
  The five mixed results differ only by the known Servo's previously missing
  angle; every value matches decoded state. Complete requests/advances, state,
  actions, Serial and all other numerical fields remain unchanged.
- The unreachable null backstop is honestly source-audited; no forged state or
  production hook is used to claim dynamic coverage.
- Canonical retry checked: **2,556 tests**, **71 fresh Nx tasks**, three skipped
  cache phases, no cache hits; old ownership case passed in 3,202 ms. Initial
  timeout and diagnosis remain preserved. No timeout or source edits were made.

Fourteen independent artifacts plus the review receipt are retained under
`independent-84f65b41/`: complete probe scripts and deltas, focused/native logs,
full native receipt/screenshots and independently reproduced full oracle.
`artifact-index.json` maps original paths to lossless copies and raw/stored
hashes. Non-image text is gzip-compressed to preserve original bytes across Git
newline normalization. No findings remain.

Exact-source General run 41009745129 also completed SUCCESS with Governance,
Code, PostgreSQL/RLS and Access A browser jobs all successful. No installed,
owner acceptance, database operation or server update is claimed.
