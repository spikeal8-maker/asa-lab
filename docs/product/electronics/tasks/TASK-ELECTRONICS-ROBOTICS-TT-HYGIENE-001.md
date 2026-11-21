---
task_id: TASK-ELECTRONICS-ROBOTICS-TT-HYGIENE-001
kind: maintenance
risk: high
semantic_change: 'no'
roadmap_slice: null
prerequisites:
  - docs/execution/current.yaml
  - docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md
  - docs/product/electronics/evidence/hygiene-baseline.yaml
  - docs/product/electronics/evidence/runtime-responsibility-20261026.md
  - docs/product/electronics/contracts/CANONICAL_CLOCK_CONTRACT.md
  - docs/product/electronics/tasks/TASK-ELECTRONICS-ROBOTICS-TT-NATIVE-DRIVE-001.md
acceptance_boundary: slice
review: independent
---

# Electronics TT — точечная ревизия размера планировщика и решателя

Проверить две текущие записи класса `decomposition-candidate` для `contexts/electronics/domain/arduino-circuit-scheduler.ts` и `contexts/electronics/domain/solver.ts` на принятом `main`. Применить разделы 6 и 8 Engineering Hygiene Contract и способ фиксации ответственности из #778. Числа должны следовать из рецензии фактического исходника и его Git blob. [Контракт](../contracts/ENGINEERING_HYGIENE_CONTRACT.md#6-large-source-and-decomposition-review), [свидетельство #778](../evidence/runtime-responsibility-20261026.md), [выбор #1177](https://github.com/spikeal8-maker/asa-lab/issues/1177)

## Измерение и граница обзора

- Определить текущий защищённый `main` и прочитать оба файла из этого дерева. Сохранить в свидетельстве идентичности, размеры Git blobs и основание для каждого класса. Сопоставить фактическое распределение ответственности с последними принятыми изменениями и предыдущим обоснованием baseline.
- Для планировщика проверить границу владения очередью и каноническим временем, расписание и подтверждение интервалов, порядок наблюдений, сохранение состояния при ошибке и связь с общим решателем. Для решателя проверить границу MNA, поддержку и диагностику топологии, штамп и принятие данных моделей, качество KCL и владение электрическими состояниями. Отдельно показать, как изменение TT из #1176 входит в эти границы, используя его diff в режиме чтения. Описать реальную связанность двух принятых исходников и мотивировать сохранение класса `decomposition-candidate` для каждого. Обнаруженный блокирующий дефект ответственности фиксируется как результат обзора.
- Привести отдельное сравнение предыдущих опорных размеров, защищённого `main` и отклонённого точного #1176. На его защищённом Code job `validate-electronics-agent-docs` остановил проверку роста двух источников. Идентичность прогона записана в [current.yaml](../../../execution/current.yaml). Значения нового baseline берутся из принятых blobs, поэтому размер ветки #1176 в них не записывается. [Прежний отказ Code](https://github.com/spikeal8-maker/asa-lab/actions/runs/43679712129/job/132707954501)
- После подтверждения ответственности обновить только `reviewed_bytes` и обоснования двух существующих записей. Сохранить оба класса, лимиты 50 000 байт и 20%, политику полной ревизии и все остальные записи. Сосредоточить измерения, идентичности, ссылки и независимый вердикт в новом неизменяемом свидетельстве. Исходники, валидатор, тесты, workflow и зависимости находятся вне этого среза.

## Пути и приёмка

- `docs/product/electronics/evidence/hygiene-baseline.yaml`
- `docs/product/electronics/evidence/robotics-tt-hygiene-1177.md`

После защищённого принятия выбора выполнить свежий точный preflight на два пути. Проверить, что измерения сделаны на принятых исходниках, и запустить `pnpm validate:electronics-agent-docs`. Сопоставить содержимое baseline с исходным YAML. Допустимы изменения только двух выбранных записей. Независимая рецензия проверяет исходные blobs, классы, измерения и итоговые документы на точном SHA. Для интеграции применимы обычные защищённые проверки.

Успешная ревизия даёт актуальную базу отсчёта для последующей проверки исходного среза #1172. Прежний отказ #1176 сохраняется как исторический результат. Контроллер проверяет последующую композицию и её CI по отдельному точному SHA. Продуктовое поведение, принятие D01/D02 и развёртывание находятся вне этого среза.
