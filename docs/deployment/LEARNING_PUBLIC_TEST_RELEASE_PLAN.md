# Learning/Courses public staging release plan

**ID:** PUBLIC-TEST-001  
**Issue:** #374  
**Base:** fresh `main` only  
**Production impact:** none until separate owner-authorized deploy

## 1. Purpose

Provide a public, disposable-but-persistent staging installation where the owner can inspect the current Learning/Courses product in a real browser before any production update.

Staging is not a second product. It runs the same Web/API/Scratch/PostgreSQL stack with isolated data and explicit staging origins.

## 2. Current observed state

| Surface | Revision / schema |
|---|---|
| public `asa-lab.ru` | `1ae93cbb99ffa53abbf53430bf2c6d1dfca39e1e` / schema 142 |
| local Ali_Robs dev | `78287af04ee16d3f034c8a349cbc7ff43763b5c1` / schema 151 |
| fresh main at plan creation | `62787aa5f8addf1e1e5c6e3b242f53ee7aa851d8` |
| PR #361 | `0b1748f44e5c8598228a887556496f3620b21d41` |
| PR #369 | `64c544c6d7de9cf78ad6abd6813f85bb1cb54357` |

A local dry-run merge of fresh main + #361 + #369 completed without Git conflicts. This proves only mergeability, not acceptance.

## 3. Release model

There are two different artifacts.

### Preview candidate

May include accepted or explicitly owner-requested unmerged Learning heads for inspection.

It:
- runs only on staging;
- uses synthetic data;
- is clearly marked TEST/STAGING;
- is never promoted by copying a database or container blindly.

### Production candidate

Must be an exact SHA reachable from `main`, with required CI success and guarded update eligibility.

No draft PR is deployed directly to production.

## 4. Target staging topology

Recommended host topology:

```text
https://lab.alikinas.ru
        |
        +--> staging Web 127.0.0.1:14610
                |
                +--> private staging API
                +--> private staging PostgreSQL
                +--> private staging MinIO

https://scratch.lab.alikinas.ru
        |
        +--> staging Scratch 127.0.0.1:14613
```

Required Compose identity:

```text
COMPOSE_PROJECT_NAME=asa-lab-staging
ASA_WEB_PORT=14610
ASA_BLOCKS_PORT=14613
ASA_SEED_DEV=false
```

Required browser origins:

```text
ASA_PUBLIC_WEB_ORIGINS=https://lab.alikinas.ru
ASA_BLOCKS_PARENT_ORIGIN=https://lab.alikinas.ru
ASA_BLOCKS_RUNTIME_ORIGIN=https://scratch.lab.alikinas.ru
```

The exact public runtime hostname may differ, but it must be a distinct HTTPS origin and must be fixed before building Web/Scratch.

## 5. Data isolation

Public staging MUST NOT use the production PostgreSQL or MinIO volumes.

Do not copy production learner data into public staging.

Use:
- separate PostgreSQL named volume;
- separate Blocks object-storage volume;
- synthetic teacher;
- synthetic groups;
- synthetic learners;
- synthetic courses/assignments/projects only.

Credentials are kept in private host-owned `.env` and are not committed.

## 6. Candidate composition

Before the first Learning public candidate:

1. Finish V1 visual acceptance in PR #369.
2. Fresh-converge PR #361 onto current main and independently accept D5.
3. Re-fetch main immediately before candidate creation.
4. Integrate exact accepted heads into one staging candidate.
5. Record:
   - base main SHA;
   - #361 accepted SHA;
   - #369 accepted SHA;
   - final candidate SHA;
   - changed migration set.

No broad feature work is added during convergence.

## 7. CI gates

Before public exposure, exact candidate must pass:

```text
Learning E1 Convergence
ASA Lab Governance and Code Gates
```

Plus candidate-specific checks:

```text
pnpm test:learning-e1
pnpm e2e:learning-e1
pnpm gate:repository
git diff --check
```

Any known external baseline failure must be explicitly named and must not be caused by candidate files.

## 8. Migration gates

Staging uses a new isolated database.

Required:
1. render final Compose config;
2. run migration plan;
3. migrate clean staging DB;
4. confirm expected schema equals actual schema;
5. rerun migration and confirm zero pending migrations;
6. start API only after migration success.

Production migration is a separate later operation.

The public production installation currently reports schema 142. The current main contains migrations through 0159; PR #361 additionally contains 0160. Therefore production promotion later requires a real guarded migration preflight, not manual SQL.

## 9. Public ingress

DNS currently resolves `lab.alikinas.ru` to the same external address as production, but no working staging route was observed.

Before public staging acceptance:
- configure HTTPS route `lab.alikinas.ru -> 127.0.0.1:14610`;
- create/configure distinct HTTPS Scratch runtime hostname -> `127.0.0.1:14613`;
- preserve production routes;
- do not publish API/PostgreSQL/MinIO.

TLS and routing are operator infrastructure; they do not change application code.

## 10. Synthetic acceptance dataset

Staging should contain at least:

- teacher: 1;
- groups: 2;
- learners: 5+;
- course with theory + Electronics practice + 3D practice;
- direct assignment;
- scheduled assignment;
- available assignment;
- in-progress work;
- submitted/waiting-review work;
- changes-requested work;
- completed work;
- one ordinary non-assignment StudentSeat project.

This dataset is for product inspection, not performance benchmarking.

## 11. Owner journeys

Minimum public browser journeys:

### Learner

```text
login
→ Home learning attention
→ My Learning
→ two groups
→ scheduled locked task
→ available task detail
→ Start/Continue
→ editor assignment anchor
→ open/move/resize task panel
→ save
→ submit
```

### Teacher

```text
login
→ class
→ learner profile
→ see ordinary + assignment projects
→ open assignment review
→ exact submitted version
→ return/change-request/accept
→ next learner
```

### Modules

Verify:
- Electronics;
- 3D;
- Blocks/Scratch overlay and runtime origin.

## 12. Owner-visible evidence

Exact-candidate screenshots are required and stored as CI/deployment evidence.

At minimum:
- learner home;
- multi-group My Learning;
- task detail;
- Electronics anchor/panel;
- 3D panel;
- Scratch overlay;
- teacher learner profile;
- teacher exact review;
- mobile 390;
- mobile 320.

A public URL without reviewed evidence is not acceptance.

## 13. Staging readiness receipt

Record:

```text
CANDIDATE_SHA:
BASE_MAIN_SHA:
PR361_SHA:
PR369_SHA:

WEB_REVISION:
API_REVISION:
SCRATCH_REVISION:

SCHEMA_ACTUAL:
SCHEMA_EXPECTED:
SYNCHRONIZED:

PORTAL_URL:
SCRATCH_URL:

LEARNING_E1:
GOVERNANCE:

OWNER_EVIDENCE:
OWNER_ACCEPTANCE:
```

## 14. Production promotion

Only after owner acceptance:

1. ensure the accepted candidate content is merged/reachable from fresh `main`;
2. require exact-main general CI success;
3. identify the real production Compose checkout/project/volume;
4. run guarded update `--check`;
5. create verified backup;
6. run migration plan against production;
7. guarded update;
8. verify Web/API/Scratch exact same revision;
9. verify schema synchronized;
10. run authorized synthetic smoke on `asa-lab.ru`.

Never promote by pointing production DNS at the staging database/container.

## 15. STOP conditions

Stop before changing production if:
- candidate includes unreviewed product files;
- #361 or #369 head changed after acceptance;
- main moved and candidate was not rebuilt;
- staging and production Compose identities are ambiguous;
- migration plan fails;
- public Scratch origin is not exact;
- any candidate service reports a different revision;
- owner-visible Learning journey is not accepted.
