---
task_id: TASK-ELECTRONICS-SPDT-ACTIVE-SHADOW-001
kind: repair
risk: low
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Owner E09 in existing programme452; accepted E01/526 and PSU543 preserved
acceptance_boundary: slice
review: independent
---

# Remove only the extra active SPDT shadow

Bounded [547](https://github.com/spikeal8-maker/asa-lab/issues/547) of existing452. Canonical current.yaml selects the executable phase; this card never authorizes another task.

## First executable phase: causal browser BEFORE only

Author creates ONLY the new browser file plus its three minimal registrations. Product CSS is READ ONLY in this phase. Return one unpublished scenario SHA/self-review and STOP; controller publishes/executes one directed BEFORE using unchanged production, checks actual original evidence, then explicitly returns the same selected slice to a CSS implementation phase if the predicted extra filter is proven. Do not run a full browser suite in hope. If no causal proof, report exact observations and STOP. Root handles main/current/card/GitHub publication and exact gates; author may not edit this card/current, push/dispatch/deploy/start stack. Keep the full actual raw and screenshots in finally even on BEFORE assertion failure. A later CSS repair uses ONLY the single active selector and the identical already-proven scenario. No fallback or focused-element comparison as visual proof.

**Результат ученика:** переключатель SPDT различим в ON/OFF без дополнительного голубого свечения всего корпуса в ON. Выделение, клавиатурный фокус, обычная тень корпуса, диагностика и активное оформление других компонентов сохраняются.

**Компонент:** `electronics.ui.workbench`, ownership `asa`; риск области medium, фактическая правка локального представления low. Независимый review нужен по прямому поручению владельца всей программе.

### Доказательство до правки

Пока установлен лишь механизм-кандидат. `WorkbenchStage.tsx:910` добавляет `workbench-component-actuator-active` при Running && state, а `workbench.css:2972` накладывает `drop-shadow(0 0 7px rgba(25,151,205,.82))` на любую `.workbench-part` внутри. Это нельзя объявлять подтверждённым дефектом без built-browser BEFORE.

Использовать собранные Web/API/Worker и реальную изолированную PostgreSQL в GitHub Actions штатного Electronics workflow. До CSS-изменения опубликовать baseline probe с новым сценарием: продуктовые байты CSS/Stage/Visual должны совпадать с исходным SHA. Новый сценарий использует реальный логин, POST проекта, PUT полного документа и GET ревизий, не mocks API/Worker и не подмену CSS через evaluate.

Сначала при Running выполнить нативный клик по `[data-component-id="shadow-switch"] [data-testid="spdt-actuator"]`. Сохранить фактические trusted pointerdown/click, active-class, transform внутреннего подвижного g, computed filter, PNG OFF/ON. Ожидаемая after-проверка равенства обычного OFF/ON filter должна падать именно на дополнительном голубом filter; finally обязан сохранить сырые наблюдения и серверный полный документ даже при таком ожидаемом отказе. Если голубой filter не воспроизводится либо различается только из-за фокуса, реализацию не начинать: сообщить конкретное наблюдение контроллеру. Исторический owner screenshot не предоставлен; этот probe докажет механизм текущего production-кода, а не совпадение с неизвестным снимком владельца.

Состояние фокуса сравнивать одинаковое: нативный actuator делает preventDefault и не должен сам менять focus. Записать activeElement и отдельно тестировать фокус. Не сравнивать focused OFF c unfocused ON: в CSS уже есть более позднее `.workbench-part:focus { filter:none }`.

### Минимальная fixture и границы действий

Полный schemaVersion4 проект с батареей 3 В, резистором 220 Ом, SPDT и контрольной тактовой кнопкой; нет LED, Arduino-аудио или значимых динамических нагрузок. Построить компоненты через существующие `configureProductionLibrary`/`addComponentToDocument`, используя exact runtime catalog. SPDT terminal IDs: `common`, `throw-left`, `throw-right`. Батарея BAT+ -> common; оба throw -> один lead-1 резистора; lead-2 -> BAT-. Оба положения дают обычную замкнутую безопасную DC-нагрузку, исключая посторонний fail-open/Stop. Контрольная кнопка нужна только для проверки сохранения прежнего active-glow при нативном удержании. Не выдумывать электрические показания; дождаться настоящего complete ready C=H/solved Worker результата.

Позиции в компактной области, native Fit при открытии; проверить actual in-viewport actuator до клика для каждого размера. Не переносить hidden/offscreen деталь программной записью состояния и не вводить авто-fit в продукт.

Матрица: 1440/1024/390/320 × light/dark browser colorScheme × fit/нативное увеличение/нативное уменьшение масштаба. В текущем Electronics нет отдельного theme switch: workbench.css/Stage/Header не имеют data-theme или prefers-color-scheme; PresentationPreferences поддерживает motion/sidebar, а не тему. Поэтому light/dark — честная проверка двух browser preferences одной поддерживаемой текущей темы, без выдуманного продуктового режима и без записи data-theme. Сохранять actual media matches/computed colors. Если в свежей базе появятся реальные темы, прочитать точный новый контракт перед реализацией.

Для каждого состояния измерять selected/unselected, OFF/ON, Running/Stop. Выделять нативным кликом по корпусу/клавиатурой, снимать выбор кликом по известной пустой grid-точке; не смешивать выбор с нажатием actuator. Native Start/Stop и actuator должны сохранить свои semantic классы и движение; при Stop actuator штатно не переключает runtime. После Stop baseline возвращается, Start может восстановить штатный начальный OFF — это наблюдение, не требование сохранять runtime ON в документе. Для контрольной кнопки удержать native mouse down при Running и проверить прежний голубой computed filter, отпустить. Выделение SPDT проверять отдельной `.workbench-tinkercad-selection`, фокус — по существующим правилам, не заменять их glow.

Для настоящего Save добавить одну явную обычную правку резистора штатным inspector input, снять полный scoped local draft, нажать Save; ровно один PUT, revision r -> r+1, полный документ равен ожидаемому, без потери components/connections/vertices/stateProperties. Runtime ON/OFF не должен менять документ/создавать ревизию. Затем cookies-only новый browser context без local/session storage, GET подтверждает тот же полный server draft/revision/updatedAt; открыть, повторить native Start/ON/OFF/selection и computed-filter проверку. Не обещать persistence runtime ON: оно штатно не входит в проект. Все raw/PNG/трассы сохранять через testInfo.outputPath/attach в уже игнорируемые reports; tracked изображения не менять.

### Разрешённые минимальные пути после canonical selection

1. `apps/web/src/electronics/workbench.css`: только selector existing active-glow исключает `[data-component-type="switch-spdt"]`; декларация и все остальные правила остаются. Предпочтительно `.workbench-component-actuator-active:not([data-component-type='switch-spdt']) .workbench-part`. Взять quote-style окружающего файла. Не создавать новый override `filter:none`, поскольку он уничтожит базовую тень/фокус.
2. **Новый** `e2e/electronics-switch-shadow.spec.ts`: один независимый сценарий с матрицей выше, настоящим auth/project/save/reopen. Заимствовать минимальные паттерны реального API из отдельного clock browserfile, без изменения исходного файла и без импорта test-файла (это регистрировало бы чужие tests повторно).
3. `package.json`: только добавить новый spec к обоим существующим browser script `e2e:electronics` и `e2e:electronics-simulation`. Сохранить все имеющиеся файлы, включая clock541 и появившийся ready-cadence539; gate alias не заменять, dependencies/lock не менять.
4. `.github/workflows/electronics-r4-m1-focused.yml`: только положительно добавить путь нового spec в существующий pull_request.paths; workflow jobs/steps/commands/security/timeouts/545 digest-pinned registry overlay не менять. Directed BEFORE/AFTER probe controller может оформить отдельно; такой probe не заменяет ordinary exact-head gates.
5. `docs/product/electronics/components/ui-assets-persistence.yaml`: только добавить новый browser test к `electronics.ui.workbench.tests`, сохранить PSU543/field544 и все остальные entries.

Карточку и canonical current.yaml принимает контроллер на main перед запуском автора; автор не выбирает себя. COMPONENT_MAP index менять не нужно: component ID/card/keywords прежние. CSS есть в subsystem sources, но global `agent:context --path .../workbench.css` сейчас FAIL «path ... is not mapped to an agent surface; use --scope ...». Выполненный штатный fallback `agent:context --scope electronics` успешен и ведёт к Electronics router/subsystem; глобальные Surface Map не расширять ради задачи без отдельной необходимости.

Запрещено писать existing `electronics-interactions.spec.ts` (544/538), common `electronics-simulation.spec.ts` (543 и другие), Stage/Visual, owner SVG/assets, Worker/solver/clock/Arduino, persistence/API/schema, diagnostics/selection и общий CSS cleanup. Бюджет: 1 production file, 1 новый browser test, 3 непосредственно необходимые registration/map paths. Если причина потребует Stage/Visual или другой продуктовый механизм — STOP, сообщить новую доказанную границу контроллеру.

### Gates и review

После принятой main-карточки, в согласованном чистом изолированном checkout: свежий remote/main/current/exact-CI snapshot; `pnpm agent:preflight --scope <выбранный-lane> --check`; `pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-SPDT-ACTIVE-SHADOW-001`. До этого никаких repo edits.

Локально только format/lint/new-file discovery и focused `NX_SKIP_NX_CACHE=true pnpm gate:electronics-m1` с frozen dependencies. Новый spec discovery сам по себе не browser PASS. Причинный directed BEFORE затем AFTER на собранном production в изолированном GitHub Actions; без локального stack. После final convergence: штатные `pnpm gate:electronics-m1:browser` и `pnpm gate:repository` именно на финальном SHA, неизменённые timeout/assertions/физика. Записать точные SHA/run/job/artifact IDs, CRC/SHA256 сырых оригиналов, fresh Nx execution counts, ни одного cached результата как нового evidence.

NEW independent reviewer проверяет actual final SHA/diff, actual original browser records/screenshots до/после и GitHub state, полноту Save/reopen и preservation прочих состояний. Отчёт автора не доказательство. Автор после одного среза/self-review STOP; controller интегрирует/принимает технически и продолжает программу. School deployment/owner acceptance/K0/T3/class evidence этим срезом не предоставляются.


## Selected native scenario R1 before product CSS

Controller independently checked actual originals of2190 unchanged-product probe ba0564d1/run38012635802:10 equal-focus native OFF/ON pairs prove ordinary baseline shadow becomes blue active glow;194 ready C=H/finite/quality frames. Both1024 preferences complete32 states and whole Save/revision+1/cookies-only reopen. Independent BEFORE analysis original SHA dc98d371de617593baa5b35c05c0396ce71d833894a15de413779d776d1220d8;33-file manifest SHA65f954aa8fa846fadaa4a68b8d50284d99033e2c545cb7019ff7eda564e57eb2. Other cases are NOT complete:1440 zoom actuator bottom904.352 exceeds900;390/320 capture center is not a native actuator hit. Mobile terminal radius14 exceeds center distance12.7, but actual old hit identity was not retained, so no product pointer defect is proven.

This phase supersedes first-phase write budget for ONE NEW author: ONLY e2e/electronics-switch-shadow.spec.ts on preserved2190. CSS/Stage/Visual/registrations/current/card/dependencies remain read-only. Save raw hit/sample geometry and actual elementFromPoint identity BEFORE asserting; finally must retain failures. Use a visible reachable point inside the existing actuator, verify native hit identity at the actual click point and trusted actual target; no force/synthetic clicks/pointer-events override/terminal hit-area reduction. Use the existing native pan gesture to bring zoomed parts into viewport; preserve the full original fixture rather than relocating state programmatically. If native geometry cannot be repaired within this test alone, STOP with evidence, not a weakened assertion.

Preserve original fixture, widths/preferences/fit/zoom matrix, selected/unselected/ON/OFF/Stop/Start and control-button glow checks, all old default timeouts/assertions, complete real Worker ready frames/physics, native inspector/Save/onePUT/revision+1/whole expected server document/cookies-only reopen. No field/product repair or CSS in this phase. New helper may make geometry assertions more precise at the actual reachable click point, but may not omit hit/viewport/trusted/full persistence checks. Existing registrations remain exact. Fresh canonical remote/preflight/card validation, format/lint/discovery and bounded selfreview; inspect shared node_modules junction before any install and do not reinstall shared dependencies. ONE unpublished test-only SHA/tree/report/hashmanifest thenSTOP. Root independently checks source/foreign paths, publishes ONE justified changed-cause full8 BEFORE with unchanged production, then separately selects minimal CSS phase. Directed evidence is not ordinary gate/final product acceptance; exact final gates and NEW independent final reviewer still required. No school/DB/network/Docker/backups/owner assets actions.

## Selected stopped native capture scenario R2

Independent causal checker (not final acceptance) report SHA256 b34e2fa4052399bed7be5f019116fbf30669e94da986e3621a094588224d75a0 inspected actual b196 source and probe03a889/run38015124303. Controller independently verified all report/original manifest bytes and all eight raw stopped sequences. In every case native trusted pointerdown hits the exact actuator; pointerup/click target svg.workbench-canvas at the same actual point. Exact existing stopped drag handler sets canvas pointer capture; capture events were not logged, so capture is inferred. Full actuator/runtime/whole server revision2 remain unchanged, zeroPUT; Save/reopen not reached. R1 accidentally applies Running click-actuator identity to this stopped route. This is a proven test defect, not a product pointer defect. Expected blue-filter soft failures remain; full BEFORE NOT_READY.

This supersedes the preceding test phase for ONE NEW bounded author on preserved b196: ONLY e2e/electronics-switch-shadow.spec.ts. Keep Running actuate helper byte-identical. Add a separate strict stopped native helper using the same actual actuatorGeometry/assertActuatorGeometry and native page.mouse.click. Positively require trusted down at the same actuator/point, trusted up and click on the exact canvas/null component/null actuator at that same point, matching the observed route. Preserve the original stopped inactive and unchanged-transform assertions and ALL25 matrix expect statements. Optional ADDITIVE passive pointerId/gotpointercapture/lostpointercapture observation may directly prove capture; never synthesize or release capture from test code. No fallback targets or reduced native checks.

Keep the entire fixture and registered case/Save/cookies-only reopen byte-identical, all original Running physics/ready C=H/finite/quality checks, fit/zoom/width/preference/selection/control-button matrix, native pan, real whole onePUT/revision+1/finalGET, all timeouts and finally failure raw/PNG. Product CSS/Stage/Visual/controller/solver/auth/persistence, registrations, dependencies, current/card remain READ ONLY. Fresh canonical preflight/card validation and bounded format/lint/discovery/self-review; inspect dependency junction before any install. ONE unpublished scenario SHA/tree/report/hashmanifest thenSTOP. Controller independently checks actual diff/foreign paths and runs ONE changed-cause full-eight BEFORE on unchanged production. No CSS implementation until full matrix is actually reached; no ordinary-gate or acceptance substitution. No school/DB/Docker/network/backups/owner-asset action.
