# Complete publication/browser CI repair

Owner scope: resolve 429 throughout publication acceptance and the remaining failed
GitHub checks, verify and push Main; no working-site update.

Baseline: Main `d806d078`. Its Governance/code, database/RLS and Access A workflows
eventually completed successfully. The completed failed focused workflows were
Public Projects Publication, AI browser, Chess browser and Scratch public player.

## Corrections

- Publication acceptance previously shared one API process across all ten browser
  files. Registration and login budgets accumulated across unrelated scenarios
  under the runner's single address. A local reduction of duplicate actors did
  not solve that full-run isolation defect. The gate now runs **every same file**
  sequentially in its own Playwright invocation; the existing owned webServer
  starts/stops a fresh API each time. The database, real registration/login paths,
  rate limits and all tests are retained. External shared servers are rejected for
  this acceptance gate. Per-file trace output avoids clearing previous evidence.
  No 429 retries, fake IPs, limiter reset endpoints or production exemptions.
- AI saved-file layout test waited for the full document `load` event although
  lazy resources could delay it. Navigation now waits for DOM readiness followed
  by the real chat theme control. Existing file/image decoding, readability and
  layout assertions remain. No timeouts were increased or provider calls enabled.
- Chess offline recovery left the viewport at 320px after screenshots, then waited
  for desktop Home navigation hidden by the existing <=560px chrome breakpoint.
  The test restores desktop width after collecting all mobile evidence, before
  continuing its desktop recovery journey. Existing real offline/online, durable
  invitation, resumed game and no-forced-reload checks remain. Chess behavior and
  navigation code were not changed.
- Scratch public-player layout still assumed description text starts alongside
  the stage and used the old 900px breakpoint. The current sidebar starts alongside
  it above 1100px, with author information before the description. Assertions now
  check the actual sidebar alignment and below-stage placement at compact widths.
  Real execution, stop, fullscreen, stage fit, source immutability and Seat checks
  remain unchanged. The failed later activity-proof upload was downstream of the
  early browser failure; its strict artifact requirement was not disabled.

## POST_STEP_REVIEW

- CHANGE_CLASS: verification infrastructure/test-only repair.
- LAYOUT_IMPACT: none; no product DOM, CSS or user-visible strings changed.
- LOCAL VERIFICATION: actual full publication browser gate PASS, 30/30 scenarios
  in all ten files on a newly created isolated `*_test` database; emitted dependency
  check PASS after each file, zero forbidden modules. Real headed native Electronics
  execution included. Actual built API/Web, no response mocks for publications.
- OTHER BROWSERS: eight AI saved-image/file cases passed across 320/390/1024/1440
  and both themes; real Chess offline/reconnect journey passed; real pinned Scratch
  Guest/Seat player passed across 1440/1120/1024/390/320 plus fullscreen.
- SOURCE CHECKS: changed-source lint, formatting and E2E TypeScript passed; existing
  auth controller suite passed unchanged. Product API/Web build passed on baseline.
- SAFETY: no application permission, limiter, authentication, migration SQL, working
  database, runtime configuration or deployment change. Disposable testing data only.
- UNVERIFIED: final-commit cloud workflows until completed. Local AI Vite reported
  fonts outside its allow-list because this runner shares a junctioned dependency
  tree; checks passed, but that local setup is not a claim about hosted font delivery.
- VERDICT: local repair PASS; cloud acceptance and site deployment remain separate.

Detailed local logs: operations report directory, `all-repair-*`. Existing unrelated
owner reports/screenshots and generated test evidence remain outside this commit.
