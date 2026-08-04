# AGENTS.md — обязательный контракт ASA Lab

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       67b4f8eea3804d750684dd1c6dce929f5f1f9bfa
active task:             TASK-ELECTRONICS-M1-001
active issue:            #63
active branch:           agent/r4-electronics-m1
active PR:               #72
status:                  in_progress
checkpoint:              m1_convergence_in_progress
sole executor:           coding_bot
assistant role:          read_only_reviewer
execution manifest:      docs/delivery/EXECUTION_MANIFEST.yaml
convergence baseline SHA:f27ac1594761265a326229fa2aa8d841081a5dd8
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml` остаётся каноническим execution
contract. Текущий checkpoint — `m1_convergence_in_progress`: coding-бот является
единственным исполнителем, а assistant работает только как read-only reviewer.
Второй исполнитель не меняет ветку до завершения convergence.

## 2. Цель текущего прохода

Не добавляя возможностей, привести существующий Electronics M1 к единому
release candidate:

```text
один owner-catalog
→ один проверяемый runtime
→ focused/common CI
→ один exact SHA
→ один asa-lab-dev
→ один настоящий owner flow
```

R4-M2, новые component families и расширение solver остаются заблокированы.

## 3. Разрешённый scope

Работать только в `agent/r4-electronics-m1` и PR №72.

Разрешено:

- укреплять `contexts/electronics/domain/netlist.ts` и DC solver;
- добавлять fail-closed simulation contract и численные quality checks;
- исправлять ложный `solved: true` для неподдерживаемых схем;
- реализовывать локальный интерактивный перерасчёт тем же общим ядром;
- улучшать модели уже существующих R4-M1 компонентов без добавления новых;
- добавлять focused golden tests, diagnostics и browser smoke;
- обновлять execution/test contracts в пределах TASK-ELECTRONICS-M1-001.

## 4. Неприкосновенные данные и запреты

Запрещено удалять или менять:

- `apps/web/public/assets/electronics/owner-supplied/**`;
- `apps/web/public/assets/electronics/owner-audit/**`;
- локальные owner ZIP и backups;
- PostgreSQL volume, рабочую БД и backup dumps;
- `main`;
- PR №29 и ветку `assistant/map-ux-owner-view`.

Также запрещено:

- новые SVG, ручная перерисовка, PNG tracing или vectorization;
- generated runtime artwork и подмена owner SVG;
- новая ветка, merge PR №72 или перевод из Draft без решения владельца;
- R4-M2, transient solver, Arduino, micro:bit и новые component families;
- изменение tenant/RLS модели или destructive persistence migration;
- ложные токи, напряжения, яркость или `solved: true` для unsupported topology.

Компонент без подтверждённого owner SVG остаётся disabled/missing. Компонент без
электрической модели делает simulation result `unsupported`; solver не имеет
права выдумывать результат для остальной схемы.

## 5. Обязательные simulation contracts

Первый принимаемый пакет должен доказать:

- deterministic netlist независимо от геометрии провода;
- breadboard hole groups входят в те же электрические сети;
- unsupported component завершает расчёт fail-closed;
- все численные значения конечны: без `NaN` и `Infinity`;
- контролируется максимальная невязка KCL и напряжения идеальных источников;
- одинаковый документ даёт байт-в-байт одинаковый результат;
- браузер пересчитывает локально до завершения autosave;
- сервер повторно использует то же ядро для проверки результата.

## 6. Focused checks

До следующего owner checkpoint запускать только релевантные проверки:

```text
pnpm test:electronics
pnpm vitest run apps/web/src/electronics/testing
pnpm lint
pnpm typecheck
pnpm build
один actual-editor browser smoke
```

Full repository matrix вручную не запускать. Автоматический CI репозитория не
считать owner acceptance. После focused PASS PR остаётся Draft; merge и R4-M2
по-прежнему запрещены.
