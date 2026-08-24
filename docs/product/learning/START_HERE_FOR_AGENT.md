# ASA Lab Learning — START HERE FOR CODING AGENT

**Пакет:** ASA Learning Agent Package v1  
**Репозиторий:** `spikeal8-maker/asa-lab`

Этот файл — первая точка входа для coding-agent.

---

# 1. Что находится в пакете

```text
docs/product/learning/START_HERE_FOR_AGENT.md
docs/product/ASA_LEARNING_TECHNICAL_SPEC.md
docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
docs/product/learning/TASK_EXECUTION_SPEC_TEMPLATE.md
docs/product/learning/MILESTONE_ACCEPTANCE_TEMPLATE.md
```

Назначение:

- `01_*` — какой должна стать система;
- `02_*` — machine-readable critical requirements;
- `03_*` — какую атомарную задачу брать и в каком порядке;
- `04_*` — обязательная форма execution-spec перед кодированием;
- `05_*` — форма итоговой приёмки milestone.

---

# 2. Сначала прочитать репозиторий

Перед любыми изменениями ОБЯЗАТЕЛЬНО прочитать из самого репозитория:

```text
AGENTS.md
START_HERE_FOR_AI.md
docs/execution/current.yaml
schemas/openapi.yaml
relevant docs/project-map/**
relevant migrations/**
relevant tests/**
```

`docs/execution/current.yaml` является источником истины о том, какая работа разрешена прямо сейчас.

Пакет НЕ заменяет governance репозитория.

---

# 3. Приоритет источников

При конфликте использовать:

```text
1. docs/execution/current.yaml
2. AGENTS.md / START_HERE_FOR_AI.md / repository governance
3. docs/product/ASA_LEARNING_TECHNICAL_SPEC.md
4. owner-approved milestone execution spec
5. docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md
6. docs/product/ASA_LEARNING_REQUIREMENTS_LEDGER.yaml
7. current code/migrations/OpenAPI as evidence of CURRENT
```

Master Technical Spec определяет TARGET.

Код и миграции определяют CURRENT.

Нельзя выдавать TARGET за уже реализованную функцию.

---

# 4. Главная команда

НЕ реализовывать ASA Learning целиком.

Работать так:

```text
одна атомарная task
→ audit CURRENT
→ TASK EXECUTION SPEC
→ implementation
→ migration/OpenAPI where required
→ tests
→ browser/security evidence
→ ledger update
→ DONE
→ next task of SAME milestone
```

На границе milestone STOP до owner acceptance.

---

# 5. Первая работа

Первая задача после owner activation Learning:

```text
LRN-M0-001 — Current Learning Architecture Audit
```

Из `docs/product/learning/ASA_LEARNING_AGENT_WORK_QUEUE.md`.

До начала кода необходимо:

1. проверить `docs/execution/current.yaml`;
2. если Learning milestone НЕ активирован — продуктовый код не менять;
3. подготовить M0 audit/execution material;
4. сообщить owner, что требуется activation;
5. STOP.

Если owner уже активировал M0:

1. выполнить `LRN-M0-001`;
2. создать execution-spec по `docs/product/learning/TASK_EXECUTION_SPEC_TEMPLATE.md`;
3. не переходить к M1;
4. не создавать новую learner identity table до `ADR-LEARNER-IDENTITY-001`;
5. не делать Gradebook redesign;
6. не начинать новый Quiz Engine до завершения M0 convergence.

---

# 6. Критический запрет

Нельзя создавать отдельные runtime-системы для:

```text
quiz
project
course assignment
manual assignment
```

Все они должны сходиться в:

```text
LearningActivityVersion
→ ActivityRun
→ ActivityParticipation
→ Attempt
→ Submission
→ AssessmentResultRevision
→ ResultSelection
→ projections
```

---

# 7. Что считается доказательством

Функция НЕ считается готовой по:

```text
mock
screenshot
component
API endpoint alone
migration alone
unit test alone
```

Нужна совокупность, соответствующая task:

```text
implementation
+ schema/OpenAPI
+ migrations
+ tests
+ negative authorization
+ browser evidence
+ accepted SHA
```

---

# 8. Финальный отчёт каждой task

В ответе owner всегда указать:

```text
TASK:
STATUS:
BASELINE SHA:
FINAL SHA:

REQUIREMENTS CLOSED:
FILES CHANGED:
MIGRATIONS:
OPENAPI:
TESTS:
BROWSER EVIDENCE:
SECURITY EVIDENCE:
KNOWN GAPS:
NEXT READY TASK:
```

Если acceptance не доказан:

```text
STATUS != DONE
```

---

# 9. Нельзя редактировать будущее ТЗ молча

Если во время coding обнаружена проблема Master Spec:

```text
STOP architecture invention
→ document conflict
→ propose ADR/spec correction
→ request owner decision
```

Coding-agent не может молча менять будущую архитектуру под удобство текущей реализации.

