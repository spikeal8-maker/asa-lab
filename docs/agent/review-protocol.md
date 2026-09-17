# Agent review protocol

Этот протокол определяет проверку законченного изменения. Он не заменяет focused tests, repository gate или owner acceptance.

Для любого пользовательского интерфейса дополнительно обязателен `docs/product/ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md`. Он задаёт layout-impact, обязательные viewport, visual evidence и запрет объявлять UI готовым при известном визуальном дефекте.

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
LAYOUT_IMPACT: none | <изменённые classes/components + consumers>
VIEWPORTS: n/a | <фактически проверенные 1440/1024/390/320>
VISUAL_EVIDENCE: n/a | <screenshots/browser assertions>
TESTS: <фактически запущенные focused checks>
NEGATIVE_CHECKS: <что проверено на запрет/конфликт/ошибку>
DOC_DRIFT: none | <точное расхождение>
UNVERIFIED: <что не проверено>
VERDICT: PASS | NEEDS_FIX | BLOCKED
```

Для `L0_LOCAL_UI` и `L1_UI_BEHAVIOR` поля `LAYOUT_IMPACT`, `VIEWPORTS`, `VISUAL_EVIDENCE` обязательны и не могут быть пропущены словом `n/a`, если реально менялись пользовательские DOM/CSS/text/layout.

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
9. Если менялся UI: найдены ли все consumers изменённого shared CSS/компонента и проверены ли затронутые surfaces?
10. Если менялся UI: нет ли text squeeze, page-level overflow, overlap, пустой grid-колонки, обрезанного primary CTA или дублированного empty-state?
11. Если менялся UI: проверены ли 1440/1024/390/320 и применимые populated/empty/loading/error/disabled/long-content состояния?

`NEEDS_FIX` означает: исполнитель исправляет найденную проблему и повторяет review. `BLOCKED` означает реальную зависимость/решение владельца; это не способ остановиться вместо исправления своей ошибки.

## 3. UI_LAYOUT_REVIEW

Для каждого L0/L1 изменения пользовательского интерфейса до `PASS` обязательно применяется `ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md`.

Минимальный порядок:

1. определить изменённые selectors/components/text и их impact radius;
2. найти все consumers shared selector/component;
3. проверить desktop 1440, compact 1024, mobile 390 и narrow mobile 320;
4. проверить long-content и все применимые UI states;
5. подтвердить отсутствие неразрешённого horizontal page scroll;
6. сделать browser evidence для 1440 и 390; для milestone/release — для всех четырёх viewport;
7. если пользователь или screenshot уже показал дефект, добавить regression check именно по причине дефекта;
8. если хотя бы одна затронутая surface визуально сломана, `VERDICT = NEEDS_FIX`, даже если unit/e2e/CI функционально зелёные.

Нельзя чинить только один screenshot, если изменённый shared selector используется ещё на других страницах.

### 3.1. Functional-first UI review

Если владелец явно зафиксировал functional-first sequencing, L0/L1 шаг может завершиться с `FUNCTIONAL_ACCEPTANCE=PASS` и `VISUAL_STATE=provisional`, но только если выполнен минимальный usability gate из `ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md` §10A. Такой PASS означает «действие безопасно и доступно», а не «экран окончательно сверстан».

Перед `DEMONSTRATED`, owner visual acceptance или release-candidate UI выполняется отдельный полный `VISUAL_ACCEPTANCE`. Запрещено использовать provisional layout как основание не проверять overflow/overlap/CTA/focus уже на функциональном шаге.

## 4. CHALLENGE_REVIEW

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
- отсутствие скрытого fallback к legacy writer/read path;
- для release candidate с UI: отсутствие известных layout regressions на изменённых основных surfaces.

## 5. Стоимость проверки

Нельзя заменять этот протокол глобальным аудитом после каждой мелкой правки.

- L0: component/surface self-review + layout-impact review + focused UI test;
- L1: self-review + layout-impact review + affected behavior tests;
- L2: self-review + domain contract + command/read-model tests; если L2 меняет UI, также применяется UI layout contract;
- L3: self-review + challenge review + compatibility/security tests; если L3 меняет UI, также применяется UI layout contract;
- milestone/candidate: independent critical review + declared full gates + visual acceptance изменённых основных surfaces.

Проверяется не весь проект после каждого пикселя, а **изменённая surface плюс все реальные consumers затронутого shared CSS/компонента**. Это сохраняет малый контекст и одновременно предотвращает регрессии соседних страниц.

Цель review — раннее обнаружение смысловой и визуальной ошибки при минимальном контексте, а не производство длинного отчёта.
