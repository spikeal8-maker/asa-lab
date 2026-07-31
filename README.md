# ASA Lab

**Модульная образовательная платформа для аккаунтов, рабочих пространств, проектов, виртуальных лабораторий и будущего учебного цикла.**

## Каноническое состояние

```text
main:                    e01ac85095ddaabef19ed618964deac3aa5b2406
verified implementation: 35c06c42012672b9b4cb2626b85ba1f21b973bc0
merged PR:               #70
Account C1 / Issue #48:  completed
active product task:     none
```

PR №70 объединён в `main` контролируемым merge commit. Squash, rebase и force-push не применялись. Функциональная полнота конечного продукта не заявляется.

## Что работает

- public entry, регистрация и универсальный вход по email или username;
- `Account`, `Profile`, `Principal`, Personal Workspace и `sessions_v2`;
- educator self-attestation с серверной возрастной политикой и AuditEvent;
- список workspaces и membership-scoped ActiveContext;
- профиль Account и управление активными sessions;
- Project Hub с существующими Electronics и ASA Chess проектами;
- Chess Online;
- PostgreSQL, RLS и additive migrations;
- Docker runtime для Windows 11 WSL2 и Linux;
- persistence и backup/restore.

Проверенная матрица для implementation SHA `35c06c4…`:

```text
Account task gate: 28/28 PASS
Regression:         298/298 PASS
Playwright:         9/9 PASS
Browser errors:     0
Docker lifecycle:   PASS
Persistence:        PASS
Backup/restore:     PASS
```

Merge SHA содержит проверенный implementation SHA вторым родителем. Hosted GitHub Actions остаётся внешне заблокированным до первого шага и не объявляется PASS.

## Текущая пауза

Новая product task не активирована. R2, R3 и R4 остаются roadmap-задачами:

```text
R2 Creator Home / capability-aware Portal shell   blocked
R3 Project Hub / Module Registry / lifecycle      blocked
R4 Electronics functional parity                  blocked
```

Coding-агент не выбирает следующий этап самостоятельно. Для начала нового этапа требуется отдельный owner-approved governance transition.

## Старые ветки и PR

Рабочая stacked-цепочка Electronics → Project Hub → Chess → Chess Online → Docker/Account вошла в историю `main` через PR №70.

Остальные старые PR и ветки не объединяются вслепую. До закрытия они классифицируются как:

- `contained` — полностью вошло в `main`;
- `superseded` — заменено более новой реализацией;
- `still valuable` — содержит уникальную полезную работу;
- `obsolete` — больше не требуется.

Ветки и локальные owner screenshots сохраняются до отдельного решения.

## Запуск

Канонические локальные порты:

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

Docker:

```bash
cp .env.docker.example .env
./tools/docker-up.sh dev
./tools/docker-healthcheck.sh dev
```

Backup базы хранится отдельно от Git. Один Git checkout не восстанавливает пользовательские данные.

## Источники истины

Перед изменениями coding-агент читает:

1. [`AGENTS.md`](AGENTS.md);
2. [`docs/project-map/infrastructure-focus.yaml`](docs/project-map/infrastructure-focus.yaml);
3. [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml);
4. [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml);
5. GitHub Issue активной задачи;
6. [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml).

Человеко-читаемые документы:

- [`START_HERE_FOR_AI.md`](START_HERE_FOR_AI.md);
- [`docs/delivery/DEVELOPMENT_PROGRAM_V1.md`](docs/delivery/DEVELOPMENT_PROGRAM_V1.md);
- [`docs/project-map/PROJECT_MAP.md`](docs/project-map/PROJECT_MAP.md);
- [`docs/project-map/QUALITY_MAP.md`](docs/project-map/QUALITY_MAP.md).
