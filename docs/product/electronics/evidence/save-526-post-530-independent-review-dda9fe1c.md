# Независимая проверка №526 / E01 — итоговый состав после принятого530

VERDICT: REQUEST_CHANGES

Проверяемый SHA: `dda9fe1c6956ace5e009b14004fd83b606b8be3a`.
Tree: `46b02ae8707f329d0abf3e9f529d4ea1c94765f7`.
Рецензент новый, не был автором или предыдущим рецензентом этого ремонта. Изменений репозитория, индекса, refs, current.yaml, Issue или установки не выполнял. Отчёт автора использован только как навигация.

## Вход и независимая проверка исходников

Свежий штатный preflight: SAFE_TO_START, current526/in_progress/preserved_r5_final_convergence_after_accepted_530, origin/main c69265688891d3084f59add6d1188813a6764633, dirty0/blockers0/overlaps0, control-plane PASS. Exact card validation114 PASS. GitHub Issue526 OPEN; оба наблюдаемых workflow действительно имеют head_sha dda9, незавершённые jobs не считаются PASS.

Прочитаны root policy, START_HERE, GitHub-first/delivery, Electronics router, HIGH review protocol/AGENT_GUIDE§13, UI acceptance, persistence component map, полная SAVE-RECOVERY card со всеми R1–R5/final composition, точные E01/SAV01–12 owner sections.

Фактический diff16 путей,3746 остальных mode/blob entries byte-equal принятому main.10 чистых R5 blobs byte-equal сохранённому0dd31. Изменение generated coverage относительно обоих родителей — только browserEvidenceSha256; фактический digest simulation совпадает. Независимый TypeScript AST-проход: simulation сохраняет все38 main и44 R5 test bodies byte-for-byte, итог45; interactions все35 main, отличие от R5 ровно ранее принятый BREADBOARD_PROFILE531; mounted Arduino все9 main и5 R5 bodies сохранены. Продуктовые solver/runtime/auth/server/API/schema/dependencies/owner artwork не меняются.

Проверены реальный serial save queue, один in-flight, sixty-second deadline, transient backoff5/10/20/40/60s с quiet recovery без правок, hard-stop automatic retry для auth/conflict/permanent errors; CAS/three-way merge и stale queued snapshots. Scoped account/seat local schema3 с verified server identity, сохранение legacy bytes без adoption, async generation/scope guards; текущая local durability подтверждается read-back текущего документа, другая вкладка может её отозвать. Emergency JSON читает полный текущий document, включая sketch. Отдельно проверены прежние consumers Chess/Checkers и единственный shared persistence indicator consumer Electronics. Header/CSS затронутые состояния требуют фактических56 новых браузерных layout receipts; исходники assertions не заменяют эти receipts.

## Выполненные независимые проверки

- pnpm agent:preflight --scope electronics --check — PASS.
- pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-SAVE-RECOVERY-001 —114 PASS.
- git diff --check — PASS.
- Четыре mapped файловых набора storage/indicator/project-state/mounted Arduino:60 tests PASS, без кэша Vitest.
- Chess/Checkers save-queue:4 tests PASS. Первоначально в команду были включены две несуществующие маски project-state; Vitest реально выполнил только4 существующих набора/60tests. После обнаружения найдены реальные save-queue paths и выполнены именно они,4tests. Не заявляется неисполненная проверка.
- NEW external independent mounted-production challenges:4 PASS. Silent no-op storage сохраняет старые bytes/отзывает current durability; последующий transport failure/retry сохраняет полный latest sketch. Rejected old identity lookup после actor change не трогает новый scope и не отправляет PUT. Непрерывные правки не отодвигают fixed transient retry. Замена local record другой вкладкой не даёт ложного current-copy claim. Первые два запуска external harness не исполнили тестов из-за module aliases; исправлена только внешняя конфигурация, итог4 фактически исполнены, продукт не менялся. Дополнительно проверено качество независимого challenge: исходный первый вариант сохранял произвольное поле arduino, поэтому он не принят за доказательство canonical sketch. Внешний тест исправлен на реальный addComponentToDocument(arduino-uno) и stateProperties.arduinoSource; направленно повторён только этот изменённый challenge:1PASS/остальные3невыбраны, без изменения продукта или основного browser gate.
- Original causal BEFORE local-denial/quiet-recovery JSON прочитан самостоятельно: SHA eb2e44af... /8bcc0ac7... совпадают с контрактом; old quiet interval69 235ms/единственный failedPUT, denied memory166.7 при server50/falsecopy. Повтор BEFORE не запускался.
- Исторический partial R5 ZIP самостоятельно проверен: hash8c5786856d6fefa963ef2fb1265b7e4619a4a7b3a3b71d3ce9ccaf0af229e4a2,147CRC PASS. Не принят за final evidence.

## Оставшиеся обязательные проверки

Обычные General37976875849 и Electronics37976882424 exact dda9, все8 jobs; новые оригинальные full56/denial/schema+sketch/quiet/second-profile/crash/reauth/scope/CAS/departure/fast529 receipts и PNG. До их независимой проверки APPROVE и техническая приёмка запрещены.

## Честные границы

При недоступном localStorage in-memory-only работа не обещает пережить process death. Identity GET→PUT не атомарная привязка HTTP session; сервер остаётся authority, новый серверный протокол этим клиентским ремонтом не создан. Departure keepalive/identity verification best effort; per-edit confirmed local draft — путь аварийного восстановления. Конкретные исторические потерянные школьные работы не восстановлены этим evidence. K0 installed version/full backups NOT_VERIFIED, real school T3/class15+15/owner acceptance/deployment pending. Установка/БД/сеть/backup не затронуты. E04 setpoint persistence не импортирован, текущие document/StopRun semantics сохраняются.


## Итоговый exact-SHA CI — фактически проверен

General37976875849: SUCCESS, все4 jobs Governance113977292435 /Code113977556294 /Data113979149639 /Access113979149700 SUCCESS. Оригинальный general ZIP388863bytes/61CRC PASS/hash15508bc46d7fce803e75fbc45f83d1be270381dca5145a31077741de7740ba4c самостоятельно прочитан.

Ordinary Electronics37976882424: focused113977320732 SUCCESS (633engine+404web,70 fresh Nx), benchmark113978062616 SUCCESS (18fresh Nx), browser113978062685 FAILURE (132PASS/3FAIL/13.2m), review-images113984365198 SKIPPED. Frozen-lockfile/literalNX_SKIP_NX_CACHE=true/Cache skipped подтверждены настоящими logs; dependency-download cache не объявлен Nx evidence cache. Benchmark ZIP10CRC/hash54cf3878c0ed0d338d5da783d8d6f7b2c36a3704749dbf5d4f3ed69eccb3e636 проверен. Не объявляется all8PASS или acceptance.

Новый оригинальный browser ZIP11640780130:67863871bytes/285CRC PASS/SHA256ba4b1ad442381aa5f7f0a9d3422b7877567b70e376da7be6b925f4dd35c02329. Рецензент читал единственный controller-cache, не скачивал повторно.

## Подтверждённое замечание P1 — категория A, текущая CSS-интеграция

`apps/web/src/electronics/workbench.css:4927` — новый общий media1281..1536 `:has(.workbench-simulation-time)` без условия аварийной JSON-кнопки принудительно задаёт normal running toolbar96px. Тем самым меняет ранее принятый normal layout532 при1374px в трёх режимах Text /Blocks+Text /Blocks. Неизменённая проверка `e2e/electronics-simulation.spec.ts:3207` требует normal48px при1374; все три фактических отказа точно здесь, expected48/received96. Новый raw сохраняет1374-running /1374-blocks-text-running /1374-blocks-running с toolbar top48/bottom144/height96. Независимо прочитанные уже сохранённые исходные browser originals принятого530 sourcef373/run37969211551 показывают эти же три phases при1374 и height48. Это реальное сравнение двух оригинальных выполнений, не предположение о main по исходникам.

Визуально просмотрен новый1374-running PNG: кнопка Stop читаема/доступна, page overflow нет; не заявляю доказанную потерю действия ученика или неисправность сохранения. Доказана лишняя строка/изменение принятого compact contract и красный обязательный gate от текущего E01 diff. Нельзя чинить его заменой expected48→96, уменьшением утверждений или слепым rerun.

Требуется отдельный bounded CSS repair: ограничить новые emergency-layout правила реальным затронутым состоянием, сохранить нормальную532 геометрию и readable/clickable emergency JSON+Code/Save/Run/Stop. Предпочтительный causal boundary — только workbench.css; конкретное условие/границы проверяет новый автор на реальном DOM. Не менять persistence/runtime/physics/auth, исходные532/533/530/529 assertions или timeouts. Проверить направленно normal1374 running в трёх режимах и relevant emergency+clock/breakpoints, затем необходимые обычные exact gates и NEW independent review нового SHA. Все уже полученные semantic receipts сохранить; source dda9 не переписывать.

## Новые полные E01 receipts — PASS, сохранены несмотря на общий FAIL

Независимый external checker `reviewer-526-dda9-originals-check.py` прочитал original ZIP/actual JSON:

- Полные56 layout observations:40 breadboard (10widths×normal/error×Run/Stop) плюс16 sparse schematic/BOM (4widths×2views×JSON present/absent). Controller dirty/error truth, local-only warning, quiet/saving visibility, enabled Save, pressed Code/RunStop, actual text bounds/hit targets/no overlap/no page overflow/scene height PASS. Просмотрены оригинальные error PNG1440/1024/390/320.
- Older scoped local bytes остаются неизменны при storage denial; current full schema/sketch emergency download до и после failed PUT полностью равен. Server остаётся50, current166.7 и changed Arduino sketch; ложного local durability claim нет.
- Новый полный56 denial receipt содержит3 failed PUT, все несут ровно current document; intervals5041ms/10065ms соответствуют bounded5s/10s retry во время долгого измерения layouts, не retry storm. Первоначальное собственное derived правило len(requests)==1 было неверным переносом короткой historical partial фазы; остановилось до proof, исправлено только внешнее правило на реальные3/полное содержимое/минимальные5s+10s. Продукт/assertions не изменены, скрытого retry не выполнялось.
- Quiet recovery без правок/online/focus/reload6020ms,2PUT total/1confirmed200, full server document равен whole emergency expected; second independent profile/localnull открывает ту же полную схему и скетч.
- Actual renderer SIGKILL: mark→единственный mapped owned PID/fresh ancestry/no trace loss; observed crash29ms after signal; no pagehide/no safety PUT; полный local→recovered→server document равен,177.7+changed sketch. Убийство процесса выполнено тестом только в зарегистрированном isolated CI, рецензент никакие процессы не трогал.
- Same-actor reauth restores188.8+sketch; late reply/serial departure3requests→333.3+sketch; same-renderer project/account isolation/old bytes unchanged/old editor revoked/no actorB old PUT/403–404 prior projects; real two-tab CAS leaves local666.6/server555.5. Проверены целые objects/raw, не одни заголовки.
- 529 fast browser cases фактически PASS: manual Save130.8ms и genuine departure81.1ms, оба <260ms; исходные test bodies/полные document assertions сохранены.

Новые compact532 raw остановились после52из96 phases; только2 complete intent receipts вместо5. Нельзя выдавать проходящие отдельные E01 receipts за восстановленный полный compact acceptance.533 media и530 native case прошли в ordinary job, но итоговый all8 gate остаётся FAIL.

## Вывод и точка продолжения

REQUEST_CHANGES по одной подтверждённой CSS/acceptance regression categoryA. Новых блокирующих дефектов persistence в проведённом source/challenge/full E01 evidence не обнаружено. Сохранить dda9, original285CRC/raw56/semanticPASS и все старые refs; новый автор выполняет только bounded causal CSS repair, новый независимый рецензент принимает новый exact SHA после необходимых ordinary gates. Рецензент STOP; контроллер продолжает programme452, E01 остаётся приоритетом. К школьной установке/данным/owner acceptance отношение не меняется.
