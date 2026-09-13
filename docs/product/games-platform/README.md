# ASA Games Platform — пакет проектной документации

**Статус:** Draft / documentation only  
**Ветка:** `docs/asa-games-platform-architecture`  
**Base:** `3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`  
**Назначение:** зафиксировать целевую архитектуру игровой подсистемы ASA Lab до дальнейшей сетевой разработки отдельных игр.

## 1. Зачем нужен отдельный Games Platform

ASA Lab уже содержит несколько игровых направлений, но их сетевые возможности развивались разными путями. Шахматы имеют зрелый `chess-live` с challenge, matchmaking, rating, idempotency, event sequence и PostgreSQL persistence. Шашки имеют отдельный classroom flow и собственную Match Session эволюцию. `apps/realtime-gateway` существует как каркас, но ещё не является реальным data-plane.

Если продолжить добавлять `checkers-online`, `tic-tac-toe-online`, `arena-online` как самостоятельные системы, платформа получит дублирующиеся приглашения, рейтинги, очереди, уведомления, историю, reconnect и сетевые протоколы.

Дополнительная цель — не ограничиваться встроенными ASA-играми. Платформа должна иметь безопасный creator/developer contract, чтобы игры учеников, педагогов, ASA-команды и позже внешних разработчиков могли проходить путь `source → isolated build → review → immutable release → publication`, не становясь доверенным кодом ASA автоматически.

## 2. Какие классы игр обязана поддерживать архитектура

Платформа проектируется не только для настольных 1v1 игр.

| Класс | Примеры | Сетевая модель |
|---|---|---|
| Command / turn-based | шашки, шахматы, крестики-нолики, карточные игры | versioned commands, durable canonical state |
| Active session / low-rate | покер, квизы, пошаговые игры с таймером | authoritative session + realtime delivery |
| Realtime room | arena, shooter, racing, platformer | in-memory authoritative room, tick loop, snapshot/delta |
| Event / temporary | школьная арена, игра мероприятия, сезонный квест | любой runtime kind + lifecycle window |
| Sandboxed creator web game | ученическая HTML/Canvas/Phaser/Three.js игра | isolated web client + ASA Game Client SDK |

Архитектура считается недостаточной, если она хорошо обслуживает только шашки и шахматы или если стороннюю игру можно подключить только путём добавления её исходников в доверенный ASA monorepo.

## 3. Документы пакета

### Нормативная точка входа

- `docs/product/games-platform/ASA_GAMES_PLATFORM_TECHNICAL_SPECIFICATION.md` — главное ТЗ: цели, границы, требования с ID, architecture/runtime/publishing/security/privacy/deployment/migration и Definition of Done.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md` — основной порядок реализации по вертикальным пользовательским результатам; запрещает длинную инфраструктурную разработку без работающего product result.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_REQUIREMENTS_TRACEABILITY.md` — матрица `требование → компонент → milestone → обязательное evidence`; используется для контроля реализации.

**Порядок реализации определяется `ASA_GAMES_PLATFORM_VALUE_DELIVERY_PLAN.md`.** Master Technical Specification определяет требования и границы, но не означает, что все capabilities строятся одновременно.

### Архитектура и research

- `docs/architecture/ASA_GAMES_PLATFORM_CURRENT_STATE_AUDIT.md` — фактический аудит текущего репозитория: что уже можно переиспользовать и что нельзя переносить как есть.
- `docs/architecture/ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md` — нормативное решение о Control Plane, Command Runtime, Realtime Gateway и Room Runtime.
- `docs/architecture/ASA_GAMES_PLATFORM_NETWORKING_RESEARCH.md` — внешний research по Nakama, Colyseus, Agones, GameLift, PlayFab, Open Match, WebSocket/WebTransport и сетевому netcode.
- `docs/architecture/ASA_GAMES_PLATFORM_DATA_AND_IDENTITY.md` — canonical match model, participants, events, outbox, gaming identity, rating и statistics projections.
- `docs/architecture/ASA_GAMES_PLATFORM_PROTOCOLS_AND_RUNTIME.md` — API/realtime protocols, room allocation, reconnect, recovery, tick budget, security и observability.
- `docs/architecture/ASA_GAMES_PLATFORM_TECHNOLOGY_OPTIONS.md` — build-vs-buy и staged technology choices: PostgreSQL, WebSocket/WebTransport, Redis, Colyseus, Nakama, Open Match, GameLift, Agones, runtime languages.
- `docs/architecture/ASA_GAMES_PLATFORM_CRITICAL_ARCHITECTURE_REVIEW.md` — критический review текущего проекта платформы и вывод о гибридной Steam/Discord/Roblox-модели для ASA.
- `docs/architecture/ADR-GAME-002-GAME-PACKAGES-PUBLISHING-AND-TRUST.md` — proposed contract для source/build/release/publication, capability grants, trust tiers, client sandbox и server-runtime admission.

### Продукт, developer flow и acceptance

- `docs/product/games-platform/ASA_GAMES_PLATFORM_PRODUCT_SPEC.md` — пользовательская модель: Games Hub, lobby, invites, party, classmates, quick/rated play, profile, stats, leaderboards, tournaments/events.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_DEVELOPER_INTEGRATION_GUIDE.md` — прикладной контракт разработчика: manifest, adapters, renderer, bots/metrics, trusted и isolated games, forbidden patterns.
- `docs/product/games-platform/ASA_GAME_PACKAGE_AND_PUBLISHING_SPEC.md` — конкретный package/publishing workflow: `asa-game.yaml`, GitHub connector, isolated build, immutable releases, channels, publication scopes, sandbox client и developer/admin portal.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_TESTING_AND_CERTIFICATION.md` — обязательные contract/security/reconnect/load/fault-injection gates и certification games.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_EXECUTION_PLAN.md` — подробная архитектурная декомпозиция milestone/task; sequencing subordinate to Value Delivery Plan.

## 4. Что этот пакет НЕ разрешает

До принятия ТЗ и ADR пакет не является разрешением:

- переписывать `chess-live`;
- создавать новые `games_*` таблицы;
- менять production Compose;
- добавлять WebSocket endpoints;
- продолжать отдельный `checkers invite/matchmaking/rating` backend;
- подключать Redis/Kafka/Kubernetes/Agones как обязательные зависимости;
- делать публичные игровые профили детей без согласованной privacy policy;
- клонировать произвольный GitHub-репозиторий и запускать его как production game;
- запускать произвольный student Docker/container runtime;
- автоматически публиковать Git push в публичный Games Hub.

Документация сначала фиксирует границы и migration strategy. Реализация идёт только отдельными bounded slices после review.

## 5. Главные архитектурные принципы

1. **Server authority.** Клиент отправляет intent/input, но не объявляет authoritative result, hit, score, placement или rating.
2. **Control Plane отделён от gameplay runtime.** Matchmaking, invites и rating не знают правил шашек; game runtime не управляет аккаунтами и публичным профилем.
3. **Две runtime-модели.** Command games и fast realtime rooms не загоняются в один execution loop.
4. **PostgreSQL остаётся durable source of truth.** Ephemeral realtime state не обязан писаться в SQL каждый tick.
5. **Transactional outbox вместо dual-write.** Durable change и событие фиксируются атомарно; доставка и projections асинхронны и идемпотентны.
6. **Game plugin/package contract.** Новая игра регистрирует capabilities и adapters/artifacts, а не создаёт свой matchmaking/rating/invite stack.
7. **Source ≠ Build ≠ Release.** GitHub/ZIP/ASA Creator являются source providers; в runtime допускаются только проверенные immutable artifacts.
8. **Capability request ≠ grant.** Manifest может запросить функцию, но разрешение выдаёт platform policy/reviewer.
9. **Untrusted client isolation.** Student/community web code не выполняется внутри trusted ASA React/DOM/session boundary.
10. **Privacy by construction.** В публичный игровой слой не попадают internal account/learner IDs, email, school/class metadata без явной scope policy.
11. **Version everything.** Match и release фиксируют game/rules/state/protocol/build versions.
12. **Progressive infrastructure.** Первая версия не требует Kafka/Kubernetes/Redis; контракты позволяют добавить их при доказанной необходимости.
13. **Value before breadth.** Каждый крупный этап заканчивается работающим пользовательским результатом; нельзя строить несколько инфраструктурных слоёв подряд без product proof.
14. **Private by default for creator content.** Student/community release не становится публичным без соответствующего review.

## 6. Критерий успеха платформы

Для first-party игры разработчик реализует преимущественно game-specific rules/runtime/renderer. Для внешней/creator игры он предоставляет package manifest + artifacts/source, а ASA сама строит и публикует immutable release через контролируемую pipeline.

Новая игра считается правильно подключённой, если она автоматически получает разрешённые платформенные возможности:

- authenticated/public gaming identity;
- Games Hub/lobby/party;
- invitations;
- classmates/recent opponents;
- matchmaking;
- reconnect;
- match history;
- common statistics;
- rating/leaderboards для authoritative modes;
- notifications;
- moderation/reporting;
- event/tournament integration;
- observability and operational lifecycle;
- release channels/rollback;
- capability-controlled access to storage/UI/runtime services.

Если для третьей игры приходится заново писать собственные invite, matchmaking, rating, event storage и reconnect, Games Platform спроектирована неправильно. Если student/community game должен получить ASA session cookie, доступ к БД или быть импортирован как доверенный React/NestJS-код, creator platform также спроектирована неправильно.

Практический результат программы проверяется не количеством созданных сервисов, а демонстрируемыми milestones: R1 — сетевая партия в шашки; R2 — Quick Match и повторное использование ядра второй игрой; R3 — рейтинг/статистика шашек; R4 — Chess+Checkers на общем multiplayer core; R6 — realtime Arena; R7 — безопасная ученическая web-игра от source до classroom publication.