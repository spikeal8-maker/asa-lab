# <TASK_ID> — Execution Spec

**Task:** `<TASK_ID>`  
**Milestone:** `<M0/M1/...>`  
**Status:** DRAFT  
**Baseline SHA:** `<sha>`  
**Master Spec:** `docs/product/ASA_LEARNING_TECHNICAL_SPEC.md`  
**Work Queue:** `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`

---

## 1. Goal

Одно точное предложение: что эта task должна сделать.

## 2. Non-goals

Что эта task сознательно НЕ делает.

## 3. Requirement IDs

```text
REQ-...
REQ-...
```

## 4. CURRENT evidence

Для каждого существующего поведения:

```text
file/path
migration
API
test
observed behavior
```

Не делать утверждений без evidence.

## 5. Existing contracts to reuse

Какие существующие:

```text
entities
contexts
tables
controllers
services
schemas
tests
```

будут переиспользованы.

## 6. Exact files to change

```text
path/to/file
...
```

## 7. Files explicitly out of scope

```text
path/pattern
...
```

## 8. Database / migration

Если не требуется:

```text
N/A — reason
```

Иначе:

- migration filename;
- exact DDL;
- FK;
- CHECK;
- unique/partial indexes;
- RLS;
- backfill;
- transaction;
- rollback.

## 9. API / OpenAPI

Если не требуется:

```text
N/A — reason
```

Иначе:

- method/path;
- request schema;
- response schema;
- errors;
- authorization;
- pagination;
- idempotency;
- optimistic concurrency.

`schemas/openapi.yaml` обновляется в том же change set.

## 10. Transaction boundaries

Какие операции должны быть атомарными.

## 11. Idempotency / concurrency

Точные правила retry/conflict.

## 12. Authorization / RLS

Positive grants + negative cases.

## 13. Migration / compatibility

Legacy/new coexistence, read/write cutover.

## 14. Feature flag / rollout

Если не требуется:

```text
N/A — reason
```

## 15. Rollback

Как безопасно откатить до cutover.

## 16. Unit tests

```text
TEST-ID
scenario
expected
```

## 17. Integration tests

```text
TEST-ID
scenario
expected
```

## 18. Browser E2E

Если UI затронут — exact user journey.

## 19. Security negative tests

Прямые UUID / cross-class / cross-school / role/capability cases.

## 20. Performance considerations

Что измеряется или почему N/A.

## 21. Acceptance checklist

- [ ] requirement 1
- [ ] requirement 2
- [ ] migrations
- [ ] OpenAPI
- [ ] unit
- [ ] integration
- [ ] browser
- [ ] security
- [ ] repository gates
- [ ] ledger updated

## 22. Evidence

После реализации заполнить:

```text
final SHA
commands
test outputs
browser artifacts
migration evidence
known gaps
```

