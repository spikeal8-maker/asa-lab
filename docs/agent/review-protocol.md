# Agent review protocol

Этот протокол определяет проверку законченного изменения. Он не заменяет focused tests, repository gate или owner acceptance.

## 1. POST_STEP_REVIEW

Выполняется тем же исполнителем после каждого логически завершённого шага до объявления шага завершённым.

Формат:

```text
POST_STEP_REVIEW
STEP: <что обещал шаг>
CHANGE_CLASS: L0_LOCAL_UI | L1_UI_BEHAVIOR | L2_DOMAIN_MUTATION | L3_CRITICAL
CHANGED: <коротко: файлы/контракты/поведение>
USER_RESULT: <что теперь реально может пользователь>
INVARIANTS_TOUCHED: <stable IDs или none>
TESTS: <фактически запущенные focused checks>
NEGATIVE_CHECKS: <что проверено на запрет/конфликт/ошибку>
DOC_DRIFT: none | <точное расхождение>
UNVERIFIED: <что не проверено>
VERDICT: PASS | NEEDS_FIX | BLOCKED
```
## 2. Обязательные вопросы self-review

Исполнитель обязан ответить по коду, а не по намерению:

1. Выполнен ли именно обещанный пользовательский результат?
2. Не изменил ли шаг сущность/permission/state вне scope?
3. Не появилась ли новая source of truth рядом с существующей?
4. Сохранены ли immutable/history/idempotency/concurrency требования, если они затронуты?
5. Не превратился ли client/UI в authority для server-owned состояния?
6. Совместимы ли migration/API/rollback boundaries, если менялся persistence contract?
7. Не использует ли код superseded/historical document как нормативный?
8. Соответствуют ли тесты реальному failure mode, а не только happy path?

`NEEDS_FIX` означает: исполнитель исправляет найденную проблему и повторяет review. `BLOCKED` означает реальную зависимость/решение владельца; это не способ остановиться вместо исправления своей ошибки.

## 3. CHALLENGE_REVIEW

Отдельный критический проход обязателен, если выполнено хотя бы одно условие:

- `CHANGE_CLASS = L3_CRITICAL`;
- изменены Auth/RLS/permissions;
- изменены migration/API rollout boundaries;
- изменена state machine или canonical resolver;
- изменены Submission/Result/Gradebook semantics;
- закрывается milestone;
- формируется release candidate.
Challenge review должен пытаться опровергнуть готовность шага. Минимум проверяется:

- конфликт с canonical domain contract;
- stale read/projection после mutation;
- повтор команды / lost response / concurrent update;
- old-client/new-schema и new-client/old-schema compatibility для rollout;
- negative authorization;
- сохранность исторических данных;
- отсутствие скрытого fallback к legacy writer/read path.

## 4. Стоимость проверки

Нельзя заменять этот протокол глобальным аудитом после каждой мелкой правки.

- L0: component/surface self-review + focused UI test;
- L1: self-review + affected behavior tests;
- L2: self-review + domain contract + command/read-model tests;
- L3: self-review + challenge review + compatibility/security tests;
- milestone/candidate: independent critical review + declared full gates.

Цель review — раннее обнаружение смысловой ошибки при минимальном контексте, а не производство длинного отчёта.
