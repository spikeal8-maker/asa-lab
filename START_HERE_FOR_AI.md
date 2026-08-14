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

## 2. Прочитай состояние

```bash
cat docs/execution/current.yaml
```

Поле `development_policy` определяет способ работы. При `mode: direct_main`
единственная актуальная версия разрабатывается непосредственно в `main`.
Исторические `execution_lease`, lane, branch, PR и `owned_paths` не являются
разрешениями и не блокируют работу.

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

## 6. Обязательное чтение по задаче

```text
AGENTS.md
→ docs/execution/current.yaml
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ docs/testing/active-task-tests.yaml
→ GitHub Issue из current.yaml
```

Manifest, project map и active-task registry описывают устройство и тесты
проекта. Они не ограничивают работу только одной задачей или директорией.

Планируемые, ещё не исполнимые тесты лежат отдельно в
[`docs/testing/planned-test-catalog.yaml`](docs/testing/planned-test-catalog.yaml)
и не являются gate.

## 7. Работай и проверяй одним gate

У каждого результата — один скрипт. Локальный агент, focused CI и owner evidence
запускают **одну и ту же** команду; расхождение между ними запрещено.

```bash
pnpm gate:electronics-m1         # focused gate задачи, без браузера
pnpm gate:electronics-m1:browser # браузерный journey, нужен поднятый стек
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

## 8. Stop

Останавливайся на условиях из `AGENTS.md` и из `blocking` в `current.yaml`.
В режиме `direct_main` execution lease, product branch, PR и lane ownership не
являются условиями остановки.
