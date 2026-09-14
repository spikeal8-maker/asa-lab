# ASA Lab — Hygiene Audit Report Template

Используется для L2/L3 аудитов по политике [`REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`](../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md).

Формулировка «проверено, всё нормально» без измеримого evidence не принимается.

---

## 1. Паспорт аудита

- **Модуль / lane:**
- **Уровень:** L2 / L3
- **Baseline SHA:**
- **Target SHA:**
- **Аудитор:**
- **Связанный milestone / Issue:**
- **Scope paths:**
- **Не входящие в scope пути:**

### Iteration window

- **Last L2 target SHA:**
- **L2 threshold:** 2 / 3
- **Accepted slices since last L2:**
- **Included slice/task IDs:**
  - ...
- **Почему audit запускается сейчас:** counter reached / milestone boundary / event trigger / release

Календарная дата может быть записана для трассировки, но **не является триггером аудита**.

---

## 2. Итог

**Verdict:** `PASS / WARNING / BLOCK`

Короткое заключение:

> ...

### Blocking findings

- нет / список ID.

### Deferred warnings

- нет / список ID.

### Counter after audit

- `PASS` / accepted `WARNING` → reset to `0`;
- `BLOCK` → next slice forbidden until resolved/owner decision.

---

## 3. Repository delta

- tracked files before:
- tracked files after:
- working-tree size before:
- working-tree size after:
- diff added size:
- diff removed size:
- new binaries:

### Крупнейшие новые/изменённые файлы

| Path | Before | After | Delta | Type | Verdict |
|---|---:|---:|---:|---|---|
| | | | | | |

---

## 4. Large source files

| Path | LOC / size | Responsibilities | Threshold | Action |
|---|---:|---|---|---|
| | | | | |

Для >500 LOC указать responsibilities и decomposition review.  
Для >800 LOC требуется explicit decision.  
Для >1000 LOC handwritten runtime-кода без exception verdict не может быть `PASS`.

---

## 5. Generated artifacts

Проверено наличие:

- `playwright-report/`;
- `test-results/`;
- `coverage/`;
- traces/videos/screenshots;
- `*.log`, `*.tmp`, `*.bak`, `*.old`;
- `dist/`, `build/`, caches;
- dumps;
- profiling/debug output.

| Path | Why generated | Tracked? | Canonical evidence? | Action |
|---|---|---:|---:|---|
| | | | | |

---

## 6. Assets

### Images

- oversized originals:
- duplicates:
- missing responsive variants:
- inappropriate format:

### Audio / video

- files and sizes:
- loaded eagerly?:
- object-storage/CDN candidate?:

### 3D

- model size:
- texture size:
- duplicate textures/materials:
- compression/LOD findings:

### Protected owner assets

Зафиксировать отдельно; не удалять/перекодировать автоматически.

---

## 7. Bundle / lazy loading

- baseline route/chunk:
- target route/chunk:
- delta %:
- unrelated route impact:
- shared chunk impact:
- new heavy dependencies:
- lazy-load preserved: YES / NO / N/A

Если автоматического reporter нет — указать источник ручных метрик.

---

## 8. Dependencies

| Dependency | Added/removed | Runtime/dev | Browser impact | Existing alternative | Decision |
|---|---|---|---|---|---|
| | | | | | |

Unused dependencies:

- ...

---

## 9. Duplicate / transitional implementations

Проверить `New`, `V2`, `Fixed`, `Final`, `Copy`, `Old`, параллельные service/engine/controller реализации.

| Old path | New path | Source of truth | Delete condition | Required-before slice | Verdict |
|---|---|---|---|---|---|
| | | | | | |

---

## 10. Dead code / debug leftovers

- unused imports/exports:
- unreachable branches:
- expired feature flags:
- debug controls/logging:
- unused assets:
- obsolete fixtures:

---

## 11. Architecture boundaries

Проверить, что новый код не перенёс responsibility между доменами без решения.

Для игр:

```text
UI
→ Game Controller / Application
→ Game Engine
→ Rules Engine

AI/Bot → Engine
Multiplayer → Application/Session
Persistence → versioned Game State
```

Для Public Projects отдельно проверить:

```text
Working Project / ProjectVersion
→ Publication
→ Public artifact/read-only projection
→ Public UI
```

Public UI не должен становиться вторым Project Core или получать mutable private document.

Findings:

- ...

---

## 12. Git history / large objects — L3

- largest objects checked: YES / NO
- accidental media/dump in history:
- duplicate binary history:
- clone-size concern:
- history rewrite required: YES / NO

History rewrite не выполняется обычным audit и требует owner-approved решения.

---

## 13. Findings ledger

| ID | Severity | Path / subsystem | Finding | Required action | Owner | Required before slice/gate |
|---|---|---|---|---|---|---|
| HYG-001 | | | | | | |

Severity:

- `WARNING` — bounded debt, следующий gate указан;
- `BLOCK` — следующая итерация/release запрещена.

Календарный deadline не заменяет development gate.

---

## 14. Cleanup выполнен

Перечислить только реально выполненные действия:

- ...

После cleanup повторить затронутые focused/regression tests.

---

## 15. Deferred debt

| ID | Why not fixed now | Risk | Separate task required | Required before slice/gate | Owner decision |
|---|---|---|---:|---|---|
| | | | | | |

Найденный дефект соседнего модуля не расширяет автоматически scope текущей задачи.

---

## 16. Regression evidence

- focused test command/result:
- browser/E2E command/result:
- repository/general gate:
- exact final SHA:
- CI run / artifact reference:

---

## 17. Acceptance statement

### PASS

> Hygiene audit завершён. BLOCK findings отсутствуют. Cleanup текущего audit window выполнен, regression evidence получен. Hygiene counter сброшен в 0.

### WARNING

> Hygiene audit завершён. BLOCK findings отсутствуют. WARNING зарегистрированы с конкретным required-before gate. Hygiene counter сброшен в 0 после принятого решения.

### BLOCK

> Hygiene audit обнаружил BLOCK findings. Следующая bounded iteration/release запрещена до их устранения либо отдельного owner-approved решения.