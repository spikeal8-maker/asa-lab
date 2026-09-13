# ASA Games Platform — Requirements Traceability Matrix V2

**Статус:** Proposed  
**Нормативное ТЗ:** `ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION_V2.md`  
**Порядок:** `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`

---

# 1. Правила

Каждая implementation task обязана ссылаться минимум на один requirement ID V2 и один R-stage.

Requirement не переводится в `DONE` без evidence, соответствующего его природе:

- architecture decision/ADR;
- schema/contract test;
- restricted-role security/RLS test;
- integration/browser multi-client E2E;
- retry/concurrency/reconnect evidence;
- fault/load/soak test;
- migration parity evidence.

`Implemented` без evidence не считается выполнением.

Если требование относится к более позднему stage, оно не должно становиться причиной speculative implementation в текущем stage.

---

# 2. R0 — Architecture Freeze

| Requirement | Компонент/решение | Evidence |
|---|---|---|
| GP-R0-001 | Gaming Identity ADR | Account/StudentSeat/Principal lifecycle matrix + public DTO contract |
| GP-R0-002 | Games Security Domain ADR | storage/security placement diagrams + cross-workspace authz model + negative-test plan |
| GP-R0-003 | Canonical Match dimensions | typed domain model review; no overloaded `mode` |
| GP-R0-004 | Match state machine | transition table + termination reason matrix |
| GP-R0-005 | Teams first-class | duel/FFA/team fixtures representable without game-specific columns |
| GP-R0-006 | Minimal capability vocabulary | approved R1–R4 capability list |
| GP-VALUE-001..005 | Delivery governance | accepted Value Delivery Plan + Delivery Brief template |
| error/idempotency minimum | API contract | version/idempotency/error taxonomy accepted before R1 |

**R0 Gate:** no shared Games migration/API implementation before all rows are accepted.

---

# 3. R1 — Checkers Online: Private Match

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-FR-001..004 | Minimal Game Registry | registry contract tests; Checkers registered/disableable |
| GP-FR-040..042 | Gaming Identity | stable resolver tests + privacy redaction |
| GP-SEC-030 | Public identity privacy | no internal IDs/email/class metadata snapshots |
| GP-FR-050..054 | Match Core | schema/domain tests + authoritative outcome negative test |
| GP-FR-060..063 | Command Runtime | duplicate command/version conflict/reconnect integration |
| GP-SEC-040 | Adapter boundary | Checkers adapter has no rating/notification/DB direct write |
| GP-NFR-040..041 | atomic finish/outbox | transaction rollback + duplicate consumer tests |
| GP-FR-140 | history | finished Checkers appears identically to both participants |
| GP-QA-001..004 | evidence | 2-browser real match with reconnect and exact SHA |
| GP-GOV-001..005 | bounded changes | Delivery Brief, no unrelated rewrite, separate deploy/enable |

**R1 Product evidence:** two users complete one authoritative network Checkers match.

---

# 4. R2 — Quick Match + Generic Command Proof

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-FR-100..103 | Matchmaker duel V1 | pair/cancel/expiry/race/version compatibility tests |
| GP-FR-050..063 reuse | Tic-Tac-Toe adapter | no bespoke network repo/controller; generic reconnect/history |
| GP-VALUE-003 | abstraction reuse | Checkers + XO use same Match Core/command/matcher contracts |

**R2 Product evidence:** Checkers Quick Match works between two users; XO works on same core.

---

# 5. R3 — Competitive Checkers

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-FR-120..123 | Rating Service/Policy | deterministic fixtures + unique match/player/pool application |
| GP-FR-130 | Stats projector | delete/rebuild projection → identical totals |
| GP-FR-133 | Leaderboard | per-game/pool privacy-aware ranking tests |
| GP-SEC-105 | server authority | forged client result/score cannot alter rating |
| GP-NFR-041 | projector idempotency | duplicate outbox event harmless |

**R3 Product evidence:** rated Checkers match produces one correct rating delta, profile/stats/history/leaderboard.

---

# 6. R4 — Chess Convergence

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-MIG-001 | Chess donor decomposition | generic vs chess-owned mapping review |
| GP-MIG-002 | shadow projection | representative results/events/rating deltas parity |
| GP-MIG-003 | compatibility API | old API contract suite against delegated new path |
| GP-MIG-004 | additive migration | no destructive cleanup in cutover release |
| GP-VALUE-003 | abstraction reuse | mature Chess + Checkers consume same generic services |

**R4 Product evidence:** new Chess match runs through Games Core/compatibility delegation with no semantic regression.

---

# 7. R5 — Classroom Social Play

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-FR-110 | Invite Service | generic invite works for Checkers/Chess |
| GP-FR-112 | Party minimal contract | lifecycle tests only where required for next realtime/team stage |
| GP-FR-113 | Social Directory | Classroom + Recent Opponents providers |
| GP-SEC-060 | classroom privacy | cross-class/cross-tenant/global negative tests |
| GP-SEC-030 | public DTO privacy | class/school metadata absent from global views |

**R5 Product evidence:** permitted classmates can invite/play; classroom leaderboard/H2H restricted correctly.

---

# 8. R6 — Realtime Platform + Arena Mini

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-FR-080..081 | Realtime Gateway | auth/subscription/fanout tests; no game physics imports |
| GP-NFR-030..031 | Gateway backpressure/transport | slow-consumer + reconnect-storm load tests |
| GP-FR-070 | server-authoritative room | malicious set-position/score claims rejected |
| GP-FR-072 | Room Protocol | schema/version/reconnect/resync tests |
| GP-FR-090..092 | Allocator/token | capacity/version/token isolation tests |
| GP-RT-LEASE-001 | fencing | stale runtime callback/allocation generation rejected |
| GP-NFR-020..021 | tick/hot path | p95/p99/overrun + no per-tick blocking SQL proof |
| GP-FR-052 | teams | Arena 2v2 uses canonical team outcome path |
| GP-QA-001..004 | realtime evidence | 4-client FFA + 2v2 + crash/reconnect/load artifacts |

**R6 Product evidence:** Arena Mini FFA and 2v2 work end-to-end.

---

# 9. R7 — Creator Web Games MVP

| Requirement | Компонент | Evidence |
|---|---|---|
| GP-CREATOR-001..002 | Build/Release model | exact source revision → immutable build; rollback without rebuild |
| GP-SEC-010 | Build sandbox | secrets/DB/socket/privilege negative tests |
| GP-SEC-101 | Client sandbox | cookie/DOM/cross-origin escape negative tests |
| GP-CAP-001..002 | capability grants | request cannot self-grant; release/audience-scoped enforcement |
| GP-NET-001 | external network policy | deny-by-default `connect-src`/gateway tests |
| GP-OWN-001 | ownership | principal/workspace/platform ownership + reviewer authority tests |
| GP-QUOTA-001 | quotas | build/storage/log limits enforced |
| Game Storage Contract | storage SDK | quota/version/visibility/delete tests |
| GP-PRIV-001..004 | student privacy | private-by-default + classroom approval + analytics allowlist |
| GP-QA creator proof | Creator Sample | GitHub→build→preview→approval→classroom→save→upgrade→rollback |

**R7 Product evidence:** student web game launches safely for a classroom without ASA cookies/DB/internal APIs.

---

# 10. R8 — Creator Multiplayer Rules — conditional

No requirements become implementation commitments until owner approves R8 Delivery Brief.

Mandatory evidence before production:

- managed-command sandbox ADR;
- threat model;
- feasibility benchmark;
- CPU/memory/time/network/filesystem limits;
- deterministic/retry behavior;
- hidden-information fixture;
- creator multiplayer certification.

WASM/WASI is candidate only until ADR acceptance.

---

# 11. R9 — Events/Tournaments/Scale — demand-driven

No speculative commitments.

Any of the following requires a separate Delivery Brief + measured justification:

```text
Redis
Kafka/NATS
Kubernetes/Agones
WebTransport
regional runtime fleet
community creator publication
advanced tournament formats
verified external room runtimes
```

---

# 12. Cross-cutting requirement mapping

| Requirement group | Earliest stage | Rule |
|---|---:|---|
| GP-ARCH-001..006 | R0/R1 | logical boundaries first; physical split only by need |
| GP-NFR-040..042 | R1 | durable match consistency before ratings/stats |
| GP-FR-140..142 | R1/R6 | command history now; realtime replay only when required |
| GP-SEC-100..106 | R1/R6/R7 | enforce at first surface that exposes corresponding risk |
| GP-PRIV-* | R1/R5/R7 | privacy tests expand with discovery/publication surfaces |
| GP-API rules | every stage | exact DTO/errors/limits defined immediately before endpoint implementation |
| resource limits | R1/R6/R7 | command → realtime → creator quotas progressively |
| GP-GOV-* | all | bots/agents cannot silently widen scope |

---

# 13. Product completion gates

## Games Core Alpha — R3

Must have PASS evidence for R1–R3. Later Realtime/Creator requirements do not block this release.

## Games Core V1 — R4

Must have mature Chess+Checkers convergence evidence.

## School Games V1 — R5

Must have classroom privacy/social evidence.

## Realtime Games V1 — R6

Must have Arena FFA + teams + allocator fencing/load evidence.

## Creator Web Games V1 — R7

Must have Creator Sample publishing/security evidence.

R8/R9 are optional future capabilities and do not retroactively prevent declaring earlier product checkpoints complete.