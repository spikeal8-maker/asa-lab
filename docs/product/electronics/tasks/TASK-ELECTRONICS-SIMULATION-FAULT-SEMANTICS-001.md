---
task_id: TASK-ELECTRONICS-SIMULATION-FAULT-SEMANTICS-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md#второй-рубеж-запуск-не-превращает-любую-ошибку-в-непонятное-выключение
acceptance_boundary: slice
review: independent
---

# Причина остановки моделирования и классы отказа

Программа: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Ограниченный ремонт: [#463](https://github.com/spikeal8-maker/asa-lab/issues/463). Восстановление ресурсов [#462](https://github.com/spikeal8-maker/asa-lab/issues/462) технически принято отдельно; его результат не доказывает причину остановки расчёта.

## Один пользовательский результат

Когда запуск останавливается, ученик видит различимую фактическую причину: состояние электрической схемы или отсутствие достоверного результата не называется ошибкой неотвечающего Worker. Технический отказ имеет понятный путь повторного запуска. Индикатор работы не остаётся активным без продвижения расчёта; схема, её история и несохранённые изменения сохраняются.

## Вход и проверка границы

На опубликованном снимке scheduler выдаёт `electrical_sample_failed`, `electrical_quality_failed` и `physical_advance_failed`; `ElectronicsLiveSimulationWorkerController` передаёт `onFailure(error)`, а `use-electronics-workbench.ts` игнорирует `error`, сбрасывает запуск и показывает общий текст о неотвечающем модуле. Перед записью проверить это на свежем `main`: `pnpm agent:preflight --scope electronics --check`, статус Issue/CI, пересечения с чужими файлами и `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-SIMULATION-FAULT-SEMANTICS-001`. Если preflight сообщает `RECOVERY_REQUIRED` или `WAITING_HANDOFF`, классифицировать diff и процессы; не переписывать чужую работу.

Маршрут: `COMPONENT_MAP.yaml` → `components/engine-worker-clock.yaml`, entries `electronics.worker.protocol`, `electronics.worker.live-controller` и `electronics.engine.public-api`; для подтверждённого scheduler fault — `components/arduino-peripherals.yaml`. Читать точные символы и тесты из карточек, а не повторять инвентаризацию всей электроники.

## Ограниченный scope

- Сначала записать маленькую таблицу диагностических классов и переходов состояния на основе фактического Worker protocol, scheduler, solver result и UI. Разделить поддерживаемую разомкнутую/неполную цепь, unsupported/non-convergent результат, электрический/физический fault, Worker/protocol/timeout, намеренный Stop, добавление детали и stale reply. Не объявлять каждую ошибочную схему технической поломкой.
- Провести типизированную причину от места возникновения через Worker/controller до UI без потери кода; минимально исправить отображение и переход в остановленное состояние. Повторный запуск после recoverable technical fault должен быть предсказуемым. Сохранить честный `unsupported` и запрет ложных токов, напряжений, яркости и `solved: true`.
- Не менять solver, физические модели, netlist, семантику сохранения, document IDs, соединения, origin/авторизацию и рабочую установку ради текста ошибки. Если подтверждённый дефект физики требует отдельного scope или продуктового решения раздела 7 ТЗ, зафиксировать его и остановить этот срез для отдельного выбора; не подменять диагностикой ремонт физики.
- Изменять только доказанные пути Worker/controller/UI и направленные тесты. Соседние Arduino, CSS, decomposition, asset cleanup и classroom/FRP нагрузка не входят в #463. Не трогать чужие незавершённые изменения.

## Acceptance

1. На контролируемых production-code сценариях причина сохраняется до UI с исходным классом/кодом; разомкнутая поддерживаемая цепь и unsupported/non-convergent результат не превращаются в общий «Worker не отвечает». Ошибка протокола/исполнения/тайм-аут показана отдельно и не выдаёт успешный электрический результат.
2. Running-индикатор гаснет при fault/Stop и не остаётся активным без продвижения. После recoverable technical failure новый запуск идёт на актуальном документе; поздний ответ старого поколения игнорируется. Намеренный Stop и успешное добавление одной детали остаются различимыми штатными действиями.
3. Реально собранный браузерный редактор проверен до/после на обычной и ошибочной схеме, technical Worker failure, позднем ответе и повторном запуске. Ошибка сохранения и отказ картинки не маскируются как simulation fault; схема и её несохранённое состояние не теряются.
4. `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` и `git diff --check` проверены на точном финальном SHA; другой агент независимо проверяет фактический diff, браузерный результат и GitHub state. Красный unrelated CI классифицируется по `AGENTS.md` §2.1 и не расширяет ремонт.

## Остановка

Исполнитель делает один bounded candidate, focused gate, self-review, отчёт и STOP. Независимый reviewer проверяет exact SHA, сообщает APPROVE/REQUEST_CHANGES и STOP. Контроллер проводит необходимые отдельные ремонты, интеграцию и closeout, затем продолжает программу #452. Owner acceptance и deployment остаются отдельными действиями.
