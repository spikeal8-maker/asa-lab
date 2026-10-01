---
task_id: TASK-ELECTRONICS-LED-THERMAL-BROWSER-BASELINE-001
kind: repair
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md#второй-рубеж-запуск-не-превращает-любую-ошибку-в-непонятное-выключение
acceptance_boundary: slice
review: independent
---

# Браузерный baseline теплового отказа LED

Программа: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Отдельный blocker repair: [#457](https://github.com/spikeal8-maker/asa-lab/issues/457). Технический closeout [#453](https://github.com/spikeal8-maker/asa-lab/issues/453) и [#456](https://github.com/spikeal8-maker/asa-lab/issues/456) ожидает полного exact-main browser gate.

## Доказанный вход

На интегрированном `main` `650eb572c617e8dac6bb5dc7bf36321ed9ba0667` общий [repository CI 36914343792](https://github.com/spikeal8-maker/asa-lab/actions/runs/36914343792) прошёл. [Electronics CI 36914366153](https://github.com/spikeal8-maker/asa-lab/actions/runs/36914366153) прошёл solver/build/benchmark и 93 браузерных сценария, включая Arduino Reset и восстановление ресурсов, но существующий сценарий SPDT/LED в `e2e/electronics-simulation.spec.ts` ожидал `led_burnout` и за 5 секунд реального времени наблюдал только `led_overcurrent`. Одобренная ветка #456 `724b0e95aecbd485d6f6bc7485f6ffa4a92e0e2c` имеет то же дерево кода и прошла все 94 сценария. Изменение #456 не затрагивало тест SPDT/LED или физическую модель.

Модель подтверждает переход в `led_burnout` после 4 500 мс модельного времени (`apps/web/src/electronics/testing/live-simulation.spec.ts`). Браузерная проверка даёт почти такой же лимит в реальном времени, не показывая фактически достигнутый горизонт worker. В красном логе LED перешёл от `warning` к `destructive`, но достиг ли worker порога 4 500 мс, неизвестно. Причина отказа пока не доказана.

## Граница

Работать только с соответствующим сценарием и узкими test helpers в `e2e/electronics-simulation.spec.ts`. Пассивно наблюдать ответ production worker и фиксировать фактически подтверждённый `committedHorizonMicroseconds` вместе с `requestedHorizonMicroseconds` при отказе. Дождаться прохождения порога модельного времени под конечным лимитом реального ожидания; затем потребовать `led_burnout`, burned image и видимый признак отказа. Не подменять это растущими часами toolbar, простым увеличением timeout или ослаблением электрического ожидания.

Генератор покрытия хранит SHA-256 всего браузерного файла в `docs/product/electronics/generated/component-coverage.json`; при изменении теста обновить только этот checksum штатным генератором. Если для выполнения gate нужен ещё путь записи, сначала явно обосновать его в карточке.

Не менять solver, тепловую модель, Arduino runtime, обычные изображения, owner assets, схему документа, сохранение, авторизацию или рабочую установку. Если worker достиг порога, а LED не перегорел, STOP и отдельный продуктовый runtime defect. Если worker не продвигается, зафиксировать это как отдельную причину, не делать тест зелёным искусственно.

## Обязательный результат

1. Красный exact-main путь классифицирован отдельно от #456 без заявления о доказанной причине.
2. Собранный браузерный редактор доказывает прохождение модельного порога, затем фактическое перегорание LED и правильный рисунок/индикатор.
3. При отказе evidence показывает подтверждённый горизонт worker и состояние LED, различая задержку выполнения и неверную физику.
4. Focused, browser и general gates на финальном exact HEAD проверены; новый независимый reviewer выдаёт `APPROVE` либо `REQUEST_CHANGES`.
5. Защищённые данные, рабочая БД и установка не меняются.

После принятия контроллер закрывает технические blocker-зависимости #456 и #453, затем выбирает следующий bounded результат программы #452. Исполнитель и рецензент останавливаются после своего среза.
