---
task_id: TASK-ELECTRONICS-TOUCH-WIRE-AFTER-UNDO-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md#третий-рубеж-предсказуемые-жесты-и-завершение-размещения
acceptance_boundary: slice
review: independent
---

# Мобильное начало провода после Undo

Программа: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Отдельный blocker repair: [#461](https://github.com/spikeal8-maker/asa-lab/issues/461). Он не расширяет ремонты ресурсов [#453](https://github.com/spikeal8-maker/asa-lab/issues/453), Arduino Reset [#456](https://github.com/spikeal8-maker/asa-lab/issues/456) или LED thermal [#457](https://github.com/spikeal8-maker/asa-lab/issues/457).

## Доказанный вход

Точный `main` `f406da311253383c62ed547869a5da13a5d42bba` прошёл [общий CI 36929596858](https://github.com/spikeal8-maker/asa-lab/actions/runs/36929596858), но [Electronics browser 36929619491](https://github.com/spikeal8-maker/asa-lab/actions/runs/36929619491) дал 93/94. Единственный отказ: `R3 native matrix 390x844` в `e2e/electronics-interactions.spec.ts:3011` после Undo не увидел `.workbench-wire-preview` за 5 секунд. Сценарии восстановления ресурсов, Reset и LED thermal прошли.

В сохранённом trace касание свободной `BAT+` в точке `(289.79, 370.61)` доставило `pointerdown`, `touchstart`, `gotpointercapture`, `pointerup`, `touchend` и `click`; DOM показывал свободную клемму. Этого недостаточно для вывода о причине: нужно различить состояние редактора после Undo, асинхронную синхронизацию и ошибку тестового ввода. Предыдущие точные кандидаты проходили полный browser gate на том же пути.

## Граница

Primary route: `electronics.ui.workbench` в `COMPONENT_MAP.yaml`, карточка `components/ui-assets-persistence.yaml`. Начать с одного failing browser scenario и узких обработчиков touch/wire/Undo в `apps/web/src/electronics/use-electronics-workbench.ts` и зависимостях, которые этот сценарий реально вызывает. Сначала воспроизвести и показать причину на собранном редакторе. Исправить только доказанный механизм. Тестовый repair допустим лишь если доказана ошибка инструмента/синхронизации теста; продуктовый repair требует focused regression на фактическом состоянии схемы и касании клеммы.

Сохранить native touch hit resolution, Undo/Redo, ровно одно соединение после двух касаний, отсутствие записи после отмены, IDs деталей/выводов и пользовательскую схему. Не считать повторное касание, увеличение timeout, `force` или ослабление ожидания ремонтом. Не менять solver, Arduino, физику LED, авторизацию, owner assets, БД или рабочую установку. Если причина требует иной компонентной области, исполнитель сообщает evidence и STOP для отдельного выбора контроллера.

## Обязательный результат

1. Trace, воспроизведение и успешный baseline классифицированы; гипотеза проверена, а не выдана за факт.
2. На собранном браузерном редакторе после Undo первое касание свободной клеммы создаёт preview, второе создаёт ровно один провод; отменённые жесты и данные схемы сохраняют прежнюю семантику.
3. Focused gate, полный browser gate и общий CI проверены на exact candidate SHA; другой независимый reviewer даёт `APPROVE` или `REQUEST_CHANGES`.
4. После интеграции exact-main general/browser проверяются заново. До их прохода #453/#456/#457 и этот ремонт технически не закрываются.

Исполнитель обслуживает только этот срез и останавливается. Контроллер продолжает программу #452 после evidence, review и closeout.
