---
task_id: TASK-ELECTRONICS-ULTRASONIC-U08-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U07-001
acceptance_boundary: milestone
review: independent
---

# U08 — принять оба датчика в собранном приложении

## Один результат и вход

Принять интегральный результат U00–U07 на одном кандидате и его принятой main
revision: электрические регрессии, text/blocks, Worker, UI, сохранение и profiles.
Component ID: `electronics.peripheral.ultrasonic`. Это milestone acceptance;
зелёные частные unit suites не закрывают её автоматически.

Root/scoped AGENTS → [START_HERE](../START_HERE.md) → ultrasonic entry → принятые
dependency receipts → [ТЗ §5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки),
[§8](../contracts/ULTRASONIC_EXECUTION_SPEC.md#8-gates-и-доказательства),
[§9](../contracts/ULTRASONIC_EXECUTION_SPEC.md#9-критерий-полного-завершения).
Acceptance: **UL-T01/UL-M03/UL-H01/UL-H02/UL-U02/UL-I01/UL-I02/UL-R01**,
повтор всей матрицы.
Контроллер проверяет актуальные dependencies и hygiene baseline. Новая
production repair требует отдельного явно executable scope; U08 её не поглощает.

## Точные разрешённые записи

Production runtime files: **0**. Test writes только:

- `contexts/electronics/testing/ultrasonic-block-runtime-adapter.spec.ts`.
- `contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts`.
- `apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts`.
- `apps/web/src/electronics/testing/simulation-worker.spec.ts`.
- `e2e/electronics-simulation.spec.ts`.
- `e2e/electronics-interactions.spec.ts`.

Evidence: `docs/product/electronics/evidence/ultrasonic-u08-integrated-acceptance.md`.
Generated path: `docs/product/electronics/generated/component-coverage.json`,
только выход штатного генератора, также включённый в planned scope. Сам генератор,
CI budgets, general workflows, solver и model identities не изменяются.

## Интегральная приёмка

Для **обоих** вариантов пройти обычный UI: новый проект → добавить Arduino и
датчик → подключить реальные pins → открыть собственную полную `?` справку →
вставить её text sketch → Run → увидеть pulse/Serial → менять поле/ползунок/цель
→ no-reflection → Pause/Resume/Stop → сохранить → закрыть и открыть снова.
Второй путь использует настоящие blocks и полученный из них source/adapter.
Нельзя создавать успешный runtime напрямую через скрытый test API вместо
проверки пользовательского запуска. Подготовка test data не подменяет этот путь.

Обязательны:

1. Все шесть первоначальных expected-correct regression checks стали PASS
   без skip/todo/expected-failure: missing GND×2, load 10 кОм×2,
   power loss ровно Tstart×2. Нормальные 1 м →5800 мкс и U04 range table сохранены.
2. Ошибки питания, no-echo deadline, две модели одновременно, setup/loop и
   accepted Trigger latching работают через реальную Worker boundary.
   Main/Worker дают одинаковые результаты, committed time и state/input digest
   для partition/budgets 1/7/1024 и JSON continuation поддерживаемого профиля.
3. При Run/drag не сбрасываются Arduino/Serial/clock; документ и server autosave
   не получают временное distance. После Stop/save/reopen совпадают IDs, wires,
   pins, source, initial distance/reflection. Старый известный профиль upgrade
   точный; неизвестный отклоняется явно. Safe variant и Undo из U05 сохранены.
4. Реальные длительные повторяемые Run и частые controls/два датчика не растят
   queue/retained memory без границы. Сценарий, simulated/wall duration, число
   событий и samples записаны; сравнение с baseline на том же environment,
   existing benchmark budgets. Новая произвольная норма FPS не заменяет их.
5. Browser cases из U07 проверяют scene transforms, pointercancel, keyboard и
   touch; owner assets неизменны. Help содержит пять разделов и оба исполняемых
   полных sketches/готовых безопасно открываемых примера, которые выполняются
   без ручной доработки. Coverage опирается на реальные engine/browser receipts;
   не поддерживаемое генератором поле остаётся честно ограниченным.

## Gates и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U08-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run contexts/electronics/testing/hc-sr04-runtime.spec.ts contexts/electronics/testing/ping-ultrasonic-runtime.spec.ts contexts/electronics/testing/ultrasonic-distance-timed-input.spec.ts contexts/electronics/testing/ultrasonic-block-runtime-adapter.spec.ts apps/web/src/electronics/testing/live-simulation-worker-controller.spec.ts apps/web/src/electronics/testing/simulation-worker.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1:browser
NX_SKIP_NX_CACHE=true pnpm exec playwright test e2e/electronics-mobile-properties.spec.ts --workers=1
NX_SKIP_NX_CACHE=true pnpm benchmark:electronics:ci
pnpm generate:electronics-component-coverage
git diff --check
```

Child lane использует свой preflight scope. Новый independent reviewer принимает
exact final candidate, весь acceptance matrix и combined shared-path changes,
включая принятый L298N, если он присутствует в actual main. Required repository
и General/Electronics CI должны относиться к этому SHA; после интеграции
проверяется CI принятого main, старые или cancelled runs не засчитываются.
Unrelated baseline failure классифицируется отдельно, без скрытого waiver.

Evidence содержит все поля ТЗ §8, численные результаты, commands/exit/counts,
CI URLs, ссылки на browser receipts и ограничения. Итог U08 — «код и
пользовательский путь приняты», не «развёрнуто». Исполнитель STOP; U09 требует
отдельного выбора deployment и exact target владельцем.
