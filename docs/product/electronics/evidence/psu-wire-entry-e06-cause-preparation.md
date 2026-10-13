# E06 / Issue466 — ограниченная подготовка ремонта подхода провода к БП

Роль: отдельный read-only исследователь для контроллера действующей программы452. Это не приёмка продукта и не активация задачи. Продукт, карточки, current.yaml, Git index/refs и школа не изменялись. Новые CI/browser запуски и скачивания не выполнялись.

## 1. Каноническая связь и фактический вход

- Основная ветка/HEAD/origin main: `064e5f34e6d99101b60aad2007dfae902621bc4f`; рабочее дерево чистое. Exact General38170565175 завершился SUCCESS; Routing38170565254/Release38171789048 SUCCESS.
- `pnpm agent:preflight --scope electronics --check`: SAFE_TO_START; выбранной остаётся TASK-ELECTRONICS-ORDINARY-IMAGE-CONSUMER-FAILURE-001 /548, checkpoint r2_observation_completed_no_proven_cause. Dirty0, blockers0, worktree overlaps0, control-plane PASS. Это не выбор E06.
- Targeted context для Stage не картирован в глобальном Surface Map: сначала ошибочно указан `apps/web/src/features/electronics/WorkbenchStage.tsx`; затем правильный `apps/web/src/electronics/WorkbenchStage.tsx` также вернул unmapped. По инструкции использован разрешённый scoped router. Guards не отключались.
- Точная дополнительная карточка владельца: `docs/product/electronics/ASA_ELECTRONICS_OWNER_REPAIR_PRIORITY_20261008.md`, E06 строки425–439, особенно429–437. Это нужный реестр; V2 содержит367 строк, поэтому ссылки429–439 на сам V2 неверны.
- Базовый контракт: `ASA_ELECTRONICS_STABILIZATION_SPEC_V2.md`141–143,248–250. Существующий Issue466 OPEN: «Электроника: transform/layer/selection parity для Arduino, приборов и компонентов»; требует видимый последний участок у PSU/Arduino, согласованный hit order и отсутствие второго electrical wire, запрещает глобальное «все wires поверх всего».
- Мapped component: electronics.ui.workbench / `components/ui-assets-persistence.yaml`. Точная bounded-карточка E06 для проводов у БП пока отсутствует. Существующая TASK-ELECTRONICS-INSTRUMENT-MIRROR-001 /525 прямо исключает wire-layer; TASK-ELECTRONICS-WIRE-MENU-LAYER-001 /530 относится к принятому меню Purple/Code, не к электрическим проводам над БП. Нельзя переименовать эти результаты в E06.
- Контроллеру требуется отдельно формализовать bounded-карточку и canonical selection перед продуктовым исполнителем. Новая программа/инвентаризация не нужна.

## 2. Реальное сохранённое доказательство

Использованы уже скачанные оригиналы принятого543: exact `53a8c7efdafeea6f145217339973593e594e2000`, ordinary38007826968, browser114081295162,143/143 PASS. Фактическая связь SHA/run повторно прочитана в GitHub. Не выдаётся за измерение нового main.

Исходный ZIP `53a8c7ef-ci/run-38007826968/browser-artifact-11652711911.zip`:39888263 байта, SHA256 `3006c65372cebb3701a8b81d1eb9b704e190fcc09164e65a3b52f3fd2aebcebc`; все378 членов CRC PASS. Четыре выбранных локальных оригинала побайтово совпали с членами ZIP; точные индивидуальные SHA находятся в proof.json.

В просмотренных нативных `psu-1440-running.png` и `psu-1440-reopened.png` красный и чёрный провода видны справа от БП, исчезают на правой кромке корпуса и не видны до находящихся внутри корпуса красной/чёрной клемм. Последний участок подключения визуально отсутствует. Это наблюдение на реальной картинке собранного редактора, не вывод только из порядка JSX.

Полный оригинальный `psu-1440-raw.json` подтверждает реальный документ: bench-supply/regulated-power-supply, load/resistor и UNO; ровно два соединения supply-positive и supply-negative от bench-supply:positive/negative к load:lead-1/lead-2, vertices пусты. Нет оснований объяснять отсутствие подхода отсутствующим электрическим соединением. Вторая картинка относится к cookies-only открытию; сохранённая схема также показывает этот дефект видимости. Данное исследование не повторяет приёмку сохранения543.

`psu-390-running.png` просмотрен отдельно: сам БП находится за видимой областью сцены. Эта картинка НЕ доказывает мобильную видимость/перекрытие E06 и не принимается вместо необходимого fit-сценария. Сохранённого trace.zip для данного успешного543 сценария в его извлечённой reports-папке нет; actual pointer ownership по нему не выдумывается.

## 3. Подтверждённый механизм и границы вывода

В current Stage662–680 оба конца существующего соединения вычисляются через terminalPositionInDocument, затем wirePoints/roundedWirePath. Stage1287–1352 рисует wire hit, сохранённый путь и pending preview раньше component-body-layer1360–1364. PSU включён в ordinary bodies. Terminal-overlay1365–1369 добавлен позднее, но не перерисовывает закрытый путь провода. ProductionComponentVisual732–744 рисует непрозрачный runtime SVG БП, pointerEvents all; его реальные ручки/кнопка используют существующие обработчики745–762. Обычная часть тела также участвует в component drag/select971–983.

Реальный543 кадр согласован с этим конкретным механизмом: существующий путь подходит к правильной внутренней клемме, но корпус рисуется поверх последнего участка. Это доказанный исторический PSU пример. Pointer ownership на скрытом участке, pending preview, crossing, rotation/mirror и Arduino пример ещё не измерены.

Текущий Stage имеет только accepted554 изменение native-wheel binding относительно measured53a8. Полный хвост от breadboard-body-layer до конца файла побайтово равен; ProductionComponentVisual, geometry, drag-preview, CSS, presentation-test и simulation-test — целиком те же Git blobs. Поэтому известный rendering механизм сохраняется в исходниках current main; нового реального browser измерения current SHA здесь не заявляется.

Нельзя заявлять, что скрыты все провода на всех устройствах, что это единственная причина жалобы или что устранён весь E06/466. Частота на школьных компьютерах не доказана.

## 4. Минимальный следующий исполняемый срез

Один результат: уже существующий провод, подключённый к клемме регулируемого БП, имеет непрерывный видимый и выбираемый подход к конкретной клемме при сохранённых корпусе, передних показаниях и органах управления. Pending подход к той же клемме также виден. Никаких новых электрических сущностей, topology/ID/schema/runtime-state изменений.

Минимальная стратегия для проверки исполнителем: локальная декоративная отрисовка только части существующего canonical wire path внутри/у подключённого PSU, с ограничением по фактической transformed геометрии БП и соответствующей локальной hit-геометрией. Внешний основной wire/hit слой и остальные детали сохраняются. Декоративный путь ссылается на существующий wire.id и не добавляется в document.connections/netlist/history. Конкретная реализация выбирается после одного направленного BEFORE, а не принимается этим отчётом как готовое решение.

Не переносить глобальный wire-layer над всеми компонентами; не поднимать весь прибор или все wire targets; не перекрывать показания/ручки/кнопку невидимой широкой hit-полосой; не менять защищённый owner SVG. Если нужен видимый корпус-crossing, не связанный с terminal approach, это отдельное расширение после фактического доказательства. Полный owner E06 включает crossing и Arduino; узкая PSU-entry приёмка не закрывает их автоматически.

Предлагаемый бюджет для формальной карточки:

- Основной production path: `apps/web/src/electronics/WorkbenchStage.tsx`.
- Прямой обязательный зависимый consumer при новом декоративном path: `apps/web/src/electronics/workbench-drag-preview.ts`. Сейчас createWireDragPreview106–117 обновляет один overlayGroup, а component preview199–203 использует querySelector одного schematic-wire. Слепое добавление второго painted path оставит его неподвижным во время жеста. Изменять только поддержку локального PSU decoration; сохранять существующие selectors/поведение всех иных wires. Нужна фактическая проверка рисования в процессе drag, не только после pointerup.
- `workbench-geometry.ts` только если необходимо выделить строго конечную transform/segment геометрию без изменения canonical endpoint/path. Иное production расширение — сначала конкретное доказательство контроллеру. ProductionComponentVisual/owner SVG/PSU runtime controls по умолчанию сохраняются побайтово.
- At most2 meaningful regression files: существующий `testing/workbench-presentation.spec.ts` (или точный existing geometry/drag-preview test, если проверяет отдельный инвариант) и существующий `e2e/electronics-simulation.spec.ts`. Existing source-order assertion409–419 не является достаточным поведением; сохраняется old global order и добавляется проверка ограниченного исключения/actual mounted geometry. Не ослаблять старые проверки.
- Только канонический browser-source digest в `generated/component-coverage.json` вслед за изменённым existing browser test; остальные поля равны генератору/main. Package/lockfile/permanent workflow не нужны, так как existing simulation journey уже зарегистрирован. Перед публикацией проверить actual diff.

## 5. ONE genuine built BEFORE → bounded repair → AFTER

Новый направленный BEFORE оправдан отсутствующими данными E06 (actual hit/pending/transforms), а не повторением старой543 проверки уставок. Использовать existing real login/API/project/built browser harness. Одна специально выбранная схема БП и нагрузки с двумя настоящими клеммами; ограниченный подход, который проходит внутри корпуса и виден в нативном полном кадре после обычного fit. Не генерировать electrical result и не создавать synthetic/forced pointer события.

До assertions сохранить actual SVG/DOM paths, source endpoint IDs, transformed terminal positions, finite screen CTM, реальные hit ancestors/elementsFromPoint на выбранных точках подхода, native PNG и full canonical document. Для выбранного старого дефекта ожидается отсутствие видимого последнего участка/неверный wire hit под корпусом; actual pixel visual и actual ownership проверяются вместе. Скриншот/DOM alone не доказывает действие ученика.

AFTER на новом точном SHA:

1. Проверить 0/90/180/270 и none/X/Y/XY на PSU: finite transforms/endpoints, непрерывный подход именно к positive/negative, unchanged owner body/readouts, знак/значение и терминалы. Не вводить политику горизонтальности при обычном повороте из section7.
2. Connected + pending route, обычный выбор проводника, создание/изменение изгиба и переподключение к конкретной клемме реальным pointer. Не force, не увеличение timeout, не изменение точности физики. Не включать запрещённую структурную мутацию во время Run.
3. Во время жеста путь/локальная decoration не расходятся; после commit нет второго wire/entity, потерянного ID/endpoint или изменения unrelated whole document. Save через actual CAS и новое cookies-only открытие сохраняют полную схему, параметры и sketch/workspace, только намеренные электрические/геометрические изменения; viewport/selection/runtime не становятся новым electrical intent.
4. Реальные PSU power/voltage/current controls и показания продолжают работать. На пересечении с управляющим элементом не появляется невидимое перехватывание; selected wire/edit handles и terminal hits согласованы с фактическим видимым правилом. Если найден выбор между новой policy и existing control behavior, не решать за владельца: отдельная конкретная развилка.
5. Реальные desktop1440 и mobile390 после fit/collapse, applicable1024/320: БП и подход действительно внутри видимой сцены, а не offscreen как старый390 кадр. Проверить регрессию resistor/breadboard/Arduino обычных слоёв без признания неподтверждённого Arduino E06 исправления.
6. Focused+обычный required browser/repository gates на final exact SHA, frozen dependencies, literal NX_SKIP_NX_CACHE=true/fresh counts, NEW independent reviewer actual GitHub/source/originals. Старый543 зелёный CI не принимается за новый slice. No hopeful unchanged reruns; unrelated failure classified per AGENTS §2.1.

## 6. Зависимости, параллельность и STOP

Нет обнаруженного dirty пересечения: все Electronics worktrees чисты; единственный dirty worktree v-ux2a-assignment-list содержит только Learning files и сохранён. Фактический diff pending553R5 e132 против current064e не пересекается с предложенными Stage/Visual/preview/geometry/CSS/presentation/simulation paths. Однако generated digest/control-plane общие: проверять свежий main и все dirty paths перед записью, не предполагать вечную независимость. Held544/549 имеют Stage work;525 имеет Visual work;538/547 имеют жесты/CSS. Их опубликованные кандидаты не перезаписывать и не интегрировать автоматически.

553 R5 exact CI/review продолжаются отдельно;552 конфликт ожидает решения. Ничего из их code/commands/workflow не менялось.548 остаётся NO_PROVEN_CAUSE; его blocker не закрывается этим E06 исследованием. Нет смысла включать E06 в553 либо автоматически в старую525 карточку.

Нет нового согласования section7 для восстановления уже явно требуемого PSU terminal approach при неизменных controls/physics/структурных блокировках. Если исполнителю потребуются иной overlap policy, новые Run действия, обычная rotation-horizontalness или механика гибких выводов — это вне данного разрешённого минимального результата.

RESULT: исторический connected PSU-entry rendering дефект подтверждён оригиналом; ограниченный следующий ремонт обоснован для отдельного формального выбора. Не приняты current product fix, полный E06/466, школьная частота/T3, owner/class/release. Исполнитель этого read-only шага STOP; контроллер может продолжить программу после свежего выбора/gates.

Соседний `e06-psu-wire-cause-proof.json` содержит machine-readable exact Git blobs, исходный ZIP/CRC/четыре individual SHA, actual document connections, main CI/GitHub466 и fresh dirty-path snapshot. Программа проверки только читала repo/GitHub/cache и записала этот внешний proof; никаких тестов продукта не запускала.
