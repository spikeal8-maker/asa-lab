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
execution mode:          assistant_simulation_implementation
coding bot:              STOP — do not modify or push
execution manifest:      docs/delivery/EXECUTION_MANIFEST.yaml
simulation baseline SHA: efc6faf043525498b1d613d7c58ae52ac4f417e7
owner-confirmed archive: C5BFD26760DB7A92D06E0B51B0BDE3BB45595278A762BAB3AB9198ABB04B4D75
```

`docs/delivery/EXECUTION_MANIFEST.yaml` остаётся каноническим execution
contract. После явной команды владельца «реализуй» текущий checkpoint переведён
из визуального recovery в `simulation_implementation_in_progress`.

Coding-бот обязан остановиться на чтении этого файла. Он не должен выполнять
pull, rebase, commit, push, Docker-запуски или публикацию отчётов. Реализацию
выполняет текущий assistant непосредственно в существующей ветке и PR №72.

## 2. Цель текущего прохода

Построить детерминированное R4-M1 DC-ядро, а не набор визуальных эффектов:

```text
document + pins + wires + breadboard connectivity
→ validated netlist
→ device models
→ DC solve
→ numerical quality checks
→ diagnostics
→ owner SVG states
```

Расчёт в браузере и на сервере должен использовать одно общее чистое ядро.
Изменение кнопки, SPDT, потенциометра, сопротивления или соединения должно
немедленно пересчитывать локальный результат; сохранение выполняется отдельно и
не блокирует уже запущенное моделирование.

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
