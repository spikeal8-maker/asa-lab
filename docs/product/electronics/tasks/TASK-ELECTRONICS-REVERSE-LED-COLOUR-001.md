---
task_id: TASK-ELECTRONICS-REVERSE-LED-COLOUR-001
kind: repair
risk: low
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner programme 452 / 23 observations registry 703, row 13 (L01)
  - Independent P0 triage #703; no confirmed data-loss priority preemption
acceptance_boundary: slice
review: independent
---

# №13 / L01 — не превращать LED в серый при обратной полярности

**Программа:** #452. **Единый реестр:** #703. **Стабильное ТЗ:** `docs/product/electronics/OWNER_23_EXECUTION_QUEUE.md`. Карточка: `docs/product/electronics/tasks/TASK-ELECTRONICS-REVERSE-LED-COLOUR-001.md`. Выбранность определяет только актуальный `docs/execution/current.yaml`.

**Статус на момент постановки:** `UNCONFIRMED_IN_NATIVE_BROWSER`; исходный CSS-механизм уже обнаружен. Не называть задачей #10 / настоящий LED thermal-burnout. Не менять C++/Worker/solver, UI цветов или owner SVG.

**БЫЛО → СТАЛО для ребёнка:** при развернутом наоборот обычном красном/зелёном LED после реального Run электрическая симуляция не зажигает лампу, но цвет корпуса сохраняется выбранным (красным/зелёным), вместо принудительной серости; информационная диагностика обратной полярности остаётся. При правильной полярности свет возникает только по реальному solved/current; при реальной опасной перегрузке существующая диагностика и burnt appearance остаются неизменными.

**Owning surface:** `electronics.ui.workbench` → `docs/product/electronics/components/ui-assets-persistence.yaml`. Risk of area medium, actual stylesheet repair low; mandatory independent review by owner.

**Кандидат причины и BEFORE:** в `apps/web/src/electronics/workbench.css` существует
` .workbench-led-visual.is-reverse .workbench-led-asset { filter: grayscale(1) brightness(0.88) contrast(0.82); }`.
В `component-catalog.ts` состояние `reverse` уже даёт 0% яркости. Сначала подтвердить в native Chromium вычисленный фильтр, сохранённый owner SVG/href, классы/состояние и цвет корпуса при синтетической схеме, а затем его исчезновение с тем же сценарием AFTER. При невозможности получить реальный native BEFORE явно оставить `WAITING_NATIVE_BEFORE`, а не выдавать source observation за optical acceptance.

**Минимальный изменяемый набор:**
- `apps/web/src/electronics/workbench.css` — убрать только принудительный reverse grayscale/contrast, не отрисовывать другое SVG;
- `apps/web/src/electronics/testing/workbench-presentation.spec.ts` — обновить устаревшее CSS-ожидание и запретить обратный grey filter;
- при необходимости одна собственная focused regression для `visualAsset(…,'reverse')` и нормального/thermal случаев; пользовательское e2e только в отдельном файле, не переписывать общие занятые e2e или артефакты без handoff.

**Положительные/отрицательные:** blue/red/green обратный корпус остаётся своего оттенка, brightness 0%; normal forward lit state не затухает и не красится, overcurrent/burned не сбрасывается; Stop/Run одинаковый документ, нет нового сохранения/Undo/Reset behavior. Проверить 1440 desktop, 390 mobile + 320 при touch/zoom (не обязательно добавлять управления).

**Обязательные gate и независимость:** `pnpm agent:preflight --scope electronics-reverse-led-colour --check`, `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-REVERSE-LED-COLOUR-001`; focused Vitest; `pnpm gate:electronics-m1`; применимые browser/native и General gates на финальном SHA с literal `NX_SKIP_NX_CACHE=true`, `pnpm bundle:check` против 218000 Б, `git diff --check`, новый независимый source/product reviewer финального SHA. Только принятый источник — main, `IN_MAIN` не равно `DEPLOYED` и `USER_VERIFIED`. Старый bundle 217993 Б не распространять на новый SHA.

**STOP/соседи:** любые пересечения с чужими текущими редакторами CSS/Stage, P0 confirmed loss, отсутствующий native BEFORE, отрицательное review, непройденный exact CI, изменение физических инвариантов — остановить только данный срез и передать evidence контролёру; продолжить независимые работы. Школьные данные, Docker/FRP/backup/DB, защищённые SVG не изменять. После slice исполнитель STOP, а контролёр продолжает очередь.