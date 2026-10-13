# №552 R2 — новый независимый SOURCE review

VERDICT: REQUEST_CHANGES. EXACT_SHA: b813d82b9be32747efeafd3ffe7af87e3e093374. TREE: 4cbfba07e7e99d9a503bd4f7171500b84a62b435. Это source/evidence review, не PRODUCT APPROVE и не техническая приёмка. NEXT_ALLOWED_TASK: STOP.

## Фактический вход и независимая проверка

Read-only preflight electronics-startup выполнен лично: SAFE_TO_START; selected TASK-ELECTRONICS-AUDIO-STARTUP-BARRIER-001/in_progress, checkpoint r2_owner_approved_final_composition_new_exact_review; root HEAD/origin main 16a901b9f9eaeea48bd02abc3d8692ddab4d42e7; dirty0, execution blockers0, overlap0, control-plane PASS. ELECTRONICS-552-PIEZO-CLOCK-553 остаётся acceptance_blocker; independent_source_review разрешён, integration/closure ещё запрещены. Remote ls-remote лично подтверждён. Кандидат committed/unpublished; actual GitHub workflow_runs для b813 — 0. Main General38176028705 в snapshot21:36:18UTC: governance/code/data SUCCESS, Access in_progress; незавершённый run не объявляется PASS кандидата.

Лично прочитаны root policy/START/workflow, Electronics router/component mapping/card R2, review protocol, layout contract, AGENT_GUIDE §§2/5/6/11/12/13, README MATH-8 и owner E12. Product layout impact none: hook не меняет DOM/CSS/text. Школьная установка/T3/класс/owner acceptance отложены; действий с ней не было.

Независимый checker прочитал все45 external originals и25 Git originals из author manifest, сравнил полные bytes/hash/entry; дополнительно12 физических package.json realpath/versions/bytes и installed lock равный tracked frozen lock. Отчёт исполнителя не использован как доказательство вместо этих данных. Narrow author logs/readable commands действительно соответствуют7 discovery, format/lint/web/browser types; browser/full gates в этом запуске не выполнялись. Независимо проверены tree/parents, все3942 foreign mode/type/blob/path, точные6diff paths, три exclusive source blobs равные29f5, одобренные package/map и whole-file inverse, единственная автоматически добавленная workflow строка. current.yaml, карты задач, accepted553/554, lockfile и чужой E06 source не изменены. Scope/composition PASS.

## Единственное обязательное замечание P1: built regression не различает исправление

Файл e2e/electronics-startup-audio.spec.ts, exact b813, строки451–457,680–737,767–782.

Native AudioContext/resume Proxy честно вызывает оригинал и возвращает ТОТ ЖЕ native promise. Но записывается только resume-invoked: нет settlement/rejection observations и проверки pending native promise в момент настоящего Worker preflight. runStop проверяет eventual running/LED/ready(0), whole Save и intentional delay, без отношения к settlement. Шесть natural cases прямо объявляют nativeCharacterizationOnly:true и conditionalPendingEvidenceIsSeparateMountedTest:true. Седьмой tone case проверяет native PCM/noTone/Stop, но не исходный startup barrier. Поэтому все7 built BEFORE могут пройти со старым await; green characterization не является регрессионным BEFORE/AFTER.

Это подтверждается actual reachable source: use-electronics-workbench.ts:447–459 перед toggleSimulation делает await unlockPiezoAudio. Main hook:30–36 содержит await native resume, candidate hook:30–41 только запускает resume().catch и возвращает. При уже running native context путь resume не выполняется ни в одной версии. При быстром resume обе версии могут дать eventual ready/LED и удовлетворить всем существующим built asserts. Старые mounted7 доказывают условный механизм в jsdom, но не выполнение этой границы в собранном браузерном продукте. Нельзя тратить built BEFORE только в надежде получить случайный timeout.

## Минимальный отдельный bounded TEST-ONLY repair

После формального выбора R3 разрешить новому автору только e2e/electronics-startup-audio.spec.ts; весь product hook/unit/approved composition/553/554/foreign bytes сохранить. Существующие strict7 cases/таймауты/fixtures/assertions/PCM/whole Save/CAS/cookies и incremental FAIL preservation не ослаблять.

Добавить пассивные наблюдения settled/rejected ТОГО ЖЕ native resume promise с contextId и Run/order, не заменяя возвращаемое promise, native AudioContext/Worker/physics/результат. Обработчики наблюдения должны потреблять собственную ветвь rejection без изменения product semantics. Получить достижимый suspended native context посредством настоящего native suspend() после обычного cold Run/Stop и подтвердить его фактическое состояние; затем настоящий trusted warm Run. Сохранить native invocation/settlement, request identity и фактический pending/settled state непосредственно на реальном preflight postMessage. Сам факт вызова suspend ещё не доказывает нужный порядок.

Нужен дискриминирующий oracle: canonical Worker preflight выбранного Run отправлен, пока именно этот реальный native resume promise ещё pending. Actual старый await не может удовлетворить такой проверке; новое поведение должно быть доказано реальными originals. Дополнительно подтвердить complete finite/quality ready(0), реальный LED и отсутствие runtime-save/повреждения документа. Не требовать, чтобы LED успел загореться до короткого settlement: это отдельная, не доказанная длительность. Не вводить fake/deferred promise, replacement audio, autoplay flag, задержку/таймер в продукте, поддельный Worker или физический кадр. Никакого увеличения timeout.

Предложенный native suspend/warm путь — кандидат направленного свидетеля, а не утверждение о поведении Chrome/runner. Автор обязан проверить actual reachable call/order и обосновать этот oracle ДО expensive CI. Если native resume пропущен/settled раньше Worker в обеих версиях, честно NOT_DISCRIMINATING; не выдавать PASS за исправленный prolonged pending, не делать повторные hopeful runs. Это проверка условного startup admission; она не доказывает школьную частоту или продолжительный LED stall. После нового exact SHA нужны новый independent SOURCE review, одинаковый frozen built BEFORE/AFTER с ожидаемым конкретным отказом старого порядка, финальные обязательные gates и НОВЫЙ PRODUCT review.

В том же test-only файле допустимо привести historic metadata currentPiezoClockAdmission:KNOWN_INDEPENDENT_BLOCKER_NOT_REPAIRED_HERE (строка953) к факту: prerequisite553 уже принят; это не просьба переделывать553.

## Остальные challenge-проверки

Лично исполнил15 направленных контрпримеров к фактическим extracted assertFrames/evidence функциям этого SHA, с настоящим установленным Playwright expect/TypeScript, без запуска продукта/браузера. PASS ожидаемых результатов: same-generation rounded complete projection принят; wrong worker/request/session/generation, yielded-as-LED, incomplete ready, quality failure, wrong projection, cancel/terminate-before-publication, untrusted gesture, duplicate matching request отвергнуты; предыдущий complete ready перед более поздним yielded корректно принят. Это проверка оракула, не product evidence.

Node primary failure сохранён синхронно в отдельный файл до optional await. Контрпример с навсегда pending async raw-write доказал, что finish(primary) не ждёт supplements/attachment, возвращает тот же primary error и уже содержит incremental originals/lastCheckpoint. Failure filename отдельный, поэтому старый async raw write не перезаписывает primary originals. Success captureErrors не превращаются в PASS. Реального нового browser FAIL/PASS/trace здесь нет и не заявляется.

Product diff соответствует заявленному минимальному механизму: сохраняет API Promise<void>, native gesture invocation, constructor/synchronous failure propagation к caller catch, локальное consuming asynchronous rejection. Late completion не содержит continuation, запускающего голоса; unchanged effect/Stop/unmount управляют voices. Нового продуктового дефекта по source не доказано. REQUEST_CHANGES относится к отсутствующему built regression witness, а не к необходимости переписать product.

## Осталось и STOP

Не выполнены genuine discriminating built BEFORE/AFTER, exact b813 full focused/browser/repository CI и NEW PRODUCT acceptance; blocker не снят. Ремонты №553/554 и E06 не затрагивать. Original E12 school cause/frequency/incident fixture, physical speaker/T3/class/owner acceptance не доказаны. Школа не тронута. Ни push, dispatch, browser, install, service, index/ref/current/Issue mutation, ни следующий repair этим reviewer не выполнялись. STOP.
