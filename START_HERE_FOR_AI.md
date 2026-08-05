# START_HERE_FOR_AI — вход coding-агента в ASA Lab

Этот файл постоянный. В нём никогда не должно появляться конкретной задачи,
ветки, Issue, PR или SHA — только порядок действий. Актуальное состояние живёт
в одном месте: [`docs/execution/current.yaml`](docs/execution/current.yaml).

Если ты нашёл здесь захардкоженный `TASK-…`, `agent/…` или SHA — это дефект
управляющей инфраструктуры. Останови работу и сообщи владельцу.

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

Оттуда берутся: `task.id`, `task.issue`, `task.branch`, `task.pr`,
`task.status`, `task.checkpoint`, `execution_lease` и список `blocking`.

Ни один другой файл не является источником этих значений. Если
`EXECUTION_MANIFEST.yaml`, `project-map.yaml`, `QUALITY_MAP.md`, тело PR или
комментарий в чате противоречат `current.yaml` — прав `current.yaml`, а
расхождение является ошибкой, которую нужно устранить, а не обойти.

## 3. Проверь, что состояние не разъехалось

```bash
pnpm control-plane:check
```

Проверка сравнивает `current.yaml` с фактическим Git, remote HEAD, головой PR,
телом PR и остальными документами. При FAIL — сначала чинится рассинхрон,
никакой продуктовой работы.

## 4. Проверь Git

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git switch "$(python3 -c 'import yaml;print(yaml.safe_load(open("docs/execution/current.yaml"))["task"]["branch"])')"
git pull --ff-only
git rev-parse HEAD
```

Не удалять untracked backups, credentials и owner screenshots. Не использовать
force-push, reset --hard, rebase опубликованной истории, merge или tag.

## 5. Проверь execution lease

`execution_lease.holder` в `current.yaml` определяет единственного писателя в
продуктовую ветку.

- лизом владеешь ты → работай в пределах разрешённого scope;
- лиз держит кто-то другой → ты **reviewer**: читай, запускай тесты, отчитывайся,
  но не коммить в продуктовую ветку;
- `holder: unassigned` → продуктовая работа не начата; получи лиз у владельца
  одним явным переходом, прежде чем писать код.

Читать репозиторий, запускать тесты и публиковать отчёт можно без лиза.

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

Планируемые, ещё не исполнимые тесты лежат отдельно в
[`docs/testing/planned-test-catalog.yaml`](docs/testing/planned-test-catalog.yaml)
и не являются gate.

## 7. Работай и проверяй одним gate

У каждого результата — один скрипт. Локальный агент, focused CI и owner evidence
запускают **одну и ту же** команду; расхождение между ними запрещено.

```bash
pnpm gate:electronics-m1     # focused gate текущей задачи
pnpm gate:repository         # общий gate репозитория
```

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
Перевод задачи в `in_review`, merge, снятие Draft и активация следующей задачи —
только решением владельца.
