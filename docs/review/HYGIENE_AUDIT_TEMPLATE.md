# ASA Lab — Hygiene Audit Report Template

Используется для L2/L3 аудитов по политике [`REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md`](../delivery/REPOSITORY_HYGIENE_AND_OPTIMIZATION_POLICY.md).

Отчёт должен быть коротким, воспроизводимым и содержать измеримые результаты. Формулировка «проверено, всё нормально» без evidence не принимается.

---

## 1. Паспорт аудита

- **Дата:**
- **Модуль / lane:**
- **Уровень:** L2 / L3
- **Baseline SHA:**
- **Target SHA:**
- **Аудитор:**
- **Связанный milestone / Issue:**
- **Scope paths:**
- **Не входящие в scope пути:**

---

## 2. Итог

**Verdict:** `PASS / WARNING / BLOCK`

Короткое заключение:

> ...

### Blocking findings

- нет / список ID.

### Deferred warnings

- нет / список ID.

---

## 3. Repository delta

- tracked files before:
- tracked files after:
- repository working-tree size before:
- repository working-tree size after:
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

Для каждого файла >500 строк ответить:

- почему файл большой;
- смешаны ли обязанности;
- нужна ли декомпозиция;
- если не нужна — почему.

Для >800 строк требуется явное решение. Для >1000 строк handwritten runtime-кода без исключения verdict не может быть PASS.

---

## 5. Generated artifacts

Проверено наличие:

- `playwright-report/`;
- `test-results/`;
- `coverage/`;
- traces/videos/screenshots;
- `*.log`, `*.tmp`, `*.bak`, `*.old`;
- `dist/`, `build/`, cache;
- dumps;
- profiling/debug output.

### Findings

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

Зафиксировать отдельно. Не удалять и не перекодировать автоматически.

---

## 7. Bundle / lazy loading

- baseline route/chunk:
- target route/chunk:
- delta %:
- unrelated route impact:
- new heavy dependencies:
- lazy-load preserved: YES / NO / N/A

Если автоматического reporter ещё нет — указать используемый ручной источник метрик.

---

## 8. Dependencies

| Dependency | Added/removed | Runtime/dev | Browser impact | Existing alternative | Decision |
|---|---|---|---|---|---|
| | | | | | |

Unused dependencies found:

- ...

---

## 9. Duplicate / transitional implementations

Проверить паттерны:

- `New`;
- `V2`;
- `Fixed`;
- `Final`;
- `Copy`;
- `Old`;
- параллельные service/engine/controller реализации.

| Old path | New path | Which is source of truth | Delete condition | Verdict |
|---|---|---|---|---|
| | | | | |

---

## 10. Dead code / debug leftovers

- unused imports:
- unreachable branches:
- expired feature flags:
- debug controls:
- console/debug logging:
- unused assets:

---

## 11. Architecture boundaries

Проверить, что новый код не перенёс ответственность между доменами без решения.

Для игр отдельно проверить:

```text
UI
→ Game Controller / Application layer
→ Game Engine
→ Rules Engine

AI/Bot → Engine
Multiplayer → Application/Session layer
Persistence → versioned Game State
```

Findings:

- ...

---

## 12. Git history / large objects — L3

- largest objects checked: YES / NO
- accidental media/dump in history:
- duplicate binary history:
- clone-size concern:
- history rewrite required: YES / NO

Если rewrite нужен, он не выполняется в рамках обычного аудита: требуется отдельное owner-approved решение.

---

## 13. Findings ledger

| ID | Severity | Path / subsystem | Finding | Required action | Owner | Deadline / gate |
|---|---|---|---|---|---|---|
| HYG-001 | | | | | | |

Severity:

- `WARNING` — может быть вынесено в отдельный debt;
- `BLOCK` — следующий крупный milestone/release запрещён.

---

## 14. Cleanup выполнен

Перечислить только реально выполненные действия:

- ...

После cleanup обязательно повторить затронутые focused/regression tests.

---

## 15. Deferred debt

| ID | Why not fixed now | Risk | Separate task required | Owner decision |
|---|---|---|---:|---|
| | | | | |

Найденный дефект соседнего модуля не расширяет автоматически scope текущей задачи.

---

## 16. Acceptance statement

Заполнить одну формулировку:

### PASS

> Hygiene audit завершён. BLOCK findings отсутствуют. Cleanup текущего scope выполнен, regression evidence получен.

### WARNING

> Hygiene audit завершён. BLOCK findings отсутствуют. Перечисленные WARNING зарегистрированы как ограниченный technical debt и не блокируют следующий milestone.

### BLOCK

> Hygiene audit обнаружил BLOCK findings. Следующий крупный milestone/release запрещён до их устранения или отдельного owner-approved архитектурного решения.
