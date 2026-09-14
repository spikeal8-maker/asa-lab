# PROJ-R7-04C — Blocks / Visual Programming Public Viewer

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-03`; текущий Visual Programming/Blocks runtime должен иметь стабильную read-only/run boundary.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

## 0. Activation gate

Старт только если этот exact slice выбран в `docs/execution/current.yaml`, Public Artifact foundation принят, а текущие Blocks/Scratch contracts сверены с актуальным `main`.

---

## 1. Пользовательский результат

Публичная страница visual-programming проекта позволяет:

- увидеть опубликованную программу/блоки в read-only режиме;
- запустить опубликованный результат, если runtime безопасно это поддерживает;
- остановить/перезапустить выполнение;
- перейти в fullscreen, если поддерживается;
- увидеть понятный static fallback, если runtime недоступен.

Публичный viewer не является редактором и не меняет source Project.

---

## 2. Scope

Входит:

- Blocks Public Artifact adapter/sanitizer;
- read-only representation блоков/сцены;
- bounded run/stop/reset runtime;
- capability projection;
- sandbox/resource limits;
- lazy loading;
- mobile/touch controls;
- cleanup timers/workers/listeners;
- loading/error/fallback states;
- focused security/performance tests.

Не входит:

- редактирование блоков;
- toolbox/palette authoring;
- сохранение изменений в source;
- импорт внешнего Scratch-проекта без отдельного контракта;
- redesign Scratch/Blocks editor;
- второй interpreter/runtime внутри Public Projects.

---

## 3. Архитектурный инвариант

```text
PublicationRevision
→ Blocks Public Artifact
→ canonical Visual Programming runtime boundary
→ read-only/run-only public viewer
```

Public Projects не копирует interpreter, event semantics, sprite/runtime logic или block legality.

Если canonical runtime ещё не имеет безопасной public-run boundary, slice останавливается либо работает только как read-only/static viewer до отдельного принятого решения.

---

## 4. Security / runtime limits

Обязательно:

- exact immutable artifact source;
- no Project write capability;
- no account/session secrets inside artifact;
- no arbitrary network/file access из пользовательского проекта без утверждённого sandbox contract;
- bounded execution/time/event limits;
- cleanup on unmount/navigation;
- unsupported extension/block fails clearly;
- no fake emulation unsupported features.

---

## 5. Required tests

- eligible Blocks artifact renders;
- private/revoked content denied before runtime load;
- run/stop/reset work for supported program;
- unsupported block/extension produces controlled state;
- source Project remains unchanged;
- no authoring controls exposed;
- timers/workers/listeners released on unmount;
- static preview fallback works;
- mobile controls work without hover;
- unrelated routes do not eagerly load Blocks public runtime;
- existing Visual Programming editor regressions remain green.

---

## 6. Acceptance Criteria

- **R7-04C-AC01** viewer consumes only R7-03 sanitized artifact.
- **R7-04C-AC02** block/program representation is read-only.
- **R7-04C-AC03** runnable mode uses canonical runtime boundary.
- **R7-04C-AC04** no second interpreter/runtime is created.
- **R7-04C-AC05** runtime limits and cleanup are proven.
- **R7-04C-AC06** unsupported behavior is not fabricated.
- **R7-04C-AC07** lazy loading/mobile/accessibility/fallback pass.

---

## 7. Hygiene

High-risk runtime slice: L2 threshold = 2 accepted high-risk slices.

Evidence records:

- route/chunk delta;
- new dependencies;
- largest changed files;
- duplicated interpreter/runtime logic check;
- worker/timer cleanup;
- hygiene counter.

`BLOCK` if Public Projects starts owning a separate Blocks/Scratch runtime.

---

## 8. STOP conditions

STOP if safe runtime boundary is not available, implementation needs write access, requires broad Visual Programming rewrite, or would duplicate interpreter semantics.