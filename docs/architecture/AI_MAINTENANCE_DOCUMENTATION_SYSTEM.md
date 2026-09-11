# ASA Lab — система документации для дешёвого сопровождения

**Status:** OWNER-DIRECTED DOCUMENTATION FOUNDATION
**Purpose:** сделать будущие изменения людьми и AI-агентами адресными, проверяемыми и дешёвыми по контексту.
**Live execution state:** только `docs/execution/current.yaml`.
**This document is not a task/status ledger.**

## 1. Проблема

ASA Lab уже содержит большие нормативные спецификации. Они нужны как полный источник требований, но их нельзя делать обязательным входом для каждой мелкой правки.

Целевая система должна позволять изменить кнопку, подпись, локальное поведение или один доменный command без повторного исследования половины репозитория.

Документация обязана одновременно предотвращать две ошибки:

1. агент читает слишком много и тратит токены на нерелевантный код;
2. агент читает слишком мало и реализует работающий путь с неверной доменной семантикой.

Поэтому документация строится слоями, а расширение контекста выполняется только по доказанной зависимости.
## 2. Слои документации

| Слой | Назначение | Когда читать |
| --- | --- | --- |
| Root policy | Git, безопасность, данные, deployment, STOP | всегда |
| Document Registry | какой документ имеет authority и какой устарел | всегда через tooling |
| Domain Contract | короткие инварианты bounded context | при изменении доменной логики |
| Surface Map | route → component → API → command → tests | при изменении конкретного UI/flow |
| Task Package | scope большого активного результата | только для текущей крупной задачи |
| Evidence/Review | фактически выполненные проверки и риски | после изменения / перед candidate |

Полные master-specs остаются в репозитории и не заменяются сокращёнными контрактами. Короткий контракт указывает на точные разделы master-spec, когда требуется расширение.

## 3. Единственные источники истины

- `docs/execution/current.yaml` — только live execution state;
- `docs/agent/document-registry.yaml` — authority/status документов;
- продуктовые master/spec — постоянные требования своей области;
- ADR — принятые архитектурные решения;
- executable tests/workflows — проверяемое поведение;
- Git history — история изменения;
- owner acceptance — отдельный факт, не выводимый из CI.

Ни Surface Map, ни Task Package, ни review-файл не имеют права становиться вторым источником live-state.
## 4. Контекст по изменению

Будущий агент должен уметь входить не только по lane, но и по адресу изменения:

```text
agent:context --scope learning
agent:context --surface classroom.settings
agent:context --control overdue-reminder
agent:context --path apps/web/src/components/ClassroomGradebook.tsx
```

Вывод должен содержать только:

- bounded context;
- surface/control;
- authority documents и точные section/rule IDs;
- минимальный набор implementation files;
- API/commands/read models;
- обязательные инварианты;
- focused tests;
- соседние зависимости только при реальном пересечении.

Если dependency обнаружена во время работы, агент расширяет контекст и фиксирует причину. Глобальный аудит репозитория не является стандартным первым шагом локальной правки.

## 5. Классы изменений

- `L0_LOCAL_UI` — текст, layout, локальный visual state;
- `L1_UI_BEHAVIOR` — navigation/dialog/filter/client behavior;
- `L2_DOMAIN_MUTATION` — API/command/domain state/projection;
- `L3_CRITICAL` — auth/RLS/migration/state machine/result/deployment compatibility.

Чем выше класс, тем шире обязательный контракт и review. Класс определяется воздействием, а не размером diff.
## 6. Review protocol

Каждый законченный шаг проходит короткий self-review до объявления checkpoint завершённым.

Минимальные вопросы:

1. Что обещал шаг?
2. Что реально изменено?
3. Какие инварианты затронуты?
4. Не создана ли вторая source of truth?
5. Какие negative/concurrency/compatibility cases проверены?
6. Что осталось непроверенным?
7. Есть ли drift между кодом и canonical contract?
8. Вердикт: `PASS`, `NEEDS_FIX` или `BLOCKED`.

Self-review не является независимым acceptance. Отдельный challenge review обязателен для `L3_CRITICAL`, завершения milestone и release candidate.

## 7. Этапы внедрения

### DOC-M0 — authority foundation

- создать machine-readable Document Registry;
- классифицировать canonical документы без массовой переписи архива;
- валидировать paths, authority и supersession links;
- подключить проверки к governance gate.

### DOC-M0.5 — routing and contract foundation

До создания большого числа компактных контрактов:
- зафиксировать schema для Domain Contract и Surface Map;
- ввести стабильные invariant/surface/control IDs;
- маршрутизировать `agent:context --scope` через Document Registry;
- разделить `readFirst`, `readIfNeeded`, `doNotUse` и review process;
- привязать активные задачи к exact canonical document revisions;
- обнаруживать revision drift автоматически.
### DOC-M1 — Learning vertical pilot

Проверить систему на одном сложном домене end-to-end:
- компактный Learning Domain Contract;
- несколько реальных Learning Surface Maps;
- `agent:context --path`, `--surface`, `--control`;
- resolver invariant IDs и исполнимых focused tests;
- ограниченный context budget без чтения целого Master по умолчанию.

Пилот должен доказать, что локальная правка получает нужную архитектурную семантику без исследования всего Learning.

### DOC-M2 — review enforcement

`POST_STEP_REVIEW` обязателен после логически законченного шага. Для `L3_CRITICAL`, milestone и candidate дополнительно требуется `CHALLENGE_REVIEW`. Требование должно приходить через tooling/context, а не существовать только как Markdown.

### DOC-M3 — Identity/Access rollout

После подтверждения Learning-пилота применить тот же формат к Account/Profile/Login/StudentSeat/Classroom access/settings. Не создавать второй способ маршрутизации.
### DOC-M4 — root router cleanup

Только после доказанной новой маршрутизации:
- сократить `AGENTS.md` до универсальной политики;
- сократить `START_HERE_FOR_AI.md` до маршрутизатора;
- перенести domain-specific правила в зарегистрированные контракты;
- не удалять root-правило, пока новый resolver не выдаёт его адресно.

### DOC-M5 — gradual rollout

Подключать Projects/Electronics/3D/Chess/Admin/Visual Programming по мере реальной работы. Не проводить массовую перепись документов без продуктовой причины.

### DOC-M6 — full maintenance coverage

После покрытия bounded contexts перевести registry из `partial` в `full`, запретить незарегистрированные нормативные документы и закрепить context budgets для L0–L3.

## 8. Acceptance всей системы

Система считается полезной только если типичная локальная правка может получить достаточный context pack без чтения полного master-spec или полного repository tree.

Для `L0/L1` context pack должен указывать один surface и focused tests. Для `L2/L3` он обязан дополнительно включать domain invariants и compatibility/security obligations.

Ошибочный reference на superseded document, отсутствующий path, два canonical authority для одной области или active task со старой canonical revision должны быть machine-detectable.

Главная метрика — не количество документов, а уменьшение объёма нерелевантного чтения при сохранении архитектурной точности.
