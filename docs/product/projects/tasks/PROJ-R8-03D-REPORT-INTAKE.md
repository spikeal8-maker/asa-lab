# PROJ-R8-03D — Жалобы: защищённый серверный приём (B1)

**Выбрано владельцем:** 2026-10-24. **Issue:** [#713](https://github.com/spikeal8-maker/asa-lab/issues/713). **Программа:** [#211](https://github.com/spikeal8-maker/asa-lab/issues/211).
**Статус:** SELECTED / IN PROGRESS. **Отложенная интеграция:** #702 / PR #704 (закрепление) — OPEN/DRAFT, BLOCKED FOR MERGE без General PASS.

## 1. Один ограниченный срез

B1 — настоящее сохранение жалобы на **публичную PublicationRevision** через PostgreSQL и защищённый API.
Не создавать пользовательскую кнопку-заглушку. После B1 отдельный B2 подключает `⋯ → Пожаловаться` на карточке/detail и реальный браузерный путь, отдельный B3 добавляет case/queue в существующую админку.

**Строго запрещено:** любые изменения Scratch, Electronics, Arduino, AI, Courses, Auth/Identity, Project Core, развёртывания, старых миграций, общего CI и чужих тестов. Не затрагивать 18 файлов PR #704. Работа #702 не отменена и не признана принятой.

## 2. Вход / preflight

`AGENTS.md` → `START_HERE_FOR_AI.md` → `docs/execution/current.yaml` (lane projects) → `PROJ-R8-03.md` → `DECISION_LEDGER.md` → эта карточка → #713.

- Новый **чистый** git worktree на актуальном main, чужие untracked артефакты прежнего worktree сохраняются.
- `pnpm agent:preflight --scope projects --check` должен вернуть SAFE_TO_START. При RECOVERY_REQUIRED выполнить предписанный SAFE_ACTION; не обходить control-plane.
- Проверить текущее бронирование новых номеров миграций перед созданием; PR #704 уже резервирует **0239**, но ещё не принят.
- Обязательное разделение Backend / QA / независимый Reviewer. Один автор на пересекающийся путь.

## 3. Контракт и ограничения

- Рассматривать жалобу как входящий сигнал, **не** как модерационное действие: одна жалоба не скрывает и не удаляет публикацию.
- Серверный endpoint для аутентифицированного личного аккаунта: `POST /api/public-projects/:publicationId/reports` с exact `revisionId`, `reason`, необязательным `comment`, `Idempotency-Key` (или эквивалентным действующим контрактом).
- Причины строго из ТЗ: `spam`, `abuse`, `dangerous_content`, `personal_data`, `copyright`, `other`. Краткий комментарий ≤500 символов; контролируемая валидация input и предсказуемые ошибки.
- Verified Account/principal на существующей сессионной границе. Anonymous и StudentSeat не превращаются в аккаунт; без отдельного policy decision fail closed. **Identity/Authz код не изменять.**
- SQL проверяет актуальную публичную доступность и **точную текущую revision**, не допускает hidden/revoked/unlisted, protected Learning, подмену reporter или утечку данных. Работа с конкретной immutable PublicationRevision, не рабочим Draft.
- PostgreSQL хранит приватный report (reporter/principal, publication/revision, category, comment, status, requestId, createdAt), отдельный от ModerationCase/Action. RLS и привилегии запрещают прямой DML приложения; бизнес-операция через ограниченный существующий DB-security pattern.
- Транзакционная защита повторов, ограничение частоты отправки, одновременные запросы, однозначная идемпотентность. Без раскрытия имён жалобщиков автору и всем public DTO.
- Нельзя мигрировать рабочую школьную или production БД.

## 4. Приёмка

1. Fresh и populated/replay PostgreSQL 16, проверка ролей/RLS, idempotency, concurrency, rate limits, immutable revision.
2. API integration: successful report, 400 invalid payload, 401 anonymous, 403 StudentSeat/blocked role, 404 private/unlisted/revoked/hidden, 409 stale revision/duplicate при несовпадающем запросе, 429 rate limiting, safe 503.
3. После записи не меняются public state, Project, Draft, Versions, Collections; приватные данные не появляются в detail/list JSON.
4. Focused exact-SHA CI и отрицательные тесты, независимое code **и security** review; General CI классифицировать, но не обходить.
5. Issue/PR/SHA/evidence/NOT DEPLOYED фиксируются; код до обязательной приёмки не объявлять MERGED или готовым пользовательским UI.

## 5. STOP исполнителя; продолжение контроллера

Исполнитель после B1 направляет контроллеру результат и STOP. Контроллер сохраняет блокер #702/#704, организует независимое review и переходит к B2 только после разрешённой интеграционной границы. Документы [SPEC](../../ASA_PROJECTS_IMPLEMENTATION_SPEC.md) §35–38 и [micro iterations](../IMPLEMENTATION_MICRO_ITERATIONS.md) §10 приоритетнее импровизированной архитектуры.
