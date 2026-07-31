# BOT_RUNBOOK — coding-агент ASA Lab

## Назначение

Coding-агент пишет product code только по одной активной task. GitHub/governance аудит старых PR выполняется отдельно и не является поводом держать активного coding-агента без работы.

## Источники

```text
AGENTS.md
→ docs/project-map/infrastructure-focus.yaml
→ docs/project-map/project-map.yaml
→ docs/delivery/EXECUTION_MANIFEST.yaml
→ GitHub Issue активной задачи
→ docs/testing/test-catalog.yaml
```

Человеко-читаемые нормативные представления:

- [`DEVELOPMENT_PROGRAM_V1.md`](DEVELOPMENT_PROGRAM_V1.md);
- [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md);
- [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml);
- [`../project-map/PROJECT_MAP.md`](../project-map/PROJECT_MAP.md);
- [`../project-map/QUALITY_MAP.md`](../project-map/QUALITY_MAP.md).

## ORIENT

```bash
git remote -v
git status --short --branch
git fetch --all --prune
git rev-parse HEAD
git rev-parse origin/main
```

Не удалять backups, credentials и owner screenshots. Не использовать force-push/reset-hard и не завершать неизвестные процессы.

## Каноническое состояние

```text
canonical branch:        main
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
PR #70:                  merged
TASK-ACCOUNT-C1-001:     done
Issue #48:               completed
active task:             none
```

Текущий head `main` всегда определяется через `git rev-parse origin/main`; post-merge governance commits делают его новее product merge SHA. `main` — источник текущей Alpha-сборки.

## Когда active task отсутствует

Ожидаемый ответ coding-агента:

```text
NO_ACTIVE_TASK
```

После этого агент не пишет product code и не выбирает R2/R3/R4 самостоятельно.

Governance-работа в этот момент выполняется отдельно:

- синхронизация manifests/maps/Issues;
- аудит старых PR;
- категории `contained / superseded / still valuable / obsolete`;
- закрытие и удаление только по отдельному решению.

## Как активируется следующая task

Owner transition обязан одновременно опубликовать:

```text
task ID
Issue
branch
status ready/in_progress
current_focus
depends_on
scope and non-goals
test IDs
stop condition
```

После этого coding-агент сразу выполняет один вертикальный flow:

```text
domain/application
→ additive migration/repository
→ API
→ UI
→ focused tests
→ live browser E2E
→ evidence
→ owner review
→ stop
```

## Первый отчёт активной task

Не более 25 строк:

```text
TASK:
ISSUE:
BRANCH:
HEAD:
BASELINE:
STATUS:
DEPENDENCIES:
ALREADY_IMPLEMENTED:
USER_FLOW:
NON_GOALS:
PORTS:
FOCUSED_TESTS:
STOP_CRITERION:
```

Не запрашивать merge target, tag или имя следующей ветки, если они не требуются текущему slice.

## Scope freeze

После `in_progress` разрешены только:

- текущий user flow;
- необходимые contracts и additive migrations;
- API/UI текущего flow;
- security/RLS/compatibility fixes;
- focused tests, E2E и review feedback.

Запрещены следующая capability, unrelated refactoring, competing branch, ослабление tests/RLS и переписывание применённых migrations.

## Порты

Нормативная политика: [`LOCAL_PORT_POLICY.md`](LOCAL_PORT_POLICY.md).

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

## Проверки

Точная матрица активной задачи берётся из [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml) и [`../testing/test-catalog.yaml`](../testing/test-catalog.yaml).

Общий governance минимум:

```bash
python tools/validate_infrastructure_focus.py
python tools/validate_project_map.py
python tools/validate_test_catalog.py
python tools/validate_delivery_program.py
```

Для product task:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm build
pnpm test
```

`PASS` — только реальный exit `0`. `BLOCKED` и `NOT_RUN` не закрывают gate.

## GitHub Actions

Hosted runner сейчас может завершаться до первого шага (`steps: []`). Это внешний blocker, а не доказанный code failure. CI не считается PASS.

## Git

- новая product branch создаётся только после task activation;
- branch стартует от актуального `main`;
- force-push и rewrite истории запрещены;
- старые PR не merge/close/delete без preservation audit;
- backups, dumps и credentials не коммитятся.

## Completed Account C1 evidence

```text
implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
merge:          e01ac85095ddaabef19ed618964deac3aa5b2406
Account gate:   28/28 PASS
Regression:     298/298 PASS
Playwright:     9/9 PASS
Browser errors: 0
```

Эта task закрыта и не возобновляется как активная.

## Blocked roadmap

```text
R2 Creator Portal     blocked
R3 Project lifecycle  blocked
R4 Electronics parity blocked
```

Roadmap активируется только отдельным owner transition.
