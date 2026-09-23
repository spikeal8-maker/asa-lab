# START_HERE_FOR_AI — вход coding-агента в ASA Lab

Этот файл постоянный. В нём никогда не должно появляться конкретной задачи,
ветки, Issue, PR или SHA — только порядок действий. Актуальное состояние живёт
в одном месте: [`docs/execution/current.yaml`](docs/execution/current.yaml).

Если ты нашёл здесь захардкоженный `TASK-…` или SHA — это дефект управляющей
инфраструктуры. Исправь его вместе с текущей работой.

## 1. Прочитай политику

```text
AGENTS.md
→ docs/delivery/GITHUB_FIRST_DEVELOPMENT_PROTOCOL.md
```

`AGENTS.md` задаёт правила Git, безопасности, портов, данных и критерии остановки.
Для установки, расписания обновлений и полного экспорта данных входная точка —
[`PORTABLE_OPERATIONS.md`](docs/deployment/PORTABLE_OPERATIONS.md). Сначала найдите
канонический каталог PostgreSQL; не разворачивайте вторую копию из worktree.
GitHub-first protocol задаёт рабочую модель: GitHub хранит каноническое состояние и
изменения, локальный компьютер используется только как короткий runner, а тяжёлые
production Docker/browser/data evidence выполняются в GitHub Actions. Политика не
зависит от того, какая задача активна.

## 2. Выполни один preflight

Обычный вход нового coding-агента — одна команда:

```bash
pnpm agent:preflight --check
```

Для известного направления или локальной правки сразу сузь контекст:

```bash
pnpm agent:preflight --scope <lane> --check
pnpm agent:preflight --path <repo-path> --check
pnpm agent:preflight --surface <SURF-ID> --check
pnpm agent:preflight --control <CTRL-ID> --check
```

Preflight безопасно обновляет только remote-tracking `origin/main`, затем одним
пакетом показывает branch/HEAD/divergence, dirty paths, blockers, gates,
пересечения с грязными worktree, результат control-plane check и тот же scoped
context, который раньше приходилось получать отдельной командой. Он не делает
checkout/reset/clean/kill, не редактирует продукт и не создаёт вторую копию
execution state.

Код `0` при `--check` означает `SAFE_TO_START`. Код `2` означает, что
писать пока нельзя: результат точно различает `RECOVERY_REQUIRED`,
`WAITING_HANDOFF`, execution blocker, неактуальный Git snapshot или повреждение
control plane. Сначала выполни указанное `SAFE_ACTION`; не повторяй прерванную
команду автоматически.

Низкоуровневые `pnpm agent:context` и `pnpm agent:recover` остаются для
диагностики и повторного запроса, но больше не являются обязательной цепочкой
старта. Targeted context берёт Domain Contract и Surface Map из `docs/agent/`,
показывает только связанные implementation paths, invariant IDs и исполнимые
tests, а полный Master оставляет как точечную escalation-ссылку. Если path ещё не
картирован, команда останавливается вместо догадки — используй `--scope` и
добавь отсутствующую карту вместе с изменением.

Значения branch/revisions определены в [контракте revision state](docs/execution/REVISION_STATE_CONTRACT.md). `split_history` показывает датированный snapshot отдельных main/recovery/review refs, а не единый интегрированный HEAD; перед записью обнови GitHub snapshot. Наблюдение не выбирает задачу и не даёт owner acceptance.

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

## 3. Control plane уже входит в preflight

Отдельный `pnpm control-plane:check` нужен только для диагностики самого control
plane. Стандартный preflight уже запускает эту проверку и не возвращает
`SAFE_TO_START`, если она красная.

## 4. Проверь Git

Команды ниже относятся к выбранной работе в `main`. Для существующей feature-ветки
оставайся в её checkout, получи `origin/main` и удалённую task branch через fetch,
проверь divergence и пересечения; не переключайся в `main` автоматически.

```bash
git remote -v
git status --short --branch
git fetch origin refs/heads/main:refs/remotes/origin/main
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
→ документы и точные разделы из вывода
→ GitHub Issue только если нужен полный scope
```

Для локальных изменений Account/Auth/Profile/StudentSeat сначала используй самый узкий
`agent:context --path/--surface/--control`. Он автоматически подаёт компактный
`docs/agent/contracts/identity.yaml`; полный `ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md` читается
только по указанным escalation-разделам. P/U/R обозначения — сценарии, способы входа и
scoped обязанности, а не глобальные типы аккаунта. Личный Account не требует школы, а
StudentSeat не требует предварительной регистрации Account.

### Electronics / Arduino

`pnpm agent:preflight --scope electronics --check` →
[`docs/product/electronics/START_HERE.md`](docs/product/electronics/START_HERE.md).

Preflight является единственным обычным стартом. Если он возвращает
`RECOVERY_REQUIRED`, `WAITING_HANDOFF`, blocker или targeted follow-up, выполни
указанный `SAFE_ACTION`; низкоуровневые `agent:recover` и `agent:context`
используются только для такой диагностики, а не как параллельный порядок старта.

Дальше: component ID → одна subsystem entry → выбранная task card → точные
contracts/symbols/tests. Полный Electronics README не загружается по умолчанию.
Review определяется семантикой выбранного изменения по `AGENT_GUIDE.md` §13;
высокий риск области сам по себе не требует второго агента для inventory.

### Visual Programming / Scratch

Открой [Scratch router](docs/product/visual-programming/README.md), затем точную
task card из `pnpm agent:context --scope visual-programming`. Card ведёт прямо к
одному component entry, нужной секции D0 и source/tests. Master, ADR, roadmap,
AGENT_GUIDE и остальные cards читаются только для конкретного нерешённого вопроса.

Для install/update/repair сначала прочитай
[единый порядок развёртывания Scratch в ASA](docs/deployment/SCRATCH_INSTALLATION.md).
Не начинай с standalone/preview-рецепта: `scratch` уже входит в основной Compose.
Сначала установи, где работает существующая ASA Lab; новый порт или второй
Compose project не являются способом повторного развёртывания её модуля.

Readiness не запускает следующий этап: отдельный product task выбирается владельцем.
Обычное исправление tooling/docs выполняется в разрешённом владельцем объёме;
для него не нужен новый продуктовый milestone. Принятые A/C и pin сохраняются.

Scratch сохраняет делегированный router в общем Document Registry; внутренние
component/task cards не копируются в глобальный Surface Map.

Проверка: `pnpm gate:blocks`; браузер против собранного standalone runtime:
`pnpm gate:blocks --browser`. Общий `gate:repository` остаётся отдельным.

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
`current.yaml` остаётся единственным источником выбранной задачи. Readiness, Master, ADR,
roadmap или текст запроса сами по себе не разрешают следующий Scratch slice. Глобальный
`docs/agent/review-protocol.md` остаётся authority review; Scratch provider может только
усиливать component-specific ownership/risk checks.

Продуктовые TARGET/master документы не являются разрешением на tenant/RLS redesign,
destructive migration, deployment или автоматический старт следующего milestone.
`EXECUTION_MANIFEST.yaml`, project map и test catalogs читаются только когда этого требует
конкретная работа и не используются для восстановления active task/checkpoint. Planned tests
не являются gate.

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
