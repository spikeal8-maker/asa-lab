# Независимый направленный review №544 R2

## Вердикт: REQUEST_CHANGES — только ожидаемый документ браузерного сценария

Проверен ровно `1ee348134b386113e3c341db7f975881250e8147`, tree `f2a87f5230b5ae84860e40bfd10ffa2ff29cee08`, parent `4acedfa6dd96d8632cfe67fdadc209688eefca76`.

Сам продуктовый механизм переноса вне прежней сетки подтверждён направленным actual browser AFTER. Полная приёмка №544/E03 остаётся PENDING: единственный сценарий остановился до Save, cookies-only reopen и повторного захвата. Full32 и ordinary exact-SHA gates ещё не подтверждены. Старые APPROVE других SHA не использованы.

## Свежий вход и независимость

Прочитаны root policy, START_HERE, GitHub-first/delivery/review/layout contracts, actual source/diff/tests и оригинальный artifact. Первый preflight показал WAITING_HANDOFF только из-за `docs/execution/current.yaml` контроллера в hygiene480; этот файл и checkout не изменялись. После фактической передачи повторный preflight: SAFE_TO_START, HEAD1ee34813, origin/main55a180016a2533705f116f57ecd62d62dbabadf6, dirty0, blockers0, overlaps0, remote/control-plane PASS. Issue544 фактически OPEN. Оригинальный diagnostic run38004803405 — completed/FAILURE, точный GitHub HEAD14c33dbd95530cc687cfbd3b70b81b4ff2a3014a, parent1ee34813. Единственное отличие diagnostic tree от candidate — диагностический workflow. Это не registered gate.

Рецензент не редактировал репозиторий, не коммитил, не запускал browser/CI, не менял продукт или тест. Записаны только внешние proof/report/cache. Отчёт автора использован как навигация; источниками вывода являются Git blobs, полные JSON, trace, PNG и фактические логи.

## Что независимо подтверждено в коде

Ровно три task paths: `use-electronics-workbench.ts`, новый `testing/workbench-field-drag.spec.ts`, одна test registration в `components/ui-assets-persistence.yaml`. Обратная замена только тела `componentDragDelta` полностью восстанавливает родительский hook побайтно. Обратное удаление одной регистрации полностью восстанавливает map. Все3792 остальных mode/type/blob entries сохранены. Stage и целый32-case interactions spec побайтно равны3d1. Accepted clock541/CI545 source не откатывались.

Изменение исключает только абсолютное ограничение pointer drag прежними−980/4980/3980. Screen-to-world, offsets, threshold3CSSpx, bounds presence, preview/commit, rounding0.001, history, save и keyboard clamp сохранены. Нечисловой/бесконечный delta становится0. Нет расширения поля числовой константой, миграции схемы, CSS/artwork/physics изменения.

Независимо заново выполнены35 mounted actual production hook tests и5 существующих drag-preview tests:40/40 PASS. Новые тесты действительно вызывают `useElectronicsWorkbench`/его project-state; подменяются только API/storage/DOM geometry/frame runner boundaries. Проверяются8edges×3zoom, полный document/history/UndoRedo, групповые bends, bound LED с макеткой, отрицательные pointer/threshold/Shift/right/cancel/nonfinite случаи. Старые preview tests дополнительно подтверждают detach только committed copy и сохранность stationary wire bends. Это unit evidence, не браузерная приёмка.

Сохранённые actual focused logs проверены по размерам/SHA256:633engine+440web PASS, module-sdk1 + typecheck42 + build27 =70fresh Nx tasks, все3стадии Cache Skipped; frozen dependencies PASS. Gate целиком повторно не запускался. Никакие test assertions или timeout не изменялись.

## Фактический AFTER, а не предположение

Run38004803405/job114071013054/artifact11650458480. Оригинальный ZIP скачан один раз; CRC всех33members PASS.15267442B SHA256 `6dbf6d7e0c3ee87f2f0cd7422c09d3097cac540417b972595880312aeb27fac0`.

Raw `field-boundary.json`:238945B SHA256 `1e631476187acccc5669c4b01e72bd3b6164ac34ae06bb10b093b55b74d777ee`. Trace10889366B SHA256 `fde6611a57fad2e01fbae9bb4d938cd2b0004d2e9cdc0fb9ebbc5b393c56b5e8`,140members CRC PASS. Перед/после PNG просмотрены: батарея остаётся видимой, перемещается согласно жесту; остальная схема остаётся на месте. Нет горизонтального page overflow на проверенных1440px; остальные ширины этим запуском не доказаны.

Полный fixture4components/3connections/schema4/целыйUNO sketch равен фактическому серверному документу revision2. Перед жестом pending local recovery отсутствует (`local:null`), что не означает отсутствия серверного документа. Обычная заранее выбранная точка батареи opaque alpha255, world(-5130.310997009277,140.5) вне исходной сетки; target — реальный svg.workbench-canvas. Trusted native mouse down,6moves,up, CSS displacement(24,18), stageScale1.3834482169039903. ViewBox до и после одинаковый. Actual movement из(-5216,-10) в(-5198.652,3.011), совпадает с rounded world displacement; precision4 assertion5226 действительно пройдён. Старый clamp−980 больше не сработал.

Весь actual local document по полной структуре равен исходному fixture с ровно двумя ожидаемыми изменениями выбранной батареи: position и `holeBindings:{}`. Все остальные components/полныйUNO и3wires со всеми bends/metadata/viewport/simulation сохранены. Существующий expected создаёт только новое position и потому ошибочно отвергает `{}`. Rawrequests0: Save/revision3/reopen/regrab не достигнуты и не заявляются PASS.

## Единственное подтверждённое замечание

`e2e/electronics-interactions.spec.ts:5286`: для выбранного grabbedId expected full document должен содержать `holeBindings:{}` наряду с новой position. Это обязательная существующая семантика `translatedDragDocument`, `workbench-drag-preview.ts:44–47`: независимо от наличия исходного свойства `Object.entries(part.holeBindings ?? {})` → filter → `Object.fromEntries`, то есть для данной небинденной батареи `{}`. Эти строки введены историческим `6b1ff210fe91bc59ade760f651841bf73deb6450`; весь helper совпадает с parent и accepted main58753. `workbench-document.ts` и вызов translatedDragDocument/последующего snap в finishPointer также не изменены кандидатом. Это не новый продуктовый дефект №544 и не основание менять production canonical detach.

Требуется отдельный bounded harness repair: явно добавить `holeBindings:{}` только ожидаемой выбранной детали в первом whole-document expected. Сохранить полный `toEqual`, исходный fixture до жеста, все другие component/wire/Arduino/viewport поля, native actions,32cases, отрицательные assertions, precision4, исходные timeout/Save/revision/cookies-only reopen и whole final equality. Не удалять ключи из actual, не применять blanket normalization или partial matching. Повторное ожидание после reopen уже наследует подтверждённый whole document; его ослаблять не требуется.

После нового SHA необходимы changed-cause AFTER, неизменённый32matrix, ordinary final composition/focused+repository gates и новый независимый финальный exact-SHA review. Этот REQUEST_CHANGES разрешает только обоснованный harness repair; не означает full acceptance или закрытие E03.

## Остаточные ограничения / STOP

Показан один конкретный1440left перенос вне прежнего поля. Работа остальных31cases, Save/cookies-only reopen/regrab, full ordinary SHA и окончательный layout review остаются недоказанными этим запуском. Не утверждается, что это единственная причина всех школьных захватов. School version/backups/T3/class/owner acceptance остаются отдельно pending; deployment/DB/network/protected assets не затрагивались.

Независимый reviewer завершил один exact-SHA направленный review и STOP. Контроллер продолжает программу и назначает отдельный bounded harness repair.
