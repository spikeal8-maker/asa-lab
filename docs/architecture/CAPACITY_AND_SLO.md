# Capacity model, SLO и reference-инфраструктура ASA Lab

**Статус:** canonical owner architecture contract.  
**Owner decision:** 2026-10-04.  
**Applies to:** core platform, Learning, Scratch/Blocks, Electronics, 3D, Games и будущий AI compute plane.  
**Machine-readable contract:** `docs/agent/contracts/capacity.yaml`.

Этот документ задаёт проектную ёмкость и правила архитектуры. Числа C3000/S4500/T5000 — не результат линейной экстраполяции старого теста и не утверждение, что текущая установленная версия уже прошла нагрузочную приёмку. Они являются обязательными целями проектирования; фактический PASS подтверждается только нагрузочным evidence на указанном exact SHA и указанном reference hardware/profile.

## 0. Как читать этот документ — обязательно для агентов

Capacity target и minimum development requirements — разные вещи.

1. **C3000 — design target, а не minimum hardware.** Обычную разработку, review, unit/integration tests, Docker preview и небольшие стенды разрешено выполнять на существенно более слабых машинах.
2. **Недостаток ресурсов для физического C3000 load test не является coding blocker.** Агент продолжает bounded product-задачу и проверяет C3000 прежде всего расчётом amplification и архитектурными инвариантами.
3. **Текущая topology не обязана немедленно соответствовать mature C3000 topology.** Один API + PostgreSQL + MinIO и текущий Compose остаются допустимой стартовой реализацией.
4. **Не создавать инфраструктуру заранее.** Redis, PgBouncer, дополнительные API replicas, realtime gateway, worker pool, CDN, отдельный storage host, game-runtime или AI/GPU workers добавляются только отдельной задачей, owner-поручением либо после измеренного bottleneck/функциональной необходимости.
5. **Future sections are conditional.** Разделы Games/3D/AI задают границы для момента, когда соответствующая тяжёлая функциональность действительно реализуется; они не являются списком контейнеров, которые надо создать сейчас.
6. **Hardware profiles не являются gate обычной разработки.** Они применяются только к явно названному виду стенда/acceptance run.

### 0.1. Минимальные требования для обычной разработки

Это практический **DEV-MIN**, а не C3000 certification host.

| Ресурс | DEV-MIN | DEV-REC | Что означает |
|---|---:|---:|---|
| CPU | 4 современных ядра | 6–8 ядер | код, Compose, focused tests |
| RAM | 8 GB | 16 GB | при 8 GB тяжёлые browser/full-repo gates лучше оставлять CI |
| Свободный SSD | 30 GB | 60+ GB | repo, dependencies, Docker images/volumes |
| Сеть | 10 Mbit/s | 50+ Mbit/s | Git/registry; не capacity test |
| GPU | не требуется | не требуется | обычная разработка Core/Scratch/Electronics/3D UI |
| Отдельный Redis/PgBouncer | не требуется | не требуется | появляются отдельной задачей |
| Несколько API replicas | не требуется | не требуется | один API допустим для dev/preview |
| 1 Gbit/s uplink | не требуется | не требуется | нужен только для соответствующего load profile |

Если конкретный dev-стенд слабее DEV-MIN, это **не автоматический STOP**: агент выполняет доступный focused scope, не запускает заведомо неподходящий тяжёлый benchmark и оставляет полный gate CI/выделенному стенду.

### 0.2. Минимальный функциональный self-host / demo

Для функционального запуска без заявления C3000 capacity:

| Ресурс | RUN-MIN |
|---|---:|
| CPU | 4 ядра |
| RAM | 8 GB |
| Свободный SSD | 40 GB + место под пользовательские данные |
| Сеть | обычный LAN/Internet; фиксированный throughput не является условием запуска |
| API replicas | 1 |
| PostgreSQL | 1 |
| Object storage | текущий поддерживаемый вариант |
| Redis/PgBouncer/realtime/workers | не обязательны, пока конкретная функция их не требует |

RUN-MIN означает «система запускается и функционально используется в малом масштабе», а не «сертифицировано N CCU».

## 1. Термины

- **Registered users** — все созданные Account и StudentSeat. Число зарегистрированных пользователей не равно CCU и не ограничивается C3000.
- **CCU** — одновременно активные пользователи, выполняющие реальную работу.
- **Active user** — независимая authenticated session, которая открывает/редактирует/сохраняет проект, работает с курсом, классом, игрой, 3D или другой поддерживаемой поверхностью. Idle tab сам по себе не считается активным пользователем.
- **Class-local burst** — синхронное действие одного класса из 30 пользователей.
- **Lesson window** — массовые входы/открытия в начале урока и final save/submission в конце.
- **Core plane** — ingress, Web, API, identity, PostgreSQL, object storage, realtime/control plane.
- **Compute plane** — фоновые CPU/GPU jobs: автопроверка, экспорт, тяжёлая геометрия, серверный рендер, AI text/image и другие ресурсоёмкие задачи.

## 2. Обязательный owner capacity contract

| Profile | Назначение | Active CCU | Классы × 30 | Требование |
|---|---|---:|---:|---|
| CLASS-30 | минимальный classroom gate | 30 | 1 | функционально-нагрузочная корректность одного класса |
| C500 | промежуточный regression gate | 500 | ~17 | раннее обнаружение архитектурного amplification |
| **C3000** | **нормальная проектная/эксплуатационная цель** | **3 000** | **100** | все core SLO соблюдаются; это основная цифра для разработки |
| **S4500** | **кратковременный surge** | **4 500** | **150** | без project loss/logout/outage; допустим ограниченный рост latency |
| **T5000** | **stress ceiling текущей single-core-host topology** | **5 000** | **~167** | лабораторный stress gate, не обычное SLA |
| L2 distributed | следующий архитектурный уровень | 10 000+ | 333+ | требует распределения stateful/compute компонентов |

### 2.1. Нормативное правило для разработки

Любой новый или изменяемый:
- polling;
- autosave;
- retry/reconnect;
- asset fetch;
- session refresh;
- background job;
- realtime fanout;
- teacher/dashboard query;
- AI request;
- server-side render/compile/export

**MUST** оцениваться как минимум при C3000.

Формула проверки для периодической операции:

```text
platform_rate = per_user_rate × 3000
```

Если периодическая операция при C3000 создаёт тяжёлый full-resource read, полный project load, массовый DB scan, повторную загрузку immutable bytes или синхронный внешний вызов, это архитектурный finding даже если CLASS-30 проходит.

## 3. Принцип local-first

Scratch VM, Electronics simulation, 3D interaction и обычная игровая логика SHOULD выполняться в браузере пользователя, когда это безопасно и функционально возможно.

Core server не должен становиться вычислительным циклом каждого кадра/шага/блока пользователя.

Нормальная модель:

```text
browser
  ├─ local interaction / VM / simulation / rendering
  ├─ local recovery
  ├─ bounded metadata/revision/realtime traffic
  └─ minute-scale durable persistence where the module contract allows it

core server
  ├─ auth / authorization
  ├─ durable project state
  ├─ classes / courses / results
  ├─ immutable/user assets
  ├─ realtime notifications
  └─ queue admission

compute plane
  └─ CPU/GPU-heavy jobs outside the synchronous API path
```

## 4. C3000 acceptance profile

C3000 — это не 3 000 idle tabs.

Обязательные подпрофили:

| Subprofile | Нагрузка |
|---|---|
| steady active | 3 000 независимых authenticated active sessions |
| lesson start | 3 000 входов за 120 s; project/module opens с controlled ramp |
| class-local burst | 30 пользователей одного класса выполняют одно действие синхронно |
| all-one-module | отдельные прогоны Scratch, Electronics, 3D и Games при максимально поддерживаемой доле C3000; browser-local compute не переносится на API |
| mixed modules | одновременно Scratch + Electronics + 3D + Games + Learning/teacher surfaces |
| save wave | средний durable remote save budget около 50/s для minute cadence; jitter обязателен |
| short save burst | до 150 save/submission mutations/s в коротком контролируемом окне без потери данных |
| lesson end | final save/submission без глобального thundering herd |
| reconnect | 20% C3000 = 600 клиентов восстанавливаются в течение 60 s |
| weak network | bounded retry/backoff+jitter, без синхронного retry storm |
| dependency fault | transient API/DB/object-store/realtime fault без массового logout/project loss |
| warm reopen | immutable static bytes обслуживаются browser/edge cache, origin не повторяет тяжёлую cold delivery |

## 5. Core SLO для C3000

| Indicator | C3000 target |
|---|---:|
| Core availability during lesson windows | ≥ 99.9% |
| API read P95 | ≤ 400 ms |
| API write P95 | ≤ 700 ms |
| API read/write P99 | ≤ 1.5 s, кроме явно долгих async jobs |
| Login P95 | ≤ 2 s |
| Durable project save P95 | ≤ 1.5 s для typical project |
| Save error rate | < 0.1% |
| HTTP 5xx | < 0.1% на acceptance profile |
| Unexpected logout | 0 accepted |
| Project loss after server acknowledged save | 0 accepted |
| DB pool timeout | 0 accepted |
| DB pool wait P95 | ≤ 50 ms |
| DB pool wait P99 | ≤ 250 ms |
| Queue admission P95 | ≤ 300 ms |
| Realtime/control delivery P95 | ≤ 1 s |
| Event-loop lag P99 | ≤ 100 ms |
| Core CPU steady | ≤ 70% reference host |
| Core CPU short burst | ≤ 85% |
| Host RAM steady | ≤ 75%; swap thrashing запрещён |
| NIC steady | ≤ 60% line rate |
| NIC short burst | ≤ 80% line rate |

S4500 может временно превышать latency C3000, но не допускает project loss, массовый logout, DB pool timeout cascade или полный outage.

## 6. Request/amplification budgets

Это архитектурные бюджеты, а не искусственная замена end-to-end load test.

| Traffic class | C3000 design rule |
|---|---|
| durable autosave | minute-scale where module semantics allow; ≈50 saves/s average at C3000 |
| background API traffic | target ≤0.10 req/s/user average (=300 RPS) excluding lightweight realtime transport |
| total mixed core API | проектировать на hundreds RPS steady с запасом; acceptance фиксирует фактический RPS |
| heavy project polling | запрещён как постоянный idle path |
| revision/presence check | lightweight payload/ETag/revision only, jittered; realtime event preferred |
| immutable static | browser/edge cached; повторная сессия не должна заново тянуть тяжёлые vendor bytes |
| retries | exponential/bounded backoff + jitter; hard auth/integrity failures не retry |
| class burst | 30 пользователей могут синхронно выполнить поддерживаемое действие |

### 6.1. Запрет full-open polling

Периодический `openProject`/полная загрузка project JSON/history для обнаружения изменений запрещены как steady-state механизм C3000.

Допустимые варианты:
1. realtime invalidation/revision event;
2. lightweight revision endpoint;
3. conditional GET/ETag;
4. bounded low-frequency fallback с jitter.

## 7. Hardware profiles: development ≠ capacity certification

Железо ниже относится **только к физическому нагрузочному прогону соответствующего профиля**. Оно не является требованием для написания кода, review, preview, unit tests или обычного self-host.

### 7.1. C3000 reference load host

Это отправная точка для полного C3000 benchmark, а не «минимальный компьютер ASA Lab».

| Component | Reference for C3000 load run |
|---|---|
| CPU | 24 modern high-performance cores / 48 threads |
| RAM | 128 GB, ECC preferred |
| System/container storage | fast SSD/NVMe with sufficient free space |
| PostgreSQL storage | dedicated high-endurance NVMe preferred |
| Object storage capacity | определяется retention/user data; не фиксируется CCU-цифрой |
| Public/traffic generator network | 1 Gbit/s symmetric reference |
| Faster cold-start test | 2.5 Gbit/s optional |
| Backup | required for production deployment, not for an isolated synthetic load bench |

Более слабый стенд можно использовать для C500/частичных прогонов и для поиска bottleneck. Если более слабый стенд фактически проходит полный C3000 profile и evidence корректно фиксирует hardware — такой результат допустим.

### 7.2. T5000 stress reference

| Component | Stress reference |
|---|---|
| CPU | 32 cores / 64 threads |
| RAM | 192–256 GB |
| DB/object disks | fast NVMe; separation preferred |
| Network | 2.5 Gbit/s+ where traffic generation needs it |
| Purpose | laboratory stress measurement only |

### 7.3. Hardware is never a generic coding gate

Агент MUST NOT:
- проверять DEV/preview machine на соответствие C3000 reference hardware перед обычной правкой;
- отказываться писать код из-за отсутствия 64/128 GB RAM, 1/2.5 Gbit/s или нескольких NVMe;
- требовать Redis/PgBouncer/несколько API instances до отдельной задачи;
- переписывать Compose «под C3000» без измеренного bottleneck или owner instruction.

Hardware validation выполняется только когда task явно имеет тип capacity acceptance, production provisioning или load benchmark.

## 8. Public/static network contract

C3000 cannot depend on repeatedly delivering large immutable editor bundles from origin.

Rules:
- hashed/versioned editor/vendor assets: `immutable`;
- entry HTML/runtime config/authenticated project data: never public-immutable;
- warm reopen MUST prove high cache reuse;
- heavy media/assets MUST be lazy/on-demand;
- browser cache or an edge/CDN-equivalent may absorb immutable cold assets.

Network modes:

| Mode | Requirement |
|---|---|
| 1 Gbit/s origin | acceptable for C3000 steady/warm profile; full cold C3000 requires strong immutable edge/browser caching or longer ramp |
| 2.5 Gbit/s origin | recommended reference for aggressive cold-start testing without external CDN |
| separate storage/AI LAN | 10 GbE preferred to keep internal transfers out of public bottleneck |

FRP/tunnel/proxy is part of the capacity envelope. A transport pool that saturates before C3000 is a failed C3000 topology even if API/DB are healthy.

## 9. Возможная mature C3000 topology — не план немедленной миграции

C3000 does **not** require Kubernetes. Схема ниже — возможное состояние после измеренных шагов масштабирования. **Она не требует сейчас добавлять перечисленные сервисы.** Текущий более простой Compose остаётся допустимым, пока проходит нужный текущий gate и не показан bottleneck, который требует следующего компонента.

```text
Internet / LAN
      |
   Caddy/edge
      |
      +-------------------- static Web/editor assets
      |
      +---- API replica 1 ----+
      +---- API replica 2 ----+---- PgBouncer ---- PostgreSQL primary
      +---- API replica 3 ----+
      |
      +---- realtime-gateway replica(s)
      |
      +---- object API --------------------------- MinIO/object storage
      |
      +---- job-dispatcher ---- worker-runtime pool
      |
      +---- Redis (cache/rate-limit/pubsub; never source of truth)
```

Это всё ещё одна установка и может находиться на одном physical host. Несколько API process/container — не отдельная распределённая платформа.

## 10. Каталог возможных services — вводятся по необходимости

Таблица ниже описывает роли, которые могут появляться по мере роста. Это **не required container list для текущей реализации** и не разрешение агенту заранее перестраивать Compose. Начальные ресурсы — только ориентир для отдельного benchmark/provisioning task.

| Service | Role | C3000 topology | Initial budget/reference |
|---|---|---|---|
| edge/web (Caddy) | TLS/ingress/static/cache headers/reverse proxy | 1–2 instances | 1–2 vCPU, 0.5–1 GB RAM |
| api | stateless HTTP/control plane | **3 replicas recommended** | 3–6 vCPU, 2–4 GB RAM each |
| pgbouncer | connection multiplexing | 1 | 1 vCPU, 0.5 GB RAM |
| postgres | source of truth | 1 primary on C3000 single-host | 8–12 CPU share, 32–48 GB working memory/cache envelope |
| redis | shared rate limits/cache/realtime pubsub | 1 | 1–2 vCPU, 2–8 GB RAM; disposable/rebuildable state only |
| minio/object | durable user assets | 1 on C3000 | 2–4 vCPU, 8–16 GB RAM + dedicated storage |
| scratch static runtime | embedded editor delivery | 1–2 | 1 vCPU, 0.5–1 GB; execution remains client-side |
| realtime-gateway | presence/invalidation/live events | 2 preferred | 1–2 vCPU, 1–2 GB each |
| job-dispatcher | queue admission/fair scheduling | 1–2 | 1–2 vCPU, 1–2 GB |
| worker-runtime | CPU-heavy async tasks | scalable pool | resource class per job; never block API event loop |
| observability | metrics/logs/traces | local bounded or external | must not become core dependency |

## 11. Database contract

PostgreSQL остаётся source of truth.

C3000 requirements:
- PgBouncer/equivalent connection pooler before multiple API replicas;
- request-scoped tenant context remains fail-closed;
- slow-query logging/analysis;
- indexes proven from real query plans;
- no unbounded list/query in a request path;
- no blind `max_connections`/pool enlargement as a repair;
- background/report reads must not starve classroom writes;
- hot audit/event/history tables require retention/partition strategy when measured growth demands it;
- DB backups + PITR/restore test.

Starting point for C3000 benchmark:
- API-side pool ≈10 per replica, because current evidence favors a bounded pool;
- 3 API replicas → approximately 30 client-side slots before PgBouncer;
- actual PgBouncer/PostgreSQL server-pool size is selected from benchmark, not guessed.

## 12. Object storage contract

Object storage stores binary/user media; PostgreSQL stores authority/metadata.

Requirements:
- content-addressed/immutable objects where possible;
- deduplication by digest where semantics allow;
- asset GET must not reload an entire mutable project merely to authorize immutable bytes if request-scoped authority can safely prove access;
- streaming upload/download; no whole-file buffering beyond bounded validation needs;
- object-store latency and DB operations/request must be measured separately;
- lifecycle/retention/quota by tenant/module;
- backup/replication policy independent from DB but tied to one recovery set.

## 13. Realtime contract

Realtime is notification/invalidation, not a second source of truth.

For C3000:
- ≥3 000 simultaneous logical connections supported when the module uses realtime;
- reconnect backoff+jitter;
- room/class/project fanout, not global broadcast;
- clients recover from missed realtime event by checking canonical revision;
- no permanent session state exists only in a gateway process.

## 14. Games architecture

### 14.1. Local/single-player games

Game loop, graphics and deterministic local simulation execute in the browser.

Server handles:
- identity;
- save/progress;
- achievements/results;
- classroom assignment;
- optional leaderboard/audit.

### 14.2. Multiplayer/classroom games

Do not run authoritative game ticks inside the generic API.

Future services:

```text
game-gateway
   |
game-runtime workers
   |
room/class partition
   |
durable snapshots/results -> PostgreSQL
```

At C3000 the planning model is up to 100 simultaneous 30-user classroom rooms. A room failure must not affect unrelated rooms.

## 15. 3D architecture

Interactive viewport, camera, transforms and ordinary modelling remain client-side (WebGL/WebGPU/WASM where appropriate).

Heavy server work — mesh repair, large import conversion, export, rendering, slicing or compute-expensive geometry that cannot safely run client-side — becomes an asynchronous job:

```text
API -> queue -> 3d-worker -> object storage -> result notification
```

Generic API request MUST NOT synchronously spend seconds/minutes on 3D CPU work.

## 16. AI architecture

AI is a separate compute plane. **C3000 core acceptance must pass even when AI workers are saturated or unavailable.**

```text
Core API
  |
ai-gateway / admission
  |
durable job + fair queue
  |
  +-- ai-text-worker(s)  -> GPU host(s) / external provider
  +-- ai-image-worker(s) -> GPU host(s) / external provider
  +-- embeddings/other worker
  |
result metadata -> PostgreSQL
large output -> object storage
```

Rules:
- no image/text inference in the generic API process;
- no GPU model load in core Web/API/PostgreSQL containers;
- request admission is fast and bounded;
- user sees queued/running/failed/completed state;
- per-tenant/user quotas and fair scheduling;
- cancellation and timeout are explicit;
- AI provider/GPU failure does not log users out and does not break project saving;
- AI concurrency is benchmark-derived per model/GPU, not hard-coded from a guessed global number;
- 3 000 users may use the platform while only a bounded subset has AI jobs running concurrently.

### 16.1. Optional example AI worker class

Этот профиль применяется **только если отдельная задача вводит локальный AI worker**. Он не является minimum requirement ASA Lab, DEV-MIN или C3000 Core и не требует сейчас покупать/поднимать GPU-инфраструктуру.

Possible starting worker node, separate from the C3000 core host:
- 16 CPU cores;
- 64 GB RAM;
- ≥2 TB NVMe model/cache/workspace;
- GPU with **≥24 GB VRAM** for a practical local worker class;
- 48–80 GB VRAM class for larger models where required;
- 2.5 GbE minimum to core LAN, 10 GbE preferred for large model/media workflows.

This is a worker reference, not a promise of tokens/s or images/minute; throughput depends on the selected model and must be benchmarked separately.

## 17. Background jobs and queue

Any operation whose normal P95 cannot fit the synchronous API budget SHOULD become a job.

Examples:
- autograder;
- compile;
- export;
- report generation;
- large archive;
- video processing;
- server render;
- AI generation.

Requirements:
- idempotent job identity;
- bounded attempts/backoff;
- per-resource class queue;
- oldest-job-age metric;
- tenant fairness;
- cancellation where safe;
- durable outcome;
- worker outage for 15 minutes must recover without duplicate destructive effects.

## 18. Observability required for capacity

Every C3000 evidence run records:
- exact Git SHA/release identity;
- hardware/OS/Docker versions;
- active CCU and module mix;
- RPS p50/p95/p99;
- endpoint latency p50/p95/p99;
- CPU/RAM/event-loop;
- DB active/idle/waiting connections;
- DB pool wait/timeouts;
- top slow queries/query count per request;
- save rate and bytes;
- object-store GET/PUT latency/throughput;
- ingress/tunnel connection pressure;
- static cold/warm bytes/user;
- cache hit/revalidation;
- retry/reconnect rate;
- queue depth/oldest age;
- unexpected logout;
- project loss/conflict/error class.

A PASS without this evidence is invalid.

## 19. Failure injection

C3000 acceptance includes controlled:
- loss/restart of one API replica;
- Redis restart;
- realtime gateway restart;
- 2 s object-store latency;
- worker pool outage;
- transient DB dependency error/failover drill where topology supports it;
- temporary external AI/provider failure;
- weak network/reconnect storm.

Failure of AI, realtime or a worker MUST NOT invalidate an already authenticated user's durable project state.

## 20. RPO/RTO

| Profile | RPO | RTO |
|---|---:|---:|
| local/school pilot | ≤24 h disaster; ≤15 min where PITR is configured | ≤8 h |
| C3000 production | ≤5 min core metadata target | ≤2 h |
| future distributed/regional | ≤1 min metadata; object replication separately | ≤60 min |

After the UI reports a durable server save as successful, losing one API/worker process must not lose that confirmed version.

## 21. When single-host topology is exhausted

Do **not** move to distributed infrastructure merely because one synthetic test looks high.

Split the topology when C3000 cannot retain safety headroom after application/query/cache fixes, or when one of these persists:
- CPU >70% steady;
- RAM >75% steady;
- DB pool waits/timeouts violate C3000;
- storage latency/IO contention violates SLO;
- public/internal network >60% sustained;
- object storage competes materially with PostgreSQL;
- T5000 cannot run as stress without cascading failure;
- availability requirements exceed one-host failure domain.

Recommended split order:
1. AI compute plane is already separate;
2. external/edge static delivery if needed;
3. object storage/backup separation;
4. PostgreSQL to dedicated host with PgBouncer and replica strategy;
5. stateless API/realtime nodes behind a load balancer;
6. distributed worker pools;
7. tenant placement/sharding only after measurement requires it.

## 22. Future 10k+ topology

```text
                    Load balancer / edge
                           |
             +-------------+-------------+
             |             |             |
           API-1         API-2         API-N
             |             |             |
             +------ Redis/shared control ------+
                           |
                       PgBouncer
                           |
                 PostgreSQL primary
                    /             \
              read replica     read replica

        realtime cluster      worker pools
                 \             /
                  durable queues
                        |
                object storage cluster

               separate AI GPU fleet
```

10 000+ CCU is a different deployment tier, not a reason to complicate C3000 prematurely.

## 23. Capacity exit gates

C3000 is accepted only when:
1. CLASS-30 and C500 prerequisites pass;
2. C3000 profile passes at applicable SLO;
3. S4500 surge produces no project loss/logout/outage cascade;
4. T5000 stress result is recorded even if it defines the current ceiling;
5. backup restore is verified;
6. no cross-tenant authorization incident exists;
7. reconnect/retry is bounded;
8. DB pool timeout is zero at C3000;
9. warm static traffic proves cache reuse;
10. cost and storage growth per active/registered user are measured;
11. AI/worker saturation does not degrade the core plane beyond SLO;
12. exact evidence is attached to the exact tested SHA.

## 24. Superseded capacity target

The historical **P1500 / 1 500 CCU** target is superseded by this owner decision.

New canonical sequence:

```text
CLASS-30
  -> C500
  -> C3000  (normal design/operation)
  -> S4500  (surge)
  -> T5000  (stress ceiling)
  -> 10k+ distributed tier
```

Issue #477 remains the platform capacity acceptance issue and is redefined for C3000/S4500/T5000.
