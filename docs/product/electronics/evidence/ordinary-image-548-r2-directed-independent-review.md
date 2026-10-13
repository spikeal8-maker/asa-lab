# №548 R2 — независимая проверка единственного directed run

**VERDICT: NO_PROVEN_CAUSE. STOP диагностического эксперимента и рецензента.**

| Предмет | Фактический результат |
| --- | --- |
| Canonical selection | TASK-ELECTRONICS-ORDINARY-IMAGE-CONSUMER-FAILURE-001 / Issue548 / R2 existing permanent-case SAME-node observation. Fresh preflight SAFE_TO_START, clean main/HEAD07f0e94f0cf30b535e46a841d0854d3656c567ac, blockers/overlaps0. |
| Source | b16e7a6d3d8796ab14d8a84fa8f83f072a2355d5 / tree c878e86aa780404dcd11e9849510fad901e35177; parent07f0e94f0cf30b535e46a841d0854d3656c567ac. |
| Diagnostic probe | 7af3502c3af3cdf9584d4315bfdc542b7e2e4f0a / tree9cf4bf853a5edadbd9be4c2e2b5499236fd64f20; parentb16. Единственный delta — диагностический workflow. |
| CI exact probe | Run38169594858, job114559222941, attempt1, workflow_dispatch, terminal SUCCESS 2026-10-11T19:51:53Z. Все steps, upload и cleanup SUCCESS. Running1test/1worker; **1passed6.6s**. Это directed observation, не ordinary/full repository gate. |
| Пользовательский результат | В собранном реальном редакторе штатно показаны предупреждения отсутствующего изображения на stage и catalog. Исторический отказ каталога не воспроизведён. Продуктовый recovery repair не выполнялся. |
| Приёмка | Product acceptance/owner acceptance/blocker closure548/553/538/544 НЕ заявлены. Natural passing run не доказывает устранения исторического сбоя. |

## Независимая проверка исходников и исполнения

Я новый рецензент этого run, не автор и не предыдущий source safety reviewer. Прочитаны actual immutable source, canonical card/current, root/entry/delivery/review/UI policy и route. Собственный checker подтвердил parent/tree/scopes и побайтовое механическое соответствие browser job исходной задаче с единственными разрешёнными изменениями name/needs/grep. Frozen image digests/security/isolated PostgreSQL/migration/API/Web/35minutes/cleanup сохранены. Исходный playwright.config retries0 и trace retain-on-failure прежние.

Проверены actual SHA256/bytes всех **50 external и37 Git originals** предыдущего safety review, а не принято на веру его заключение. Собственный TypeScript AST checker независимо сравнил ВСЕ9 исходных assert expressions; route404, quiet800, stage10000/default5000, max7, whole-document/zeroPUT/errors сохранены. Ни одна проверка/ожидание не ослаблена. Предыдущий source approval означает лишь безопасность одного наблюдения.

В actual job log checkout/build/tag/environment относятся к exact7af. Выполнены frozen fetch/install; literal NX_SKIP_NX_CACHE=true. Actual Nx строки 0/6,0/16,0/27 hit(0%): **49 задач выполнены заново**. API/Web healthy; отдельный CI stack затем удалён. Source General38169255507 при финальном snapshot ещё IN_PROGRESS; его PASS здесь не заявлен. Другие gates этим directed run не заменяются.

## Первичные originals

Artifact11713416460, electronics-r4-m1-browser-38169594858, ZIP4258964bytes, SHA25616f29ea602865cafa4419ce0d06bcc13e2e70ad03e3e7f71903fdba3d26f1416. Получен ровно один раз. Все29 ZIP entries прошли CRC; original ZIP и extracted files сохранены. Остальные уже лежавшие e2e/docker evidence внутри архива не выданы за новые сценарии этого run.

Полный Node raw **548-ordinary-primary.jsonl:189 последовательных records**; **141 browser records** полностью совпадают с browser-full-receipt.records и sequence1..141. delivered=produced141, pending0, dropped{}, transportErrors0, observerErrors0; final secondaryErrors/writeErrors[], primaryFailed=false. Original primary-error отсутствует, потому что исходные assertions прошли. Все4 supplements CAPTURED. Attached JSONL — точный prefix полного raw до187; raw188 — квитанция attach,189 — final. Это ожидаемый порядок записи после attachment, а не потеря конца original.

Native PNG1440×1000 просмотрен непосредственно: реальные stage/catalog broken-image presentation с предупреждениями. RootHtml, текущие DOM object identities, network requests/responses и localStorage есть в full receipt. trace.zip/HAR отсутствуют при naturalPASS из-за неизменённого retain-on-failure; trace не выдуман и для его получения повтор не запускался. Полная actual network последовательность сохранена в Node journal, не подменяется отсутствующим trace.

## SAME-node цепочка, которую действительно наблюдали

Все времена ниже performance.now() одного timeOrigin1791748304620.6. Не использовалось сопоставление лишь по URL. Native event trusted=true на подключённом SVGImageElement, ownerDocument/documentRoot=true. Его WeakMap object ID совпадает с actual React currentTarget и последующей ref записью; render-bind связывает function token с конкретным hook ref.

| Consumer / actual IDs | Ref boundary и effect | Trusted native → React → hook delivery | Reject → failed rendering/ref |
| --- | --- | --- | --- |
| Stage battery: node6/root13/document12/hook3/callback15 | ref458.4ms(seq24); effect406.1(seq16), callback15 render-bind456.1(seq20) | native498.7(seq26) → React499.0(seq27) → notify-deliver499.3(seq29) | active/pending true reject1457.8(seq124) → returnedFailed render1459.3(seq130) → same-node failed ref1460.6(seq136) |
| Stage holder: node11/root14/document12/hook8/callback17 | ref458.5(seq25); effect406.3(seq17), callback17 render-bind456.6(seq21) | native500.4(seq33) → React500.6(seq34) → notify-deliver500.7(seq36) | active/pending true reject1458.0(seq125) → failed render1459.7(seq131) → failed ref1460.7(seq137) |
| Catalog AA2: node35/root56/document12/hook32/callback33 | render-bind646.0(seq58); passive listeners attached646.2(seq60), href=null; ref659.6(seq105); effect665.2(seq107) | native759.0(seq108) → React759.7(seq109) → notify-deliver759.9(seq111) | active/pending true reject1458.1(seq126) → failed render1460.1(seq132) → same-node failed ref1460.8(seq138) |

Catalog selectedVariant battery-holder-aa-2, exact aa-2.svg, final statusfailed на том же node35/root56. Callback после rerender меняется: финальный67 связан render-bind132 с hook32 и ref138 с node35; старый ref(null) не истолкован как cleanup. Notify-queue/early-replay не наблюдались: все3 native error пришли после соответствующих effect и текущих ref. Это положительная штатная цепочка только данного run, не причина старого отказа и не опровержение возможного раннего window.

## Старые assertions и сохранность схемы

Final checkpoint original-case-all-assertions-complete достигнут. Наблюдён quiet817ms вокруг прежнего800ms ожидания. Ровно7 image GET, все404: два plain asset GET, image-retry0/1/2 в cycle1 и mask-retry1/2. Requests/response IDs сохранены; соответствие конкретного HTTP request конкретному DOM object не выдумано. Отдельного GET200 в этом run нет. Count7/max7 и quiet равенство прошли.

Сравнены целиком исходная schema4 fixture, initial, final mock-server document и supplemental editor document: **все равны**,5components/все поля сохранены. PUT0; pageerror0. LocalStorage содержит4 прежние Arduino UI settings, draft keys нет.7 console error — ожидаемые image404, они не названы pageerror. Это настоящий built frontend с прежним openEditor helper, **API маршруты перехвачены UI fixture**; реальная persistence/auth/cookies/server-save проверка этим тестом не доказана.

## Пределы и дальнейшая граница

Ref callback — diagnostic boundary, не весь React commit. ordinaryReactCommitObserved означает EVER-ref WeakSet, а не последнюю commit; порядок выше выведен из реальных sequence и matching callback/hook. Mutation timestamps — observer delivery. Matching URL/detached node/HTTP200 не определяют clone origin; cloneClassification остаётся NOT_INFERRED. Instrumentation/binding/synchronous journal overhead ненулевой и не измерен; школьная частота поведения не доказана.

Внешний reviewer checker дважды потребовал локальной правки reader: не все Node values являются dict; attachment является prefix до финальных двух записей, а не полным raw. Исправлены только внешние readers; исходники/CI/browser не менялись и не повторялись.

**Новый продуктовый дефект не доказан, минимальный product repair из этих originals обосновать нельзя.** Повтор того же сценария, новый Search/CPU/timing stimulus или broad suite в надежде на отказ не разрешён этим результатом. Контроллер сохраняет точные originals/NO_PROVEN_CAUSE и отдельно выбирает допустимый следующий bounded шаг; независимые задачи может продолжать по своим dependencies. Новое доказанное локальное нарушение потребует отдельного repair и новой independent final acceptance.

Repository/product/current/Issue edits, commit/push/dispatch/rerun/install/service/school/DB/network/backup/deployment actions мной NONE. Локально выполнен read-only preflight и собственные external source/AST/original proofs; fresh local Nx0, CI Nx49. Чужое дерево clean и сохранено.

**NO_PROVEN_CAUSE. STOP.**
