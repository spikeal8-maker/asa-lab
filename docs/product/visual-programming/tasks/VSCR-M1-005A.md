# VSCR-M1-005A — первый связанный путь сохранения Scratch

**Kind:** bounded non-exposed implementation slice
**Risk:** high
**Execution:** starts only when `docs/execution/current.yaml.task.id` is exactly `VSCR-M1-005A` and `docs/execution/current.yaml.task.status` is exactly `in_progress`.

## Goal

По поручению владельца17.09.2026 продолжить сохранение, не подбор проверяющих.
Первый пакет: ресурсы → канонический документ → общий SaveDraftUseCase → OpenProject.
Не новый backend/проект/счётчик ревизий. Пользовательский результат всей программы:
после закрытия редактора восстанавливаются блоки, костюмы, спрайты и звуки.

## Scope

D0-002: generic async persistence guard, SaveDraftUseCase order, asset equality,
metadata/aggregate validation, existing optimistic revision/mutation identity.
D0-003: asset-before-document and canonical refs, no physical paths in documents.
Pinned scratch-parser6.0.1 matches accepted VM82c5fea6; API-only dependency.
Координатор явного save/open с обязательными портами ресурсов и Project Core.
Порты хранилища в тестах не выдаются за production S3/PostgreSQL adapter.

## Sources and tests

Минимальное дополнение `contexts/projects/application/ports.ts` и
`project.usecases.ts`; новый API-validator/coordinator и тесты.
Общий Module SDK остаётся синхронным, repository SQL/версии не переписываются.
Расширяется существующий gate:blocks, не создаётся другой root gate.
Тесты гоняют настоящий parser и реальные save/open use cases с изолированными
тестовыми adapter, отрицательные сценарии проверяют отсутствие записи.

## Acceptance

Запись и повторное открытие структуры через существующий Project Core.
Missing/extra/duplicate ref, wrong tenant/digest/format/size, превышение лимита,
ошибка parser/ресурса/metadata не создают ревизию. Чужой проект не пишет.
Сохраняются baseRevision, mutationId и конфликт вместо last-write-wins.
Повтор потери ответа использует ту же identity; обычные модули не меняются.
Снимок входного состояния не меняется во время асинхронного сохранения.

## Prerequisite and release boundary

Владелец разрешил продолжить реализацию пути сохранения в Draft отдельно от
незавершённой независимой приёмки PR278. Это перенос проверки на общую приёмку,
не её отмена: M1-003A, B/E и инфраструктура хранилища не объявлены принятыми.
Этот пакет не импортирует непроверенный capability core и не открывает HTTP.
Production wiring общего guard, HTTP/Account/StudentSeat, настоящие S3/metadata
adapter и VM/browser journey потребуют отдельной интеграции до выпуска.

## Independent review

До merge/release — независимая проверка общей связки сохранения и прав; PASS
не подменяется авторскими тестами. Лимит review-провайдера не запрещает
кодирование этой невключённой части, но запрещает ложную отметку acceptance.

## Stop

Публикация только Draft; сервер/.env/БД/контейнеры/порты/UI не менять.
Не объявлять server-save работающим на сайте по тестовым портам.
Не вводить autosave, новый auth backend, второй Compose или таблицы проектов.
После проверенного среза записать точное evidence и границы следующей интеграции.

## Bounded self-review

Проверить вызов guard до единственной записи, неизменность проекта при каждом
отказе, ресурсную полноту, отсутствие parser/Scratch imports в Project Core,
отсутствие production wiring и честность границ тестовых adapter.
Сохранить evidence точного SHA, не выдавать CI или свой разбор за independent PASS.
