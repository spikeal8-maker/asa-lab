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

Для задач `Визуального программирования` / Scratch-compatible runtime основной
продуктовый источник —
[`ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md`](docs/product/ASA_VISUAL_PROGRAMMING_SCRATCH_MASTER_SPEC.md).
Сначала прочитай его §0–§4, затем только раздел выбранного VSCR task ID и
[`ADR-VSCR-001`](docs/architecture/ADR-VSCR-001-SCRATCH-EDITOR-INTEGRATION.md).

Для любого VSCR task, который затрагивает Scratch host, Project persistence,
asset storage, runtime security/origin или deployment/activation, дополнительно
обязательно прочитай соответствующий implementation contract в
[`docs/product/visual-programming/`](docs/product/visual-programming/):

```text
VSCR-D0-001 — Scratch host
VSCR-D0-002 — Project persistence guard
VSCR-D0-003 — asset metadata/object storage
VSCR-D0-004 — runtime capability/CORS/CSP/rate limits
VSCR-D0-005 — deployment/backup/activation
```

Для coding-задач первой волны `VSCR-M0.1-001` и `VSCR-M1-001…005` обязательно
прочитай также точный task package в
[`VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md`](docs/product/visual-programming/VSCR-IMPLEMENTATION-PACKAGES-M0.1-M1.md).
Master/ADR/D0 объясняют архитектуру; task package фиксирует конкретные paths,
шаги, тесты, запреты и Definition of Done для одного coding slice.

Если выбранного coding task ID нет в актуальном implementation-package документе,
не восстанавливай его из общего roadmap и не придумывай детали самостоятельно —
STOP и запроси/подготовь отдельный task package. Для M2/M3 это специально
обязательное правило: их task packages создаются только после принятия реальных
интерфейсов предыдущего milestone.

Если master spec требует D0 prerequisite, а соответствующий D0 contract отсутствует,
противоречит коду или не принят для выбранной границы — STOP. Coding-агенту
запрещено самостоятельно выбирать альтернативную архитектуру и продолжать M1.

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
gate его частью: `gate:code` без
PostgreSQL не равен `gate:repository`, а `gate:electronics-m1` не включает
браузер.

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