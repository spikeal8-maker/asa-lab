# PROJ-R8-05 — Discovery Metrics and Refinement

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted core R8 discovery/interactions; exact subfeatures depend on available real data.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Decisions:** `docs/product/projects/DECISION_LEDGER.md`

---

## 0. Activation gate

Start only when this exact slice is selected and `DEC-PROJ-113` ranking formula is resolved for every ranking mode being enabled.

No ML/personalized recommender before real data volume and separate approval justify it.

---

## 1. Пользовательский результат

Discovery becomes more useful without becoming opaque or fake:

- real view/open/run/save/copy metrics;
- documented sort/ranking modes;
- related projects;
- links from Projects to relevant Knowledge;
- improved featured logic;
- performance tuning after real usage evidence.

---

## 2. Scope

In as separately measurable sub-slices:

- analytics event schema/versioning;
- deduplicated view/open/launch metrics;
- persisted aggregates where needed;
- additional real sort modes;
- related projects from module/tags/explicit links;
- `Хотите сделать похожее?` Knowledge links;
- featured/curation refinement;
- query/index/cache tuning;
- catalog/viewer performance refinement.

Out:

- invented engagement numbers;
- opaque personalized ranking without separate decision;
- collecting PII not required for metric semantics;
- cross-product ML recommender by default;
- ads/monetization ranking.

---

## 3. Metric semantics

Every user-visible metric defines:

- event meaning;
- persistence source;
- dedup window/key;
- bot/internal traffic policy if relevant;
- anonymous/authenticated treatment;
- when count appears in UI;
- retention/privacy constraints.

A React rerender or repeated polling must not count as a new view.

---

## 4. Ranking rule

A sort/ranking label appears only after its formula is documented and testable.

Examples may use real combinations of:

- recency;
- unique opens;
- saves;
- copies/remixes;
- reactions;
- launches.

Exact weights/periods are DEC-PROJ-113 decisions. No hidden arbitrary score should be introduced in code without documentation.

---

## 5. Related projects / Knowledge

First implementation should prefer deterministic signals:

- module key;
- tags/topics;
- explicit author/editor links;
- shared supported components/technology metadata where canonical.

Knowledge connection may show real:

- course;
- task;
- article;
- video.

Do not fabricate relation cards when there is no real target.

---

## 6. Performance refinement

Use measured evidence from R7/R8 rather than speculative rewrites.

Check:

- API query plans/indexes;
- first 20–24 card batch;
- image payload/variants;
- N+1 regressions;
- route chunks;
- viewer lazy loading;
- cache correctness/public-private separation;
- low-end mobile;
- large viewport;
- memory/resource cleanup.

---

## 7. Required tests

- view/open/run counts follow dedup policy;
- bots/rerenders/polling do not inflate counts according to documented contract;
- ranking is deterministic for fixture data;
- no private/unlisted project enters related/recommendation results;
- related projects use real metadata;
- Knowledge link resolves to existing public/eligible material;
- additional sort modes restore through URL state;
- query/load test shows no unacceptable regression;
- analytics failure does not block project open/viewer action;
- telemetry contains no raw private project document/secrets.

---

## 8. Acceptance Criteria

- **R8-05-AC01** every visible metric has documented semantics and persistence source.
- **R8-05-AC02** every enabled ranking mode has accepted formula.
- **R8-05-AC03** no fake/placeholder counters remain in production path.
- **R8-05-AC04** related projects/Knowledge use real deterministic data.
- **R8-05-AC05** privacy/cache boundaries remain correct.
- **R8-05-AC06** performance changes are evidence-driven and measured.
- **R8-05-AC07** analytics is non-blocking for core user flows.

---

## 9. Hygiene

Split metrics, recommendation linkage and performance optimization into bounded sub-slices if one task would become too broad. Normal threshold 3; runtime/performance-heavy sub-slices may use threshold 2.

---

## 10. STOP conditions

STOP if ranking formula is unresolved, implementation needs fake data, analytics requires sensitive/raw content, or optimization proposal becomes broad unrelated rewrite without measured bottleneck.