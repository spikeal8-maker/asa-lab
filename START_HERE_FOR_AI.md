# START_HERE_FOR_AI — вход coding-агента в ASA Lab

Этот файл постоянный. В нём никогда не должно появляться конкретной задачи,
ветки, Issue, PR или SHA — только порядок действий. Актуальное состояние живёт
в одном месте: [`docs/execution/current.yaml`](docs/execution/current.yaml).

Если ты нашёл здесь захардкоженный `TASK-…` или SHA — это дефект управляющей
инфраструктуры. Исправь его вместе с текущей работой.

## 1. Прочитай политику

```text
AGENTS.md
```

Там правила Git, безопасности, портов, данных и критерии остановки. Политика не
зависит от того, какая задача активна.

## 2. Получи короткий контекст направления

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
```

Команда читает [`docs/execution/current.yaml`](docs/execution/current.yaml) и
выводит только выбранное направление: задачу, checkpoint, gates, относящиеся к
нему документы и пересекающиеся незавершённые файлы. Это штатный вход агента;
полный `current.yaml` нужен только при изменении состояния или диагностике
control plane.

Поле `development_policy` определяет способ работы. При `mode: direct_main`
единая актуальная версия разрабатывается непосредственно в `main`. Исторические
`execution_lease`, branch, PR и `owned_paths` не являются разрешениями и не
блокируют работу.

Even in `direct_main`, a feature branch MUST NOT select its own execution task:
`docs/execution/current.yaml` is changed and accepted on `main` first, then product
branches inherit that canonical state. A product branch editing `current.yaml` to
authorize itself is a governance failure.

Ни один другой файл не является источником этих значений. Если
`EXECUTION_MANIFEST.yaml`, `project-map.yaml`, `QUALITY_MAP.md`, тело PR или
комментарий в чате противоречат `current.yaml` — прав `current.yaml`, а
расхождение является ошибкой, которую нужно устранить, а не обойти.

## 3. Проверь, что состояние не разъехалось

```bash
pnpm control-plane:check
```

Проверка подтверждает целостность YAML, обязательных gates и инженерных
инвариантов. В режиме `direct_main` устаревшие lease, branch и PR не проверяются.
Реальное повреждение структуры исправляется до продуктовой работы.

## 4. Проверь Git

```bash
git remote -v
git status --short --branch
git fetch origin main
git switch main
git pull --ff-only origin main
git rev-parse HEAD
```

Не удалять untracked backups, credentials и owner screenshots. Не использовать
force-push, reset --hard, rebase опубликованной истории или tag без отдельного
поручения владельца.

Если задача выполняется в отдельной feature-ветке, перед изменением общих файлов
(`package.json`, lockfile, execution/control-plane, shared infrastructure) обязательно
сравни её с текущим `main`. Если ветка отстаёт или разошлась, сначала выполни
неразрушающую конвергенцию с `main`, сохрани актуальное состояние `main` и повтори gates.
Не регенерируй lockfile из устаревшей базы и не откатывай security-fix, уже принятый в
`main`.

## 5. Проверь параллельную работу

Проверь `git status`, существующие worktree и затрагиваемые файлы. Не удаляй и
не перезаписывай чужие незавершённые изменения. Lane и `owned_paths` можно
использовать как подсказки о расположении модулей, но не как запрет записи.

## 6. Чтение по задаче

```text
AGENTS.md
→ pnpm agent:context --scope <lane>
→ документы и точные разделы из блока read
→ GitHub Issue из результата команды, если нужен полный scope
```

Для задач о пользователях, доступах, профилях, меню и кабинетах основной
продуктовый источник —
[`ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`](docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md).
Прочитай его §0, затем нужный паспорт персонажа §34, permissions §6 и нужный
экран; не загружай весь архив спецификаций. Логические P/U/R обозначения —
сценарии, способы входа и scoped обязанности, а не глобальные типы аккаунта.

### Visual Programming / Scratch

Для `Визуального программирования` используется отдельный token-efficient router:

[`docs/product/visual-programming/README.md`](docs/product/visual-programming/README.md).

Не читай весь Scratch-раздел по умолчанию. Сначала определи профиль работы. Scratch coding
или review начинается только когда `docs/execution/current.yaml` содержит точный выбранный
Scratch task/scope; readiness или текст запроса сами по себе execution state не заменяют.

#### Milestone / VSCR implementation

Для выбранного milestone/sub-slice:

```text
точный VSCR task ID уже выбран в current.yaml
→ README router
→ readiness/order из VSCR-M1-FORWARD-PLAN-2026-09-11.md
→ точная tasks/<selected-task>.md
→ Master §0–§4 + selected task stub
→ ADR-VSCR-001
→ COMPONENT_MAP.yaml
→ только указанные task card subsystem entries
→ только mapped D0 contract sections/source/tests
```

Основной стабильный продуктовый источник —
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md),
архитектурное решение —
[`ADR-VSCR-001`](docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

Readiness хранится только в
[`VSCR-M1-FORWARD-PLAN-2026-09-11.md`](docs/product/visual-programming/VSCR-M1-FORWARD-PLAN-2026-09-11.md).
Если выбранный task/sub-slice там `BLOCKED`, coding запрещён. `READY` означает только
возможность отдельного выбора владельцем, а не автоматический старт.

Для executable milestone-среза обязана существовать точная task card. Если её нет, не
восстанавливай реализацию из roadmap, Git history, старого PR, комментария или чата — STOP.
Для M1-003+ и M2/M3 это намеренно: точная card создаётся после принятия реальных
предыдущих интерфейсов.

D0-контракты читаются адресно по task/component mapping, а не все сразу:

```text
VSCR-D0-001 — host / branding / product controls / iframe / fixture storage
VSCR-D0-002 — Project durability
VSCR-D0-003 — asset metadata/object storage
VSCR-D0-004 — runtime capability/current authority/Origin/CORS/CSP
VSCR-D0-005 — deployment/backup/activation
VSCR-D0-006 — immutable Gallery publication/player/remix
VSCR-D0-007 — sb3 compatibility / ZIP safety
```

#### Bounded Scratch maintenance

Для уже реализованной локальной правки вроде «изменить кнопку», «переименовать label»,
«скрыть элемент» Master, ADR и full roadmap **не загружаются автоматически**.

Стандартный путь:

```text
точный bounded maintenance task/scope уже выбран в current.yaml
→ README router
→ COMPONENT_MAP.yaml по human keyword/component ID
→ ровно одна components/*.yaml card
→ ровно один component entry
→ mapped contract section
→ mapped source file(s) / symbols
→ mapped focused test(s)
→ bounded self-review
```

Если component ownership = `upstream_patch`, новый Scratch source patch не создаётся по
аналогии: разрешён только уже принятый patch; новый patch — STOP/design review.

Если routing указывает на отсутствующий implemented source/test, symbol или несуществующий
contract heading, сначала исправь routing defect. Broad repository search допустим только
после явной фиксации причины.

После Scratch implementation/maintenance обязательно выполни:

```bash
node tools/validate-blocks-docs.mjs
```

Для Scratch/VSCR отдельная feature-ветка не имеет права начинать новый slice на
устаревшем shared baseline. Readiness не отменяет обязательную проверку divergence
с текущим `main`; если следующий slice затрагивает workspace dependency graph, lockfile,
execution state или shared infrastructure, repository convergence идёт раньше coding.

Master spec задаёт TARGET, порядок зависимостей и safety gates, но сам по себе
не разрешает выполнять следующий milestone и не заменяет `current.yaml`.

Этот документ определяет TARGET пользователей. Auth определяет протоколы,
Learning Master — академическую семантику, ADR — принятую архитектуру,
`AGENTS.md` — инженерные ограничения. Ни один продуктовый документ не заменяет
разрешение на конкретную работу, tenant/RLS-изменение или deployment.

[`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml),
project map и test catalogs являются справочниками программы, архитектуры и
проверок. Они читаются только когда этого требует конкретная работа; из них
запрещено восстанавливать активную задачу или checkpoint.

Планируемые, ещё не исполнимые тесты лежат отдельно в
[`docs/testing/planned-test-catalog.yaml`](docs/testing/planned-test-catalog.yaml)
и не являются gate.

## 7. Работай и проверяй одним gate

У каждого результата — один скрипт. Локальный агент, focused CI и owner evidence
запускают **одну и ту же** команду; расхождение между ними запрещено.

```bash
pnpm gate:electronics-m1         # focused gate задачи, без браузера
pnpm gate:electronics-m1:browser # браузерный journey — нужен стек
pnpm gate:repository             # governance + code + data, нужен PostgreSQL
```

Список доступных gates читается из `package.json` и `current.yaml`. Не подменяй
gate его частью: `gate:code` без PostgreSQL не равен `gate:repository`, а
focused gate конкретного модуля не заменяет repository gate при изменении shared baseline.

Для owner evidence кэш Nx обязан быть отключён. Значение обязано быть буквально
`true`: Nx сравнивает строку, поэтому `NX_SKIP_NX_CACHE=1` тихо берёт результат
из кэша и доказательством не является.

```bash
NX_SKIP_NX_CACHE=true pnpm gate:repository
```

Убедись по выводу, что задачи выполнились: `Cache: N/N hit (100%)` означает, что
не проверялось ничего.

## 8. Публикация и развёртывание

Перед коммитом, публикацией, обновлением Docker или работой с backup обязательно
следуй единому маршруту
[`docs/delivery/AGENT_CHANGE_WORKFLOW.md`](docs/delivery/AGENT_CHANGE_WORKFLOW.md).
Он разделяет локальную проверку, commit, push, CI, deployment и owner acceptance
и не позволяет принять одно за другое.

## 9. Stop

Останавливайся на условиях из `AGENTS.md` и из `blocking` в `current.yaml`.
В режиме `direct_main` execution lease, product branch, PR и lane ownership не
являются условиями остановки.
