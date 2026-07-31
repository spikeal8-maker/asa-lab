# AGENTS.md — обязательный контракт coding-агента ASA Lab

Этот файл обязателен для coding-агентов и разработчиков.

## 1. Каноническое состояние

```text
canonical branch:        main
product merge SHA:       e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
merged PR:               #70
Account C1 / Issue #48:  completed
active product task:     none
```

Технический Alpha принят без заявления функциональной полноты. Post-merge governance-коммиты могут делать текущий head `main` новее product merge SHA.

Новая product task не активирована. R2, R3 и R4 остаются blocked roadmap. Агент не начинает их самостоятельно.

## 2. Источники истины

Порядок приоритета:

1. принятые ADR;
2. product и capability contracts;
3. architecture и security contracts;
4. OpenAPI, JSON Schema, migrations и event schemas;
5. infrastructure manifest/focus, только когда `active: true`;
6. `docs/delivery/EXECUTION_MANIFEST.yaml`;
7. `docs/project-map/project-map.yaml`;
8. GitHub Issue активной задачи;
9. `docs/testing/test-catalog.yaml`;
10. человеко-читаемые README, Development Program и карты.

Чат не меняет task ID, Issue, branch, dependency, port, test ID, executable queue или exit gate. Изменение сначала публикуется в нормативных файлах и Issue.

## 3. Определение работы

Первым проверяется:

```text
docs/project-map/infrastructure-focus.yaml
```

### Infrastructure focus active

При `active: true` выполняется только указанная infrastructure task. Product code запрещён.

### Infrastructure focus inactive

При `active: false` проверяются terminal status, `current_focus: null`, completed SHA и согласование с infrastructure manifest.

После этого читается product map.

### Product task

Product code разрешён только когда одновременно верно:

```text
project.current_focus содержит task ID
тот же task есть в EXECUTION_MANIFEST.yaml
status = ready | in_progress | in_review
все depends_on = done
Issue открыта и не blocked
branch соответствует manifest
```

Если `project.current_focus` отсутствует или равен `null`, coding-агент не пишет product code. Он сообщает `NO_ACTIVE_TASK` и не выбирает roadmap-задачу.

## 4. Текущее состояние после merge

Account C1 завершён и находится в `main`.

Уже реализовано и не создаётся повторно:

- public entry;
- adult registration;
- Account / Profile / Principal;
- Personal Workspace;
- `sessions_v2`;
- login по email или username;
- educator self-attestation;
- provisional audited educator capability;
- workspace list и ActiveContext switching;
- account profile;
- active session list и revocation;
- legacy teacher compatibility;
- principal-aware project ownership;
- Project Hub, Electronics, ASA Chess и Chess Online;
- Docker deployment, persistence и backup/restore.

Issue №48 закрыта как completed.

## 5. Разделение обязанностей

### Coding-агент

- реализует только активную product task;
- меняет код, contracts и additive migrations в пределах scope;
- запускает focused tests;
- выполняет browser E2E;
- публикует evidence;
- останавливается для owner review.

### GitHub/governance работа

- синхронизация README, manifests, maps и Issues;
- аудит старых PR и веток;
- классификация `contained / superseded / still valuable / obsolete`;
- закрытие PR и удаление веток только по отдельному решению;
- release tag только по отдельному решению.

Governance-аудит старых PR не является coding task и не должен блокировать активную продуктовую реализацию после её нормативной активации.

## 6. Один task — один вертикальный flow

```text
domain/application
→ additive migration/repository
→ API
→ UI
→ focused tests
→ live browser E2E
→ evidence/maps
→ owner review
→ stop
```

После `in_progress` scope заморожен. Запрещены unrelated refactoring, новый framework, следующая capability и competing product branch.

## 7. Git и ветки

- `main` является каноническим источником текущей Alpha-сборки.
- Новая product branch создаётся только после owner-approved task activation.
- Нельзя продолжать новую product работу на закрытой ветке PR №70.
- Запрещены force-push и переписывание опубликованной истории.
- Старые branches/PR не merge, не закрывать и не удалять без preservation audit и отдельного решения.
- Squash/rebase проверенного release candidate запрещены без повторной полной матрицы на новом SHA.

## 8. Архитектура

- Control Plane — modular monolith.
- `apps/api` и `apps/web` — composition roots/adapters.
- Business logic находится в bounded contexts.
- Domain не импортирует NestJS/Fastify/HTTP, PostgreSQL client/ORM или React.
- Cross-context interaction идёт через public ports/contracts.
- Прямые writes в чужие таблицы и internal cross-context imports запрещены.
- Project/Classroom Core не знает subject-specific payloads.
- Subject modules подключаются через Module SDK.

## 9. Identity, tenancy и security

- Tenant/workspace/principal определяются серверной session context.
- `tenant_id`, workspace ID, principal ID, role или capability из browser body не являются доверенными.
- Runtime DB role не superuser, не owner и без `BYPASSRLS`.
- API использует `APP_DATABASE_URL`; migrations/admin tools используют `DATABASE_URL`.
- Tests используют отдельный `TEST_DATABASE_URL` с guard.
- Passwords хранятся memory-hard hash.
- Session token генерируется CSPRNG; в БД хранится только hash.
- Tokens, passwords, credentials и project content не логируются.
- Migration после применения не переписывается; изменение только новой additive migration.
- Destructive cleanup требует отдельного owner-approved этапа.

## 10. Проекты и модули

- `Project` — изменяемый контейнер.
- `ProjectDraft` использует optimistic revision.
- `ProjectVersion` неизменяема и имеет digest.
- Project envelope содержит `moduleKey`, `moduleVersion`, `schemaVersion`.
- Core не содержит `if moduleKey === ...` для предметной логики.
- Несовместимое schema change требует version bump, schema, migrator и fixtures.

## 11. Порты

```text
Web  127.0.0.1:4610
API  127.0.0.1:4611
E2E  127.0.0.1:4612
```

Запрещены `3000`, `3100`, `5173`.

Если порт занят, неизвестный процесс не завершается и другой порт не выбирается молча.

## 12. Тесты

Источник product gates:

```text
docs/delivery/EXECUTION_MANIFEST.yaml
docs/testing/test-catalog.yaml
```

Результаты:

- `PASS` — фактический exit 0;
- `FAIL` — фактический non-zero;
- `BLOCKED` — обязательная среда отсутствует;
- `NOT_RUN` — команда не запускалась.

`BLOCKED` и `NOT_RUN` не закрывают gate. Screenshot не заменяет assertion. Manual smoke не заменяет Playwright.

Hosted GitHub Actions сейчас может падать до первого шага из-за внешнего runner/settings blocker. Это не разрешает объявлять CI PASS и не отменяет локальный exact-SHA gate.

## 13. Definition of Done

Task завершена только когда:

1. user flow Issue реализован;
2. non-goals отсутствуют в diff;
3. contracts/migrations/security согласованы;
4. все обязательные tests PASS на одном SHA;
5. browser E2E и owner evidence готовы;
6. persistence и migration path проверены при применимости;
7. owner принял результат;
8. PR объединён утверждённым методом;
9. post-merge governance синхронизирован;
10. следующая задача не начата автоматически.

## 14. Текущая команда агенту

```text
NO_ACTIVE_TASK
Не писать product code.
Не выбирать R2/R3/R4 самостоятельно.
Ожидать опубликованный owner-approved task transition.
```
