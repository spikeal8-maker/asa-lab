# Независимая SOURCE проверка E06 / PSU-entry

VERDICT: REQUEST_CHANGES
NEXT_ALLOWED_TASK: STOP

Проверен один immutable candidate fe9193b947076b8e2d006044d24c907ce2c62f43, tree b31cb876ef3b433308bcdd1288cf6d1bf3c521c1, parent16a901b9f9eaeea48bd02abc3d8692ddab4d42e7. Это source review; PRODUCT APPROVE/приёмка/E06/466 closure не выданы. Browser/CI/push/install/deployment не выполнялись. Промежуточный author worktree не читался.

## Требуются отдельный bounded repair и новый независимый exact source review

### R1 / P1 — незавершённый подход к БП пропадает, когда БП является целью

Exact workbench-drag-preview.ts108–112 передаёт в psuWireApproaches для pending только [pending.pendingTerminal, null]. В том же exact файле64–68 допускаются лишь endpoint.componentId/terminal, совпадающие с конкретной PSU клеммой. Поэтому pendingTerminal нагрузки и wirePreviewEnd, уже снапнутый к PSU, всегда дают пустой pending массив для PSU, независимо от правильности конечных координат.

Это достижимое штатное состояние: неизменённый use-electronics-workbench.ts2154–2165 получает target через terminalTargetAt, сохраняет setReconnectHover(target), передаёт target в updateWireDraftPreview. Строки2016–2025 снапят wirePreviewEnd к настоящему terminalPoint. Stage передаёт весь c в psuEntryPresentation, но эта функция не читает уже существующий reconnectHover. Подключённый провод с PSU на обоих направлениях поддержан; arriving pending — нет. Основной pending path рисуется до PSU body, локальный поверх корпуса отсутствует. Это source доказательство отсутствующей ветви; новое browser измерение этого отказа не заявляется.

Минимальный ремонт: использовать существующий canonical hovered terminal для pending destination, сохранив исходный endpoint и точный путь/нетлист/controls. Проверить starting и arriving pending на обеих PSU клеммах, отмену и отсутствие document/history/PUT. Не создавать второй resolver/state. Новый тест сейчас проверяет только starting positive (e2e529–541) и не ловит этот случай.

### R2 / P1 — первичный browser FAIL может потеряться и быть заменён вторичной ошибкой сбора

Exact e2e/electronics-simulation.spec.ts642–660: primaryFailure записывается только в память; затем await psuEntryLocal и await screenshot. Flush происходит позже в finally, причём после незащищённого await Promise.all(responseCopies). Отклонение response.text() или незавершённое ожидание может не дать сохранить первичный отказ/attach и может заменить исходное исключение.

Независимо исполнен именно committed catch/finally в изолированной fault injection, без product/browser запуска: первичный PRIMARY_NATIVE_WIRE_OWNERSHIP_FAIL присутствовал в journal в памяти; flush не произошёл; наружу вышел RESPONSE_COPY_REJECTION; attach=false; fresh.close=false. Оригиналы: e06-psu-entry-new-source-exact-catch-finally.txt, primary-failure-counterexample.cjs/json. Это проверка source failure semantics, не evidence исправленного UI.

Минимальный ремонт: синхронно сохранить primaryFailure/достигнутый checkpoint ДО первого await; secondary collector/attachment/close errors сохранять отдельно и не подменять primary. Flush/attach/cleanup не должны зависеть от успешности всех response copies. Добавить узкую fault проверку именно rejection/незавершённого collector; не ослаблять реальные pupil assertions, trace или timeout.

## Что независимо подтверждено

- Fresh root7bf4722f45d64c1298b3db2d02ba7d6222e4ac62 preflight SAFE_TO_START, выбран E06 /466 in_progress; dirty0, blockers0, worktree overlaps0, remote refresh PASS, control-plane PASS.
- Author manifest SHA e70bf44aa70d010d55f791b4f8669a8eebfa429938d2f035c4dc36bf0e3fd00f: все48 external originals проверены по bytes/SHA256. Author report SHA66b0d4135f12f0061e59831eb44d7cfd27c42c315614ac290c9adb7e3ae96cca также сверён; его вывод не использован как доказательство готовности.
- Actual Git parent/tree/6paths проверены самостоятельно. Все3940 foreign tracked entries побайтово равны parent16; новых/удалённых tracked paths нет. Current/card/owner assets/physics/CSS/Visual/package/workflow/lock сохранены. Новоеmain7bf отличается от16 только тремя startup552 metadata paths; E06 production/card не изменены.
- Все прежние e2e cases/assertions от let admin до EOF и presentation assertions от const stageSource до EOF побайтово равны baseline. Browser-source digest — единственное JSON поле coverage diff; совпадает с SHA256 e2 source17dff1d18692b35f8e1cd37456528269385c91d41230bd8590b63d8eba867e85. Штатный generator/registration/deps не менялись.
- Stage65680B; actual неизменённый reviewed_bytes54879 в evidence/hygiene-baseline.yaml; потолок65854.8B. Порог не ослаблен. Формат/diff-check чисты. Старый предположенный порог62909×1.2 в preparatory plan исправлен, не использовался для verdict.
- Manifested final4 originals: format/lint/web typecheck exit0; три meaningful test файла82PASS. Это проверенные исходные журналы исполнителя, не мой новый прогон/не полный focused gate. Browser type delta сохраняет7 baseline diagnostics, новых нет; full browser typecheck остаётся non-PASS и не объявлен зелёным. Frozen физические зависимости не устанавливались.
- Локальный connected path — prefix настоящего rounded canonical path до первого body exit, с transformed corners; обратное направление поддержано. Обычные wire layers не подняты глобально; PSU front-panel clip исключает existing readouts/controls; настоящий wire.id остаётся один. Wire/component preview обновляют локальные paths/clip и restore; state mutation в новом рендерере отсутствует. Это source проверка, не actual native paint proof.
- Genuine BEFORE viability: новые e2 imports parse/configure/normalize существовали baseline; до первого native click/assert нет обязательного нового helper/testid. BEFORE с одинаковыми e2 bytes и возвратом ровно3production paths к16 должен проверять actual elementFromPoint/selection/PNG, а не отсутствие нового DOM. Фактический production build и исходный native отказ ещё NOT_RUN; новое unit helper import не должен подменять browser failure.
- Позитивные стороны test: полная parser/editor stable fixture до API, independent owner coordinates, whole expected, real login/API/mouse, real CAS revision+1, cookies-only пустой draft и whole equality. Новые120s test не изменили прежние timeout/assertions. Node incremental phase/request/response receipts и native PNG/trace предусмотрены.

## После ремонта, до PRODUCT acceptance

Оспорить не только positive approach: native select/visible pending обеих клемм и обоих направлений; actual voltage/current/power actions и readout shielding; group/component drag clip/path parity; reconnect и Run structural lock. 16 rotate/mirror combos распределены по1440/1024/390/320, но отрицательная клемма сейчас покрыта геометрией/reconnect, а не отдельным native approach selection. Её actual hit/paint нельзя объявлять доказанным этим source review.

До genuine frozen BEFORE не запускать AFTER. Новый source SHA требует нового exact review. Финальные frozen focused/browser/repository gates + NEW independent PRODUCT review обязательны. E06 пересечение корпуса/Arduino/полный466, school frequency/K0/T3/owner acceptance/deployment не приняты. Принятый553, 548 NO_PROVEN_CAUSE/blockers, выбранный552 и чужие кандидаты сохраняются.
