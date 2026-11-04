# TASK-PROJ-PUBLICATION-LIKES-001 — лайки публикаций

Источник состояния — `docs/execution/current.yaml`, projects lane, issue211.
Решения: DEC116, DEC118 и подтверждённая владельцем DEC122. Только исходный
срез лайков; сайт, Scratch copy, экспорт, Games, рейтинги и бонусы ИИ не меняются.

## Поведение

- Одна компактная кнопка «Нравится» и реальный серверный счётчик. Один лайк
  действующего Account/StudentSeat; собственную работу лайкать нельзя.
- Existing `project_reactions` получает отдельный canonical publication target,
  без переноса/удаления старых like/wow. Старый Gallery mutation остаётся закрыт.
  Прямое чтение новых реакторов runtime-ролью запрещено; публичны только числа.
- Проверяются активные Account, session hash/expiry/revocation либо существующая
  Seat session, class, credential и learner identity. Publish/download policy и
  общий/авторский запрет копирования не ограничивают лайки.
- Совпадающая действующая проверенная learner identity запрещает собственный
  лайк через другую роль и вторую реакцию через связанные Account/Seat.
  Новый глобальный идентификатор человека не создаётся; неизвестные/отключённые
  связи не угадываются. Ретроспективная переклейка identity links сюда не входит.
- Булевый PUT идемпотентен. Добавление требует актуальной readable publication
  и revision; Project/state locks сериализуют его с revoke/moderation/admin OFF.
  После завершённого OFF даже повтор on=true возвращает запрет, счётчик сохраняется.
- При update/revoke/republish той же публикации и блокировке пользователя лайки
  остаются. Заблокированный пользователь не может менять реакцию.
- Убрать свой существующий лайк можно при admin OFF и после hide/revoke.
  Удаление по непрозрачному ID возвращает только `{liked:false}`, одинаково для
  скрытого/неизвестного ID; чужой private DTO, название и число не раскрываются.
- Private actor state и mutation response — `private, no-store`. Anonymous public
  count не содержит `liked`, реакторов или ролей. UI закрывает поздние ответы
  после смены сессии и не угадывает счётчик оптимистически.
- Администратор видит реальные числа и свёрнутый компактный контроль реакций.
  Изменение требует verified platform admin, отсутствия Seat cookie, причины,
  ожидаемой revision/version и аудита `publication.reactions`. Счётчик не редактируется.

## Проверки и границы

Forward migration0283; принятые SQL не перенумеровываются. Legacy/nonempty upgrade
сохраняет like/wow целиком и проверяет явные defaults новых полей. PG/API покрывает
конкуренцию, stale revision, status/session, own work, verified linked roles,
opaque unlike, CAS/reason/audit и runtime RLS. Browser через настоящий built API
и страницу проверяет Account1440, Seat390 с default-OFF class policy, reload,
обновление публикации, admin OFF, снятие лайка и фактические снимки. Новые cases
подключены в существующие explicit gate/tsc/browser lists, без пропуска старых.

Обязательны независимые Code/Security финального SHA, General и существующий
Public Projects PG/built-browser gate до Main. Локально только узкие unit/format
и проверки типов; никаких Docker, рабочей БД, dependency reinstall или deployment.
Самопроверка автора не заменяет реальное CI/browser evidence. Автор сообщает SHA
и STOP; контроллер проводит интеграцию отдельно.
