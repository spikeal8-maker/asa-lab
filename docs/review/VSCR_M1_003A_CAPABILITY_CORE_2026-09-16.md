# VSCR-M1-003A — серверное ядро разрешений, 16.09.2026

Выбор задачи опубликован отдельно на main: `7be89fe3038d502afbe76147ef9fe889bd0af907`.
Источник активного исполнения остаётся `docs/execution/current.yaml`.

## Реализованная граница

`BlocksRuntimeCapabilityService` в API — невключённое ядро, не HTTP endpoint.
Выдаёт и проверяет compact JWT через `jose` 6.2.12 (MIT, без транзитивных зависимостей).
Алгоритм HS256, issuer `asa-lab`, audience `asa-blocks-runtime`, точный
`typ=asa-blocks-runtime+jwt`, срок 600 секунд и нулевая временная погрешность.
Ключ из 32 байт обязателен и копируется; его энтропия — обязанность будущей композиции.
Нет чтения .env, ключа по умолчанию, генерации при импорте, логирования JWT или CORS.

Привязка: tenantId, principalId, projectId, mode и неизменяемая versionId игрока.
Профиль editor: `project:read`, `asset:read`, `asset:write`, `draft:write`, `snapshot:write`.
Профиль player: только `project:read`, `asset:read`. Разрешения нельзя выбрать входным объектом.
Неизвестные поля, расширенные права, другой алгоритм/ключ, route/origin и сроки отвергаются.
Максимальный token — 4096 символов до криптографической обработки.

Перед выдачей и после криптографической проверки вызывается обязательный
`BlocksRuntimeAuthorityPort`. Только буквальное `true` разрешает операцию;
ошибка зависимости, отзыв прав или истечение во время ожидания не дают успех.
Входы и ключ копируются, аргументы порта и возвращаемый grant заморожены.
Тестовый порт существует только в unit tests, не в production composition.

## Чего здесь нет

Нет AppModule/контроллеров, реального Account/StudentSeat/Project Core adapter,
новых browser permissions, файлового хранилища, записи draft, автосохранения,
миграций или обновления сервера. Это не завершение B/E и не доказательство
действующей защиты будущих HTTP-маршрутов. Редактор и текущие порты не менялись.

## Проверки и ограничения

Набор unit tests использует настоящие подписи, синтетические UUID и случайные
тестовые ключи. Проверяются точные claims/header, размер, права player,
другой tenant/project/version, отзыв текущих прав, ошибки и задержка authority,
невалидные часы и изменения входных объектов во время async-операции.
Существующие команды gate сохранены; проверки API добавлены в общий `gate:blocks`.
Полные exact-SHA CI и независимое заключение записываются в issue #273 отдельно.
Сам этот отчёт не является независимым review или утверждением о зелёном CI.

Будущий HTTP adapter обязан получать actor/route из доверенной ASA-композиции,
проверять текущий Account/StudentSeat и состояние проекта на каждом запросе,
ограничить время ожидания/нагрузку и не подменять authority разрешающей заглушкой.
Проверка полномочий не блокирует конкурентное изменение прав на уровне БД;
проверки записи и транзакционная семантика остаются обязанностью будущего adapter.
Повторное использование неистёкшего JWT само по себе разрешено; идемпотентность
сохранения обеспечивается Project Core, не token-blacklist.

## Источники профиля

- [Задание A](../product/visual-programming/tasks/VSCR-M1-003A.md).
- [D0-004](../product/visual-programming/VSCR-D0-004-RUNTIME-SECURITY-CONTRACT.md).
- [jose: JWTVerifyOptions](https://github.com/panva/jose/blob/main/docs/jwt/verify/interfaces/JWTVerifyOptions.md).
- [jose 6.2.12](https://jsr.io/@panva/jose@6.2.12).
- [RFC 8725](https://www.rfc-editor.org/rfc/rfc8725.html).

POST_STEP_REVIEW: отдельное API-ядро, UI/layout impact none; действующий runtime
не импортирует новый сервис. Нет server-save claims. High-risk challenge review
проверяет точный implementation commit и эти ограничения, не всю платформу.
