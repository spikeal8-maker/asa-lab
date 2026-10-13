# №548 — новый сохранённый отказ ordinary catalog на exact 9f9505f9

**Вердикт: NO_PROVEN_CAUSE. Неверный variant/asset в проверке исключён. Продуктовый ремонт из этих оригиналов пока не обоснован. STOP данного read-only разбора.**

| Предмет | Независимо проверенный результат |
| --- | --- |
| Вход | Read-only preflight SAFE_TO_START: HEAD/origin main `20d3229a002ae4f8a0be1a1fec2815c8c81bdb84`, dirty0, blockers0, execution blockers0, overlaps0, control-plane PASS; canonical Electronics — TASK-ELECTRONICS-ORDINARY-IMAGE-CONSUMER-FAILURE-001, R1 evidence phase. |
| Exact отказ | Source `9f9505f9e7a84b7a869e5a2fd93583742c27abdd`, run38163496163, browser job114541736981, attempt1, terminal FAILURE только step8. Saved raw log SHA256 `07a5355f4af0c59ac68819397505b510421cc736f7216f379c911b1bc28df554` и artifact11711627920 SHA256 `5e2df432407e6b7779d7b17cf5db1484f15e3fbbb7c629fd6d53df938733528b` проверены по реальным bytes. Никаких скачиваний. |
| Версия продукта | Все10 релевантных файлов renderer/hook/shared recovery/catalog/preview/sidebar/mounted tests/snapshot/старый browser spec побайтово совпадают с main20d. Вложенный trace содержит spec, побайтово равный Git exact9f. Проба, продуктовый fix или gate rerun не выполнялись. |
| DOM | Самостоятельно декодированы все16 Playwright delta snapshots с postorder backrefs. Во всех11 snapshots с каталогом: data-selected-variant=`battery-holder-aa-2`, единственный `<image>` href EXACT `/assets/electronics/component-database/components/battery-holders/aa-2.svg`, без failed и без доступного badge. Каталог отсутствует508646.349ms, присутствует508983.755ms и остаётся без badge до515229.163ms. На stage обе AA2 детали имеют failed/badge в последующих snapshots. |
| Неверный target | **Исключён фактическим DOM**, не предположением по family. WorkbenchSidebars вызывает selectedFamilyVariant(family,null), передаёт именно его entry и visualAsset в ComponentPreview, затем ProductionComponentVisual. Test route соответствует реально отрисованному AA2 asset. Лично просмотренный last-native.jpeg показывает стандартный broken-image placeholder, в том числе его зелёный фрагмент; это не доказательство загруженного holder. |
| Запросы | Всего11 target HAR records:10 GET с image Accept/404 и один отдельный GET Accept:*/*/200. Три image retry0/1/2 только cycle1; остальные — три original URL, mask retry1/2, mask-cycle1 и mask-retry1/mask-cycle1. HAR не записывает native target identity, request.resourceType и initiator; Accept не переименован в измеренный resourceType. |
| Тайминг | retry0:508417.286–508437.450ms; catalog впервые наблюдается508983.755ms; retry1:509022.325–509044.389ms; terminal retry2:509534.173–509537.784ms. Это ограничивает появление каталога внутри конечной попытки, но не даёт точного commit/native-event порядка. Последний catalog assert call4926 истекает за исходные5000ms. |
| Отдельный200 | GET200 начинается512225.575ms, рядом с original-image404512225.848ms, уже во время ожидания каталога. Это не успешный native load. Source допускает snapshot FIRST_CAPTURE_MS=4000, cloneNode(true), inlineImages и force-cache fetch; initiator отсутствует, поэтому конкретное происхождение обоих запросов **не установлено**. Пустой HAR cache object также не доказывает отсутствие negative image cache. |

## Что не записано и почему нельзя выбирать ремонт

Старая case не содержит native ingress/React/hook observation. В trace нет SAME-node trusted error/load, React currentTarget, hook token, setup/cleanup/active/pending/early-event replay или позднего сброса failed. Resource404 console подтверждает HTTP failure, но не доставку события конкретному catalog consumer. Устойчивое представление DOM в нескольких snapshots не доказывает сохранение идентичности JS-объекта между ними.

Реальный source `useOwnerImageHref` не начинает load в effect setup: собственный native notify вызывает recover/start/load. Событие после render и до effect может быть queued/replayed; rejected shared promise публикует failed только active consumer. Shared quiet recovery отдельно хранит failedListeners, а отрицательный retry не рассылает onReady всем peers. Поэтому stage failed сам по себе не требует глобально отравить catalog: отсутствует доказательство, что он вообще вошёл в ту же локальную load-подписку. Статический путь не является доказательством выполненной ветви. Нельзя eager-fetch каталог, broadcast чужую ошибку или менять бюджеты на этой основе.

Сохранённый f67/c472 instrumented запуск успешно показал доставку трёх native errors ПОСЛЕ effect и failed у всех трёх consumer; он не воспроизвёл failing window. Сохранённый ec524 Search запуск не создал new commit BEFORE terminal: Backspace после terminal, поэтому его второй цикл совместим с новым consumer. Их прежние выводы сохранены; новый ordinary failure не превращает эти успехи в доказанную причину и не разрешает повторять их в надежде поймать гонку.

## Минимальный недостающий факт

Нужна реальная failing SAME connected catalog node цепочка: listener attached before href → trusted native event и точный href → React currentTarget → hook token и setup/cleanup/queue/replay/active/pending/cycle → конечный failed/render либо отсутствие его. Node-owned incremental raw должны существовать до любых supplemental await; lost/dropped buffers обозначаются явно; snapshot clones отделяются от committed consumers.

Если контроллер отдельно выберет observational phase, минимальная граница — существующая permanent case и строго observation-only ProductionComponentVisual; passive createElementNS listener со стабильной WeakMap identity плюс guarded React/hook/commit records. Имеющийся f67 observer — указатель для source inverse/provenance, а не инструкция повторить прежний запуск. Нужны побайтовый inverse исходного runtime и независимая source-проверка. Никаких holds/CPU/module gates/synthetic events, новых timeout, weakened assertions, request budget, изменения recovery или школьной установки. Если natural failing SAME-node chain не возникла — NO_PROVEN_CAUSE/STOP, не повтор.

**Новый browser run сейчас не рекомендован:** эта trace исключила неверную цель, но не содержит нового детерминированного causal stimulus. Сначала требуется отдельно доказанная допустимость нужного наблюдения или механизм, устанавливающий именно отсутствующий SAME-node порядок. Возврат к ранее неудавшемуся Search с более ранним trigger остаётся тем же race.

| Сохранность / граница | Результат |
| --- | --- |
| Проверки после failure | Исходные quiet800/max7/full-document equality/zeroPUT/zeroErrors **NOT_REACHED**; не объявлены PASS из-за отсутствия побочных симптомов. Измеренные10 image-accept404 не являются разрешением поднять max7: часть поздних mask/snapshot requests не атрибутирована. |
| Изменения | Ноль repository/product/test/meta edits, install/build/test/browser/CI rerun/download/deployment/DB/network/backup actions. Только внешние report/proof/hashmanifest/decoder. Чужая работа сохранена. |
| Приёмка | Ни548, ни553/538/544 не приняты; blocker не снят, pupil fix count не повышен; school frequency/установленная версия/T3/owner acceptance не исследованы. |
| Собственные доказательства | `548-new9f-cause-proof.json`, `548-new9f-decoded-dom.json`, `548-new9f-member-inventory.json`, `548-new9f-cause-hashmanifest.json` в `C:/Users/spike/.codex/temp/electronics-e01/`. Manifest содержит фактические external SHA и20 Git originals для10 source paths на двух ревизиях. |

**STOP роли. Контроллер продолжает программу по её действующим границам.**
