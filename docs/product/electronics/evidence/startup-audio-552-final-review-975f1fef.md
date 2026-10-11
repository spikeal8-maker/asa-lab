# №552 — новый независимый PRODUCT review окончательного 975f1fef

**VERDICT: REQUEST_CHANGES. Продуктовая приёмка и интеграция запрещены.**

Точный HEAD `975f1fefb9f54c9b418e12cca50aaa5afe866f2e`, tree `0f07f611f11400a93e918ee8c6928b4ee3ed5fb8`, родители7bae+85675. Проверено самостоятельным read-only reviewer, который не участвовал в реализации или прошлых reviews. Отчёт исполнителя не использовался как доказательство поведения.

## Подтверждённые замечания

### P1 / A — новые552seed labels создают невалидные credentials до запуска продукта

`e2e/electronics-startup-audio.spec.ts:953–955`. В двух новых ordinary cases (natural immediate-high1440 и intentional-delay1440) передан длинный label. Неизменный `seedTeacher` в tests/portal/helpers.ts строит `ws-${label}-${unique}` и обрезает до60символов. Оба фактических POST/api/auth/login из сохранённых native traces содержат workspace60, оканчивающийся `-`; фактический `isValidWorkspace` из contexts/identity/domain/validation.ts отвергает оба значения. Email проходит тот же actual validator, пароль непустой. LoginUseCase возвращает validation_error до tenant/password lookup; controller переводит его в400. Реальный HTTP400 записан в trace. Ответ body в trace отсутствует; он не выдуман. Причина воспроизведена извлечённой actual функцией на сохранённых payload, без повторного браузерного запуска.

Нужно отдельным bounded repair изменить только новые552seed labels, сохранив короткий полный уникальный suffix штатного seedTeacher. Названия восьми кейсов, fixture, все физические/LED/native/Save/CAS/cookies проверки, defaults и timeout сохранить. Не чинить Auth, не менять shared helper и не допускать невалидный slug в продукте. Проверить все формы label, включая двузначные worker/counter; новый точный SHA и новый independent review обязательны.

### Независимый baseline C — старый clock observer требует события, которое корректный integer text не обязан создавать

`e2e/electronics-simulation-time.spec.ts:181` ожидает fractional committed horizon среди *text-change* publications. Сам observer около136 пишет запись лишь когда integer formatted text меняется. Actual failed390raw содержит42complete ready,37fractional ready и корректные тексты00:00:00,01,02,03,04; четыре обновления текста привязаны ровно к1/2/3/4миллионам микросекунд. Predicate возвращаетfalse все5000мс, хотя расчёт и целое отображение идут правильно. Этот файл, header, controller и physics byte-exact main85675. Продуктовая регрессия здесь не доказана.

Это отдельный ограниченный ремонт test observer/evidence, не расширение552. Сохранить старую приёмку clock/product, не увеличивать5000мс, не возвращать десятичное время и не менять solver/cadence ради случайного fractional text-change. До устранения и новой независимой проверки это acceptance blocker общего browser gate. Сам reviewer ничего не исправлял и не назначал следующую задачу.

## Exact CI и сохранённая проверка

- [General38181607447](https://github.com/spikeal8-maker/asa-lab/actions/runs/38181607447): exact975/attempt1/SUCCESS, governance114595173509, code114595432211, data114596294319, access114596294357 всеSUCCESS. PostgreSQL full3528tests+16RLS проходят; cached PASS не заявлен.
- [Electronics38181611589](https://github.com/spikeal8-maker/asa-lab/actions/runs/38181611589): exact975/attempt1/FAILURE. Focused114595188889 иbenchmark114595761737 SUCCESS; ordinary browser114595761847155PASS/3FAIL; review-images114598646973SKIPPED. Нет готового review image результата. Новый code/gate не перезапускался.
- Канонические команды, frozen lock иNX_SKIP_NX_CACHE literaltrue проверены в actual workflow/log. По сохранённым полным green joblogs подтверждены270fresh Nx tasks: code112/data43/access27/focused70/benchmark18; cache hits0. Полный failed browser joblog не понадобился: скачан только failed-step fragment, поэтому число Nx tasks внутри browser build здесь не заявляется. Последующие fixture@ reporter errors после155/3 не являются доказанной причиной этих трёх отказов.
- BrowserZIP11717859320 скачан один раз174682819B, SHA256b3e8653ec62c9cb59d2038d167abbeec899c522d198ab3688c3e2e890f834c64;497outer/1805nested CRC и все member hashes проверены. BenchmarkZIP11717628316 и GeneralAccessZIP11717599994 сохранены однократно. Большие review image archives отсутствуют/skipped. Старые BEFORE/AFTER ZIP повторно не скачивались.

## Что фактически работает в узком552

Actual source: только native resume settling исключён из startup prerequisite; синхронное native creation/resume остаётся в доверенном жесте, async rejection локально обработан, public Promise API/caller catch сохранены. Нет caller/controller/solver/Arduino/physics/timeout/lockfile/security/asset изменений. Six552source paths byte-exact7bae; остальные3944entries byte/mode/blob-exact main85675. Package/map совпадают с точными одобренными владельцем proposals. Current/E06/foreign refs и acceptance blocker сохранены; layout-impact none.

Фактические directed originals independently перечитаны: BEFORE invocation28→callback29→preflight31 FAIL; AFTER suspended28/trustedRun30/invocation32→preflight33→callback35 PASS. Same native promise/context и immutable at-postMessage snapshot проверены. Actual source внутри trace совпадает с финальным975. Whole trace API payload/response seed1→2 и единственный pupil Save2→3, fresh cookies-only context/empty draft keys/whole server reread проверены; cookie значения не публикуются. 48BEFORE+54AFTER+12author external originals и21+21+27Git originals independently hash/byte verified.

В полном ordinary975 новые552cases6/8PASS. На оставшихся пяти schema4 journeys самостоятельно соединены103advance frames:90ready requested=committed/finite/quality,13yielded сnullresult;16положительных LED publications имеютmatching complete ready активного worker/generation/session. Пять полных Save/CAS2→3 меняют только resistor220→333.3, runtimePUT0, cookies reopen сохраняет весь документ; два failed cases даже не вошли в редактор и не считаются проверенными. Intentionaldelay390показываетHIGH только после250000modelµs. Actual native suspend admission прошёл также в ordinary975. Tone даёт два native4096-sample окна1001.293945Hz/RMS≈0.01974 с progressing context, затем noTone иStop RMS0; whole tone draft неизменён. Headless PCM не доказывает школьную слышимость.

Собственные29meaningful challenges извлечённых actual oracles/evidence/hook PASS: actual AFTER допускается/actual BEFORE отвергается; wrongnativeidentity, preobservedsettlement, stalegeneration, yielded/incomplete/failedquality не принимаются; первичный FAIL сохраняет identity/синхронный Nodeoriginal, cleanup reject/hang/throw его не маскирует; incomplete supplement не становитсяPASS. Mounted pending/reject/syncfailure/Stop/unmount evidence actual originals перечитаны; focused на точном975 самостоятельно подтвердил7mountedPASS. Четыре native final PNG и два directed PNG лично просмотрены; никакого общего visual/school acceptance не заявляется.

## Ограничения и безопасная передача

Доказан conditional startup barrier и native callback order, не внутреннее Promise состояние, продолжительный natural pending, полная исходная E12 жалоба или школьная частота. T3/класс/школьная установка/owner acceptance pending по решению владельца. Repo edits/push/dispatch/rerun/install/services/DB/network/backup/deployment0; исходники и рабочее дерево сохранены чистыми. Unsupported CLIflag при первом log command был отвергнут до получения0байтов: отдельные zero-byte partial/receipt сохранены, затем corrected --log-failed один раз скачал оригинал. Это исправление команды чтения, не повтор CI.

Следующий шаг контроллера — выбранный bounded test-fixture repair552 плюс отдельно выбранная baseline observer dependency, точные gates и новый reviewer. Старые product/directedsuccess сохранены, но не подменяют приёмку изменённого SHA. Независимый reviewer на этом завершает ровно свой срез.

NEXT_ALLOWED_TASK: STOP.
