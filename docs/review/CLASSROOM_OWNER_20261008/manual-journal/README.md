# Передача среза ручного журнала — 10.10.2026

## Исправление замечаний координатора в том же срезе

Код дополнен после review; ниже перечислены текущие изменения. Проверки
первой передачи в разделе «Исторические проверки первой передачи» относятся
к прежнему diff и **не являются PASS обновлённых build/types/unit/PG/E2E**.

- Удалён общий actor с Account→Seat fallback. Учитель и Account learner
  разрешают только `asa_session`; отдельный `/api/class-join/journal/results`
  разрешает только `asa_student_session`, без Account resolver/refresh.
  В SeatResults и AttendedClassesPage передан явный scope. Компонент очищает
  предыдущую выдачу на revalidation/error/logout/смену scope и игнорирует
  запоздавший ответ. Проверка cookies выполняется по focus/visibility и
  явному обновлению без нового polling.
- Чтение и inbox сопоставляют `learner_identity_id` самой оценки с активными
  Seat/Account links и активной school identity, включая tenant/school/class.
  Legacy `seat.account_id` не является authority. Неактивный Seat link не
  воскрешается, history lineage не переписывается. Реальная модель 0086/0087/
  0095 использует неизменяемые subject/lineage и смену статусов для отзыва;
  журнал не добавляет глобальных link/unlink прав.
- Убрано `EXCEPTION WHEN OTHERS → WARNING`. В той же транзакции создаются
  inbox события для обоих разрешённых субъектов, grade, receipt и audit.
  OFF означает явно сохранённый suppressed event. Ошибка emission или
  пропущенный INSERT откатывают транзакцию; одинаковый retry не теряет
  событие и не создаёт дубль. Общий emitter имеет legacy resource check с
  ранним return; узкий закрытый journal emitter использует exact resource,
  тот же preference evaluator/advisory lock и существующую таблицу inbox.
  Старый access/course revocation predicate из 0130 сохранён в ELSE без
  изменений; list/unread/mark-read применяют тот же current_access.
- Сервер ограничивает диапазон 93 днями, страницы — 50 максимум; defaults:
  50 столбцов, 20 результатов, 20 изменений истории. UI начинает с текущего
  месяца и даёт выбор любого прошлого месяца и навигацию страниц. История
  использует exclusive revision cursor; настройки читаются отдельным
  `/journal/settings`. Нет fetch-all и загрузки истории каждой ячейки;
  authorized Seats и авторы соединяются в SQL страницы.
- Первый journal scale фиксирует IANA timezone владельца (или UTC).
  Последующие версии её сохраняют. Server today/default month и даты класса
  согласованы; DATE и старые значения шкал не переинтерпретируются.
  Inbox link содержит месяц и колонку и открывает последнее состояние оценки
  через авторизованный bounded query. Пять presets и 0/null сохранены.

Дополнительно к исходному списку файлов добавлены:

- `apps/web/src/components/JournalMonthNavigation.tsx`
- `apps/web/src/learning/journal-destination.ts`
- `apps/web/src/learning/testing/student-journal-results.spec.ts`

Итого текущий совокупный diff: 26 путей. Новая миграция остаётся **0201**;
0202, A-owned StudentSeat schema и остальные запрещённые пути не менялись.

Тесты подготовлены, **pending запуск координатором**:

- controller: 14 случаев, включая mixed cookies, отсутствие/истечение нужной
  cookie при валидной другой, отсутствие вызова чужого resolver, limits и
  propagation emission error;
- client/presets: 4 случая, включая календарь и отдельные API routes;
- DOM: 3 случая, включая stale scope response, revalidation error/logout,
  notify focus и ровно один запрос следующей страницы;
- real restricted PG: 10 journeys. Добавлены canonical-only Account,
  revoked Account/Seat/identity, pending/rejected и foreign identity/class,
  class-scoped injection notification INSERT failure → полный rollback →
  identical retry → одна доставка, сохранение прежних course/class/requester
  access правил, range/limit boundary, прежняя страница и timezone snapshot;
- новый реальный E2E расширен: все пять пресетов действительно выставляются
  и читаются учеником после reload; две уже смонтированные поверхности
  получают разные реальные mixed cookies, показывают только свой результат,
  без нужной cookie возвращают 401 и очищают выдачу; проверены прежний месяц
  и inbox deep link. Synthetic API ответов нет. Координатор включает файл
  в browser command после интеграции.

В этом продолжении реально выполнены:

- `node_modules/.bin/prettier.cmd --write <17 изменённых TS/TSX/YAML/MD>` —
  успешно, без изменения formatter/config; MD игнорируется репозиторным
  formatter согласно существующему ignore.
- `node_modules/.bin/eslint.cmd <15 изменённых TS/TSX/test файлов>` — PASS.
  Native Nx cache warning EPERM не остановил lint; новых конфигов нет.
- `node tools/validate-contracts.mjs` — PASS, 110 paths, JSON Schema.
- `node tools/migrate.mjs --check` — PASS, 198 файлов, без подключения БД.
- `git diff --check` — PASS.

Финальная проверка после self-review:

- `prettier.cmd --check <23 изменённых TS/TSX/CSS/YAML>` — PASS после
  исправления форматирования одного preset spec;
- `eslint.cmd <15 изменённых TS/TSX/test файлов>` — PASS;
- `node tools/validate-contracts.mjs` — PASS, 110 paths;
- `node tools/migrate.mjs --check` — PASS, 198 файлов,
  final 0201 sha256 prefix `762aa75437be`, без исполнения SQL;
- `git diff --check` — PASS;
- read-only структурное сравнение OpenAPI StudentSeat с HEAD — unchanged;
  нормализованное сравнение исходного predicate 0130 с ELSE — unchanged.
  Это self-review, не замена реальных PG assertions.

Canonical build/types/unit и реальные PG/browser
не запускались здесь по прямому поручению координатора. Старый локальный
MAX/Scratch/Vitest baseline не ремонтировался и не использовались новые
обходные configs. Никакой БД/API/Docker/listening server, изменений sandbox/
хоста, commits/push/merge или owner acceptance нет.

Восстановленный read-only snapshot: локальный HEAD всё ещё d686f18,
совокупный dirty diff сохранён; actual origin/main при наблюдении — f9300d8,
локальная ветка ahead 4 / behind 20. PR527 HEAD — cf5a7b3; exact-head workflows
наблюдались failure, без утверждения нового PASS и без повторного аудита CI.
Learning task в local current.yaml — TASK-LRN-COURSE-001/in_progress;
acceptance blocker допускает этот явно выбранный bounded repair. Ветки и
execution state не синхронизировались и не изменялись.

Реализованы КЛ-14/КЛ-15 в рамках явно выбранного bounded repair. Срез не
изменяет execution state, не закрывает чужие задачи и не утверждает owner
acceptance, release candidate, deployment или нагрузочную готовность.
Коммитов, push и merge нет.

## Файлы

Новые:

- `migrations/0201_classroom_manual_journal.sql`
- `apps/api/src/classroom-journal.controller.ts`
- `apps/api/src/classroom-journal.controller.spec.ts`
- `apps/web/src/classroom-journal-api.ts`
- `apps/web/src/components/ManualClassroomJournal.tsx`
- `apps/web/src/components/JournalScaleSettings.tsx`
- `apps/web/src/components/StudentJournalResults.tsx`
- `apps/web/src/components/manual-classroom-journal.css`
- `apps/web/src/learning/testing/classroom-journal-presets.spec.ts`
- `tests/courses/classroom-manual-journal.pg.spec.ts`
- `e2e/classroom-manual-journal.spec.ts`
- `docs/product/learning/CLASSROOM_MANUAL_JOURNAL.md`
- этот отчёт.

Точки включения и регрессии:

- `apps/api/src/app.module.ts`
- `apps/web/src/components/ClassroomGradebook.tsx`
- `apps/web/src/components/ClassroomGradingScheme.tsx`
- `apps/web/src/components/SeatResults.tsx`
- `apps/web/src/pages/AttendedClassesPage.tsx`
- `apps/web/src/components/LearningInbox.tsx`
- `apps/web/src/components/LearningNotificationPreferences.tsx`
- `schemas/openapi.yaml`
- `e2e/learning-course-01.spec.ts`
- `e2e/learning-surface-convergence.spec.ts`

В старых E2E изменены переходы в режим «Задания» и в существующие настройки
шкалы заданий. Проверочные assertions, exact submission, immutable review и
численные ожидания не ослаблены. Запрещённые пути первого исполнителя,
package/lockfile/workflows/AGENTS/current.yaml не изменены.

## Исторические проверки первой передачи

- `node tools/migrate.mjs --check` — PASS, 198 файлов включая новую 0201;
  соединений с БД не было. Это проверка файлов, не исполнение SQL.
- `node tools/validate-contracts.mjs` — PASS, 108 OpenAPI paths и JSON Schema.
- `node_modules/.bin/prettier.cmd --check <изменённые TS/TSX/CSS/YAML>` — PASS.
- `node_modules/.bin/eslint.cmd <изменённые TS/TSX и тесты>` — PASS.
- `node_modules/.bin/tsc.cmd -p .journal-api-types.json --noEmit` — PASS для
  нового контроллера с обычным расширением типов `@fastify/cookie`.
- `node_modules/.bin/tsc.cmd -p .journal-web-types.json --noEmit` — PASS для
  нового API client, трёх компонентов и обычных build metadata declarations.
- `node_modules/.bin/vitest.cmd run --config .journal-vitest.config.mts
  apps/api/src/classroom-journal.controller.spec.ts
  apps/web/src/learning/testing/classroom-journal-presets.spec.ts` — 11/11 PASS.
- `node_modules/.bin/vite.cmd build --config .journal-vite.config.mts` — PASS
  полного Web, последний запуск 12.70 s; есть обычные warnings размера chunks.
- `git diff --check` — PASS.

Временные `.journal-*.json/.mts` удалены после проверки. Они не меняли продукт,
assertions, aliases или package versions: typecheck-файлы выбирали новый код,
Vite/Vitest включали `resolve.preserveSymlinks=true`, Vitest использовал
временный каталог внутри writable workspace. Это потребовалось из-за `EPERM`
на native realpath и rename в управляемом локальном sandbox. Обычный Vitest
до этой настройки не исполнил ни одного теста и не считается PASS.
Логи сохранены в корне как игнорируемые `journal-*.log`.

Общий `nx run-many -t build --all` с `NX_SKIP_NX_CACHE=true`, `NX_DAEMON=false`
исполнил 27 задач без кэша: 25 прошли, Web остановился на sandbox realpath,
API — на уже существующих строках `max-auth.service.ts` с типом Response.
Web затем собран полностью с указанным разрешением symlinks. Общий Web
typecheck также обнаружил существующие ошибки Scratch/Vitest типов. Эти
области не исправлялись; полного gate:code/repository PASS здесь нет.

## Проверки, оставленные координатору

- Реальное исполнение миграции и пяти PG journeys через общий Vitest:
  `tests/courses/classroom-manual-journal.pg.spec.ts`. Тесты требуют
  `TEST_DATABASE_URL`/`APP_TEST_DATABASE_URL`, проверяют restricted runtime,
  права, связанный Account/Seat, настройки доставки, все пресеты, неизменность
  истории, конкуренцию и receipt replay. Условия skip не добавлены.
- Включение `e2e/classroom-manual-journal.spec.ts` в существующий CI browser
  command после интеграции. Это реальный API, включая server commit с потерей
  первого ответа, а не synthetic API. Снимки матрицы 390 px и результатов
  создаются самим E2E в `e2e/artifacts/classroom-manual-journal`.
- Исполнение обновлённых существующих Learning E2E и общего repository gate
  на интегрированном SHA; review интерфейса и owner acceptance отдельно.

БД, API/listening servers, Docker и deployment локально не запускались.
Рабочая БД, секреты, сеть и данные владельца не читались и не менялись.
