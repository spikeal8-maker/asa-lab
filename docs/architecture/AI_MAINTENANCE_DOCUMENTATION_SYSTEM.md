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
- классифицировать canonical документы без массового переписывания архива;
- валидировать существование paths, уникальность authority и supersession links;
- подключить validator к governance gate.

### DOC-M1 — compact domain contracts

Пилотные контексты: Identity/Access и Learning. Контракт содержит только устойчивые термины, state machines, authority boundaries и ссылки на master-spec.

### DOC-M2 — root router cleanup

Только после появления целевых Domain Contracts:

- сократить `AGENTS.md` до универсальной политики;
- сократить `START_HERE_FOR_AI.md` до маршрутизатора;
- вынести Electronics/Scratch/Learning-specific правила в зарегистрированные контексты;
- не удалять правило из root, пока registry не указывает его новое authority-место.

### DOC-M3 — maintenance surface maps

Сначала Account/Profile/Classroom/Learning, затем Projects/Electronics/3D/Chess/Admin/Visual Programming.

Surface Map не описывает дизайн заново. Он связывает пользовательскую поверхность с реальными implementation paths, commands и tests.

### DOC-M4 — targeted agent context

Расширить `agent:context` режимами `--surface`, `--control`, `--path`. Ввести ограничение размера выдачи и тесты на отсутствие нерелевантных документов.

### DOC-M5 — enforced review

Формализовать `POST_STEP_REVIEW` и `CHALLENGE_REVIEW`; milestone/candidate без требуемого review evidence не объявляется готовым.

### DOC-M6 — gradual rollout

Перенести оставшиеся bounded contexts и классифицировать historical/superseded archive по мере реальной работы. Не делать массовую документационную миграцию без продуктовой необходимости.

## 8. Acceptance всей системы

Система считается полезной только если типичная локальная правка может получить достаточный context pack без чтения полного master-spec или полного repository tree.

Для `L0/L1` context pack должен указывать один surface и focused tests. Для `L2/L3` он обязан дополнительно включать domain invariants и compatibility/security obligations.

Ошибочный reference на superseded document, отсутствующий path, два canonical authority для одной области или active task со старой canonical revision должны быть machine-detectable.

Главная метрика — не количество документов, а уменьшение объёма нерелевантного чтения при сохранении архитектурной точности.
