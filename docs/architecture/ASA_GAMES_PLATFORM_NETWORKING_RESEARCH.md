# ASA Games Platform — Networking and Industry Research

**Status:** Draft research record  
**Research date:** 2026-09-13  
**Purpose:** проверить целевую архитектуру ASA Games Platform по публичным практикам multiplayer/game-backend систем до реализации.

## 1. Method

Исследование использует официальную документацию и технические материалы систем, решающих разные части multiplayer stack:

- Nakama — authoritative multiplayer, turn-based, lobby/matchmaking;
- Colyseus — authoritative rooms и state synchronization;
- Agones — lifecycle/allocation dedicated game servers;
- Amazon GameLift FlexMatch — matchmaking + game session placement;
- PlayFab Multiplayer — lobby/party/matchmaking/server allocation;
- Open Match — customizable ticket/pool/match-function architecture;
- PostgreSQL — LISTEN/NOTIFY semantics;
- AWS Prescriptive Guidance — transactional outbox;
- OWASP — WebSocket security;
- MDN — WebSocket/WebTransport transport properties;
- Microsoft Research TrueSkill — skill/rating for multi-player/team games;
- Gaffer on Games / Gabriel Gambetta / Valve — realtime client/server prediction, reconciliation, interpolation and lag compensation.

Мы не копируем одну платформу целиком. Цель — найти повторяющиеся границы и проверить, какие из них подходят ASA Lab.

## 2. Server-authoritative multiplayer is the common baseline

### Nakama

Source: https://heroiclabs.com/docs/nakama/concepts/multiplayer/authoritative/

Nakama разделяет relayed и server-authoritative multiplayer. В authoritative model gameplay data проверяется сервером, а custom match logic владеет правилами, состоянием, join policy и завершением матча.

Документация явно различает:

- fast-paced realtime authoritative multiplayer;
- active turn-based;
- passive turn-based;
- session-based/headless game instances.

Это подтверждает ключевое решение ASA: одна игровая платформа может обслуживать разные классы игр, но execution model не обязан быть одинаковым.

Nakama также использует фиксированный tick rate для authoritative loop и держит match state в памяти. Рекомендуется выбирать минимально достаточный tick rate и не допускать, чтобы loop занимал дольше tick budget.

Source: https://heroiclabs.com/docs/nakama/server-framework/introduction/best-practices/

Nakama отдельно рекомендует не выполнять blocking database I/O внутри высокочастотного authoritative match loop: state следует держать в памяти и persist делать в конце/крупными интервалами при необходимости.

**ASA conclusion:** realtime-room state не должен писать PostgreSQL каждый tick. Command games, наоборот, могут делать durable transaction на каждый значимый command.

## 3. Authoritative room + delta state synchronization

### Colyseus

Source: https://docs.colyseus.io/

Colyseus строится вокруг authoritative Rooms: server owns room state, clients send messages/requests, а server-side state синхронизируется клиентам.

Source: https://github.com/colyseus/docs/blob/master/pages/concepts.mdx

Colyseus различает continuous State Synchronization и discrete Messages. State используется как shared reality, а клиентам отправляются изменения/deltas. Это подтверждает отдельный transport model для realtime rooms: не каждое изменение обязано быть durable event, и не каждое событие является полным snapshot.

**ASA conclusion:** Room Runtime Protocol должен иметь snapshot/delta слой и отдельные reliable game events/control messages.

## 4. Matchmaking and server placement are different problems

Это один из наиболее устойчивых паттернов во внешних системах.

### Amazon GameLift FlexMatch

Source: https://docs.aws.amazon.com/gameliftservers/latest/flexmatchguide/gamelift-match-howitworks.html

FlexMatch сначала формирует match из tickets. После успешного match результат передаётся в game session placement. Если используется другое hosting решение, match data передаётся пользовательскому placement component.

Source: https://docs.aws.amazon.com/gameliftservers/latest/flexmatchguide/matchmaker-build.html

Matchmaker группирует игроков; hosting queue затем ищет ресурсы и запускает game session.

### PlayFab Multiplayer Servers

Source: https://learn.microsoft.com/en-us/gaming/playfab/multiplayer/matchmaking/multiplayer-servers

PlayFab также позволяет matchmaking автоматически запрашивать multiplayer server allocation, причём сервер получает members сформированного match как initial players.

### Agones

Source: https://agones.dev/site/docs/reference/gameserverallocation/

`GameServerAllocation` атомарно выбирает подходящий Ready GameServer и переводит его в `Allocated`.

Source: https://performance.agones.dev/site/docs/integration-patterns/allocation-from-fleet/

Документация прямо описывает preferred flow: внешний matchmaker запрашивает allocation из Fleet.

**ASA conclusion:** `Matchmaker` и `GameRoomAllocator` — разные contracts. Command game может после match сразу создать durable `GameMatch`. Realtime game после match должен пройти placement/allocation.

## 5. Matchmaking tickets and custom match logic

### Open Match

Source: https://openmatch.dev/site/docs/guides/matchmaker/matchfunction/

Open Match использует Tickets, Pools, MatchProfile и user-defined Match Function. Match Function получает profile, выбирает tickets из pools и формирует match proposals.

Source: https://openmatch.dev/site/docs/

Open Match позиционируется как framework для собственного matchmaker, а не как готовая игровая логика.

### Nakama Matchmaker

Source: https://heroiclabs.com/docs/nakama/concepts/multiplayer/matchmaker/

Клиент добавляет ticket в pool; система периодически сравнивает tickets по критериям и player counts; unmatched tickets остаются ждать следующего pass.

**ASA conclusion:** generic ticket должен содержать platform fields (`gameKey`, version compatibility, party size, topology, scope, skill estimate, region/latency metadata), а конкретная игра/режим может добавлять match policy. Не следует кодировать шахматный `colorPreference` или checkers-specific параметры в generic matcher schema.

## 6. Dedicated game server allocation should be optional, not baseline

### Agones

Source: https://agones.dev/site/docs/

Agones предназначен для hosting/running/scaling dedicated game servers на Kubernetes. Fleet — набор warm servers; Allocation выбирает и закрепляет конкретный server.

Это полезная модель для будущего ASA scale-out, но не означает, что ASA должен внедрять Kubernetes/Agones для первых двух board games.

**ASA conclusion:** внутренний `GameRoomAllocator` contract нужен с первого realtime-room design, но v1 implementation может выбирать единственный local runtime. Agones может позже стать одним из allocator adapters.

## 7. Browser transport: WebSocket now, WebTransport-ready later

### WebSocket

Source: https://developer.mozilla.org/en-US/docs/Web/API/WebSocket

WebSocket широко поддерживается браузерами и даёт двустороннее соединение, но классический WebSocket API не предоставляет встроенного backpressure. При входящем потоке быстрее обработки приложение может накопить память/CPU load.

**ASA implications:**

- bounded outbound/inbound queues;
- max payload;
- per-connection rate limits;
- drop/coalesce policy для non-critical realtime updates;
- monitoring buffered amount/backpressure;
- slow-consumer disconnect/resync strategy.

### WebTransport

Source: https://developer.mozilla.org/en-US/docs/Web/API/WebTransport_API

WebTransport поверх HTTP/3 предлагает bidirectional/unidirectional streams и unreliable datagrams. MDN отмечает его как Baseline 2026 для современных браузеров, но часть API всё ещё имеет неодинаковую поддержку/экспериментальные детали.

Datagrams особенно подходят для frequent game-state updates, где новый пакет заменяет старый и delivery/order не обязательны.

**ASA decision:** WebSocket — baseline transport. Room protocol проектируется transport-neutral. WebTransport adapter оценивается после ASA Arena Mini и browser/deployment compatibility tests; он не блокирует v1.

## 8. Realtime netcode: authority alone does not guarantee pleasant gameplay

### Gabriel Gambetta

Source: https://www.gabrielgambetta.com/client-side-prediction-server-reconciliation.html

Authoritative server без prediction создаёт заметный input latency. Client-side prediction немедленно применяет ожидаемый локальный input, затем server reconciliation корректирует состояние по authoritative snapshot и неприменённым input sequence.

Source: https://www.gabrielgambetta.com/entity-interpolation.html

Для других игроков используется interpolation: remote entities отображаются немного в прошлом, но движение становится плавным.

Source: https://gabrielgambetta.com/lag-compensation.html

Для time-sensitive действий (например, shooter hit) авторитетный сервер может использовать lag compensation/rewind policy.

### Gaffer on Games

Source: https://gafferongames.com/post/snapshot_interpolation/

Snapshot interpolation буферизует authoritative snapshots и интерполирует между ними, обменивая небольшую дополнительную задержку на визуальную плавность. Материалы также подчёркивают bandwidth trade-offs и сложности deterministic lockstep для более высоких player counts.

### Valve networking materials

Source: https://developer.valvesoftware.com/wiki/Source_Multiplayer_Networking

Valve описывает authoritative server, snapshot/delta updates, prediction/interpolation и server-side lag compensation как взаимодополняющие механизмы.

**ASA conclusion:** `ASA Arena Mini` certification должна проверять не только соединение, но prediction/reconciliation/interpolation contract. При этом Games Core не обязан навязывать конкретную физику; SDK задаёт sequence/tick/snapshot primitives.

## 9. Durable state + event delivery: transactional outbox

### AWS Prescriptive Guidance

Source: https://docs.aws.amazon.com/prescriptive-guidance/latest/cloud-design-patterns/transactional-outbox.html

Transactional outbox решает dual-write problem: database update и event notification не должны расходиться. Business change и outbox record фиксируются одной транзакцией; publisher отправляет committed events позже. Consumers должны быть идемпотентны, поскольку duplicate delivery возможна.

ASA уже имеет такой принцип в `DATA_SECURITY_AND_TENANCY.md`.

**ASA conclusion:** match finish + participant outcome + rating-trigger event + realtime notification trigger не выполняются независимыми non-atomic writes. Durable outbox является обязательным элементом generic Match Core.

## 10. PostgreSQL LISTEN/NOTIFY is wake-up, not the durable bus

Source: https://www.postgresql.org/docs/current/sql-listen.html

`LISTEN` регистрирует текущую database session на channel; notification доставляется подключённым listeners. Registrations исчезают при завершении session.

**ASA conclusion:** `LISTEN/NOTIFY` можно использовать для снижения latency outbox processor/gateway notification, но durable truth находится в outbox/event table. После restart consumer обязан дочитать committed rows, а не надеяться на прошлые NOTIFY.

## 11. WebSocket security

### OWASP WebSocket Security Cheat Sheet

Source: https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html

Ключевые практики:

- каждое message считать untrusted input;
- strict schema/allowlist validation;
- size limits;
- rate limiting/flood protection;
- heartbeat/idle cleanup;
- backpressure controls;
- anti-replay nonce/timestamp/sequence где применимо;
- connection limits;
- authorization не заканчивается на handshake.

**ASA-specific additions:**

- tenant/scope authorization для каждой subscription;
- room token short-lived и scoped конкретным match/participant;
- public alias вместо internal identity IDs;
- no child-sensitive payloads в logs;
- commandId/input sequence anti-replay;
- cross-tenant and cross-match negative tests.

## 12. Rating: one formula does not fit all games

### Microsoft TrueSkill

Source: https://www.microsoft.com/en-us/research/project/trueskill-ranking-system/

TrueSkill был создан для skill estimation и matchmaking в играх, включая multi-player и team scenarios. Он моделирует skill distribution с uncertainty и отдельно рассматривает update, matchmaking и leaderboard use cases.

Source: https://www.microsoft.com/en-us/research/publication/trueskill-2-improved-bayesian-skill-rating-system/

TrueSkill 2 показывает, что для некоторых competitive games дополнительные signals могут улучшать skill estimate, но это уже policy-level решение.

**ASA conclusion:** Games Platform не должна hardcode `ASA Elo` как универсальный алгоритм. Rating system — versioned policy per game/mode/pool. Для простого duel можно начать с текущей chess-compatible policy или Glicko-like policy; FFA/team games могут использовать другие модели. Common storage хранит before/delta/after/policy version, а не assumptions конкретной формулы.

## 13. Comparative matrix

| System/source | Что подтверждает | Что ASA берёт | Что ASA не копирует автоматически |
|---|---|---|---|
| Nakama | authoritative runtime, tick, active/passive turn-based | runtime-family separation, in-memory room loop | обязательный Nakama deployment |
| Colyseus | room authority, delta state sync | snapshot/delta semantics | framework lock-in |
| Agones | ready/allocated dedicated servers | room allocator lifecycle | Kubernetes requirement v1 |
| GameLift | matchmaking != placement | Matchmaker → Allocator boundary | AWS dependency |
| PlayFab | Lobby/Party/Matchmaking/Server hosting separation | control-plane concepts | managed service dependency |
| Open Match | generic ticket/pool/match function | policy-driven matching | Kubernetes/Open Match requirement |
| AWS Outbox | atomic durable change + async event | Postgres transactional outbox | cloud-specific SQS implementation |
| PostgreSQL | transient notifications | LISTEN/NOTIFY as accelerator | NOTIFY as event store |
| MDN WebSocket | broad support, no native backpressure | baseline transport + bounded queues | unbounded message fanout |
| MDN WebTransport | datagrams/streams over HTTP/3 | future realtime-room option | launch dependency |
| TrueSkill | uncertainty + multiplayer/team rating | pluggable rating policy | one universal player number |
| Gaffer/Gambetta/Valve | prediction/reconciliation/interpolation | realtime client protocol primitives | platform-owned game physics |

## 14. Resulting ASA architecture decisions

Research supports the following defaults:

1. **Authoritative server is mandatory for competitive/shared outcomes.**
2. **Turn-based and fast realtime are different runtime families.**
3. **Matchmaking and game server allocation are separate concerns.**
4. **Realtime room simulation runs in memory; blocking DB I/O is outside hot tick loop.**
5. **Continuous room state uses snapshots/deltas; durable lifecycle/results use events/DB.**
6. **WebSocket is the first transport; protocol allows later WebTransport.**
7. **Durable changes use transactional outbox; NOTIFY is optional wake-up.**
8. **Rating is a pluggable policy scoped to game/mode/pool.**
9. **Public identity/privacy and authorization are platform concerns.**
10. **Kubernetes/Agones/Redis/Kafka are scaling options, not architectural prerequisites.**

## 15. Open research items before implementation

These questions remain explicit design work, not hidden assumptions:

- exact public gaming identity policy for child accounts and StudentSeat;
- initial rating algorithm for checkers and whether chess keeps existing ASA Elo during compatibility phase;
- initial realtime room tick/snapshot rates for ASA Arena Mini;
- whether room runtime v1 uses JSON, MessagePack or protobuf after measurement;
- whether WebTransport is needed at all for first production event game;
- object-storage replay format/retention if event games require replay;
- global vs tenant-only matchmaking policy for child users;
- moderation/reporting requirements for cross-tenant public matchmaking;
- region/QoS routing once ASA operates beyond a single hosting location.

These are resolved by later ADRs/experiments, not guessed in GP-001.
