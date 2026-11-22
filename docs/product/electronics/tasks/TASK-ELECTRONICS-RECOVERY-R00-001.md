---
task_id: TASK-ELECTRONICS-RECOVERY-R00-001
kind: analysis/inventory
risk: medium
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-GOVERNANCE-014
  - TASK-ELECTRONICS-BREADBOARD-PERFORMANCE-001
acceptance_boundary: slice
review: independent
---

# R00 — воспроизводимая база первого stopped-preflight ремонта

Программа [#452](https://github.com/spikeal8-maker/asa-lab/issues/452), реестр
[#703](https://github.com/spikeal8-maker/asa-lab/issues/703), ограниченное поручение
[#1111](https://github.com/spikeal8-maker/asa-lab/issues/1111).
Основание — [ТЗ восстановления v1.1, §§4–6, 11, 13](https://github.com/spikeal8-maker/asa-lab/blob/5e66430ae4d8e937aebc7c6cc85d7006b692e84c/docs/product/electronics/ASA_ELECTRONICS_RECOVERY_SPEC.md).
Эта карточка не активирует себя: выбор находится только в `docs/execution/current.yaml`.

## Один результат

Сохранённые S3/S4, одинаковый сценарий Stop, исходные сырые измерения полного
редактора и подтверждённый путь двух предварительных расчётов дают проверяемый
вход следующему R10. Улучшение продукта в R00 не заявляется. Принятое ускорение
первого overlay-hotspot #465 и все незакрытые чужие работы сохраняются.

## Компонент и точное чтение

Основной компонент — `electronics.ui.workbench`; одна зависимость —
`electronics.worker.live-controller`. Прочитать Electronics router, соответствующие
записи COMPONENT_MAP / subsystem cards, AGENT_GUIDE §§2, 3, 5, 11–13 и:

- `apps/web/src/electronics/use-electronics-workbench.ts`: `staticPreflightResult`
  и stopped LED resource warmup;
- `apps/web/src/electronics/live-simulation.ts`: `calculateSimulationPreflight`
  и фактическое назначение stopped `calculateLiveSimulation`;
- `apps/web/src/electronics/live-simulation-worker-controller.ts` и
  `simulation-worker-evaluator.ts`: существующая асинхронная граница;
- `apps/web/src/electronics/testing/canvas-annotations.browser.mjs`: принятый
  шаблон полного SchematicEditor, настоящих assets/Worker и fixture API;
- `e2e/electronics-interactions.spec.ts`: существующий full-editor fixture API.

Риск medium относится к достоверности измерительного harness. Продукт/runtime,
математика, схема сохранения и нормативная семантика read-only.

## Разрешённые записи автора

- `tests/electronics/recovery/s3.json`
- `tests/electronics/recovery/s4-reconstruction.json`
- `tests/electronics/recovery/reconstructed-audit.ino`
- `tests/electronics/recovery/provenance.json`
- `apps/web/src/electronics/testing/stopped-preflight.browser.mjs`
- `.github/workflows/electronics-recovery-performance.yml`
- `docs/product/electronics/components/ui-assets-persistence.yaml`
- `docs/product/electronics/evidence/recovery-r00-20261113.md`

Это fixtures, измерительный тест, его адресный CI и доказательства — не разрешение
менять продуктовые исходники. Карточку/канонический выбор меняет контроллер.
Узкий browser script непосредственно относится к той же границе; изменение
subsystem card допускается только для маршрута нового теста. Новый файл вне
списка сначала обосновывается контроллеру и проверяется точным preflight.

## Происхождение сцен

S3 содержит большую 882-hole макетку и Uno. S4 содержит 17 компонентов и 14
проводов. При отсутствии экспорта исходного проекта использовать явно
обозначенную реконструкцию по аудиту ASA_Lab_Electronics_Audit_2026-11-12.docx.
Сохранить JSON, SHA-256, catalogue/model identities, sketch и происхождение
каждого предположения. Восстановленный скетч нельзя называть кодом пользователя.
Доступность оригинального экспорта и фактическая сборка asa-lab.ru остаются
отдельными неизвестными; исходный проект не менять.

## Методика и показ

Разрешённый адрес показа — артефакт точного GitHub Actions run в этом репозитории:
видео, trace, HTML/JSON отчёт и сцены. Временный browser fixture запускается внутри
изолированного CI по существующему full-editor шаблону. Это instrumented candidate
full editor с fixture API, не установленная версия asa-lab.ru и не новая постоянная
установка. Ответственный за публикацию и сопоставление evidence — контроллер.

Перед исправлением закрепить product source SHA и хеш реально собранного JS,
Worker и CSS. В provenance сохранить ОС/CPU/RAM, браузер/версию, headed/headless,
GPU/ускорение, viewport, zoom/device scale, visibility, cache и питание/дисплей
либо явное `not_applicable` для CI. Главный профиль 1920×1080; 1366×768 и 390 px
проверить отдельно на доступность управления и перекрытия. CI не эквивалентен
компьютеру владельца или дисплею 60 Гц.

Одинаковые действия при Stop с закрытым и открытым кодом на S3/S4:
добавление уже загруженного компонента, движение без изменения электрических
связей, изменение номинала и изменение скетча. Для S3 редактируемый резистор
может быть добавлен первым действием; точная последовательность и восстановление
исходного документа сохраняются. Каждое действие выполняется настоящим UI;
read-only snapshot/probes не заменяют жесты вызовом controller setters.

Использовать три 30-секундных прохода каждого измеряемого действия/профиля,
сохранить все сырые выборки и p50/p95/max, long tasks (число/сумма/максимум),
preflight calls/duration отдельно по main/Worker. Не включать паузы harness в
знаменатель активного жеста и не усреднять разные сцены/панели. Событие связывается
с соответствующим применённым состоянием/preview; время команды Playwright и
RAF сами по себе не называются задержкой до показа кадра. Видео и Rendering/Paint
trace записываются отдельным одинаковым replay, чтобы не искажать timing run.

Test-only build transform может считать вызовы/длительности ровно выбранного
`calculateSimulationPreflight`; обязан проверить единственное точное совпадение,
сохранить original source / transform hashes и работать одинаково до/после.
Он не меняет return/exception/result, модель и исходники продукта. Отдельно
подтвердить, что число означает выполненные расчёты, а не только запросы Worker.

Холодное открытие и первый сетевой download не смешивать с тёплым сценарием:
статус холодного бюджета в этом ограниченном пакете `NOT_CHECKED`, без обещания
выполнить весь бюджет R10–R12. После R10 повторить frozen baseline и candidate
последовательно на одной машине CI для сопоставимых условий, сохранив исходный
R00 run как исходную проверку, а не подменяя его.

## Проверки и приёмка

1. `pnpm agent:preflight --scope electronics --check` с точными planned paths,
   затем `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-RECOVERY-R00-001`.
2. Сцены проходят настоящий document parser; размер S4 равен 17/14; hashes,
   reconstruction caveats и sketch сохранены; tracked runtime diff отсутствует.
3. `node --check apps/web/src/electronics/testing/stopped-preflight.browser.mjs`,
   форматирование адресных файлов, routing validation и применимый governance gate.
4. В CI выполнить browser runner с `NX_SKIP_NX_CACHE=true`, сохранить stdout,
   raw JSON, trace, video, environment/build receipt; текущие ошибки не скрывать.
5. Независимый агент проверяет окончательный SHA, сцены, методику, before evidence
   и оба настоящих solve call sites. Контроллер отдельно принимает результат.

Если full-editor запуск объективно недоступен, сохранить адресный контрпример и
конкретный blocker, но не объявлять измерения или демонстрацию выполненными.
Контроллер продолжает доступную подготовку R10 в границах поручения владельца.

## Запрещено и остановка автора

Не менять оригинальный проект, protected assets, product source, математику,
Worker semantics, модельное время, БД, production, постоянные установки, чужие
ветки и WIP. Не начинать R10/R11, Serial/PWM/потенциометр или полный аудит каталога.
Автор передаёт один R00 candidate с доказательствами и `NEXT_ALLOWED_TASK: STOP`.
Контроллер после проверки отдельно канонически выбирает R10; R00 не завершает
порученный владельцем пакет.
