# Независимая проверка №538: REQUEST_CHANGES

## Проверенная версия и граница

- Репозиторий: spikeal8-maker/asa-lab; действующая программа №452, ограниченный механизм E07, Issue №538.
- Единственный проверяемый финальный исходник: `42c4e1f17634ffedbb955d16298b0f4f3a74dfc3`.
- Tree: `4cb74a1d5001f28c9d476cb0868b89a6fb782529`.
- Родители: авторский `d65ccb4eddda7f3edb7a05acef2580ad56f6bc44` и canonical main `a211875aff3e4452ee085109a282d5f72a33dcac`.
- Фактические удалённые refs проверены через GitHub API: main=a211875a, codex/electronics-legacy-wire-538=42c4e1f1. Issue538 OPEN. В exact current.yaml выбран child electronics-wire / TASK-ELECTRONICS-LEGACY-WIRE-SEGMENT-001 /538/in_progress. Применимого Electronics execution blocker не обнаружено.
- Reviewer не автор изменения, не менял продукт, execution state, тесты, Git refs, установку или БД. Прочитаны root policy, входной маршрут, Electronics router, выбранная карточка, mapped subsystem, README §§7–8, AGENT_GUIDE и общий review/UI contract. Факты получены из git show точного SHA, GitHub API и оригинальных логов/артефактов, а не из заключения автора.

## Независимая проверка исходника

Сравнение деревьев с a211875a подтверждает ровно четыре пути; остальные 3751 записи имеют одинаковые mode/blob:

1. apps/web/src/electronics/workbench-document.ts — одна причинная строка и пояснение.
2. apps/web/src/electronics/testing/workbench-document.spec.ts — восемь прямых регрессий.
3. e2e/electronics-interactions.spec.ts — два добавленных реальных API сценария и необходимые imports.
4. docs/product/electronics/components/ui-assets-persistence.yaml — точное source/test/symbol ownership.

После обратной нормализации только новых imports и удаления добавленного describe прежний interactions.spec.ts полностью совпадает с baseline байт в байт. Старые сценарии не заменены и не ослаблены. DOM/CSS/layout/text не менялись; layout impact — none. Геометрия результата проверяется фактическим действием и PNG, общая новая перевёрстка четырёх viewport для этой L2 mutation не является предметом изменения.

Причинная строка получает `wire.vertices ?? wirePoints(from, to).slice(1, -1)`. Stage рисует через тот же wirePoints; прежний `vertices ?? []` ошибочно задавал для отсутствующих vertices один прямой сегмент вместо трёх отображаемых. Hook применяет тот же moveWireSegment к startedDocument при preview и commit и сохраняет защиту от независимого изменения документа.

Явный vertices:[] остаётся прямым маршрутом. Нулевая/незначимая перпендикулярная delta и недопустимый индекс возвращают исходный документ; лимит48 сохранён. Endpoint IDs/цвет/компоненты/чужие соединения не изменяются. Геометрия не входит в netlist. Существующая insertWireVertex/№493 не переделана. Нового canonical state, persistence writer, физического расчёта, asset или таймера не добавлено. Подтверждённого дефекта этой продуктовой строки не найдено.

## Действие ученика ДО изменения: доказано

Диагностический BEFORE SHA `14815b6d2ab673f52e4276782d42181ade2924fa`, run `37965102300`, job `113937366810`, artifact `11632294941`. Независимый git diff подтверждает: относительно42 восстановлен только старый production resolver и изменён отдельный diagnostic workflow. Сам browsercase/fixture/assertions неизменны. Это diagnostic, не registered browser gate.

Реально собранный браузер, настоящий сохранённый API проект без vertices. Мышь захватывает геометрический midpoint видимого среднего сегмента. Сценарий падает за2.8s точно на full-document equality после middle-drag (строка5089), поскольку vertices отсутствуют вместо ожидаемых [{x:768,y:157},{x:768,y:575}]. Ни timeout, ни auth, ни запуск стека причиной не были.

Raw journey содержит initial и middle-drag; путь остаётся из трёх прежних сегментов: (456.0495,157.302)→(730,157.302)→(730,574.555)→(1000.35,574.555). Оригинальные trace и PNG просмотрены. Сохранять это причинное BEFORE доказательство; повторять production BEFORE без новой причины не нужно.

## Действие ПОСЛЕ изменения: частично доказано, приёмка НЕ выполнена

Диагностический AFTER SHA `9e375097e4086738d31020708b5092e57b03f730`, run `37965178407`, job `113937626059`, artifact `11634070035`. Его единственное отличие от42 — diagnostic workflow; product/test blobs идентичны проверяемому42. Это также не registered gate.

Оба сценария (mouse4.2s и touch4.4s) проходят middle-drag, Undo, Redo, last-drag, full-document/netlist/vertex assertions. Raw для каждого независимо подтверждён:

| Фаза | Сохранённые вершины |
| --- | --- |
| middle-drag | [{768,157},{768,575}] |
| undo | vertices отсутствуют |
| redo | полное совпадение с middle-drag |
| last-drag | [{768,157},{768,613},{1000,612}] |

Независимое сравнение полных raw документов показывает: после удаления только изменённых vertices документ каждой фазы полностью равен initial server document, включая IDs, endpoints, цвет, параметры, simulation и viewport. В trace реально есть mouseMove/down/up на видимых midpoint и два набора по7 CDP Input.dispatchTouchEvent. PNG before-middle и after-last просмотрены: провода доступны на рабочем поле, новые изгибы видны, концы остались на контактах.

Но оба AFTER падают в строке5116 на `Reflect.get(window, '__legacyWireInput538').filter`: observer undefined. В raw каждой фазы input=[] вследствие существующего `?? []` в record; это отсутствие наблюдателя, а не доказательство отсутствия ввода. Manual save, server revision+1,1PUT, уход из редактора, cookies-only новый context, повторное открытие и проверка полных сохранённых данных НЕ достигнуты. Эти критерии остаются NOT_RUN; по пройденной геометрии нельзя принять весь срез.

### Подтверждённая причина блокера: [P1] observer устанавливается слишком поздно

Exact browsercase регистрирует page.addInitScript после loginWithOrganization, который уже открыл /#/projects. Следующий goto меняет только hash на /#/home/id и не создаёт новый document. Поэтому скрипт не исполняется в существующем документе.

Оригинальный AFTER mouse trace подтверждает порядок: первоначальный /#/projects goto4332.679ms; addInitScript5873.428ms; hashgoto5875.182→5882.444ms с result{}; позже observer evaluate на7880.545ms заканчивается undefined.filter. Все record фаз содержат пустой substitute array. Touch имеет тот же порядок и ту же ошибку. Продуктовый resolver уже отработал до этой ошибки.

Требуется отдельный bounded test-only repair: поставить наблюдатель до первого navigation/login либо явно установить в текущем документе; добавить явную проверку наличия/готовности observer до жестов. Сохранить строгие две trusted native pointerdown правильного pointerType/wireId, реальный midpoint, полные документ/netlist comparisons, Undo/Redo,1PUT/revision и fresh-context reopening. Нельзя заменить ошибку пустым массивом, удалить native assertions, принудительно доставлять DOM события, увеличить timeout или менять causal product без нового доказанного дефекта. Новый AFTER и новый independent review должны относиться к новому точному финальному SHA.

## Фактический CI

На проверяемом42 General run `37964352250` завершён FAILURE (обновлён17:25:25Z):

| Job | ID | Результат |
| --- | --- | --- |
| Governance contracts |113934837326|SUCCESS|
| Format lint types contracts build |113935306808|SUCCESS|
| PostgreSQL tests and RLS |113936677298|SUCCESS|
| Access A real browser journeys |113936677234|FAILURE|

Причина Access reviewer ещё не классифицирована: здесь не скачивался его лог. Root отдельно уведомлён о новом конкретном job; этот статус нельзя объявлять зелёным или автоматически считать дефектом Electronics. Из четырёх путей diff ни один не меняет Portal/Auth. Изменять чужой модуль в этом срезе недопустимо без отдельного выбранного ремонта.

Обычный полный Electronics workflow на42 не использован как PASS. Авторские local633+392 и70fresh — исторический focused результат автора, не independently accepted exact42 CI. В двух диагностических оригинальных job logs подтверждены literal NX_SKIP_NX_CACHE=true, frozen dependencies и49 свежих Nx build tasks на каждый probe (16+6+27,0cachehits). Эти98 диагностических сборочных задач не превращаются в полный продуктовый gate или приёмку42.

## Оригинальное evidence и целостность

Единственное скачивание двух оригинальных job logs/ZIP выполнено reviewer, root повторно не скачивал. Оба ZIP и три вложенных trace.zip проверены CRC PASS. Производные распаковки побайтно совпадают с ZIP entries. Лишние исторические изображения в artifact не засчитывались как новые сценарии.

Базовый каталог: C:/Users/spike/.codex/temp/electronics-e01/.

| Оригинал | Байты | SHA256 |
| --- | --- | --- |
|14815b6d-ci/run-37965102300/browser-job-113937366810.log|238200|6455b77a4cbf608c32c870cfed2ccbc78ee8a8c5fa497c50cbb4264417fb8394|
|14815b6d-ci/run-37965102300/browser-artifact-11632294941.zip (31 entries)|13645476|99ac16f66ff0729b0f5a021a2c0f923b9c4f69471d980f9fe2e56b6fbea5860c|
|9e375097-ci/run-37965178407/browser-job-113937626059.log|243707|3ac0323ff71bd5b26ed8a1a0e01424b0eafb58366cad192ad2dc67b612973820|
|9e375097-ci/run-37965178407/browser-artifact-11634070035.zip (42 entries)|25647045|3a94c74dc01a99089a4a8532d12e27d1d0bf9646bec9358382cc66d93123c614|
|BEFORE journey.json|10268|7a14f4186194c29d05615f80053941e2573e2f5bd12ab31049c40bafae0e663b|
|AFTER mouse journey.json|19227|ed3f6384e7eac047416e976f47e00da30aa02bb6701c7680e3946a077a78ebbb|
|AFTER touch journey.json|19227|ac5e7d42afb357901007df932fe03a95ba47901b70a7bede23bb91484aa7d0eb|
|BEFORE mouse trace.zip|9596217|bc9a3f35522eed13e7a8217e745e63905268d9752ce110caac93b42d0ddf4960|
|AFTER mouse trace.zip|10362397|dcae364a3277221b4e45a5be8b6041fb5725cafc584be1c16e46d3f473c8994d|
|AFTER touch trace.zip|10329132|6d7d28d32782db57a2ef71801a05d04cdca9992e40321713ad911f15b2464b0b|

Journey/PNG/trace paths under each extracted/reports/playwright/electronics-interactions-E-d01a4-g-Undo-Redo-and-save-reopen/ (mouse) and E-f3047 (touch); journey and PNG additionally inside electronics-legacy-wire-538/. Cache inventory logs review-538-before-cache.log и review-538-after-cache.log сохранены. Download sessions5386/89431 завершились exit0.

## Остаточная граница и вердикт

Оригинальный проблемный owner JSON отсутствует. Доказан и исправлен определённый механизм отсутствующих vertices, но вся первоначальная E07, школьная распространённость, устройство T3 и owner acceptance не доказаны. Школьная установка, сервер, рабочая БД, assets и backups не затрагивались. №526/530/525 и принятый493 не переделывались.

**VERDICT: REQUEST_CHANGES** — P1 test observer initialization блокирует обязательные native-input и save/reopen evidence; точный General также красный по отдельному ещё не классифицированному Access job. Исправить только доказанный test observer blocker отдельным bounded author, получить новый AFTER и необходимые exact gates, затем НОВЫЙ independent reviewer. По текущим raw causal product line менять не требуется. Закрытие538/продуктовая приёмка запрещены. Reviewer STOP; контроллер продолжает программу.
