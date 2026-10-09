# Независимая проверка №530 — финальный кандидат 31dfcbbd

VERDICT: REQUEST_CHANGES

Проверен один SHA: `31dfcbbdbb88219f69532cee2abc8479c2236772`, tree `644e33153a0e0c05360e3fb0a5eba0d7b7d8c51b`. Наблюдение GitHub: 2026-10-09 16:57:28 UTC. Это независимый reviewer, не автор изменения. Авторский отчёт и производные root summaries доказательствами не использованы. Продукт, индекс, execution state и школьная установка не изменялись.

## Обнаруженное препятствие

Обязательный ordinary browser gate красный: 127 PASS / 1 FAIL, 12.2 минуты. Отказ — сохранённый сценарий №532 `text — desktop-compact`, фаза `981-native-open`, `e2e/electronics-simulation.spec.ts:3237`. В `record()` строка 3219 вызывает `assertFits` для Code controls; строка 3151 требует принадлежности всех пяти точек каждому underlying control, включая точку, занятую открытым меню провода.

Это доказанное несоответствие протокола проверки временному перекрытию popup, непосредственно проявившееся после правильного изменения слоя №530. Дефект недоступности продуктового действия не доказан. Нельзя объявить приёмку при красном обязательном gate; также нет основания переписывать CSS или создавать очередной продуктовый dependency repair.

Точные оригинальные сведения:

| Объект | Фактическое значение |
| --- | --- |
| Открытое меню | left346, top94, right450, bottom166; toolbar z-index46 |
| Code drawer | left420, top144, right981, bottom900; CSS z-index45 |
| Code mode summary «Текст» | left430, top151, right588, bottom187 |
| Единственная не принадлежащая summary точка | x433, y154, owned=false, hit=`SPAN.` |
| Остальные точки summary | Все четыре owned=true, включая центр509,169 |
| Purple в native receipt | left416, top132, width28, height28; все пять точек принадлежат Purple button |

Проверяющий открыл оригинальный `981-native-open.png`: открытый popup временно перекрывает только левый верхний угол selector «Текст». Независимое чтение PNG стандартной библиотекой подтвердило RGB пикселя (433,154) = (141,69,199), точный цвет Purple span из production DOM. Эта точка находится внутри Purple и menu; по исходному JSX span принадлежит соответствующему `menuitemradio`. Получается один физический пиксель, которому тест одновременно требует принадлежать верхнему popup и расположенному под ним Code summary.

Оригинальный trace независимо проверен по CRC/SHA. Evaluate `call@2318` получает фазу `981-native-open` в 142215.877–142232.260 ms; screenshot `call@2320` начинается в 142249.686 ms, snapshot в 142254.776 ms, заканчивается в 142326.352 ms. Между измерением и изображением нет действия указателя. Это непосредственное состояние во время отказа, не вывод из последующего teardown. В предшествующей `981-stopped` все Code hit points принадлежат своим controls. В отдельном native сценарии обычный Purple click закрывает popup; full Code-controls receipt после закрытия в прерванном №532 ещё отсутствует.

## Ограниченное требуемое исправление

Новый отдельный bounded author исправляет только проверку и canonical generated digest. Production CSS №530 и принятые №532/№533 сохраняются.

- Сохранить все исходные 95 фазы и проверки №532, все 128 сценариев, текст, геометрию, clipping, viewport и физические/runtime assertions, прежние deadlines и обычные pointer actions.
- Только при реально открытом native popup различить владение точкой верхним меню и владение неперекрытыми точками underlying control. Подтвердить конкретное меню через DOM hit ancestry/фактические bounds; произвольный посторонний hit остаётся FAIL. Не удалить общий ownership assertion и не разрешать любой `SPAN`.
- Положительно проверить menu/Purple hit ownership при открытии; после обычного закрытия снять новый raw receipt полной доступности всех Code controls, затем выполнить существующие реальные font/Run/resize действия. Все закрытые состояния должны сохранять строгую принадлежность всех точек своим controls.
- Новый конкретный SHA требует направленной проверки этой доказанной причины, обязательных ordinary exact-head gates, полного итогового UI evidence и нового независимого reviewer. Повтор всего неизменённого кода в надежде на зелёный результат не обоснован.

## Независимая проверка scope и сохранности

Preflight был SAFE_TO_START: canonical `TASK-ELECTRONICS-WIRE-MENU-LAYER-001`, in_progress, checkpoint `final_convergence_after_accepted_531_532`; root HEAD/main `d2738e42387ba4a2f6cbd04c27d9744c4dc50ab9`, dirty0, blockers0, overlaps0, control-plane PASS. Прочитаны root policy, router, task card, UI layout acceptance и review protocol; новое поручение владельца 6084548550 прочитано непосредственно в GitHub.

GitHub независимо подтвердил source/tree и обычных родителей `7f8869907995a9ea79c784e26247ddad5f0185d0` + выбранный main d2738e4. Exact remote task ref остаётся 31dfcbbd. Последний наблюдавшийся main `880bd51297edec0dc064001977c3165e4ac6cafc` содержит отдельно принятый guard536 и controller docs; относительно выбранного main изменены только router, validator/tests, execution state, cards и review536. Это не новый принятый SHA №530; этот отчёт не одобряет будущую композицию.

Независимое сравнение tree mode/blob против d2738e4: ровно три изменённых пути; остальные 3746 записи идентичны. CSS — только семь строк open-only parent layer46 при min-width981; drawer45 и handle120 внутри drawer подтверждены исходником. Закрытое меню и mobile≤980 не затронуты. Настройки, runtime, persistence, Arduino, auth, owner assets, зависимости и workflows неизменны.

Изъятие добавленного 196-строчного native case возвращает весь прежний simulation source байт-в-байт, включая все 127 текущих сценариев №532/№533 и остальных. Добавленный case байт-в-байт равен сохранённому 87099554; SHA256 `1260d5173a44542edac55adc2e1e8aee5025dd9a9af6d8a3a2797e88e1b383fb`. Canonical browser SHA256 `44666220ec8387b93792115d484585e6968f7500631d447ae6155eaf0397c81f`; все остальные parsed generated JSON поля deep-equal. Diff whitespace check PASS. Отдельный guard536 не требует повторения browser только из-за движения main; его изменённая governance композиция должна проверяться своим gate, без объявления старого CI проверкой нового merge SHA.

## Фактический exact-head CI

| Run / job | Conclusion |
| --- | --- |
| General37959804343 / Governance113919450028 | SUCCESS |
| General / Code113919926981 | SUCCESS |
| General / Data113921367678 | SUCCESS |
| General / Access113921367727 | SUCCESS |
| Electronics37959807372 / focused113919468438 | SUCCESS: 633 engine + 384 web tests |
| Electronics / benchmark113920383677 | SUCCESS |
| Electronics / browser113920383568 | FAILURE: 127 PASS / 1 FAIL |
| Electronics / review-images113926353127 | SKIPPED после browser failure |

Оба workflow фактически относятся к 31dfcbbd. Ordinary focused log показывает 70 свежих Nx задач, benchmark18, browser image builds49, cache hits0; буквальный `NX_SKIP_NX_CACHE=true` и frozen dependencies подтверждены workflows и оригинальными логами. Успешный focused не заменяет browser. General conclusions проверены непосредственно GitHub; полный General log повторно не скачивался и подробные его внутренние counts здесь не заявляются. Локальная временная ошибка старого 697-assets hash test не повторилась в actual ordinary focused; она не обосновывает изменение продукта или timeout.

## Оригинальные браузерные доказательства

Кеш: `C:/Users/spike/.codex/temp/electronics-e01/31dfcbbd-ci/run-37959807372/`. Проверяющий читает оригинальные ZIP members, а не пересказ root.

| Оригинал | Bytes / SHA256 |
| --- | --- |
| browser-job-113920383568.log | 275963 / `866d1a6980c96e74256fad1f5b8b4152ce818b1b950eed2b778b8c15052e4db6` |
| browser-artifact-11631760830.zip | 49890767 / `8e08a6b3cd3c46a318eb5e49851c1297e75d0222dd71593c4c50276163f6e298` |
| failed compact trace.zip | 16403479 / `ae1a87ff75a6955d2bbd47a1dd05783249f3b480d0af8fda4d177a391cd02fa8` |
| focused-job-113919468438.log | 105680 / `2d8da6025dd877180e46563ef9e49a9f7ba595f4e9eb58e20da7b9deeedd09d2` |
| benchmark-job-113920383677.log | 137823 / `7c471cf59b05bec9e1786abc3390e1ccff08f4fb6ceefaa7b019fe8478d30ce2` |

ZIP имеет 269 members, CRC PASS, безопасные member paths; nested failed trace CRC PASS. Passing native case не обязан иметь trace при retain-on-failure, его raw geometry/PNG и фактически исполненные assertions доступны.

Native №530: все 16 оригинальных фаз численно проверены независимо. Обычный trial+реальный Purple click проходит на1440/1024/981, checked=false→true, popup open→closed, menu/Purple bounds и пять actual hit points корректны. Desktop resize изменяет реальную ширину/aria на−32 как с открытым меню вне popup, так и после закрытия. Mobile980/390/320 сохраняет локальный scroll, нет page overflow, Code доступен, обычный жест действительно увеличивает panel height. Case PASS6.2s. Самостоятельно визуально открыты original PNG: failed981-native-open; native1024-before-purple,981-after-purple,1440-open-before-resize,1440-after-open-menu-resize,390-mobile-after-resize,320-mobile-after-resize.

№532: сохранены 90 из требуемых95 raw observations: wide18, compact20 из25, mobile9, mixed24, blocks19. Проверены отсутствие page overflow, расположение/body, full primary caption, text rectangles, control bounds, font text fit и ownership. Единственное ownership нарушение среди этих90 — описанный угол summary при981-native-open. Четыре из пяти intent receipts полны: server draft document/revision/updatedAt deep equality до/после, revision2→2, localBefore/localAfter null. Null означает отсутствие local draft, а не mounted snapshot. Compact case прервался до последнего receipt и пяти оставшихся фаз; поэтому полные95/пять receipts не заявляются.

№533: оба фактических media case PASS5.4s; по семь фаз, usable controls, четыре hash-verified local200 и четыре304 с соответствующим ранее проверенным200/URL/ETag/time. Observer errors пусты. Оба полных server drafts равны до/после zoom/reopen, revision2→2, local snapshots отсутствуют. Принятый media продукт не переписан и нового media defect не найдено.

## Граница результата

Требуется только доказанный bounded test-protocol repair, новый точный SHA и новый независимый review. №530 пока технически не принято, review-images отсутствуют, полная итоговая №532 regression не завершена. №526 и её сохранённый кандидат не изменены; после принятия исправленной зависимости контроллер должен продолжить приёмку E01. Это не закрытие какой-либо из14 жалоб, не owner acceptance и не проверка школы. K0, T3 и класс15+15 остаются отдельно ожидающими; deployment/DB/network/backup действий не было.

NEXT_ALLOWED_TASK: STOP / CONTROLLER BOUNDED REPAIR
