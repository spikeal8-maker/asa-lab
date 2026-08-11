# ASA Lab

Модульная образовательная платформа для аккаунтов, рабочих пространств, проектов, виртуальных лабораторий и будущего учебного цикла.

## Текущее состояние

```text
canonical branch:        main
active task:             TASK-CHECKERS-M1-001
active issue:            #98
active branch:           agent/checkers-education-m1
active Draft PR:         #101
status:                  in_progress
checkpoint:              project_document_foundation
execution lease:         codex-checkers-m1
```

Активирована самостоятельная образовательная система русских шашек. Задачи 3D
M0 и Electronics corrective приостановлены решением владельца без заявления о
завершении. Точное состояние хранится в `docs/execution/current.yaml`.

## Что уже работает

- public entry, регистрация и login по email/username;
- Account, Profile, Principal, Personal Workspace и sessions_v2;
- educator self-attestation, capability и AuditEvent;
- workspace list и ActiveContext;
- Account profile и session management;
- Teacher Portal baseline;
- Project Hub;
- Electronics, Chess и Chess Online;
- PostgreSQL, RLS, additive migrations;
- Docker, persistence и backup/restore.

## Что строится сейчас

```text
Student opens Checkers
→ current learning and teacher assignments
→ Russian-draughts lessons, puzzles and bot ladder
→ evidence-based review and progress
→ safe class play with predefined reactions only
→ teacher activity, mastery and move-level evidence
```

Точный scope находится в Issue №98 и
`docs/product/CHECKERS_EDUCATION_MARKET_ANALYSIS.md`. Шахматы остаются отдельным
модулем; изменять их в рамках этой задачи запрещено.

## Ветка разработки

```bash
git fetch --all --prune
git switch agent/checkers-education-m1
git pull --ff-only origin agent/checkers-education-m1
```

Новая параллельная product branch не создаётся. PR №99 остаётся Draft до
прохождения focused/general gates и owner review.

## Порты

```text
Web  http://127.0.0.1:4610
API  http://127.0.0.1:4611
E2E  http://127.0.0.1:4612
```

## Запуск

```bash
cp .env.docker.example .env
./tools/docker-up.sh dev
./tools/docker-healthcheck.sh dev
```

Backup хранится отдельно от Git.

## Источники истины

1. [`AGENTS.md`](AGENTS.md)
2. [`docs/project-map/infrastructure-focus.yaml`](docs/project-map/infrastructure-focus.yaml)
3. [`docs/project-map/project-map.yaml`](docs/project-map/project-map.yaml)
4. [`docs/delivery/EXECUTION_MANIFEST.yaml`](docs/delivery/EXECUTION_MANIFEST.yaml)
5. Issue №62
6. [`docs/testing/test-catalog.yaml`](docs/testing/test-catalog.yaml)
7. [`docs/testing/active-task-tests.yaml`](docs/testing/active-task-tests.yaml)
