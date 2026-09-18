# LRN-COURSE-01 — исполнение и исправления E1

Этот файл — постоянный пакет выполнения, не источник status/checkpoint/SHA. Выбранная работа находится только в `current.yaml`, lane learning; продуктовый scope связан с Issue #179. Doc rebaseline не является приёмкой кода и не разрешает deployment.

## Прочитать

`AGENTS.md` → `agent:recover --scope learning --check` → `agent:context --scope learning` → выбранный E1-FIX-ID в Requirements Ledger → Integrated V1.5 §4 и точные разделы Learning/Access 2.2. Архив не загружается без конкретного исторического вопроса.

## Цель

Один законченный курс от автора и законной выдачи доступа до exact project Submission, review/revision и canonical Gradebook. Существующие identity/runtime/projections переиспользуются, но факт их существования не освобождает от negative/retry/concurrent тестов. Успешный старый CI не отменяет найденные дефекты.

## Зафиксированные технические решения ближайших исправлений

Эти решения снимают необходимость проектировать security/concurrency «по ходу». Если реализация требует отступления, сначала меняется канонический контракт и regression, а не код молча.

### E1-FIX-01 — admission/rate limit

Изменяемые runtime paths: `apps/api/src/classroom-join.controller.ts`, `apps/api/src/rate-limit.ts` либо небольшой shared limiter в том же Auth/API context; новый Auth service не создаётся. Числовой профиль — Access 2.2 §9.3: 60 invalid resolve/source/10m; 5 invalid exact candidate/class/10m; 180 invalid source+class/10m; 300 invalid source total/10m; successes не расходуют failure budgets. Supported production E1 — один API instance; multi-instance только после shared state. Planned regression files: `tests/security/student-seat-rate-limit.spec.ts` и `e2e/student-seat-access-hardening.spec.ts`; тесты проверяют настоящий `/resolve` + `/studentseat`, а не `/auth/login`.

### E1-FIX-02/03 — credential storage, cards and rollout

Protected-storage migration version is not pre-reserved. Immediately before implementation, fetch fresh `main`, allocate the next free migration version, and require it to be greater than every published migration version; the concrete filename is fixed only by the bounded slice that creates the schema change. API paths: `apps/api/src/classrooms.controller.ts`, `apps/api/src/classroom-join.controller.ts`; Web: `StudentAccessCards`, `StudentCodeDialog`, `JoinClassPage`. OpenAPI меняется в `schemas/openapi.yaml` до/в том же срезе. Product contract: Class Code создаётся автоматически с классом; Student Code при single/batch добавлении создаётся CSPRNG-генератором длиной 6 из case-sensitive mixed-case safe alphabet `2346789ACDEFGHJKMNPQRTUVWXYacdefghjkmnpqrtuvwxy`; staff exact класса может заменить его на `[A-Za-z0-9]{4,10}`; старый код и активные Seat-сессии отзываются без изменения LearnerIdentity/history. Storage: AES-256-GCM + separate HMAC-SHA-256 lookup key, key IDs/keyring outside DB, active+retired digest uniqueness. Permissions issue/read_current/rotate/sessions.revoke следуют active exact-class staff scope: существующие owner+co_teacher сохраняются; organization/school staff получают их только с exact-class grant; временная подмена использует тот же class scope с expiry и досрочным revoke.

Rollout: production keyring + independent `CLASSROOM_CODE_SECRET` preflight → stop old credential writer/maintenance fence → schema-only protected-storage additive migration allocated from fresh `main` with a next-free version greater than every published migration version → new API `ASA_STUDENT_CODE_PROTECTION_MODE=compat` dual-writes protected+legacy → release fence → resumable application backfill via `tools/student-seat-protected-code-backfill.mjs` while compat API is sole writer → verify `unprotected_active=0` → rotate all `legacy_predictable` and reprint cards → require `legacy_predictable_active=0` → switch `enforced` → remove legacy fallback/plaintext. Old API MUST NOT run concurrently with backfill. Planned DB test: `tests/account/student-seat-access-hardening.pg.spec.ts`; browser: `e2e/student-seat-access-hardening.spec.ts`.

### E1-FIX-12 — production secret/recovery integration

Runtime/deployment paths: `apps/api/src/classroom-code-secret.ts`, `apps/api/src/health.controller.ts`, `compose.yaml`, `tools/docker-update.ps1`, `tools/docker-update.sh`, `tools/production.mjs`. Production keyring preflight is mandatory. Production has no DATABASE_URL-derived Class Code fallback. `CLASSROOM_CODE_SECRET` is a separate stable >=32-byte secret; Student Code keyring remains separate. Updater preflight checks both before migration/deploy. Emergency Class Code secret rotation is a maintenance operation that reissues every active class code/version and invalidates old QR; DB password rotation alone MUST NOT change Class Codes.

This shared/infrastructure touch is part of E1-FIX-12 and requires fresh-main race check. Planned recovery test ID: `TST-RECOVERY-LEARNING-E1-CREDENTIAL-SECRETS-001`. Missing global secrets block deployment; a row-specific unknown historical key returns credential-specific 503/degraded diagnostics rather than taking unrelated platform APIs down.

### E1-FIX-04…08/11 — Course Builder correctness

Course Builder correctness migration version is not pre-reserved. Immediately before implementation, fetch fresh `main`, allocate the next free migration version, and require it to be greater than every published migration version; the concrete filename is fixed only if that bounded slice actually needs SQL corrections. API: `courses.controller.ts`; UI: `CoursesPanel`, `AuthorVersionHistory`, `course-version-diff`, `AssignmentLibraryPage`; точный affected subset определяется срезом. OpenAPI error/payload changes — `schemas/openapi.yaml`.

The future Course Builder correctness migration обязана сохранять existing CourseVersion/Run IDs. Transaction boundaries: archive-check+assign в одной DB command/transaction; publish receipt lookup after authz but before stale revision for an exact completed request. Draft navigation fencing остаётся client/server revision contract, не новой таблицей состояния. Planned DB test: `tests/courses/course-authoring-correctness.pg.spec.ts`; unit diff: `tests/courses/course-version-diff.spec.ts`; browser: `e2e/learning-course-authoring-hardening.spec.ts`.

Course Builder FUNCTIONAL_ACCEPTANCE определяется Integrated §4.2.1; все informational MVP blocks и structural controls проходят save/reload/preview/publish/learner render. Quiz/Programming activity UI не подтягиваются в E1.

## Порядок ограниченных срезов

1. E1-FIX-01…03 и E1-FIX-12: массовый StudentSeat-вход с одного IP, непредсказуемые короткие коды и защищённый repeated readback, правильный class-only QR/публичный host.
2. E1-FIX-04…05: защита всей навигации и inflight editor input, idempotent publish после lost response.
3. E1-FIX-06…08 и E1-FIX-11: concrete structural/policy diff, точные prepublish errors и корректный legacy-picker, atomic archive/assign.
4. E1-FIX-09: согласованность active docs и реально запускаемых regression cases; выполняется вместе с соответствующим срезом, без второго отчётного состояния.
5. E1-FIX-10: exact product candidate, независимый review по policy, полные требуемые gates, owner-visible synthetic journey; deployment и smoke asa-lab.ru отдельно разрешаются и фиксируются.
6. После функциональной приёмки — отдельный visual convergence библиотеки/курса/класса. Читаемость, доступность CTA и сохранность не считаются отложенной косметикой.

Порядок — не разрешение исполнителю автоматически проходить все пункты за один запуск. Выбирается один законченный user transition. Product code, docs-only correction и server update не смешиваются в отчёте.

## Приёмка среза

Сначала воспроизвести проблему на baseline либо записать source-only hypothesis. Regression должен падать по требуемой причине до исправления. После repair: happy path, соседний forbidden scope, retry/lost response, concurrent/stale state, сохранение истории. E1-FIX-08 не объявляется фактически проявившимся инцидентом без воспроизведения.

Использовать существующие `pnpm test:learning-e1`, `pnpm e2e:learning-e1` и Access-A по затронутому пути. Полный `pnpm gate:repository` требует настоящей изолированной БД; отсутствие БД нельзя назвать PASS. Doc-only проверка использует governance и свой semantic-doc validator. Планируемые случаи в ledger не выдаются за выполненные тесты.

## Финальная граница

Все критерии Integrated §4.15 плюс применимые E1-FIX scenarios должны иметь exact evidence. Без правильного домена, работающего NAT-входа, защищённого draft и достоверного retry кандидат не принят. Владелец отдельно принимает демонстрацию; сервер обновляется только по прямому поручению. После deployment проверяются Web/API SHA, схема и разрешённый полный user journey именно на https://asa-lab.ru/.

E2–E6, посещаемость, новая RLS/tenant модель, предметные ядра и массовая очистка старых миграций не входят в этот пакет исправлений. ТЗ по следующим стадиям сохраняется; следующее разрешение не выводится из зелёного предыдущего теста.
