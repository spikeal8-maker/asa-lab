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

В [прогоне 43060901122](https://github.com/spikeal8-maker/asa-lab/actions/runs/43060901122) обе части завершились. Журналы зафиксировали 242 успешных сценария, 23 падения и 5 таймаутов из 270. Таймауты E11 и ошибки тайминга Arduino наблюдались при одновременной работе двух Playwright worker на одном runner. Четыре задания с одним worker в каждом изолируют длинные циклы от набора ready-cadence.

## Разрешённые пути

Изменение ограничено `.github/workflows/electronics-r4-m1-focused.yml`, его проверками в `tools/test_ci_image_transport.py` и `tests/electronics/ui-679-557-qualification.spec.ts`, этой карточкой и записью `current_partition_selection` задачи в `docs/execution/current.yaml`.

## Условия приёмки

1. Четыре независимых задания в профиле `strict-real-time` получают `--workers=1` и `--shard=1/4`, `2/4`, `3/4` или `4/4`. Сохраняются все 270 сценариев, их проверки и пороги, исходный Playwright retry 0 и лимит 50 минут **на каждое задание**.
2. У каждого job отдельные Compose project / PostgreSQL / evidence artifacts. `strategy.fail-fast: false`; **любой красный shard делает общую проверку красной**. `review-images.needs: [focused, benchmark, browser]` не ослаблять.
3. `classroom-d13-v2` и `classroom-d13-v3` должны проходить ровно одним НЕ разделённым child и прежней командой. `arduino-editor-error` остается прежним.
4. Подтвердить командой `--list` на точном коммите разбиение 123 + 13 + 119 + 15, все девять spec-файлов, отсутствие пропусков и дублей. Проверить отклонение `--shard=5/4`, передачу аргументов через pnpm и выражения GitHub Actions.
5. Выполнить scoped preflight, документационные/структурные проверки, форматирование, точный GitHub CI. Независимый рецензент анализирует **последний SHA**, все четыре задания и исходные проверки browser gate, отрицательные случаи и неизменность чужого кода.

**Не выдавать CI-переразбиение за починку №13 или 25 посторонних отказов.** До полного обязательного CI и final independent integration/product APPROVE PR #719 остаётся без merge. P0 №19/№21: только безопасные синтетические проверки.
