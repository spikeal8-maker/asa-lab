# Стратегия тестирования ASA Lab

Тестирование является частью каждой executable Issue. Источник команд — [`test-catalog.yaml`](test-catalog.yaml); последовательность этапов — [`../delivery/DEVELOPMENT_PROGRAM_V1.md`](../delivery/DEVELOPMENT_PROGRAM_V1.md).

## 1. Источники истины

Каждый стабильный test ID содержит:

- ID;
- suite/level;
- command;
- `required_for`;
- timeout;
- owner;
- expected artifacts.

PR перечисляет фактический статус каждого обязательного test ID.

## 2. Статусы

```text
PASS       команда реально выполнена, exit code 0
FAIL       команда реально выполнена, exit code non-zero
BLOCKED    обязательная среда отсутствует
NOT_RUN    команда не запускалась
```

`BLOCKED` и `NOT_RUN` не закрывают exit gate.

## 3. Уровни

| Уровень | Назначение |
|---|---|
| Governance | Product/Development/Project/Quality maps и validators |
| Static | format, lint, types, build, Nx boundaries |
| Unit | framework-independent domain/application logic |
| Contract | OpenAPI, JSON Schema, events и Module SDK |
| Integration | PostgreSQL, repositories, migrations и use cases |
| Authorization | tenant/class/project/student denial matrix |
| E2E | основной user flow в реальном browser |
| Security | secrets, dependency advisories/licenses, credentials, ports |
| Accessibility | keyboard, focus, semantics, contrast, reduced motion |
| Simulation | electronics schema, netlist, golden and native/WASM parity |
| Load | school CCU and burst profiles after functional pilot |
| Recovery | backup/restore after persistent pilot data exists |

## 4. Пирамида

```text
               Load / Recovery
          Security / Accessibility
                 E2E
       Integration / Contract / Authz
                  Unit
       Static / Governance validators
```

Основной объём находится в unit/integration/contracts. E2E подтверждает один ключевой flow текущей Issue.

## 5. Общий gate product task

По применимости:

1. `TST-MAP-001`;
2. `TST-CAPABILITY-MAP-001`;
3. `TST-DEVELOPMENT-PROGRAM-001`;
4. format/lint/type/build;
5. Nx boundaries;
6. OpenAPI/JSON Schema;
7. unit;
8. migrations/integration;
9. tenant/authz/RLS;
10. secret/dependency/license;
11. port/startup safety;
12. accessibility;
13. automated browser E2E;
14. module/simulation-specific gates.

Точный набор определяется `required_for`.

## 6. Stage gates

### Product Documentation

```text
architecture
project map
capability map
release dependency ordering
development program
port policy
test catalog
links/YAML
```

### Teacher Portal

```text
login/session
classroom transaction
owner membership
AuditEvent
runtime DB role/RLS
idempotency
canonical ports
clean-session startup
accessibility
Playwright login→class→reload→logout
```

### Universal Project Shell

```text
Module Registry v0.1
ProjectDraft persistence
optimistic conflict
immutable checkpoint/digest
tenant/owner isolation
create→save→reload→checkpoint E2E
```

### Checkers Lite

```text
schema fixtures
move rules
diagnostics
save/reload
preview
no Core subject imports
browser E2E
```

### Electronics Alpha

```text
CircuitDocument schema
connectivity/netlist
diagnostics
native golden tests
WASM parity
save/reload
browser E2E
```

### StudentSeat

```text
seat lifecycle
Argon2id credential
one-time plaintext handling
CSV import/idempotency
rate limit/lockout
session revocation
child E2E
```

### Assignment/Submission

```text
immutable ActivityVersion
assignment audience/transitions
starter project idempotency
final sync
immutable ProjectVersion
SubmissionAttempt exact reference
teacher queue E2E
```

### Review/Grade/Badge

```text
version-safe comments
anchors/visibility
request changes/resubmit
attempt comparison
rubric/grade revision audit
badge evidence
full E2E
```

### Full Electronics Classroom

```text
electronics ActivityVersion
public deterministic checks
immutable circuit submission
anchored review
revision/grade/badge
complete browser E2E
```

## 7. Test data isolation

- Production data не копируются без обезличивания.
- Integration/E2E используют synthetic tenants.
- Для DB suites используется `TEST_DATABASE_URL`.
- Test runner отказывается работать на dev/production DB без explicit test marker.
- Suite выполняет cleanup или isolated database/schema.
- Минимум два tenant для отрицательной матрицы.
- Child credentials, session tokens и project content не попадают в snapshots/logs.
- Time/UUID/randomness контролируются, когда требуется determinism.

## 8. Browser E2E

- Использует same-origin server `127.0.0.1:4612`.
- Не использует `3000`, `3100`, `5173`.
- Не завершает чужие процессы.
- Сохраняет Playwright report и screenshot.
- Manual browser smoke не заменяет E2E.
- Flow проверяет видимый результат, а не только HTTP status.

## 9. Accessibility

Для критического UI пути:

- labels/names;
- keyboard navigation;
- visible focus;
- dialog initial focus;
- focus trap/restore;
- Escape;
- error announcements;
- contrast;
- reduced motion;
- responsive viewport.

Accessibility test включён в обязательный gate UI-задач.

## 10. Security

- dependency gate проверяет advisories и licenses, а не только inventory;
- secret scan не заменяет review credential flows;
- API не получает admin DB URL;
- runtime role and grants проверяются SQL tests;
- RLS threat model формулируется честно;
- tenant/client-provided IDs проверяются отрицательно;
- hidden tests не передаются в browser;
- occupied-port safety test подтверждает, что чужой процесс не завершается.

## 11. Simulation

Electronics tests делятся на:

- schema/fixture compatibility;
- connectivity/netlist;
- deterministic native golden;
- WASM parity;
- diagnostic anchors;
- editor E2E.

Unsupported topology должна вернуть diagnostic. Fake numerical success запрещён.

## 12. Добавление теста

Новый постоянный test:

1. получает стабильный ID;
2. добавляется в `test-catalog.yaml`;
3. связывается с task через `required_for`;
4. отображается в Quality Map;
5. имеет реальную command и artifacts;
6. существует до начала реализации, если это exit criterion.

После начала task нельзя удалять или сокращать обязательные test IDs ради зелёного gate.

## 13. Local-first verification

Пока GitHub-hosted jobs заблокированы внешним billing state, source of truth — локальный запуск:

```bash
python tools/run_task_tests.py --task <TASK-ID>
```

Отчёт привязывается к commit SHA и публикуется в PR.

Local-first не означает:

- skip tests;
- fake PASS;
- перенос падающего теста без изменения Issue/Maps;
- автоматический merge.

## 14. Evidence

Перед Ready for review product PR содержит:

```text
commit SHA
full task runner output
exact demo URLs
port report
Playwright report
screenshots
migration/contract/security reports
clean working tree
statement that next capability is absent
```

## 15. Текущая стадия

```text
TASK-PRODUCT-DOC-001 in_review
→ validators and task gate must PASS
→ merge PR 21
→ TASK-PORTAL-001 ready
```

PR №22 остаётся frozen до принятия Product/Development Program.