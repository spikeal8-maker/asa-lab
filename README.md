# ASA Lab

**Единая образовательная платформа для аккаунтов, личных и школьных пространств, проектов, виртуальных лабораторий, классов и полного учебного цикла.**

ASA Lab строится как модульная платформа: общее ядро управляет идентичностью, доступом, рабочими пространствами, проектами, классами, заданиями, версиями и аудитом, а предметные среды подключаются через общий Module SDK.

## Текущее состояние

Принятый владельцем технический Alpha-baseline:

```text
7afebdcf9441b027092ce17a37f1f89950af99c6
```

Baseline технически проверен, но **не является заявлением функциональной полноты**. На нём подтверждены:

- public entry, регистрация и универсальный вход по email или username;
- `Account`, `Profile`, `Principal`, Personal Workspace и `sessions_v2`;
- совместимость существующего педагога и сохранность его проектов;
- Project Hub, Electronics, Chess и Chess Online;
- PostgreSQL, RLS, migrations, persistence и backup/restore;
- Linux Docker runtime для WSL2 и обычного Linux host;
- полный локальный gate: 286 тестов и Playwright 8/8 без неожиданных browser errors.

Текущая единая рабочая линия:

```text
branch: assistant/docker-linux-bootstrap
PR:     #70 (Draft)
```

`main` пока содержит более старый Teacher Portal baseline и **не является источником восстановления текущей Alpha-сборки**. До отдельного owner-решения запрещены merge, release tag, закрытие transfer-only PR и удаление веток.

## Текущая продуктовая задача

```text
TASK-ACCOUNT-C1-001
Issue #48
status: in_progress
```

Уже реализовано и не должно создаваться повторно:

- public entry и adult registration;
- Account / Profile / Principal;
- ровно один Personal Workspace;
- `sessions_v2`, HttpOnly cookie и login по email/username;
- legacy teacher bridge;
- principal-aware ownership личных проектов;
- сохранение Electronics и Chess проектов.

Оставшийся scope Account C1:

- educator self-attestation с серверной возрастной политикой и AuditEvent;
- provisional educator capability;
- список доступных workspaces и безопасное переключение ActiveContext;
- account menu и profile settings;
- отображение email verification state;
- список активных sessions;
- отзыв одной и всех других sessions;
- реальный Account C1 Chromium flow без mock API.

## Каноническая очередь разработки

```text
Technical Alpha baseline
→ Account C1: profile, capabilities, workspace context, sessions
→ R2 Creator Portal и развитие Personal Workspace
→ R3 Module Registry, Project Hub и полный project lifecycle
→ R4 Electronics functional parity
→ Classroom / StudentSeat / learner shell
→ portfolio, publication, assignments, review и остальные модули
```

Следующий этап не начинается до owner review, полного gate и нормативного перехода текущего этапа. Параллельные долгоживущие product branches запрещены.

## Источники истины

Перед любыми изменениями coding-агент обязан читать источники в таком порядке:

1. [`AGENTS.md`](AGENTS.md);
2. [`docs/project-map/infrastructure-focus.yaml`](docs/project-map/infrastructure-focus.yaml);
3. [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml);
4. [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml);
5. GitHub Issue текущей задачи;
6. [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml).

Человеко-читаемые представления:

- [`START_HERE_FOR_AI.md`](START_HERE_FOR_AI.md);
- [`docs/delivery/DEVELOPMENT_PROGRAM_V1.md`](docs/delivery/DEVELOPMENT_PROGRAM_V1.md);
- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md);
- [`docs/project-map/QUALITY_MAP.md`](docs/project-map/QUALITY_MAP.md).

## Локальный runtime

Канонические порты:

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

Legacy-порты запрещены нормативной
[`LOCAL_PORT_POLICY.md`](docs/delivery/LOCAL_PORT_POLICY.md); deny-list здесь не
дублируется.

Docker-профили и инструкции:

- [`docs/deployment/WINDOWS11_WSL2_DOCKER.md`](docs/deployment/WINDOWS11_WSL2_DOCKER.md);
- [`docs/deployment/LINUX_DOCKER_DEPLOYMENT.md`](docs/deployment/LINUX_DOCKER_DEPLOYMENT.md);
- [`docs/deployment/DOCKER_BACKUP_RESTORE.md`](docs/deployment/DOCKER_BACKUP_RESTORE.md);
- [`docs/deployment/DOCKER_TROUBLESHOOTING.md`](docs/deployment/DOCKER_TROUBLESHOOTING.md).

## Данные и восстановление

Git сохраняет код и migrations, но не пользовательские данные. Перед сменой компьютера или разрушительными операциями отдельно сохраняются:

- PostgreSQL dump из `backups/`;
- локальные `.env` и runtime credentials;
- seed-пароли вне Git;
- owner-preview screenshots при необходимости аудита.

Backup, credentials и локальные owner-preview artifacts запрещено коммитить.

## Quality gate

Локальный базовый gate:

```bash
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm boundaries:check
pnpm contracts:check
pnpm build
pnpm test
```

Task-specific gate берётся только из `EXECUTION_MANIFEST.yaml` и `test-catalog.yaml`:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

`PASS` существует только после реального exit code `0`. `BLOCKED` и `NOT_RUN` не считаются успешным завершением.

## Главные архитектурные инварианты

- Account, Principal, Workspace, capability и membership — разные сущности.
- Account session и будущая StudentSeat session не объединяются.
- Tenant и ActiveContext определяются сервером, не браузером.
- Каждая tenant-owned сущность имеет `tenant_id`.
- Personal Project не требует Classroom.
- ProjectVersion и SubmissionAttempt неизменяемы.
- Classroom/Project Core не импортирует subject logic.
- Пользовательский код не выполняется в Core API.
- Migrations additive-only до отдельного destructive gate.
- Существующие педагог, классы, проекты и drafts сохраняются при каждом переходе.

## Структура репозитория

```text
apps/          Web и API приложения
packages/      общие contracts, SDK и platform libraries
contexts/      bounded contexts identity, projects, classroom, chess, electronics
migrations/    последовательные PostgreSQL migrations с checksum
schemas/       OpenAPI, JSON Schema и executable contracts
tests/         unit, integration, authorization, RLS и PostgreSQL tests
e2e/           реальные Chromium user flows
compose*.yaml  dev, test и staging Docker profiles
docs/          product, architecture, delivery, testing и deployment contracts
```

## Правовой статус

Архитектура предусматривает минимизацию детских данных, локальную поставку и возможность российского primary data plane. Документация не заменяет юридическое заключение, модель угроз и локальные нормативные акты образовательной организации.
