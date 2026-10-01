---
task_id: TASK-ELECTRONICS-AUTOSAVE-CADENCE-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md#52-минутный-цикл-автосохранения-и-фоновая-синхронизация
acceptance_boundary: slice
review: independent
---

# Electronics autosave — минутный сетевой цикл

Program: [#452](https://github.com/spikeal8-maker/asa-lab/issues/452). Owner task: [#459](https://github.com/spikeal8-maker/asa-lab/issues/459).

## Один результат

Снизить частоту автоматических сетевых draft writes Electronics: dirty-документ автоматически отправляется раз в минуту, при этом постоянное редактирование не откладывает сохранение бесконечно.

## Component

`electronics.persistence.project` → `components/ui-assets-persistence.yaml`.

## Требуемая семантика

1. Первое несохранённое изменение открывает дедлайн +60 секунд.
2. Последующие изменения до дедлайна не сдвигают его.
3. На дедлайне сохраняется самый свежий document.
4. Новые изменения после этого получают новый минутный цикл.
5. Manual Save остаётся немедленным.
6. `pagehide`/уход со страницы сохраняет dirty-документ немедленно.
7. Очередь остаётся последовательной; старый запрос не имеет права перезаписать новый document.
8. Revision/CAS conflict, offline/error, local draft и merge semantics сохраняются.
9. Режим моделирования не возвращает прежние 700 ms autosave.
10. Не менять 3-секундный remote polling в этом срезе; его нагрузка исследуется отдельно в #460.

## Expected write paths

- `apps/web/src/electronics/use-workbench-project-state.ts`
- `apps/web/src/electronics/workbench-autosave.ts`
- `apps/web/src/electronics/testing/workbench-autosave.spec.ts`
- при доказанной необходимости один mapped persistence test

## Приёмка

- pure/fake-time tests доказывают 60-second deadline и отсутствие debounce starvation;
- manual save/pagehide остаются immediate;
- edit while save-in-flight получает следующий корректный цикл;
- failed save не запускает бесконтрольный loop и следующий edit сохраняется по существующему контракту;
- focused Electronics gate;
- independent review exact HEAD;
- required repository CI.

## Forbidden

- не менять API/DB schema;
- не ослаблять revision conflict protection;
- не менять Scratch/identity;
- не менять simulation physics;
- не менять production deployment;
- не трогать active #456/#457 worktree.

Карточка подготовлена, но не активирует себя сама. Контроллер выбирает её после текущего пересекающегося/блокирующего Electronics среза и fresh preflight.
