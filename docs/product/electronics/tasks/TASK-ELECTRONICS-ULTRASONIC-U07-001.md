---
task_id: TASK-ELECTRONICS-ULTRASONIC-U07-001
kind: implementation
risk: high
semantic_change: yes
roadmap_slice: null
prerequisites:
  - TASK-ELECTRONICS-ULTRASONIC-U06-001
  - docs/product/electronics/contracts/ENGINEERING_HYGIENE_CONTRACT.md
acceptance_boundary: slice
review: independent
---

# U07 — добавить цель расстояния на сцене

## Один результат и вход

Для выбранного датчика доступно наглядное изменение distance на сцене:
полупрозрачный сектор, свободно перемещаемая двумерная круглая цель, две
пунктирные направляющие от излучателя/приёмника и подпись над корпусом.
Все действия используют уже принятый U06 input/commit path. Component ID:
`electronics.peripheral.ultrasonic`.

Root/web AGENTS → [START_HERE](../START_HERE.md) → ultrasonic entry → U06 →
[ТЗ §4.2](../contracts/ULTRASONIC_EXECUTION_SPEC.md#42-цель-на-сцене),
[§4.1](../contracts/ULTRASONIC_EXECUTION_SPEC.md#41-число-ползунок-и-состояния-проекта)
и [§5](../contracts/ULTRASONIC_EXECUTION_SPEC.md#5-матрица-обязательной-приёмки).
Acceptance: **UL-U03**, сохранение **UL-U02**. Проверить hygiene counter; когда
checkpoint наступил, этот production slice начинается только после отдельно
принятого checkpoint. Не объединять cleanup больших Stage/hook файлов с U07.

## Точные разрешённые пути

Production, максимум **5** в `apps/web/src/electronics/`:

- `WorkbenchStage.tsx`.
- `workbench-geometry.ts`.
- `use-electronics-workbench.ts`.
- `UltrasonicDistanceControls.tsx`.
- `workbench.css`.

Test writes в `apps/web/src/electronics/testing/`: `workbench-geometry.spec.ts`,
`workbench-selection.spec.ts`, `ultrasonic-distance-controls.spec.ts`;
browser — `e2e/electronics-interactions.spec.ts`,
`e2e/electronics-mobile-properties.spec.ts`.
Отдельный production helper/component разрешается только после уточнения
конкретного planned path до записи, с сохранением бюджета ≤10.
Owner SVG, pin geometry, physical dimensions, solver/Robotics и реальный
acoustic raycast не входят в этот срез.

## Геометрия и визуальная приёмка

Сектор исходит из излучающей стороны датчика. Круглая цель свободно
перемещается по двум координатам, включая боковое смещение. Две пунктирные
линии соединяют отдельные преобразователи с целью. Над корпусом видна подпись
в **cm/in**; метры остаются model units. 1 inch=2,54 см: ровно 100 см дают
39,4 in при одном десятичном знаке. Обе подписи вычисляются из исходного
неокруглённого значения; display rounding не меняет distance и не используется
как промежуточный вход преобразования в другую единицу.

До реализации назвать общие UI radii и sector-angle constants и закрепить
geometry test. `u=(d−dmin)/(dmax−dmin)` задаёт радиус между внутренней и внешней
дугами; угол задаёт боковое положение. Midpoint HC=201 см/PING=151 см даёт
u=0,5. При одинаковом радиусе разные допустимые углы дают одинаковое расстояние;
изменение числа/ползунка меняет радиус, сохраняя допустимый угол и прежний
`echoAvailable`. Если прежняя цель была за сектором, её UI-позиция возвращается
на допустимую ось без включения reflection. Pointer
coordinates проходят inverse scene transform; distance зависит от длины
радиус-вектора, а не от экранной вертикали. Новый input квантуется по U06 только
после range check. SVG/физические размеры и acoustic beam model не меняются.

За сектором либо его радиальными границами цель даёт отдельное приглушённое
состояние «вне зоны — нет отражения», без корректного численного показания.
В engine передаётся `echoAvailable=false`, сохраняется последнее valid distance.
Возвращение внутрь задаёт новый valid distance и true; уже latched Echo не
переписывается. Ручной false приглушает цель до явного изменения, valid drag
внутрь восстанавливает true. Ручной true возвращает цель на последний valid
радиус и допустимый угол, иначе на ось. За границами в engine не уходит
0/NaN/out-of-range distance. Pointercancel восстанавливает также reflection
и исходную UI-позицию.

Угол/позиция вне сектора — presentation state отдельного экземпляра, не новые
поля сохраняемого проекта. Они сохраняются при смене выделения в текущем
UI. Stop/reopen нормализуют цель на ось с сохранёнными distance/reflection.
Явно включить reflection могут только переключатель true или valid drag внутрь;
field/slider этого не делают. Escape/pointercancel восстанавливают три части
начала жеста: distance, reflection и UI-position; во время Run значение среды
возвращается новым input, physical time не откатывается.

Overlay сам по себе не доказывает питание или успешное измерение; no-power и
no-reflection различимы. При смене выбора исчезает чужая цель; манипуляция вторым
датчиком не меняет первый.

Возврат цели в сектор использует атомарный environment commit U06: новое
distance и true принадлежат одному timestamp. Browser/engine case с совпавшим
Trigger не должен видеть промежуточную пару между двумя независимыми setters.

## Взаимодействие

Pointer capture работает мышью и touch. Drag меняет distance, не переносит
датчик, не начинает wire и не прокручивает страницу. Escape/pointercancel
возвращает значение начала жеста через тот же U06 путь; в Run это новое
canonical input, а не отмена физического времени. В Stop — одна операция
commit/Undo после завершения успешного жеста.

Фокус виден, accessible value/units понятны, Home/End выбирают границы,
keyboard adjustment согласован с полем. Hit area не меньше 24 CSS px.
Проверить rotations 0/90/180/270°, поддерживаемый flip, zoom 0,5/1/2, pan,
desktop width 1440 и touch width 390; минимум один combined rotate+flip+pan+zoom
case. Clipping, overlap текста и hit target проверяются в реальном browser.

## Проверки и завершение

```bash
pnpm agent:preflight --scope electronics --check
pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-ULTRASONIC-U07-001
NX_SKIP_NX_CACHE=true pnpm exec vitest run apps/web/src/electronics/testing/workbench-geometry.spec.ts apps/web/src/electronics/testing/workbench-selection.spec.ts apps/web/src/electronics/testing/ultrasonic-distance-controls.spec.ts apps/web/src/electronics/testing/production-assets.spec.ts --maxWorkers=1
NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1
NX_SKIP_NX_CACHE=true pnpm exec playwright test e2e/electronics-interactions.spec.ts e2e/electronics-mobile-properties.spec.ts
git diff --check
```

Child lane использует свой preflight scope. Evidence связывает visual captures
с assertions фактического distance/pulse/commit counts, а не только картинкой.
При изменении runtime dispatch применять performance gate по ТЗ §8; не вводить
самодельный FPS budget. Новый independent review проверяет полный финальный
diff, owner art preservation и accessibility; self-review/required CI/отчёт —
ТЗ §8. Accepted slice увеличивает hygiene counter. Исполнитель STOP.
