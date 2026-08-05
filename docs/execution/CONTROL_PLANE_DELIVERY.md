# Доставка control plane в `main`

Этот документ — часть управляющей инфраструктуры, а не заметка. Пока он не
выполнен, `main` продолжает отправлять свежего агента в завершённую ветку, и
проект нельзя считать стабилизированным целиком.

## Что сейчас на `main`

Каноническая ветка объявляет задачу, законченную и влитую (PR №71), сразу в
четырёх местах:

| Файл | Объявляет |
|---|---|
| `START_HERE_FOR_AI.md` | `TASK-CREATOR-PORTAL-001`, Issue №62, `agent/r2-creator-portal` |
| `docs/delivery/EXECUTION_MANIFEST.yaml` | `active_task: TASK-CREATOR-PORTAL-001` |
| `docs/testing/active-task-tests.yaml` | `active_task: TASK-CREATOR-PORTAL-001` |
| `tools/validate_test_catalog.py` | `ACTIVE_TASK = "TASK-CREATOR-PORTAL-001"` |

Агент, выполнивший `START_HERE_FOR_AI.md` буквально, сделает
`git switch agent/r2-creator-portal` и начнёт работать не над тем.

`main` также содержит собственную версию той же проблемы с каталогом тестов:
30 из 56 зарегистрированных команд `pnpm` там не существуют.

## Почему нельзя просто перенести коммиты

Cherry-pick контрольных коммитов на `main` даёт конфликт в 11 файлах. Причина не
техническая: control plane сцеплен с R4-содержимым.

```text
на ветке есть, на main нет:
  .github/workflows/electronics-r4-m1-focused.yml
  docs/delivery/TASK_ELECTRONICS_M1_001_WORK_STATUS.md
  e2e/electronics-simulation.spec.ts

manifest на main знает только 4 задачи, до R2 включительно;
R3A и Electronics M1 в нём отсутствуют как записи вообще
```

Перенести всё целиком — значит затащить в `main` состояние R4 без кода R4.

## Ключевое ограничение

Реестр тестов активной задачи принадлежит **ветке задачи**, а не `main`.

`docs/testing/active-task-tests.yaml` для Electronics M1 ссылается на спеки,
которые физически лежат в `agent/r4-electronics-m1`. Новая проверка
исполнимости в `validate_test_catalog.py` требует, чтобы указанные файлы
существовали. Значит, положить R4-реестр на `main` без кода R4 нельзя: проверка
честно упадёт.

Отсюда следует двухслойная модель.

```text
main несёт          repo-wide слой:
                    постоянный START_HERE, политику AGENTS.md, валидаторы,
                    gate-скрипты, стабильный каталог тестов и его плановую
                    половину, и current.yaml с указанием активной задачи,
                    её ветки и PR

ветка задачи несёт  task слой:
                    active-task-tests.yaml, task-specific workflow,
                    evidence и рабочий статус задачи
```

## План

### Шаг 1. Принять PR №73

Control plane сначала должен быть проверен там, где он полностью согласован с
реальностью. Делать доставку в `main` раньше — значит переносить конструкцию,
которую ещё не приняли.

### Шаг 2. Разделить проверку реестров по слоям

`validate_test_catalog.py` проверяет исполнимость реестра активной задачи только
когда рабочая копия действительно содержит ветку задачи:

```bash
git merge-base --is-ancestor "origin/${task.branch}" HEAD
```

Если ветки в истории нет — это `main` или другая ветка, и валидатор:

- **не** требует наличия спеков активной задачи локально;
- **требует**, чтобы `task.branch` существовала на remote;
- **требует**, чтобы `active-task-tests.yaml` на этой ветке объявляла ту же
  задачу, что и `current.yaml`;
- печатает, какой слой он проверил, а какой — нет.

Это условие, а не тихий пропуск: альтернативные проверки продолжают работать, и
результат всегда назван вслух.

### Шаг 3. Собрать ветку `chore/control-plane-main` от `main`

Переносится только repo-wide слой:

```text
START_HERE_FOR_AI.md
AGENTS.md
docs/execution/current.yaml
docs/execution/CONTROL_PLANE_DELIVERY.md
docs/testing/test-catalog.yaml          (со своим разделением)
docs/testing/planned-test-catalog.yaml  (30 команд main, которых нет)
tools/validate_control_plane.py
tools/gate-governance.sh
tools/validate_test_catalog.py
tools/validate_project_map.py
tools/validate_delivery_program.py
tools/validate-compose.mjs
package.json                            (gate-скрипты)
.github/workflows/spec-validation.yml
```

Не переносится: focused workflow, рабочий статус задачи, R4-скриншоты,
`audit_owner_electronics_assets.py`, `validate_owner_electronics_runtime.py`,
R4-записи в `active-task-tests.yaml`.

Все базовые скрипты, которых требуют `gate:code` и `gate:data`, на `main` уже
есть — отдельного переноса они не требуют.

### Шаг 4. Внести R3A и Electronics M1 в манифест и карту `main`

Как **governance-записи**: id, Issue, ветка, статус, зависимость. Без кода и без
evidence. `main` обязан знать, какая работа в полёте, иначе `current.yaml` на нём
противоречит остальным документам и валидатор упадёт справедливо.

### Шаг 5. Прогнать и открыть PR в `main`

```bash
NX_SKIP_NX_CACHE=true pnpm gate:governance
NX_SKIP_NX_CACHE=true pnpm gate:code
```

`gate:data` — в CI, где есть PostgreSQL.

### Шаг 6. Закрыть блокер

После merge удалить `BLOCK-MAIN-MISDIRECTS-AGENTS` из `current.yaml`. Сверка
`gates.last_known` с фактическими conclusion сделает устаревшую запись ошибкой,
а не незамеченной ложью.

## Проверка результата

Свежий clone `main` обязан удовлетворять:

```bash
grep -c "agent/r2-creator-portal" START_HERE_FOR_AI.md   # 0
pnpm control-plane:check                                  # PASS
```

и указывать на актуальную задачу из `docs/execution/current.yaml`, а не на
завершённую.
