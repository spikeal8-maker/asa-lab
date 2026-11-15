# Public Projects — независимая копия опубликованной версии

## Решение владельца и единственный видимый результат

Владелец поручил продолжать всю программу Public Projects с видимым результатом.
PR #613 уже в main; этот срез не переписывает публикацию и не объявляет весь выпуск принятым.
Пользователь B открывает опубликованную V1 пользователя A, нажимает «Создать свою копию»,
получает отдельный личный Project, открывает его существующим редактором, изменяет,
сохраняет и открывает повторно. Исходный черновик A и публичная V1 не меняются.

## Границы первого среза

Переиспользовать единственный Project Core, текущую identity, idempotency и модульную валидацию.
Не копировать mutable draft, classroom/assignment/Learning origin, владельца или публичное состояние.
Новые копии приватны. Сервер сам выбирает личный tenant и владельца Account.
Source: live readable schema2 PublicationRevision → exact ProjectVersion → private Project.
Первый сквозной путь допускает только полностью переносимое содержимое проверенных модулей.
В первую очередь доказать three-d и electronics; каждый модуль включается только после
валидатора и настоящего save/reopen. Blocks/Scratch остаётся выключен до независимого
копирования всех tenant-bound assets; чужие приватные aliases копией не считаются.

Чтобы не вводить без решения новую матрицу лицензий, первый copy разрешён только для
явно опубликованной public-domain версии. Reserved/неизвестные/остальные лицензии fail-closed;
интерфейс должен честно объяснять это ограничение. Это не окончательная license/toggle policy.
DownloadFormats пока пуст; экспорт, токены, interactive viewers и новый Gallery cleanup не входят.

## Контракт API и интерфейса

POST /api/public-projects/:publicationId/copy

Account обязателен; StudentSeat/смешанный выбранный школьный контекст не получает Account fallback.
Idempotency-Key обязателен. Body: { revisionId, title? }. Название ограничено существующим контрактом.
Ответ: { projectId, moduleKey, created }; возвращается только новый принадлежащий пользователю ID.
Повтор того же запроса не создаёт дубликат. Другой payload с тем же ключом даёт конфликт.
Старая revisionId после обновления публикации не подменяется новой молча.
GET detail capability.canCopy следует той же серверной source/module/license eligibility.
Frontend показывает рабочую кнопку и состояния busy/error/success, выполняет настоящий API POST,
сохраняет один ключ для повторения неопределённого результата и открывает существующий editor route.
При отсутствии сессии предлагает штатный вход без автоматического копирования.

## База и приватность

Новая additive forward migration резервируется как 0235_public_project_copy.sql после0234.
Перед публикацией перепроверить реальные main и конкурирующие миграции.
Ни одна уже опубликованная миграция не переписывается; runner/checksum/order guards не ослабляются.
0235 не решает внешний конфликт топологии AI0226–29/Courses0230–32/Portal0233.
Не выполнять обновление реальной БД до отдельного согласованного rollout.

Source resolver получает только разрешённую точную immutable version под restricted runtime role.
Lock order согласован с publish/revoke: source Project перед publication state, повтор eligibility
внутри транзакции. Copy/revoke и copy/update должны иметь определённый транзакционный порядок.
Создание Project, private draft, immutable exact-source provenance и idempotency receipt атомарны.
Public DTO не раскрывает raw source document, source tenant/principal/Project IDs или storage secrets.
Указание автора и лицензии сохраняется в новых private properties/lineage без изменения источника.
Не создавать второй Project writer: расширять существующий createWithDraft при необходимости.

## Единственный автор на путь

Controller: current.yaml, task selection, Git/ref publication and integration.
Backend author: новая миграция, Public Projects controller/errors/API unit tests, минимальные Core seams.
Frontend author: projects-public API/page/surface/styles и только необходимое App navigation wiring.
QA author: public-copy PG/browser tests и existing focused gate wiring; не меняет product implementation.
Независимый reviewer: read-only final SHA/source/security; не является автором проверяемого diff.
Shared package/lock/AI/Learning исходники не входят; App seam координируется, чужие hunks сохраняются.

## Обязательное доказательство

A публикует различимую V1, затем сохраняет отличающийся private V2. B через реальную кнопку
копирует V1, видит V1 в editor, делает настоящую правку, сохраняет и повторно открывает.
Проверить точные document bytes до/после, независимость владельца/tenant, неизменность A/V1,
приватность новой копии, атрибуцию, replay/double-click, conflicting key, stale revision,
revoked/unlisted/protected source, StudentSeat/mixed-cookie и неподдержанный модуль/лицензию.
Screenshots desktop1440 и mobile390/320 — из собранного приложения с реальным API/PostgreSQL.
Использовать existing gate:projects-publication и browser counterpart, расширив реальные проверки,
с NX_SKIP_NX_CACHE=true. Full General и независимое review не подменять focused PASS.
Локально только source/unit/typecheck/format. Реальные PG/browser/Docker в GitHub Actions.
Production deployment и рабочие данные не трогать.
