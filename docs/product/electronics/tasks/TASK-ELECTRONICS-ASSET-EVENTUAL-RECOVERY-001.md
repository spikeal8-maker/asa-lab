---
task_id: TASK-ELECTRONICS-ASSET-EVENTUAL-RECOVERY-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md#первый-рубеж-ресурсы-и-захват-деталей-восстанавливаются
acceptance_boundary: slice
review: independent
---

# Восстановление ресурсов после тихого возвращения сети

Программа: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Ограниченный ремонт: [#462](https://github.com/spikeal8-maker/asa-lab/issues/462). Предыдущий ремонт загрузки и захвата: [#453](https://github.com/spikeal8-maker/asa-lab/issues/453). Обязательный hygiene checkpoint: [#480](https://github.com/spikeal8-maker/asa-lab/issues/480).

## Один пользовательский результат

После исчерпания ограниченных попыток временно недоступная маска захвата, обычная картинка или интерактивный owner SVG восстанавливается в той же открытой активной вкладке, когда транспорт снова работает. Ученик продолжает пользоваться той же деталью и схемой без reload, переключения вкладки или повторного добавления детали. Постоянно отсутствующий ресурс остаётся честной ограниченной ошибкой.

## Доказанный вход и граница

На ранее проверенном `main` terminal failed повторно активируется только событиями `online`, `focus` и `visibilitychange`. Тихое восстановление сети не обязано вызвать ни одно из них. URL обычного изображения и маски используют фиксированное значение query для каждой попытки внутри одного цикла; новый цикл должен доказанно обойти старую cacheable ошибку. Эти факты — механизм для проверки на свежем `main`, а не утверждение о единственной причине всех школьных сбоев.

Перед записью: fresh GitHub/current.yaml snapshot, `pnpm agent:recover --scope electronics --check`, `pnpm agent:preflight --scope electronics --check`, проверка незавершённых изменений других исполнителей и `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ASSET-EVENTUAL-RECOVERY-001`. Если путь занят другим ботом, не создавать конкурирующий ремонт.

Основной маршрут: `docs/product/electronics/COMPONENT_MAP.yaml` → `components/ui-assets-persistence.yaml`, entries `electronics.ui.workbench`, `electronics.ui.catalog` и защищённая граница `electronics.assets.owner-svg`. Исходные owner assets только читаются.

## Ограниченный scope

- Изучить и изменить только необходимые production-пути загрузки: `component-hit-testing.ts`, `ProductionComponentVisual.tsx`, `WorkbenchStage.tsx`, `production-asset-contracts.ts`, `component-preview.tsx`. Другой путь допустим лишь после конкретного доказательства вызова и явной записи причины в отчёте.
- Дать failed потребителю ограниченный повторный шанс после тихого восстановления без глобального постоянного polling всех assets. Определить backoff, верхние границы и прекращение при unmount/смене ресурса; успешные ресурсы не запрашивать повторно.
- Обеспечить новый cache-busting identity для нового recovery-cycle маски и ordinary image. Поздний ответ старого цикла не заменяет актуальный ресурс.
- Сохранить работающий pointer hit-testing и интерактивные органы приборов; восстановление не меняет document, history, autosave, simulation или электрические результаты.
- Проверить request amplification на синтетической группе клиентов/ресурсов в изолированном тесте. Полный classroom 15+15 и FRP/session/save анализ остаётся отдельной зависимостью #460; рабочую установку не нагружать.

## Acceptance

1. Production-код и направленные тесты воспроизводят terminal failure → тихое восстановление транспорта → успешную загрузку без `online`, `focus`, `visibilitychange` и reload. Отдельно проверены маска, ordinary image и интерактивный SVG в собранном браузерном редакторе.
2. После восстановления та же деталь снова захватывается, её изображение видно и органы управления работают; IDs, координаты, связи, документ и текущий сеанс моделирования сохранены.
3. Permanent missing остаётся bounded с видимой ошибкой. Нет бесконечной серии запросов, синхронного всплеска запросов класса и повторной загрузки уже готовых ресурсов. Зафиксированы фактические число/паузы запросов в тестовых сценариях.
4. Второй recovery-cycle не использует прежний cacheable failure URL; старый ответ не перезаписывает новый. Unmount и смена варианта не оставляют таймеров или необработанных ошибок.
5. `pnpm gate:electronics-m1`, `pnpm gate:electronics-m1:browser`, `pnpm gate:repository` и `git diff --check` проходят на требуемом exact HEAD. Отдельный reviewer независимо проверяет фактический diff, браузерный результат и GitHub CI; при замечаниях — новый bounded repair и повторный review.

## Запреты и остановка

Не менять байты protected owner assets, solver/Arduino/физику, схему документа, БД, авторизацию, сеть и рабочую установку. Не маскировать отказ, не убирать ошибочный badge и не увеличивать только timeout ради зелёного теста. Не решать #463–#466 или #460 внутри этого среза. Продуктовые развилки раздела 7 ТЗ требуют отдельного решения владельца только перед затронутой реализацией.

Исполнитель останавливается после одного candidate SHA, focused gate и self-review; независимый reviewer — после вердикта. Контроллер интегрирует принятый результат, проверяет точный main SHA и продолжает программу #452 по свежему state. Owner acceptance и deployment отдельно.
