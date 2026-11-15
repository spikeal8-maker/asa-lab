# UI qualification authentication capacity — 20 October 2026

Observed main: `e142835ed087995235d53f714f8185dfdfb00e0e`. [Electronics run 39469002502](https://github.com/spikeal8-maker/asa-lab/actions/runs/39469002502) completed with failure: 198 browser cases passed and 23 failed. General CI passed. These are observations of this SHA, not acceptance of a later candidate.

Independent trace inspection found shared authentication capacity exhaustion:

- At 18:11:53 UTC, the 1440 light shadow case received `POST /api/auth/login` HTTP 429 with `Retry-After: 39`; request ID `f1b9905c-e08f-44c9-b9e9-4b35354fd828`.
- At 18:11:59 UTC, the 1024 light shadow case received `GET /api/auth/bot-challenge?action=login` HTTP 429, `code: too_many_attempts`, `retryAfterSeconds: 34`; request ID `4383d339-5d3d-4ace-9344-97830077be55`. The disabled login control follows the failed challenge, not a demonstrated SPDT product defect.

Field qualification completed 27 of 32 cases; five failed at authentication with HTTP 429. Shadow qualification completed one of eight cases; two failed at login HTTP 429 and five encountered disabled challenge-dependent login. Raw evidence contains 27 complete field journeys and one complete shadow journey. The 11 mobile cases passed on this exact main. None of these partial results supplies missing field/shadow completion or owner acceptance.

Classification: D, shared authentication capacity in qualification infrastructure. Select a bounded test fixture repair: one real UI login per group/worker in a disposable bootstrap context, retain only cookies, and keep every case's fresh context/new project and strict native Save/CAS/cookies-only reopen contract. No authentication server or rate-limit change is selected. No unchanged rerun, waiting workaround or weakened assertion is justified. The new exact candidate still requires complete qualification and independent review; #548 and owner/device boundaries remain separate.
