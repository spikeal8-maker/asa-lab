---
task_id: TASK-ELECTRONICS-BROWSER-PARTITION-001
kind: maintenance
risk: low
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - Programme 452 / registry 703
  - PR 719 exact browser cancellation in run 40047454221
acceptance_boundary: slice
review: independent
---

# Electronics #722 — полный browser CI в изолированных Playwright shard

**Строго ограниченный CI-only repair** по существующей [Issue #722](https://github.com/spikeal8-maker/asa-lab/issues/722). Формально выбирается только через `docs/execution/current.yaml`.

Исходное доказательство: PR #719 `bc123c676eeb74ecee4b8351be43bdd339d1a1fb`; workflow #40047454221, job #120733174246: 261 тест из девяти spec-файлов; 25 красных отметок до отмены после 50 минут. На исходном BEFORE как минимум 23 из них совпали. Отдельный read-only `--list` подтвердил разбиение 144 + 117, объединение 261 без дублирования; повторить на финальном SHA.

## Единственный разрешённый CI-источник

`.github/workflows/electronics-r4-m1-focused.yml`; дополнительно только эта карточка и normal checkpoint в `docs/execution/current.yaml`. Никакие продуктовые файлы, физика, SVG, TypeScript, E2E, сети, серверы, БД, FRP, MinIO и рабочие backup не меняются.

## Условия приёмки

1. Два настоящих независимых browser matrix jobs `--shard=1/2` и `--shard=2/2` на default `strict-real-time`. Полный исходный тест-набор: без skip/grep/изменения assertions, исходный Playwright retry 0, лимит 50 минут **на каждый job**.
2. У каждого job отдельные Compose project / PostgreSQL / evidence artifacts. `strategy.fail-fast: false`; **любой красный shard делает общую проверку красной**. `review-images.needs: [focused, benchmark, browser]` не ослаблять.
3. `classroom-d13-v2` и `classroom-d13-v3` должны проходить ровно одним НЕ разделённым child и прежней командой. `arduino-editor-error` остается прежним.
4. Доказать на точном source `--list`, union, intersection, все девять spec, отрицательный `--shard=3/2`; проверить вложенную pnpm-передачу аргумента и Action/YAML expressions.
5. Выполнить scoped preflight, документационные/структурные проверки, форматирование, точный GitHub CI. Независимый рецензент анализирует **последний SHA**, оба дочерних job, intact browser gate, отрицательные случаи и неизменность чужого кода.

**Не выдавать CI-переразбиение за починку №13 или 25 посторонних отказов.** До полного обязательного CI и final independent integration/product APPROVE PR #719 остаётся без merge. P0 №19/№21: только безопасные синтетические проверки.
