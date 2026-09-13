# ASA Games Platform — пакет проектной документации

**Статус:** Draft / documentation only  
**Ветка:** `docs/asa-games-platform-architecture`  
**Base:** `3498dd2c8c2c4ce33b36d3cafa94b85dcd39009e`  
**Назначение:** зафиксировать целевую архитектуру игровой подсистемы ASA Lab до дальнейшей сетевой разработки отдельных игр.

## 1. Зачем нужен отдельный Games Platform

ASA Lab уже содержит несколько игровых направлений, но их сетевые возможности развивались разными путями. Шахматы имеют зрелый `chess-live` с challenge, matchmaking, rating, idempotency, event sequence и PostgreSQL persistence. Шашки имеют отдельный classroom flow и собственную Match Session эволюцию. `apps/realtime-gateway` существует как каркас, но ещё не является реальным data-plane.

Если продолжить добавлять `checkers-online`, `tic-tac-toe-online`, `arena-online` как самостоятельные системы, платформа получит дублирующиеся приглашения, рейтинги, очереди, уведомления, историю, reconnect и сетевые протоколы.

Цель Games Platform — сделать эти возможности платформенными, а конкретной игре оставить только то, что действительно принадлежит игре: правила, game-specific state, renderer, bot logic и специальные метрики.

## 2. Какие классы игр обязана поддерживать архитектура

Платформа проектируется не только для настольных 1v1 игр.

| Класс | Примеры | Сетевая модель |
|---|---|---|
| Command / turn-based | шашки, шахматы, крестики-нолики, карточные игры | versioned commands, durable canonical state |
| Active session / low-rate | покер, квизы, пошаговые игры с таймером | authoritative session + realtime delivery |
| Realtime room | arena, shooter, racing, platformer | in-memory authoritative room, tick loop, snapshot/delta |
| Event / temporary | школьная арена, игра мероприятия, сезонный квест | любой runtime kind + lifecycle window |

Архитектура считается недостаточной, если она хорошо обслуживает только шашки и шахматы.

## 3. Документы пакета

- `docs/architecture/ASA_GAMES_PLATFORM_CURRENT_STATE_AUDIT.md` — фактический аудит текущего репозитория: что уже можно переиспользовать и что нельзя переносить как есть.
- `docs/architecture/ADR-GAME-001-GAMES-PLATFORM-BOUNDARIES.md` — нормативное решение о Control Plane, Command Runtime, Realtime Gateway и Room Runtime.
- `docs/architecture/ASA_GAMES_PLATFORM_NETWORKING_RESEARCH.md` — внешний research по Nakama, Colyseus, Agones, GameLift, PlayFab, Open Match, WebSocket/WebTransport и сетевому netcode.
- `docs/architecture/ASA_GAMES_PLATFORM_DATA_AND_IDENTITY.md` — canonical match model, participants, events, outbox, gaming identity, rating и statistics projections.
- `docs/architecture/ASA_GAMES_PLATFORM_PROTOCOLS_AND_RUNTIME.md` — API/realtime protocols, room allocation, reconnect, recovery, tick budget, security и observability.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_PRODUCT_SPEC.md` — пользовательская модель: Games Hub, lobby, invites, party, classmates, quick/rated play, profile, stats, leaderboards, tournaments/events.
- `docs/product/games-platform/ASA_GAMES_PLATFORM_EXECUTION_PLAN.md` — staged implementation plan и acceptance gates.

## 4. Что этот пакет НЕ разрешает

До принятия ADR пакет не является разрешением:

- переписывать `chess-live`;
- создавать новые `games_*` таблицы;
- менять production Compose;
- добавлять WebSocket endpoints;
- продолжать отдельный `checkers invite/matchmaking/rating` backend;
- подключать Redis/Kafka/Kubernetes/Agones как обязательные зависимости;
- делать публичные игровые профили детей без согласованной privacy policy.

Документация сначала фиксирует границы и migration strategy. Реализация идёт только отдельными bounded slices после review.

## 5. Главные архитектурные принципы

1. **Server authority.** Клиент отправляет intent/input, но не объявляет authoritative result, hit, score, placement или rating.
2. **Control Plane отделён от gameplay runtime.** Matchmaking, invites и rating не знают правил шашек; game runtime не управляет аккаунтами и публичным профилем.
3. **Две runtime-модели.** Command games и fast realtime rooms не загоняются в один execution loop.
4. **PostgreSQL остаётся durable source of truth.** Ephemeral realtime state не обязан писаться в SQL каждый tick.
5. **Transactional outbox вместо dual-write.** Durable change и событие фиксируются атомарно; доставка и projections асинхронны и идемпотентны.
6. **Game plugin contract.** Новая игра регистрирует capabilities и adapters, а не создаёт свой matchmaking/rating/invite stack.
7. **Privacy by construction.** В публичный игровой слой не попадают internal account/learner IDs, email, school/class metadata без явной scope policy.
8. **Version everything.** Match фиксирует game/rules/state/protocol versions.
9. **Progressive infrastructure.** Первая версия не требует Kafka/Kubernetes/Redis; контракты позволяют добавить их при доказанной необходимости.
10. **Certification before migration.** Универсальность доказывают две простые контрольные игры: command-game (`Tic-Tac-Toe`) и realtime-room (`ASA Arena Mini`) до массовой миграции зрелых игр.

## 6. Критерий успеха платформы

Новая игра считается подключаемой к ASA Games Platform, если её разработчик реализует преимущественно:

- `GameManifest`;
- game-specific rules/runtime adapter;
- state/command/input schema;
- renderer/client;
- optional bot provider;
- optional custom metrics;

и автоматически получает платформенные возможности, которые разрешены её manifest:

- authenticated player identity;
- lobby / party;
- invitations;
- classmates/recent opponents;
- matchmaking;
- reconnect;
- match history;
- common statistics;
- rating/leaderboards;
- notifications;
- moderation/reporting;
- event/tournament integration;
- observability and operational lifecycle.

Если для третьей игры приходится заново писать собственные invite, matchmaking, rating, event storage и reconnect, Games Platform считается спроектированной неправильно.
