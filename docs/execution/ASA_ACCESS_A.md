# ASA-ACCESS-A — рабочая заметка

Разрешение владельца: Result A исходного V1.2 §37.2, Issue #173.
Активный статус/checkpoint — только [current.yaml](current.yaml).
Production, внешние службы и Result B/C не входят в работу.

## Основание и проверенный старт

- Оба приложения прочитаны полностью: Access V1.2 (2706 строк), Learning V3.1 (715).
- Исходный `origin/main`: `567af172e411623370e41a46c2a574b03c117c5f`.
  Checkout `C:/Users/spike/AppData/Local/asa-lab-docker-main` был чист; обновлён FF.
  Старый OneDrive checkout и его untracked файлы не затронуты.
- `pnpm control-plane:check`: PASS, direct_main, blocking=0. Это не product gate.
- В main уже принята консолидация V1.2 (редакция 2.0, source fingerprint совпадает).
  Сохраняются D10–D16/LC-01–08; восстановлена явная граница A/B/C §37.2.
- Learning V3.1 заменяет одну каноническую очередь. Старые M0/M1/VS/evidence
  сохранены по точной ссылке Git history; их результаты не пересматриваются.

## Адресные расхождения и архитектура

| Область | На исходном 567af172 | Изменение в A |
|---|---|---|
| Profile | AccountPage.saveProfile вызывает setAccountRole перед profile update | Разделить команды; dirty/error/partial states |
| Начальная загрузка | Ошибка sessions/avatar блокирует успешный profile | Независимые блоки, error/retry вместо вечного loading |
| Навигация | portalNavigation defaults classes=true; challenges показывается всем | Серверные effective actions, author-only без roster |
| Identity | Account + Principal + capability_grants + Workspace, sessions_v2 | Расширять существующий contract; не global userRole |
| Educator | Уже есть self-attest endpoint и age/grant policy | Отдельное подтверждённое подключение |
| Independent teacher | personal_teaching_contexts в 0022; ensure создаёт скрытую schools row | Адресное additive решение до DDL; не назвать старую фиктивную школу готовым результатом |
| Learning identity | 0086/ADR: immutable tenant+school scope | Не менять прошлые IDs; новый scope требует проверяемой границы |
| Author | LearningActivitiesController требует educator | Независимый author grant + тот же content runtime |
| Seat | Существующие SeatAccountPage, classroom-join, awards | Проверить личный credential, cookie conflict и logout caches |

## Порядок цельной реализации

1. Согласовать источники и exact scope/authorization mapping; сохранить нормы безопасности.
2. Backend: effective actions, отдельное авторство, preferences/security reads,
   независимый teaching scope и защищённый Seat credential path.
3. Account panels + capability flow + personal/learner navigation и legacy aliases.
4. Реальные A–J browser journeys и прямые API negatives; проверить смешанные роли.
5. Fresh/поддерживаемый upgrade при schema changes; связанные Auth/Account/Learning
   tests, governance/code/data gates; фиксированный SHA и доступные screenshots.
6. Передать результат A. Не начинать B/C и не развёртывать production.

## Сохранение и семантическая интеграция

Разрешённый upstream: `dd084c02cc9261deacf9e5de235a01d9bb7d7daf`.
До интеграции 57 файлов сохранены локальным checkpoint
`1a514e6c89f59e80eb26d1e8fc6681be650a10e2` на отдельной safety-ветке.
Внешний `asa-access-a-safety-20260909` содержит PRE_INTEGRATION.md с полным
списком/статусом и проверенный result-a.bundle (требует исходный 567af172).

Полное пересечение: 57 Access-файлов ∩ 37 upstream-файлов = два файла;
одновременно добавленных файлов нет. Текстовых merge conflicts не было,
но результат вручную сверялся по обеим дельтам:

- `api.ts`: сохранены sensorMoisturePercent, sensorResistanceOhm, divider,
  solver v21; добавлены effective actions, learningContext, author и Seat API.
- `current.yaml`: сохранены оба checkpoint Electronics/3D; отдельно внесены
  задача Access, её ветка, focused/browser команды. Owner acceptance pending.
- Остальные 35 upstream-путей после переноса совпадали с dd084c02 байт-в-байт.
  Ядра расчётов Electronics/3D не изменены. Позднее в оболочку редактора добавлен
  только диагностический data-project-save-status для точной проверки сохранения;
  подготовка E2E fixtures и производный hash описаны ниже.

## Четыре исходных падения

RLS allow-list не учитывал новый SELECT learning_contexts. Добавлен только этот
grant; прямые INSERT/UPDATE/DELETE запрещены, forced RLS и чужой tenant проверяются.
Это необходимое расширение контракта миграции 0104, не ослабление существующих прав.

Три public-entry ожидания относились к заменённой ещё до Access landing page:
регистр лицензионной фразы, единственная на всей странице кнопка входа и старый
hero/картинка. Тесты сохраняют проверку исходников/лицензии, однозначных действий
в header и project-first страницы, а не требуют отката принятой landing page.

## Воспроизводимая проверка

- `pnpm test:access-a`: Identity/Auth/MAX/Account/Portal/Learning, настоящие API
  negatives, fresh schema и upgrade с 0103 (реальная школа + исторический личный
  класс, Account/Seat/проекты/learner/Attempt/Submission). UUID не переназначаются.
- `pnpm e2e:access-a`: настоящие A–J и Account C1; никаких route mocks.
  H выдаёт ключ через учительский UI, выходит, проверяет старый токен/cache и
  входит вторым Seat; чужие работа и профиль недоступны. Личное замечание
  преподавателя к значку реально хранится в БД и видно первому; второй не видит
  его ни в UI, ни в собственном awards API, старый токен получает 401.
- `playwright.access-ui.config.ts`: отдельные mock UI-contract tests ошибок,
  partial failure/draft и ширин 320/390/1024/1440. Не замена A–J.
- `pnpm gate:repository`: governance + code + полные data/RLS проверки.
  Только `NX_SKIP_NX_CACHE=true`; не считать focused PASS общим PASS.
- CI выполняет те же scripts; реальные screenshots/trace публикуются артефактом
  `access-a-browser-<SHA>`. Статус CI берётся из workflow точного кандидата.

Локальный `tools/access-a-sandbox.mjs` требует ASA_TEST_PG_BIN, создаёт отдельный
PostgreSQL кластер на свободном loopback-порту и останавливает его в finally.
Существующие БД, Docker, их volumes и production flags не открываются для записи.

Дополнительные находки интеграционной проверки:

- Account C1 обнаружил внешний portrait URL, запрещённый действующей CSP.
  Тот же неизменённый файл хранится локально с source/hash notice; CSP не расширена.
- В direct_main необязательная локальная codex-ветка не требует заранее созданного
  PR. Валидаторы теперь проверяют такую ветку до push; отрицательные проверки
  отсутствующего Git/чужой ветки и строгого coordinated режима сохранены.
  Старые Admin test IDs перенесены в стабильный каталог, не удалены; active registry
  содержит только проверки текущего A, не production journey.
- Полный прогон выявил перегрузку временной БД: Vitest по умолчанию использует
  forks, поэтому THREADS не ограничивал число процессов. Sandbox ограничивает
  обе модели двумя workers. Ожидания тестов и лимиты production не изменялись.
- Новый негативный SQL-тест устанавливает действительный tenant в транзакции:
  он должен доказать запрет DML, а не получить UUID parse error пустого GUC.
- CI дополнительно обнаружил high advisory GHSA-2883-xcg3-v3hh для js-yaml 4.3.1
  в инструментах OpenAPI. Override и lock обновлены адресно до исправленной 4.3.2;
  security gate не обходится. Источник: https://github.com/advisories/GHSA-2883-xcg3-v3hh.
- Реальный 3D browser CI выявил неоднозначный selector «Создать»: у нового
  Account теперь есть и header, и стартовая карточка. Селектор ограничен header;
  моделирование, сохранение, reload, touch и Worker assertions не сокращены.
- Checkers browser journey открывает существующее сохранение через «Игры»,
  а не удалённую ранее карточку в «Проектах»; проверка того же ID и весь игровой
  сценарий сохранены. Electronics trace выявил гонку pagehide autosave с API
  записью следующей тестовой схемы (`project_revision_conflict`, baseRevision 5).
  Между фазами тест ждёт реального `saveStatus: saved` и проверяет отсутствие
  несохранённого local draft, вместо его удаления. CAS и расчёты не изменены;
  ожидание не добавлено перед проверками мгновенной локальной симуляции.
  Штатный generator обновляет только browserEvidenceSha256 в component coverage;
  строки компонентов, модели и их declared support остаются без изменений.
- Все focused module workflows проверяют точный head кандидата (не подменяют
  его synthetic merge с более поздним main) и явно отключают Nx cache, как общий
  Result A workflow. При конфликте PR их можно запускать workflow_dispatch на
  рабочей ветке без merge, изменения main или production.
- Повторный fetch обнаружил более поздний `origin/main` cc712bc5. Он не включён
  автоматически: согласованная база этого кандидата — dd084c02. Перед будущим
  merge более поздние Electronics/3D изменения требуют отдельной интеграции
  и повторной проверки. Draft PR не разрешает merge/deployment.

## Явные границы, не обещания

Локальный итог после интеграции dd084c02: `pnpm gate:repository` PASS,
228 файлов / 1813 тестов; отдельный RLS повтор — 15/15. `pnpm test:access-a`
316/316; `pnpm e2e:access-a` A–J + Account C1 — 5/5; UI contracts — 7/7
(320/390/1024/1440). Адресные upstream regressions — 250/250, также входят
в общий прогон. OpenAPI 65 paths, Compose config и diff check PASS.
Nx заново выполнил 25 lint + 39 typecheck/dependency + 25 build = 89 задач,
все три прогона `Cache: Skipped`. Это локальные факты, не CI/owner acceptance.
CI результат читается по конечному SHA; production не менялся.

- Account-профиль, password/MAX/avatar/sessions/timezone сохраняются. Преподавание
  и авторство — отдельные серверные команды. Восемь разделов не содержат fake switches.
- Linking Seat→Account **pending**: отсутствует контракт подтверждения обеих
  сторон (Account reauthentication + доказательство конкретного Seat/разрешение
  ответственного, срок/одноразовость, конфликт существующей связи, аудит).
  Сейчас Account может присоединиться к классу своим участием, не присвоить чужую
  историю. Это не блокирует остальные A-сценарии согласно разрешению владельца;
  автоматическое слияние по имени/email/IP/device запрещено.
- Self-study progress **pending**: нет публичной команды self-enroll и личного
  runtime участия/прогресса без школьного audience. «Самостоятельно» честно сообщает
  ограничение и открывает «Знания»; fake classroom/enrollment не создаются.
- До будущего rollout преподавателю потребуется выдать личные ключи существующим
  Seat. Слабые старые сессии без credential version намеренно не возобновляются;
  сами Seats, аватары, награды и учебные записи сохраняются.
- Production rollout и Result B/C не разрешены. Принятие владельцем отдельно от CI.
