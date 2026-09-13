# ASA Games Platform — Product Specification

**Status:** Draft  
**Audience:** product, frontend, backend, game-module authors, education/classroom owners  
**Purpose:** определить единый пользовательский слой Games Platform, который не зависит от конкретной игры.

## 1. Product thesis

Раздел «Игры» ASA Lab должен восприниматься не как список несвязанных мини-приложений, а как единая игровая среда:

- один игровой профиль;
- единый Games Hub;
- одинаково понятные способы начать игру;
- единые приглашения и уведомления;
- единая история матчей;
- общие принципы рейтинга/статистики;
- classmates/recent opponents как платформенные отношения;
- игры отличаются правилами и визуалом, но не заставляют заново изучать сетевой UX.

## 2. Supported product classes

Пользователь не обязан знать термины `command runtime` или `realtime room`, но продукт должен поддерживать:

- дуэльные пошаговые игры;
- командные игры;
- free-for-all;
- co-op;
- игры с ботами;
- локальную игру на одном устройстве, если игра это поддерживает;
- быстрый online matchmaking;
- рейтинговый matchmaking;
- private invite;
- одноклассников;
- event/seasonal games;
- tournaments;
- spectators, если игра разрешает.

## 3. Games Hub

Верхний уровень:

```text
Игры
├── Играть
├── События
├── Мои игры / недавние
├── Приглашения
├── Рейтинг
├── Статистика
└── История
```

### 3.1. Game cards

Карточка игры показывает только capabilities, которые реально доступны:

```text
Русские шашки
● 36 игроков онлайн
Рейтинг 1472
[Играть]
```

Дополнительные badges:

```text
Боты
Online
Рейтинг
Класс
Событие
Команды
```

Нельзя показывать «Рейтинговая игра» для игры без `supportsRated`.

### 3.2. Lifecycle visibility

Permanent game — всегда доступна.

Seasonal/event game:

```text
Космическая арена
До 15 апреля
```

После окончания игра может исчезнуть из основного каталога, но её матчи, статистика и награды остаются в профиле/истории.

## 4. Universal game lobby

После открытия игры пользователь видит **один и тот же набор платформенных способов игры**, отфильтрованный manifest:

```text
Играть с ботом
Играть вдвоём на одном устройстве
Быстрая игра
Рейтинговая игра
Пригласить игрока
Одноклассники
Играть командой / Party
События и турниры
```

Игровой module может добавлять образовательные поверхности (`Задачи`, `Уроки`, `Разбор`), но не должен заново реализовывать online lobby.

## 5. Quick play

UX:

```text
Быстрая игра
Найти любого подходящего соперника
[Начать поиск]
```

После старта:

```text
Ищем соперника…
12 сек
[Отменить]
```

Не надо заставлять пользователя обновлять страницу.

После match found:

```text
Соперник найден
Саша_84
[Войти в игру]
```

Для fast modes переход может быть автоматическим после короткого countdown.

Если queue долго не находит игрока, UI честно сообщает widening/fallback options, если policy разрешает:

```text
Поиск занимает дольше обычного.
Расширяем диапазон соперников…
```

## 6. Rated play

Рейтинговый режим всегда сообщает последствия до старта:

```text
Рейтинговая игра
Ваш рейтинг: 1472
Результат изменит рейтинг Standard.
```

После матча:

```text
Победа
1472 → 1486  (+14)
```

Нельзя менять public rating:

- bot game;
- local game;
- training;
- explicitly unranked/private game, если mode policy не говорит иначе.

Нет одной общей цифры рейтинга между разными играми.

## 7. Private invite

Источники invite:

```text
Одноклассник
Недавний соперник
Будущий friend
Прямая ссылка/код
```

Invite card:

```text
Саша_84 приглашает сыграть
Русские шашки · обычная партия
[Принять] [Отклонить]
```

Invite expiry показывается, если он релевантен.

Принятие invite не должно создавать две партии при double click/retry.

## 8. Classmates

Если пользователь состоит в доступном classroom scope:

```text
Одноклассники
Маша       ● online      [Пригласить]
Иван       В игре        [Посмотреть / позже]
Саша       offline       [Пригласить]
```

Правила:

- список появляется только при соответствующем classroom relation;
- classroom identity не становится публичной глобально;
- invite может быть ограничен школьной policy;
- общий Games Hub агрегирует разрешённых classmates, не заставляя входить в конкретный classroom project;
- teacher/admin controls не смешиваются с обычным игровым профилем ученика.

## 9. Party

Нужен для team/co-op/event games.

UX:

```text
Ваша группа 3/4
Александр (лидер)
Катя
Иван
[Пригласить]
[Искать игру]
```

Party leader выбирает game/mode, но server policy валидирует совместимость всех участников.

Пользователь может выйти из party без потери игрового профиля/history.

## 10. Match screen shell

Общая оболочка:

```text
┌────────────────────────────────────────┐
│ Player/Team A         Player/Team B    │
│ rating/presence       rating/presence  │
├────────────────────────────────────────┤
│                                        │
│            GAME RENDERER               │
│                                        │
├────────────────────────────────────────┤
│ connection / timer / controls          │
│ resign / draw / leave / settings       │
└────────────────────────────────────────┘
```

Game-specific renderer не должен самостоятельно реализовывать:

- connection badge;
- public identity rendering;
- rating delta shell;
- report/block actions;
- generic reconnect UI;
- rematch/invite platform flow.

## 11. Connection UX

States:

```text
online
reconnecting
opponent reconnecting
offline / grace period
server recovery
match aborted
```

Пример:

```text
Соединение потеряно. Восстанавливаем… 4 с
```

Не показывать технические WebSocket codes пользователю.

При command game reconnect пользователь получает актуальную доску/состояние.

При realtime-room reconnect — current snapshot и appropriate countdown/grace state.

## 12. Match finish

Общая finish surface показывает:

- authoritative result;
- participant placement/team result;
- rating change, если rated;
- key common stats;
- game-specific metrics, если зарегистрированы;
- rematch;
- invite again;
- review/replay, если game supports;
- report, если это network opponent.

Дуэль:

```text
Победа
+14 rating
48 ходов
[Реванш] [Разобрать] [В лобби]
```

FFA:

```text
2 место из 8
1  Саша_84
2  Александр
3  Катя
...
```

## 13. Gaming profile

Пользовательский раздел:

```text
Игровой профиль
├── Обзор
├── Шашки
├── Шахматы
├── Arena
└── История
```

### 13.1 Overview

```text
Всего завершённых матчей
Недавние игры
Активные рейтинги
Лучшие результаты/достижения
```

Нельзя складывать ratings разных игр в одну «силу».

### 13.2 Per-game stats

Общие показатели:

- games played;
- W/D/L where meaningful;
- win rate;
- current/best streak;
- recent form;
- side/team/seat splits;
- average placement for FFA;
- rating current/peak/history;
- head-to-head;
- bot stats;
- classmates scope;
- game-specific metrics.

## 14. Bot statistics

Для каждой игры с bots:

```text
Bot
Games
W/D/L
Win rate
Side split
Last result
```

Платформа может показывать:

```text
Самый сильный побеждённый бот
```

Но bot difficulty/rating должен исходить из game-owned descriptor/calibration; платформа не придумывает Elo боту.

## 15. Leaderboards

Фильтры:

```text
Игра
Rating pool
Season/period
Scope
```

Scope examples:

```text
Все разрешённые
Рядом со мной
Одноклассники
Event
Tournament
```

Для несовершеннолетних global leaderboard visibility определяется privacy policy, а не автоматически включается из-за наличия rating.

## 16. History

History item:

```text
Русские шашки
vs Саша_84
Победа
1486 (+14)
13 сентября · 16:10
```

Team/FFA items adapt fields.

History opens match summary and replay/review only if game supports it.

Local/offline matches may be excluded or marked separately depending on trust/recording policy.

## 17. Presence

Presence is minimal and privacy-aware:

```text
online
offline
in-game
```

Do not expose:

- exact last-seen timestamp to arbitrary users;
- current classroom/school;
- IP/region;
- hidden/private match identity.

## 18. Spectators

If `supportsSpectators`:

- game defines what state spectator can see;
- control plane validates match visibility;
- rated competitive game may enforce delay;
- hidden information must remain hidden;
- spectator cannot submit gameplay commands;
- classroom/event policy can disable spectators entirely.

## 19. Communication and child safety

Games Platform v1 does **not** require open free-form direct chat.

Safer initial options:

- predefined reactions;
- predefined sportsmanship messages;
- party/classroom communication only where existing policy permits;
- mute/block/report.

Any later text/voice chat is a separate moderated product/security project.

## 20. Block/report

Platform actions:

```text
Скрыть/заблокировать игрока
Пожаловаться
```

Blocked relation should be considered by invite/matchmaking policy where legally/product-wise appropriate.

Report stores platform evidence references, not arbitrary dumps of child-sensitive content.

## 21. Event games

Event card:

```text
Неделя космоса
ASA Space Arena
10–15 апреля
```

Event configuration:

- active window;
- audience/scope;
- game version pinned;
- leaderboard policy;
- reward/badge policy;
- admission cap;
- optional party/team rules.

After event:

- no new admission;
- historical matches preserved;
- leaderboard archived;
- earned achievements remain;
- game client/runtime may be removed only after retention/replay needs are resolved.

## 22. Tournaments

Platform-level tournament formats may include:

```text
single elimination
round robin
Swiss
score event
```

Not every format is required v1.

Tournament owns pairing/round advancement; underlying game still owns rules and renderer.

## 23. Game author onboarding

A trusted ASA game author should provide:

```text
GameManifest
rules/runtime adapter
schemas
renderer/client
optional bots
optional custom metrics
assets
contract tests
```

Platform provides a developer harness:

```text
manifest validation
fake players
match lifecycle simulator
network fault/reconnect simulator
schema compatibility gate
public-state leak tests
bot adapter tests
```

For isolated/event game package:

```text
game manifest
client artifact/image
runtime image (if realtime)
protocol version
resource limits
SBOM/license/security metadata
```

## 24. Certification requirements for a new game

### Command game certification

A new command game must prove:

- deterministic/valid server transition;
- unauthorized actor cannot command another seat;
- duplicate command idempotent;
- concurrent version conflict safe;
- reconnect restores authoritative state;
- hidden state not leaked;
- match finish produces common outcome/history/stats;
- no custom invite/matchmaking/rating backend created.

### Realtime-room certification

Additionally:

- room starts/stops cleanly;
- server authority over position/score;
- input rate/sequence enforcement;
- bounded payloads;
- tick budget load test;
- reconnect policy;
- runtime crash policy;
- room token isolation;
- final result delivered once;
- no direct DB dependency in hot tick loop;
- telemetry present.

## 25. Product acceptance examples

### Example A — Tic-Tac-Toe

After implementing only manifest/rules/renderer/bot (optional), platform should provide with little/no game-specific code:

- invite;
- quick match;
- history;
- reconnect;
- W/D/L stats;
- recent opponents;
- classmates;
- rematch;
- notifications.

If this requires its own network controller, Game Platform failed its goal.

### Example B — ASA Arena Mini

After implementing manifest/realtime adapter/client scene, platform should provide:

- party;
- matchmaking;
- room allocation;
- room credentials;
- match lifecycle;
- reconnect;
- placement/score history;
- event leaderboard;
- stats;
- moderation/reporting hooks.

Game-specific code owns movement/scoring, not platform UX/services.

## 26. Accessibility and degraded networks

Common Games UI must support:

- keyboard navigation where gameplay permits;
- screen-reader accessible lobby/profile/history/control UI;
- reduced motion;
- clear reconnect states;
- low-bandwidth command games;
- no automatic high-frequency animation on non-game pages;
- client quality settings for realtime games.

## 27. Non-goals for first platform release

Not required in the first implementation:

- universal voice chat;
- user-created arbitrary executable server code;
- esports-grade anti-cheat client;
- global public matchmaking for all minors by default;
- cross-region fleet orchestration;
- Kubernetes;
- WebTransport production requirement;
- full tournament format catalog;
- universal achievements economy;
- monetized game marketplace.

These remain compatible future extensions, not blockers.
