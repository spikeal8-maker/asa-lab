# Public Projects — первая работающая публикация

## Решение владельца и границы

Поручение владельца от 18 октября 2026 года: заменить старую Gallery полноценной
системой публичных проектов. Контролёр ведёт всю программу через отдельных
исполнителей, независимых ревьюеров и QA; активный срез и его состояние читаются
только из `docs/execution/current.yaml`.

Сохранение и перенос старых публикаций отменены. Это заменяет legacy-convergence
требования R7-01C, DEC-PROJ-104, R7-01 AC03/AC14 и compatibility clauses старых
task cards. PR #283 не является кандидатом на интеграцию новой системы.
Исторические публикации не получают автоматически новый публичный доступ.
Автор может явно опубликовать сохранившийся личный проект заново.

Оригинальные `projects`, `project_drafts`, `project_versions`, учебные данные,
аккаунты и собственные элементы Collections сохраняются. Этот срез не удаляет
старые строки из production. Физическая очистка требует отдельно подтверждённой
цели, инвентаризации FK, тестовой копии и backup.

## Проверяемый пользовательский результат

Личный сохранённый проект → явное «Опубликовать» → карточка в новом каталоге →
отдельная публичная страница → повторное открытие после refresh. Страница
показывает опубликованные metadata и настоящее неизменяемое статическое превью.
Изменение рабочего документа или снимка не меняет опубликованную ревизию.
«Обновить публикацию» создаёт новую ревизию только по явному действию автора.
«Снять с публикации» закрывает каталог, metadata и image без удаления оригинала.

Это сквозной первый результат R7, а не принятие всего R7/R8. Минимальная витрина
входит в этот срез; полный discovery, ShareLink, downloads, safe artifacts/viewers
и редактор публичных материалов принимаются следующими зависимыми срезами.
Контролёр продолжает порученную программу после принятия и интеграции каждого
среза по AGENTS.md §2.1. STOP исполнителя не завершает программу.

## Архитектурный контракт

1. Существующий Project Core остаётся единственным владельцем рабочих проектов.
2. Переиспользуются `project_publication_state` и immutable
   `project_publication_revisions` из 0139, exact-version/dedup алгоритм 0141
   и актуальные Learning/Identity guards, включая 0192.
3. Новая явная публикация создаёт ревизию `schema_version = 2`. Читатели новой
   системы принимают только этот контракт и актуальное разрешённое live state.
   Старые ревизии не переписываются и не конвергируются автоматически.
4. Raster preview замораживается вместе с ревизией с теми же проверками формата,
   размера и source revision, что и существующий snapshot contract. Public read
   никогда не читает текущий `project_snapshots.image` или mutable draft.
5. Publish, revoke, visibility и legacy entry points используют согласованную
   серверную политику. Обычное сохранение свойств не перепубликует live revision.
6. Legacy `visibility=link` не заменяет отзывный tokenized ShareLink. Пока новый
   ShareLink не принят, такой материал отсутствует в anonymous API и каталоге.
7. Collections не дублируются: собственные приватные элементы остаются доступны
   владельцу; чужие элементы возвращают только ещё разрешённую immutable
   публикационную проекцию. Отзыв не раскрывает приватные metadata оригинала.
8. Legacy copy/work/image не могут обходить новую policy или выдавать mutable
   документ новой публикации. Copy включается только из exact published version.

## Маршруты и API

Приложение использует hash router. Приняты адреса:

| Назначение | Адрес |
|---|---|
| Личные проекты и их редакторы | Существующие `#/projects` и `#/projects/:id` |
| Публичный каталог | `#/explore` |
| Публикация | `#/public-projects/:publicationId` |
| Старая Gallery | Redirect в каталог; старый detail — unavailable либо проверенное соответствие новой публикации |

Ссылки строятся от текущего origin, без IP/домена в продуктовых исходниках.
Anonymous render использует общую оболочку ASA Lab и доступные гостю действия.

Публичный read namespace: `GET /api/public-projects`,
`GET /api/public-projects/:publicationId`,
`GET /api/public-projects/:publicationId/image`. Owner mutations используют
существующую session/Project authorization и один публикационный алгоритм.

DTO содержит public UUID, revision/version number, title, description, tags,
license, module key, безопасную подпись автора, publishedAt и frozen preview.
Он не содержит raw document, tenant/workspace/classroom/school/account/principal
IDs, email/login, session internals или share secrets. Возможности copy,
download и interactive viewer показываются только после реальной реализации.

## Серверные права

Публикует active Account Principal — владелец допустимого личного Project.
Отдельный новый verification flag или глобальная role не вводятся: текущий
Account/session contract определяет допустимый доступ. SQL проверяет Principal
так же, как API; скрытая кнопка не является защитой.

StudentSeat не публикует через прямой endpoint, properties/visibility или SQL
entry point. Educator capability не даёт права публиковать чужую учебную работу.
Learning originals и classroom/assignment origins закрыты. В первом срезе
публикуются только независимые личные проекты Account: classroom- и Seat-owned
источники недоступны независимо от Safe Mode. Текущая принадлежность и origin
проверяются при каждом чтении, включая ранее опубликованные работы. Связанный
StudentSeat или членство в школе не запрещают публикацию независимого личного
проекта Account. Для разрешённых будущих classroom-сценариев сохраняется
действующая семантика Safe Mode: class default OR seat flag.

Скрытый/private/unlisted/revoked/ineligible материал возвращает одинаковое
not-found состояние. Metadata/image/artifact/copy/Collections не обходят policy.
Новый image endpoint использует `Cache-Control: no-store`; прежний публичный URL
не должен продолжать предоставлять материал после отзыва или смены policy.

## Авторство путей и проверка

Контролёр владеет Git/index, execution state и интеграцией. Backend исполнитель
владеет новой additive migration, API и своими PG/unit tests. Frontend исполнитель
владеет web routes/pages/components и web API adapter. QA отдельно владеет
браузерными сценариями и проверяет финальный кандидат. Один путь имеет одного
активного автора; shared consumers проверяются до принятия.

Обязательные проверки:

- PostgreSQL: exact version/FK/immutability, повтор команды, V1 → draft+image V2,
  revoke, visibility, отсутствие старых публикаций и сохранность Project Core.
- Живой API: anonymous/non-owner/StudentSeat/teacher/Learning negatives,
  properties visibility bypass, Safe Mode после publish, private Collections.
- Браузер с настоящими API/БД: publish → catalog → detail → refresh → revoke;
  неизменяемость картинки и отсутствие mock successful responses.
- Layout: 320/360/390/430/768/1024/1440, desktop максимум четыре карточки,
  mobile 360+ две, narrow 320–359 одна; focus, длинный русский текст, состояния
  empty/loading/error и отсутствие горизонтального overflow.
- Screenshots desktop/mobile из собранного приложения, независимое security/code
  review точного SHA, required CI и проверка фактического main после интеграции.

Исполняемые команды определяются package.json/current.yaml. Существующие
`test:project-slice` и `e2e:creator-portal` не покрывают весь новый boundary:
нужны publication PostgreSQL tests и отдельный реальный publication browser gate.
Новый gate записывается в execution state только после появления скрипта.
Общий `gate:repository` сохраняется. Evidence использует
`NX_SKIP_NX_CACHE=true`; code acceptance, test installation и production deployment
фиксируются отдельно. Production deployment этим срезом не выполняется.
