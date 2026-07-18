# Стратегия тестирования ASA Lab

Тестирование является частью архитектуры и каждой рабочей задачи. Тесты не добавляются отдельным завершающим этапом после реализации продукта.

## 1. Источник истины

Машиночитаемый реестр находится в `docs/testing/test-catalog.yaml`.

Каждый тест имеет:

- стабильный `id`;
- уровень и тип;
- команду запуска;
- минимальную фазу доступности;
- обязательность;
- область применения;
- ожидаемые артефакты;
- timeout;
- владельца.

PR обязан перечислить test IDs и фактический результат каждого запущенного теста.

## 2. Уровни тестирования

| Уровень | Назначение |
|---|---|
| Static | format, lint, typecheck, dependency boundaries, schema validation |
| Unit | чистая доменная логика, value objects, policies, математические функции |
| Contract | OpenAPI, JSON Schema, events, Module SDK, job contracts |
| Integration | PostgreSQL, Redis, object storage, migrations, repositories, outbox |
| Authorization | role/tenant/class/resource policy matrix и отрицательные сценарии |
| E2E | полный пользовательский вертикальный сценарий через UI/API/DB |
| Security | secrets, dependencies, sandbox, rate limits и cross-tenant isolation |
| Migration | upgrade, downgrade/forward-fix, старые ProjectVersion и schema migrators |
| Load | CCU, burst RPS, autosave, login storm, submission storm и worker backlog |
| Recovery | backup restore, PITR, queue recovery и object-storage integrity |
| Golden | детерминированные эталонные схемы, физика и математические результаты |
| Accessibility | keyboard, focus, semantics, contrast и screen-reader paths |

## 3. Правило пирамиды

Основной объём проверок должен выполняться быстро на уровне unit, contract и integration. E2E покрывает ключевые пользовательские потоки, а не каждую комбинацию полей.

```text
              Recovery / Load / Security
                     E2E
             Integration / Contract
                    Unit
             Static architecture gates
```

## 4. Обязательный минимум каждого feature PR

Если применимо, PR обязан включать:

1. unit tests доменного правила;
2. contract tests изменённого API/schema/event;
3. integration test записи и чтения;
4. положительный authorization test;
5. отрицательный cross-tenant или cross-class test;
6. audit/telemetry assertion;
7. E2E основного пользовательского сценария;
8. migration/compatibility test;
9. обновление карты и каталога тестов.

Неприменимость должна быть объяснена в PR, а не отмечена автоматически.

## 5. Наборы проверок

### Fast gate

Запускается перед каждым локальным коммитом:

```text
architecture validators
project-map validator
test-catalog validator
format
lint
typecheck
affected unit tests
```

### PR gate

Запускается для каждого Pull Request:

```text
Fast gate
dependency boundaries
contract tests
integration tests
authorization negative tests
build
migration validation
```

### Merge gate

```text
PR gate
critical E2E
security scans
container build
artifact manifest
```

### Nightly gate

```text
full E2E
load smoke
long-running golden tests
dependency/license audit
backup/restore smoke where available
```

### Release gate

```text
full regression
load profile текущего capacity tier
recovery drill
security review
accessibility review
migration from previous production version
rollback or forward-fix rehearsal
```

## 6. Тестовые данные

- Production data не копируются в тестовые среды без обезличивания.
- Fixture содержит synthetic tenants, schools, teachers и StudentSeats.
- У каждого integration/E2E suite есть минимум два tenant для отрицательных проверок.
- Открытые StudentSeat codes, токены и реальные персональные данные не сохраняются в snapshots и artifacts.
- Время, UUID и случайность контролируются там, где требуется детерминизм.

## 7. Результаты тестов

Результат должен быть машинно и человеку читаемым:

```text
TST-AUTHZ-002 PASS duration=4.2s
TST-E2E-CLS-001 FAIL assertion="class not visible" artifact=...
TST-LOAD-L1-001 NOT_RUN reason="Phase 9 not reached"
```

`NOT_RUN` не считается `PASS`.

## 8. Добавление нового теста

Новый постоянный тест получает стабильный ID в `test-catalog.yaml`. Если тест относится к архитектурному узлу или задаче, в project map добавляется связь `verified_by` либо соответствующий quality-gate узел.

Удаление теста требует причины. Критический security/authz/compatibility test нельзя удалить только потому, что он падает.

## 9. Текущая стадия

До Bootstrap доступны только проверки документации и governance:

- `TST-ARCH-001`;
- `TST-MAP-001`;
- `TST-CATALOG-001`;
- `TST-YAML-001`;
- `TST-LINKS-001`.

Команды pnpm, Nx, Docker Compose и application tests становятся активными после выполнения Issue №2.
