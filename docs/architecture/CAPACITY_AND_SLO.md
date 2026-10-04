# ASA Lab C3000 — технический capacity-контракт продукта

**Статус:** owner architecture contract.  
**Owner decision:** 2026-10-04.  
**Scope:** текущий ASA Lab: Identity, Project Core, Learning, Scratch/Blocks, Electronics, 3D, Games, Web/API/PostgreSQL/Object Storage и transport/ingress.  
**Issue:** #477.

Этот документ отвечает на вопрос:

> Как должен быть устроен и вести себя ASA Lab, чтобы одна и та же продуктовая архитектура оставалась устойчивой при **C3000 = 3 000 одновременно активных пользователях**.

Это **не** требование запускать 3 000 браузеров при каждой разработческой задаче и **не** разрешение заранее добавлять Redis, PgBouncer, API replicas, realtime cluster или workers.

Обычная разработка проверяет конкретную функцию на одном пользователе/браузере и focused tests. C3000 задаёт правила кода и runtime: разработчик обязан понимать, во что превращается per-user операция при 3 000 активных пользователях.

---

## 1. Capacity-профили

| Профиль | Назначение | Пользователи |
|---|---|---:|
| DEV | обычная разработка и визуальная проверка | 1 |
| CLASS-30 | реальный школьный класс | 30 |
| **C3000** | нормальная целевая ёмкость ASA Lab | **3 000 active CCU** |

**Active user** — независимая authenticated Account или StudentSeat session, которая реально работает: открывает Learning/Project/module surface, редактирует, сохраняет, отправляет работу, получает данные или выполняет другой поддерживаемый product flow.

Idle tab сам по себе не считается доказательством C3000.

Школьная модель для понимания масштаба:

```text
100 классов × 30 активных пользователей = 3 000 CCU
```

C3000 относится ко **всей платформе**, а не только к Scratch или Electronics.

---

## 2. Текущая базовая topology

Каноническая отправная точка — текущая простая установка, а не придуманная будущая распределённая система.

```text
Browser
   |
   v
Web / Caddy
   |--------------------> static Web assets
   |--------------------> /internal/blocks/* -> Scratch static runtime
   |
   +---- /api/* --------> API
                           |                            |  ----> MinIO / object storage
                           |
                           +-------> PostgreSQL
```

Текущий root Compose содержит:

| Service | Статус | Роль |
|---|---|---|
| `web` / Caddy | ACTIVE | ingress, static, compression, cache, proxy |
| `api` | ACTIVE | identity, authorization, Project/Learning/Classroom API |
| `postgres` | ACTIVE | canonical relational/source-of-truth state |
| `minio` | ACTIVE | binary/user asset storage |
| `scratch` | ACTIVE | статическая доставка embedded Scratch runtime |
| `migration` | ONE-SHOT | миграции до обычного API runtime |
| `minio-init` | ONE-SHOT | создание/проверка object bucket |

В repository также существуют foundation surfaces:

| Surface | Текущий статус |
|---|---|
| `realtime-gateway` | FOUNDATION, `ready: false` |
| `job-dispatcher` | FOUNDATION, `ready: false` |
| `worker-runtime` | FOUNDATION, `ready: false` |
| `@asa-lab/eventing` | FOUNDATION, `stable: false` |

**FOUNDATION не означает runtime dependency.** Эти компоненты не должны подключаться к текущему C3000 runtime только потому, что они существуют в monorepo.

---

## 3. Контракт ответственности контейнеров

| Компонент | Должен делать | Не должен делать |
|---|---|---|
| Web/Caddy | единая browser entry point, static, compression, cache, proxy | business logic, tenant authorization |
| API | auth, authorization, Project/Learning/Classroom commands/queries, durable coordination | browser frame/tick/simulation loops |
| PostgreSQL | source of truth, RLS/tenant data, projects, sessions, learning metadata | public Internet service |
| MinIO | binary/media/assets | быть источником authorization или tenant truth |
| Scratch | отдавать embedded runtime/static | исполнять Scratch VM за пользователей |
| Migration | применить schema transition и завершиться | жить как постоянный service |
| MinIO init | подготовить bucket и завершиться | жить как постоянный service |

Пользовательские данные не должны зависеть от replaceable filesystem Web/API/Scratch containers.

---

## 4. Docker network и ingress boundaries

Текущие логические сети сохраняют разделение ответственности:

| Network | Участники / смысл |
|---|---|
| `application` | Web/API/MinIO application path |
| `database` | API/Migration/PostgreSQL; internal network |
| `scratch-runtime` | Web/Scratch embedded runtime path |

Нормальный product path:

```text
Browser -> Web/Caddy -> API -> PostgreSQL/MinIO
```

Правила:

- PostgreSQL MUST NOT публиковаться в Internet/LAN как пользовательский endpoint.
- API в обычном production path находится за Web/Caddy ingress.
- Embedded Scratch использует основной ASA browser origin через `/internal/blocks/*`.
- Installation-specific IP/domain/port остаются deployment state и не вшиваются в application logic.
- Capacity repair MUST NOT обходить origin, capability, principal, tenant или RLS boundaries.

Полная portability/update/backup semantics определяются
`docs/architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md`.

---

## 5. Local-first execution

Главный способ выдерживать C3000 — не переносить пользовательский compute loop на Core.

Нормально выполняются в браузере, когда это безопасно и соответствует модулю:

- Scratch VM/runtime/rendering;
- Electronics simulation/solver;
- 3D viewport и обычная интерактивная геометрия;
- game rendering и обычный local game loop;
- drag/move/wire/edit UI;
- undo/redo;
- fast local recovery.

Core server обслуживает значимые редкие события:

- identity/session;
- authorization;
- initial project/module load;
- durable project save;
- explicit ProjectVersion/checkpoint;
- Learning/Classroom/Assignment/Submission;
- user assets;
- publication/preview authority;
- audit/metadata.

Запрещённый масштабируемый паттерн:

```text
каждый frame / VM step / mouse move
-> HTTP/API
-> PostgreSQL
```

---

## 6. Центральное правило amplification

Для любой периодической или автоматически повторяемой операции:

```text
aggregate_rate = per_user_rate × 3000
```

| Per-user cadence | Aggregate at C3000 |
|---:|---:|
| 1 request / 1 s | 3 000 RPS |
| 1 request / 3 s | 1 000 RPS |
| 1 request / 10 s | 300 RPS |
| 1 request / 30 s | 100 RPS |
| 1 request / 60 s | 50 RPS |

Перед принятием polling, autosave, refresh, retry, asset fetch, dashboard refresh или background work разработчик обязан сделать этот расчёт.

### 6.1. Full-resource polling

Периодический full `openProject`, полный draft JSON или project history не используются как steady-state change detector.

Текущий Electronics path `openProject()` каждые 3 секунды является известным C3000 blocker:

```text
3000 / 3 s = 1000 full project loads/s
```

Current Project load включает project-context lookup, tenant transaction, current draft и version list. Такой путь нельзя использовать как background heartbeat.

Для change detection применяются, по возрастающей сложности:

1. отсутствие polling, если collaboration не требуется;
2. lightweight revision/ETag endpoint;
3. conditional request;
4. event-driven invalidation/realtime — только когда реальная функция этого требует.

Для fallback metadata polling нормальная проектная граница — не чаще порядка **1 раза в 30 s на active editor**, то есть около **100 lightweight checks/s** при C3000. Более частая cadence требует измеренного обоснования и не может загружать полный Project/Draft/Versions.

---

## 7. Project / Draft / Version contract

ASA Lab сохраняет существующую модель:

```text
Project
  |
  +-- mutable current ProjectDraft
  |
  +-- immutable ProjectVersion / checkpoint
```

Правила:

- editor interaction выполняется локально;
- autosave обновляет current Draft;
- immutable Version создаётся явным product action/contract, а не каждым editor event;
- acknowledged durable save нельзя silently потерять;
- revision conflict нельзя silently overwrite;
- background sync не загружает Version history;
- Version list/history SHOULD загружаться отдельно/lazily там, где UI не требует её при initial open;
- save/retry использует idempotency/revision semantics существующего Project Core.

---

## 8. Autosave и save-wave

Scratch и Electronics используют minute-scale remote persistence по своим module contracts.

Если все 3 000 active editors dirty:

```text
3000 / 60 s = 50 remote saves/s average
```

Контракт:

- не более одного remote save in flight на editor;
- более новое изменение не теряется из-за save in flight;
- continuous editing не откладывает durable save бесконечно;
- unchanged state не создаёт бессмысленный durable churn, если module contract умеет его определить;
- client phases/retries распределяются, чтобы 3 000 editors не создавали синхронную save wave;
- controlled exit делает safety/durable action по module contract;
- forced browser/process loss защищается local recovery, а не ложным обещанием HTTP I/O после уничтожения процесса.

---

## 9. Identity, Account, StudentSeat и school NAT

Account и StudentSeat — разные principal/session модели и не объединяются ради производительности.

Обязательные свойства:

- transient network/API/5xx != logout;
- StudentSeat transient failure не переводится автоматически в anonymous;
- generic Account refresh не запускается только потому, что StudentSeat использовал общий Project API path;
- definitive revoke/invalid credential остаётся fail-closed;
- authorization выполняется server-side;
- C3000 repair не ослабляет password/session/capability/origin checks.

### 9.1. NAT-aware rate limits

Школа может иметь десятки/сотни устройств за одним внешним IP. Поэтому нормальный класс не должен блокироваться только из-за shared NAT.

Current account-login budget содержит per-address ceiling `120 / 5 min`; current generic mutation protection также содержит per-address state. Эти механизмы являются **обязательным C3000 audit item** для school-NAT flows.

Rate limit должен различать:

- brute-force/abuse;
- ошибочные credentials;
- успешные независимые school sessions;
- authenticated session identity;
- shared NAT address.

Увеличение лимита без threat-model review не является автоматическим решением.

---

## 10. PostgreSQL contract

PostgreSQL остаётся source of truth для identity, tenant state, Project/Learning/Classroom authority и durable metadata.

### 10.1. Tenant/RLS

Ни одна оптимизация не имеет права:

- обходить tenant boundary;
- снимать RLS;
- доверять tenant/principal из UI без server verification;
- заменять server authorization client-side решением.

Current tenant access использует transaction-scoped `SET LOCAL app.tenant_id`. DB transaction должна быть короткой:

```text
pool.acquire
-> BEGIN
-> SET LOCAL tenant
-> bounded SQL
-> COMMIT
-> pool.release
```

Внутри DB transaction не выполняются долгие network/AI/render/user waits.

### 10.2. Connection pool

Current API default:

```text
ASA_DB_POOL_MAX = 10
```

Это измеренная отправная точка: repository evidence указывает, что pool 50 ухудшал tail latency из-за переноса contention в PostgreSQL.

Следовательно:

- 10 остаётся baseline до нового benchmark;
- pool/max_connections не увеличиваются вслепую;
- сначала уменьшаются query count, query duration и transaction hold time;
- PgBouncer вводится только после доказанной connection-pressure необходимости.

Для pool=10 связь throughput/hold-time:

| Average connection hold | Approx transaction capacity |
|---:|---:|
| 100 ms | 100/s |
| 50 ms | 200/s |
| 33 ms | ~300/s |
| 20 ms | 500/s |
| 10 ms | 1000/s |

Это planning math, а не обещание реального endpoint throughput.

---

## 11. API и authentication throughput

Существующий performance budget уже задаёт:

```text
login throughput floor >= 60 successful logins/s
```

Measured evidence от 2026-08-16: 159 logins/s на 16-core Windows host, client on same host.

Для lesson-start модели:

```text
3000 users / 120 s = 25 successful logins/s
```

Следовательно CPU/hash throughput текущего measured path имеет запас относительно 25/s, но C3000 acceptance обязана отдельно проверить school-NAT limiter semantics и реальный mix Account/StudentSeat/existing-session/refresh.

Новый API endpoint не должен вводить постоянный тяжёлый O(CCU) background path.

---

## 12. Object storage

MinIO/Object Storage хранит binary/user media, но authorization/tenant/project authority остаётся в API/PostgreSQL.

Правила:

- большие payload передаются streaming/bounded buffering;
- unchanged asset bytes не должны бесконечно дублироваться;
- asset authority path не должен без необходимости загружать полный Project/Version history;
- временный MinIO failure не превращается в logout;
- уже загруженный client runtime продолжает доступную local работу;
- операция, которой реально нужен asset store, возвращает recoverable failure и сохраняет local unsaved work.

Storage capacity рассчитывается по реальным user/project/media/retention данным, а не по CCU.

---

## 13. Static delivery: cold и warm

Caddy уже разделяет cache semantics:

- content-hashed static → long-lived immutable cache;
- entry HTML → revalidate/no-cache;
- runtime config → no-store;
- private API/project data → никогда public immutable.

Existing Web performance evidence показывает built SPA transfer около 98 KB.

Для 3 000 cold portal shells:

```text
98 KB × 3000 ≈ 294 MB
294 MB / 120 s ≈ 20 Mbit/s
```

Это не включает тяжёлые Scratch/3D/vendor/library assets. Для них C3000 требует:

- versioned immutable delivery;
- browser cache reuse на warm reopen;
- lazy/on-demand media где это имеет смысл;
- отсутствие повторной тяжёлой origin delivery каждый урок.

Нельзя компенсировать плохое кеширование только увеличением uplink.

---

## 14. Retry, reconnect и degraded operation

Retryable transient failures используют bounded backoff и jitter. Hard auth/revoke/integrity/conflict errors не retry бесконечно.

Цель degraded behavior:

| Temporary failure | Ожидаемое поведение |
|---|---|
| Internet/API | уже загруженный local editor/runtime продолжает возможную local работу |
| save endpoint | newest unsaved work остаётся локально и получает явный unsaved/error state |
| MinIO | asset-dependent operation recoverable; session/project authority не исчезает |
| Scratch static origin после bootstrap | уже загруженный VM продолжает local execution |
| transient session check | не превращает valid local state в массовый logout |
| recovery | reconnect распределён, без thundering herd |

Project loss после server-acknowledged save и cross-tenant authorization incident не являются допустимым capacity trade-off.

---

## 15. Health, readiness, restart

Container running state и HTTP 200 не равны product acceptance.

Семантика:

- **live** — процесс существует и может обслуживать lifecycle;
- **ready** — сервис способен выполнять обязательный пользовательский путь с необходимыми dependencies.

Core runtime обязан:

- переживать restart replaceable Web/API/Scratch containers без потери durable user data;
- хранить durable state только в declared persistent stores;
- не считать one-shot Migration/MinIO-init постоянными сервисами;
- не принимать mixed incompatible release/schema installation как нормальное состояние.

Подробный lifecycle/update/backup contract остаётся в Portable Self-Hosted Deployment Standard и не дублируется здесь.

---

## 16. Learning и mixed workload

C3000 — platform target. Нагрузка включает не только редакторы:

- Account/StudentSeat identity;
- Home/Projects;
- Courses/Learning;
- Activities/Assignments;
- Attempts/Submissions;
- teacher roster/review;
- Scratch;
- Electronics;
- 3D;
- Games;
- supported publication/project flows.

Не фиксируется искусственный вечный процент каждого модуля. Acceptance записывает фактический mix и включает:

1. mixed platform profile;
2. class-local 30-user synchronized actions;
3. module-heavy profiles для модулей, которые реально могут занять большую долю C3000.

Browser-local compute не переносится на API только ради удобства synthetic test.

---

## 17. Product SLO

Сохраняются текущие школьные product targets:

| Indicator | Target |
|---|---:|
| Availability during agreed lesson hours | ≥ 99.9% |
| Monthly overall availability | ≥ 99.5% |
| API read P95 | ≤ 400 ms |
| API write P95 | ≤ 700 ms |
| Login P95 | ≤ 2 s |
| Project metadata save P95 | ≤ 700 ms |
| Durable checkpoint P95, typical project | ≤ 1.5 s |
| Save error rate | < 0.1% |
| Cross-tenant authorization incidents | 0 accepted |

Эти SLO не доказываются характеристиками hardware; они проверяются реальными journeys/measurements.

---

## 18. Observability для C3000

Capacity evidence должно позволять ответить, где находится bottleneck: browser, transport, ingress, API, DB или object storage.

Минимальный набор:

- exact source/release SHA;
- active sessions и workload/module mix;
- endpoint RPS;
- p50/p95/p99 latency;
- HTTP status/failure class;
- API event-loop lag;
- host/container CPU/RAM;
- DB pool active/idle/wait/timeouts;
- slow query/query count;
- save rate и save bytes;
- object-store GET/PUT/latency/bytes;
- cold/warm static bytes;
- cache behavior;
- transport/tunnel connection pressure/rejections;
- retry/reconnect rate;
- unexpected logout;
- acknowledged-save loss;
- container restart.

Логи/метрики должны оставаться privacy-safe и не публиковать credentials, student secrets или project content.

---

## 19. Acceptance — реальные product journeys

Обычная feature development не запускает C3000. Один пользователь/браузер и focused tests остаются нормальным dev workflow.

Отдельная capacity acceptance может использовать synthetic session/API load плюс representative browser journeys. Для PASS недостаточно 3 000 idle tabs или одного `/health` endpoint.

Обязательные product journeys:

### Account
```text
login -> Home/Projects -> open -> edit -> durable save -> reopen
```

### StudentSeat
```text
class/student admission -> assignment/project -> edit -> save -> reopen/continue
```

### Learning
```text
teacher assignment -> learner work/submit -> teacher review
```

### Scratch
```text
bootstrap -> local execution -> local recovery -> minute durable save -> warm reopen
```

### Electronics
```text
open -> local edit/simulation -> save/revision -> reopen
```

### Degraded path
```text
temporary dependency/network fault
-> no mass logout
-> no acknowledged-project loss
-> bounded recovery
```

Load testing рабочего школьного сервиса без отдельного owner authorization запрещено.

---

## 20. Scaling decision table

C3000 не является разрешением заранее усложнять topology.

| Доказанная проблема | Сначала | Следующий шаг только если проблема остаётся |
|---|---|---|
| тяжёлый polling | убрать full-resource polling | realtime/event invalidation |
| API CPU/event-loop | hotspot/query/payload optimization | дополнительные API instances |
| DB pool wait | уменьшить SQL/transaction hold | PgBouncer/pool topology |
| shared rate-limit state нужен между API | определить semantics | Redis/другое shared store |
| static/asset origin saturation | immutable cache/lazy bytes | CDN/edge |
| DB/MinIO I/O contention | query/media optimization | разделение storage/DB hosts |
| тяжёлая async операция реально появилась | вынести из sync request | dispatcher/worker runtime |
| collaboration требует push | lightweight revision сначала | realtime gateway |

Перед multi-API deployment нужно устранить assumption, что scale-critical limiter/shared state может жить только в памяти одного API процесса.

---

## 21. Known C3000 audit items текущего продукта

На момент owner decision известны как минимум:

1. **Electronics full `openProject()` каждые 3 s** — unacceptable steady C3000 amplification.
2. **Account login per-address limiter 120/5 min** — проверить/исправить для корректных school-NAT массовых входов без ослабления brute-force защиты.
3. **Generic per-address mutation limiter** — проверить classroom NAT semantics для поддерживаемых authenticated mutations.
4. **Per-process rate-limit state** — не позволяет считать будущие API replicas drop-in scale-out.
5. **Project open загружает current draft и full version list** — background sync не имеет права использовать этот тяжёлый path.
6. **Transport/FRP saturation уже наблюдалась в школьном инциденте** — capacity измеряет весь ingress path, а не только CPU API.
7. **Foundation realtime/worker/eventing surfaces не ready/stable** — не использовать их как будто production capacity уже на них основана.

Этот список задаёт работу для отдельных bounded issues. Он не разрешает broad rewrite.

---

## 22. Reference hardware и DEV floor

Железо — последний слой, а не архитектура.

### 22.1. DEV

Обычная разработка/ручная проверка:

| Resource | DEV baseline |
|---|---:|
| CPU | **2 cores** |
| RAM | **4 GB** |
| User/browser | **1** |
| GPU | не требуется для обычной Core-разработки |

Более слабая машина не запрещает coding/review; тяжёлые build/browser/full-repo gates могут выполняться CI.

GitHub repository metadata на момент решения — около **220 MB**. Это не равно полному dev disk footprint: package cache, Docker images, Playwright browsers и volumes могут занимать существенно больше. Жёсткий disk minimum не объявляется без измерения install footprint.

### 22.2. First C3000 reference host

Цель — доказать C3000 сначала на разумном single-host baseline, а не скрывать amplification большим сервером:

| Resource | Initial C3000 reference |
|---|---:|
| CPU | **8 modern performance cores / 16 threads** |
| RAM | **32 GB** |
| Storage | **NVMe/fast SSD** |
| Network | **1 Gbit/s symmetric** для installation/origin path, если deployment публикуется через него |
| API | **1 current API instance сначала** |
| PostgreSQL | **1 current primary** |
| DB pool | **10 starting default** |
| MinIO | **1 current instance** |
| Redis/PgBouncer/realtime/workers | не обязательны без измеренной причины |

Это **reference provisioning target**, а не утверждение, что текущий SHA уже прошёл C3000.

Правило принятия:

> если C3000 не проходит на этом baseline, сначала находится и исправляется bottleneck/amplification. Hardware/topology увеличиваются только после доказательства, что проблема не является ошибкой application/data path.

Если более слабая машина доказанно проходит C3000 product journeys/SLO — это основание снизить reference hardware.

---

## 23. Краткий owner contract

```text
TARGET
3000 simultaneous active users

CURRENT CORE
Web/Caddy + API + PostgreSQL + MinIO + Scratch static runtime

DEVELOPMENT
1 user; 2 CPU / 4 GB is a normal baseline

COMPUTE
interactive editor/simulation/game/3D work stays local-first

NETWORK
one public ASA entry; internal services remain isolated

PERSISTENCE
Project/Draft/Version semantics; acknowledged save is durable

AUTOSAVE
minute-scale; ~50 saves/s average at 3000 dirty editors

SYNC
no steady full-project polling; lightweight revision/event invalidation

DATABASE
tenant/RLS preserved; short transactions; pool 10 until benchmark proves otherwise

STATIC
versioned immutable cache; warm reopen must not redownload heavy vendor bytes

IDENTITY
Account != StudentSeat; transient failure != logout; school NAT must work

FAILURE
bounded retry/backoff/jitter; no mass logout/project loss

SCALING
fix measured amplification first; add infrastructure only for a proven need

REFERENCE C3000 HOST
8 modern cores / 32 GB / NVMe / 1 Gbit/s

PASS
real product journeys + metrics on an identified release/profile, not idle tabs or hardware specs
```
