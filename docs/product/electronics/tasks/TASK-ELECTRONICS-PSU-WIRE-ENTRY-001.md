---
task_id: TASK-ELECTRONICS-PSU-WIRE-ENTRY-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - docs/product/electronics/evidence/psu-wire-entry-e06-cause-preparation.md
acceptance_boundary: slice
review: independent
---

# E06: видимый и выбираемый подход провода к клемме БП

Один ограниченный результат действующей программы №452 / существующего №466: подключённый и незавершённый провод непрерывно виден у конкретной клеммы регулируемого БП и соответствует реальному захвату. Это только PSU-entry; Arduino, произвольное пересечение всего корпуса, отражение текста и полный №466 остаются отдельными результатами. №466 не закрывать после одного этого среза.

## Component / risk / minimal read

electronics.ui.workbench, asa, L1 UI behaviour, semantic yes/high из-за geometry/hit/preview coupling. Прочитать START_HERE.md → COMPONENT_MAP.yaml → components/ui-assets-persistence.yaml (только workbench), AGENT_GUIDE §§2,5,11–13, root review protocol и ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md. Точные нормы: owner priority E06; stabilization V2 §§3.9 и шестой рубеж «Слои»; README §§7–8 только применимые wire/transform/hit invariants. Сначала root policy/preflight, затем эта карточка и [доказательство](../evidence/psu-wire-entry-e06-cause-preparation.md).

## Proven boundary

Сохранённый actual543 native1440 PNG показывает два настоящих провода PSU positive/negative → load, скрытых от правой кромки корпуса до внутренних клемм. Root проверил SHA/CRC/4originals/full connections и просмотрел обе native PNG. Stage layer tail совпадает с измеренным543; другие шесть source blobs совпадают. Это не замер текущего браузера и не доказательство pointer ownership/pending/transform/mobile/Arduino или школьной частоты. Единственный новый directed BEFORE оправдан именно этими недостающими данными.

## Exact write budget

- apps/web/src/electronics/WorkbenchStage.tsx — локальная видимая часть существующего пути и согласованный hit order; остальные слои неизменны.
- apps/web/src/electronics/workbench-drag-preview.ts — только непосредственный consumer локальной части, чтобы она двигалась вместе с canonical path во время жеста. Текущие querySelector одного пути требуют явной проверки.
- apps/web/src/electronics/workbench-geometry.ts — только если необходима конечная transformed/segment геометрия подхода; canonical endpoints/path/netlist не менять.
- apps/web/src/electronics/testing/workbench-presentation.spec.ts — meaningful actual geometry/preview/hit regression, сохранив прежние assertions.
- e2e/electronics-simulation.spec.ts — только новый strict реальный pupil scenario; все старые кейсы и ожидания неизменны.
- docs/product/electronics/generated/component-coverage.json — только результат неизменённого штатного generator для изменённого browser digest; все прочие поля прежние.

Не менять current/card, package/workflow, lock/dependencies, CSS, ProductionComponentVisual, assets, parser/schema/persistence/auth/physics или другие продуктовые пути. При необходимости расширения — конкретное доказательство контроллеру и STOP этой части. Не импортировать held525/538/544/547/549 и observer548. Все dirty worktrees проверять заново; опубликованный кандидат не является разрешением перезаписать чужую незавершённую работу. Stage62909B уже reviewed; не превышать +20% baseline и не выполнять постороннюю декомпозицию ради порога.

## Implementation and strict evidence

1. Минимальное локальное исключение для terminal approach, без глобального подъёма wires, второго electrical wire/ID/history/source of truth или изменения endpoint. Сохранить корпус, надписи, readouts/кнопку/ручки и приоритет их собственных действий. Конкретную геометрию выбирает исполнитель из реального canonical path; не подменять artwork.
2. Новый браузерный тест использует actual login/API/production-built editor/native pointer, полную заранее определённую parser/editor-stable fixture и strict whole equality. Не нормализовать actual ответы для сокрытия различий. BEFORE и AFTER один test/fixture/порог/зависимости; BEFORE должен доказать исходную скрытую/невыбираемую часть настоящим действием и native PNG/element ownership, не отсутствием нового testid или искусственным mock результата.
3. На PASS/FAIL сохранить до рискованных assertions Node-owned incremental original журнал, full docs/requests/responses/CTM/path/endpoints/hit ancestors/native PNG/trace, первичный отказ и достигнутые checkpoints. Неполное evidence не принимать. Никаких force/synthetic dispatch pointer, hopeful retry или увеличения timeout.
4. После ремонта connected и pending подходы согласованы с terminal; реальные выбор провода, изгиб и переподключение работают без второй связи. Во время drag основной путь и локальная часть совпадают; после pointerup только намеренное изменение full document, конечные координаты и прежний netlist для чисто геометрических действий. Сохранить Run structural-lock, viewport/selection/runtime не становятся электрическим intent.
5. Проверить PSU 0/90/180/270 × none/X/Y/XY; обе клеммы и finite endpoint/hit/paint transforms. Native actions/control hits на desktop1440/mobile390; usability/видимость подхода после fit/collapse также1024/320. Не выдавать offscreen кадр за подтверждение. Сохранить передние voltage/current/power controls и readouts; обычные resistor/breadboard/Arduino слои регрессионно неизменны. Новая горизонтальность обычного поворота и иная overlap policy не разрешены.
6. Ровно намеренный pupil edit/переподключение, explicit whole Save с actual CAS revision+1, fresh cookies-only reopen с пустым local draft и полным server/editor equality. Никаких скрытых runtime PUT или потерь проводов/параметров/Arduino source. Raw оригиналы и все expected документы сохраняются без проекций.

## Gates / review / STOP

pnpm agent:preflight --scope electronics --check; pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-PSU-WIRE-ENTRY-001. Узкие format/lint/types/meaningful focused unit/discovery, generator/inverse/full foreign-tree/self-review и один неопубликованный SHA/tree/hashmanifest, затем STOP исполнителя. Он не публикует и не запускает browser/Docker/install.

Контроллер проверяет actual source/evidence; NEW independent source reviewer должен оспорить fixture/actual native assertion/production geometry до дорогого frozen BEFORE. Только настоящий исходный отказ разрешает AFTER. Финальные pnpm gate:electronics-m1, pnpm gate:electronics-m1:browser и pnpm gate:repository на final exact SHA, frozen/literal NX_SKIP_NX_CACHE=true/fresh Nx; NEW independent PRODUCT APPROVE. Старые543/553 зелёные результаты не принимают новый срез. Unrelated CI классифицируется отдельно без ремонта чужого модуля/hopeful rerun.

Сохранить все чужие направления и кандидаты, полный548 NO_PROVEN_CAUSE snapshot/blockers и552 pending conflict decision. Один accepted product slice после hygiene006; этот новый срез увеличит счётчик только после реальной приёмки. Школу/рабочую БД/сервер/сеть/backups не менять; K0/T3/class/device/owner/deployment pending. NEXT_ALLOWED_TASK: STOP.


## R1: замечания независимого source review

НОВЫЙ independent reviewer точного fe9193b947076b8e2d006044d24c907ce2c62f43/treeb31cb876ef3b433308bcdd1288cf6d1bf3c521c1 вернул REQUEST_CHANGES: [полный verdict](../evidence/psu-wire-entry-e06-source-review-fe9193b9.md). Root проверил12external+10Git originals и отдельно48author originals/6Git source blobs/3940foreign entries. Не выполнены built browser/CI/product acceptance; старый кандидат и все оригиналы сохранить.

Один НОВЫЙ bounded R1 author наследует канонический main proper merge в новой ветке существующего clean E06 worktree; при новом конфликте/чужом dirty overlap STOP. Разрешены ровно4пути: workbench-drag-preview.ts; testing/workbench-presentation.spec.ts; e2e/electronics-simulation.spec.ts; generated/component-coverage.json только browser digest из неизменённого генератора. WorkbenchStage.tsx и workbench-geometry.ts сохранить byte-exactfe919; прежние cases/assertions/timeouts, все чужие пути и current/card из выбранного main неизменны. Никаких CSS/Visual/owner artwork/physics/auth/schema/netlist/package/workflow/lock изменений.

1. Pending arrival использует существующий canonical reconnectHover, уже связанный с terminalTargetAt/updateWireDraftPreview, вместо null destination. Сохранить текущий source endpoint, логическую association и finite canonical route; не создавать второй resolver/state. Actual unit и native regression должны покрыть starting/arriving обеих PSU клемм, cancel/reconnect/no document/history/PUT. До product acceptance также нужны actual negative approach hit/paint, controls/actions/readout shielding и component/group preview parity; не заявлять эти свойства по одной positive картинке.
2. E06 primaryFailure/достигнутый checkpoint синхронно записываются Node ДО любого browser await. Response-body rejection/forever-pending, optional snapshot/PNG/attach/close errors не заменяют primary и не блокируют сохранение исходных данных. Secondary outcomes/NOT_AVAILABLE сохраняются отдельно; неполное evidence не PASS. Направленные fault counterexamples должны исполнять фактический новый failure path, включая reject и hang, сохраняя исходные pupil assertions/trace/timeout.
3. Root обнаружил ровно одно отличие старого installed lock: отсутствует apps/api pngjs importer; четыре фактически использованных web/test packages совпадают. Это не новый product defect и не основание менять dependency graph. Перед новыми проверками разрешён один обычный pnpm install --frozen-lockfile ТОЛЬКО в собственном E06 worktree, если требуется восстановить полностью точный local installed graph; никаких upgrades/shared node_modules links/services/school. Сохранить lock hashes/versions/physical realpaths до/после; tracked lock неизменен. Если требуется удалить чужие данные/запустить сервис или штатная установка не проходит, STOP конкретного действия без обхода защиты. Локальные проверки с неполным graph не называть frozen-graph PASS.

Узкие format/lint/web types, honest browser-type delta (7старых errors не чинить), meaningful unit/fixtures/discovery, whole foreign/inverse/source proof/self-review и один неопубликованный SHA/tree/hashmanifest, затем STOP. Исполнитель не делает push/CI/browser/school/current/card mutations. Root actual verification → НОВЫЙ independent SOURCE review → genuine same-test frozen BEFORE/AFTER → required exact-SHA focused/full ordinary browser/repository/NXtrue/fresh counts → НОВЫЙ PRODUCT APPROVE. Не повторять дорогие measurements без новой причины. №466 остаётся OPEN; №552 и принятые553/554 сохраняются, school/T3/class/owner/deployment pending. NEXT_ALLOWED_TASK: STOP.
