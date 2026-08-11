# AGENTS.md — обязательный контракт ASA Lab

Этот файл содержит **политику**. Он не содержит состояния.

Активная задача, ветка, Issue, PR, статус, checkpoint, SHA и владелец
execution lease читаются только из
[`docs/execution/current.yaml`](docs/execution/current.yaml). Ни один параграф
ниже не имеет права дублировать эти значения — дубликат состояния и есть та
поломка, из-за которой процесс разъезжается.

Порядок входа описан в [`START_HERE_FOR_AI.md`](START_HERE_FOR_AI.md).

## 1. Единственный писатель в каждом lane

Schema 1.1 в `current.yaml` разрешает несколько одновременно активных,
непересекающихся product lanes. Корневые `task`, `execution_lease` и `gates`
остаются каноническим primary lane для совместимости; дополнительные lanes
живут в `parallel_lanes`.

- В каждом lane держатель его `execution_lease` — единственный исполнитель,
  которому разрешено коммитить в ветку этого lane.
- Любой другой агент автоматически является **read-only reviewer** этого lane:
  читает, анализирует, запускает тесты, публикует отчёт, но не коммитит в его
  продуктовую ветку.
- Писатель работает только в `owned_paths` своего lane.
- Пути из `integration.shared_paths` может менять только lane, указанный в
  `integration.owner_lane`; собственные product paths нельзя объявлять shared.
- `docs/execution/current.yaml` не редактируется ни в одной продуктовой ветке,
  включая ветку integration owner. Переход состояния выполняется отдельной
  governance-веткой.
- Передача лиза или integration ownership выполняется одним явным переходом
  владельца, а не репликой в чате и не правкой документа «попутно».
- Роль нельзя присвоить себе, объявив её в ответе.

Schema 1.0 остаётся допустимой для старых состояний и означает один корневой
lane без параллельных писателей.

Работа вне продуктовой ветки (например, восстановление управляющей
инфраструктуры в отдельной ветке) лиза не требует, но требует явного поручения
владельца.

## 2. Правила Git

- Работать только в ветке своего lane из `current.yaml`, в его `owned_paths`,
  либо в отдельной governance-ветке, явно разрешённой владельцем.
- Запрещены: force-push, `reset --hard` на опубликованную историю, rebase
  опубликованной истории, merge продуктовых веток и создание тегов.
- Запрещено удалять untracked backups, credentials, owner screenshots и
  локальные owner ZIP.
- `main` не редактируется напрямую.
- PR №29 и ветка `assistant/map-ux-owner-view` не трогаются.
- Снятие Draft, merge и активация следующей задачи — только решением владельца.

## 3. Неприкосновенные данные

Запрещено удалять или изменять:

- `apps/web/public/assets/electronics/owner-supplied/**`;
- `apps/web/public/assets/electronics/owner-audit/**`;
- локальные owner ZIP и backups;
- PostgreSQL volume, рабочую БД и backup dumps.

Запрещено: новые SVG, ручная перерисовка, PNG tracing, vectorization,
generated runtime artwork и любая подмена owner SVG.

## 4. Порты и данные

```text
bind: 127.0.0.1
web:  4610
api:  4611
e2e:  4612
preview reserved: 4613
forbidden: 3000, 3100, 5173
```

Один постоянный Compose-проект `asa-lab-dev`. Дополнительные постоянные проекты
не создаются. Изменение tenant/RLS-модели и destructive persistence migration
запрещены.

## 5. Инварианты симуляции

Это долговременные инженерные требования к электрическому ядру, а не статус
задачи. Любой принимаемый пакет обязан их сохранять:

- детерминированный netlist независимо от геометрии провода;
- breadboard hole groups входят в те же электрические сети;
- unsupported component завершает расчёт fail-closed;
- все численные значения конечны: без `NaN` и `Infinity`;
- контролируется максимальная невязка KCL и напряжения идеальных источников;
- одинаковый документ даёт байт-в-байт одинаковый результат;
- браузер пересчитывает локально до завершения autosave;
- сервер повторно использует то же ядро для проверки результата.

Компонент без подтверждённого owner SVG остаётся disabled/missing. Компонент без
электрической модели делает simulation result `unsupported`; solver не имеет
права выдумывать результат для остальной схемы. Ложные токи, напряжения,
яркость и `solved: true` для unsupported topology запрещены.

Детерминизм нумерации сетей не должен зависеть от локали рантайма: сравнение
ключей терминалов выполняется посимвольно, а не через `localeCompare`.

## 6. Gates

У каждого результата ровно один скрипт, и он один и тот же локально, в CI и в
owner evidence run:

```bash
pnpm gate:governance             # валидаторы и согласованность состояния
pnpm gate:code                   # формат, lint, типы, границы, контракты, сборка
pnpm gate:data                   # миграции, полный Vitest, RLS — нужен PostgreSQL
pnpm gate:repository             # governance + code + data
pnpm gate:electronics-m1         # focused: солвер, редактор, типы, сборка
pnpm gate:electronics-m1:browser # реальный браузерный journey — нужен стек
pnpm control-plane:check         # только согласованность состояния
```

Каждый gate называет ровно то, что проверяет. `gate:electronics-m1` намеренно
**не включает** браузерный journey — это отдельный gate, потому что ему нужен
поднятый стек. `gate:repository` включает `gate:data`, поэтому без PostgreSQL он
не пройдёт: PASS без базы означал бы не то же самое, что PASS в CI.

`compose:check` без Docker печатает `SKIPPED`, а не `PASS`, и это не полный
`gate:code` — при отчёте так и указывается.

Правила:

- расхождение между локальной командой и командой в workflow запрещено;
- удалённая часть `control-plane:check` (голова PR, тело PR, записанные
  результаты gates) обязательна везде, где есть токен GitHub; в CI без
  `GH_TOKEN` governance-gate останавливается, а не пропускает проверку;
- `gates.last_known` в `current.yaml` сверяется с фактическим conclusion
  workflow на том же SHA — расхождение это FAIL, а не расхождение мнений;
- owner evidence run обязан выполняться с `NX_SKIP_NX_CACHE=true`; результат из
  кэша Nx не является новым доказательством. Значение обязано быть буквально
  `true` — Nx сравнивает строку, и `NX_SKIP_NX_CACHE=1` молча использует кэш;
- в отчёте указывается, сколько задач Nx выполнил заново: строка
  `Cache: N/N hit (100%)` означает, что ничего не проверялось;
- зелёный автоматический CI сам по себе не является owner acceptance;
- красный `gate:repository` запрещает заявлять release candidate независимо от
  того, что показывает focused gate.

## 7. Критерии остановки

Остановиться и вернуть управление владельцу, если:

- `pnpm control-plane:check` даёт FAIL;
- в `current.yaml` есть незакрытый пункт `blocking`;
- лиз выбранного lane держит другой исполнитель;
- изменение выходит за `owned_paths` выбранного lane или затрагивает
  `integration.shared_paths` без права integration owner;
- задача требует выхода за `required_scope` из
  [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml);
- запрошено то, что запрещено разделами 2–4.

## 8. Отчёт

```text
TASK, ISSUE, STATUS, VISIBLE_RESULT, USER_FLOW, PORTS, DEMO_URLS,
SCREENSHOTS, TESTS_RUN, MAP_NODES_CHANGED, WORKING_TREE, NEXT_ALLOWED_TASK
```

`TESTS_RUN` перечисляет фактически выполненные команды и указывает, был ли
задействован кэш. Заявлять PASS по кэшированному результату запрещено.
