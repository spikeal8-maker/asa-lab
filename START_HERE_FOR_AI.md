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

Корневые `task`, `execution_lease` и `gates` описывают primary lane. При schema
1.1 прочитай также `primary_lane`, каждый элемент `parallel_lanes` и
`integration`: оттуда берутся lane, ветка, lease, `owned_paths`, shared paths и
единственный integration owner. Schema 1.0 означает один корневой lane.

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
git switch "<branch выбранного lane из current.yaml>"
git pull --ff-only
git rev-parse HEAD
```

Не удалять untracked backups, credentials и owner screenshots. Не использовать
force-push, reset --hard, rebase опубликованной истории, merge или tag.

## 5. Выбери lane и проверь execution lease

Для primary lane используется корневой `execution_lease`; для дополнительного
lane — его собственный `execution_lease`. Каждый lease определяет единственного
писателя только в соответствующую продуктовую ветку и только в её
`owned_paths`.

- лизом выбранного lane владеешь ты → работай в пределах его `owned_paths`;
- лиз держит кто-то другой → ты **reviewer**: читай, запускай тесты, отчитывайся,
  но не коммить в продуктовую ветку этого lane;
- `holder: unassigned` → продуктовая работа не начата; получи лиз у владельца
  одним явным переходом, прежде чем писать код.

Shared paths меняет только `integration.owner_lane`. Даже он не редактирует
`docs/execution/current.yaml` в продуктовой ветке: состояние меняется отдельным
governance PR.

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

Manifest, project map и active-task registry пока сверяются с primary lane для
обратной совместимости. Параллельный lane не переписывает их под себя.

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

Список gates выбранного lane и то, что каждый из них покрывает, читается из его
`gates` в `current.yaml` (для primary — из корневого `gates`). Не подменяй gate его частью: `gate:code` без
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
Перевод задачи в `in_review`, merge, снятие Draft и активация следующей задачи —
только решением владельца.
