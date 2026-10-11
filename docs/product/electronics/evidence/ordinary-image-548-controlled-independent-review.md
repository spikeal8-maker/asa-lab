# №548 — независимая проверка контролируемого позднего подключения каталога

## Вердикт

**CONTROLLED_ORDER_READY_NO_PROVEN_PRODUCT_OR_FIXTURE_REPAIR.** Диагностический source пригоден, требуемое фактическое окно получилось с первой и единственной попытки. Неизменённый продукт в этом окне корректно показал ошибки всех трёх потребителей. Поздний mount каталога сам по себе не является достаточной причиной сохранённого отказа. Причина intermittent failure пока не доказана; это не product APPROVE, не закрытие №548 и не снятие blockers №538/544.

SOURCE `2382badba66fee795ee306685eb01a4e06d6efe9`, tree `f624d6b3450bc7fa36aad5b93ccfd2446a5a0358`, parent canonical main `0fb17bd9ce02eef510c5249f63a4016e27b53e86`. Directed probe `7adc80ff1830a14523b0c5e68ba75d435c469c2e`, tree `a7b1b1eca4d9b8715b33d09249d1e362b880b589`. Run [38120687997](https://github.com/spikeal8-maker/asa-lab/actions/runs/38120687997), job114414612168, attempt1, terminal SUCCESS, один старый case PASS за4.4s. Ordinary Electronics, focused unit и General на этом source не запускались и здесь не заявлены.

## Самостоятельная проверка source и scope

Собственный readonly preflight до чтения кандидата: SAFE_TO_START, canonical main/HEAD0fb17bd9, selected548/in_progress/controlled_late_sidebar_native_ingress_experiment,0 dirty/overlap/blockers, control-plane PASS. Прочитаны root/start/delivery/GitHub-first/router/card, mapped asset/persistence entry, AGENT_GUIDE §§11–13, review protocol, saved causal report и точные production lifecycle/snapshot symbols. Saved causal report SHA256 f4e14370c6acab73747b1ffcdab47ae39c27c9721acb8b32c48e25e0b6b3e299 совпал; все6 originals его manifest сверены независимо, старый trace CRC64 PASS. Старый observer PASS не переобъявлен ремонтом.

Actual Git/source: ровно e2e/electronics-interactions.spec.ts,3881 foreign mode/blob entries exact parent, весь prefix/suffix вне одного case побайтно exact. Собственный TypeScript AST подтвердил **9/9** исходных expect statements, оригинальный404 image route,800ms wait; новый timeout отсутствует. Stage10000, catalog default5000, max7, whole document,0PUT/errors сохранены. Checkout автора CLEAN. Проверены все14 author originals по actual bytes/SHA; его отчёт не принят вместо этих проверок.

Вручную проверен причинный дизайн: route удерживает только настоящий lazy sidebar script, после actual retry0 cycle1 image404 делает route.continue; promise не ожидается до goto, Stage вне sidebar Suspense, finally снимает gate. Нет product observer, runtime/Image/fetch/clock monkeypatch, synthetic event, dependency/CSS/owner-art/current/card изменения. Independent source-ready сообщён контроллеру **до dispatch**.

Probe отличается только diagnostic workflow. Самостоятельный YAML inverse: browserjob environment/security/frozen builds/DB/cleanup/35min и10 declared source steps exact кроме name/command; needs удалён, посторонние jobs отсутствуют. Global trigger/env/concurrency exact. Setup/post добавляют runner steps; их нельзя называть12 canonical source steps. Полный tree inverse source→probe подтвердил все остальные3881 entries exact. Этот workflow не ordinary gate.

## Фактический порядок и native результат

Порядок заново вычислен из originals, не принят по receipt outcome:

| Событие | Epoch milliseconds |
|---|---:|
| retry0 cycle1 image404 response | 1791703000142 |
| sidebar script200 response / finished | 1791703000171 |
| connected catalog image ID3 added observation | 1791703000199.9 |
| ID3 trusted native error | 1791703000253.7 |
| retry2 cycle1 image404 response | 1791703000983 |
| тот же ID3 получил data-owner-image-status=failed | 1791703000984.7998 |

Gate был действительно held до retry0, освобождён reason=retry0-response, sidebar original script завершён до terminal retry2. Browser performance.timeOrigin+atMs и Node response times согласуются с достаточным промежутком; MutationObserver фиксирует доставку batch, а не точный внутренний React commit.

Три стабильные SVG image identities:1 stage battery,2 stage holder,3 catalog battery-holder-aa/variant-aa-2. Все три получили trusted connected native error; каталог — после своего added observation, пока общий cycle1 pending. Все три затем на **тех же identities** получили failed attribute; removals/replacements отсутствуют. В full final DOM три accessible owner-image-error badges. Final images по-прежнему connected/original href/failed. Native load успех не выдуман; источник постоянно404.

Все9 исходных assertions достигнуты и PASS, в том числе800ms quiet/max7. Whole initial/server/editor одинаковы целиком: schema4,5components,0connections.0 draft PUT,0 pageerrors, localDrafts{}. Это сохранность именно полного fixture, не только нескольких выбранных полей; Save/reopen не исполнялся, поскольку case обязан не изменять документ и не отправлять PUT.

## Network, CDP и границы атрибуции

Ровно7 GET/image404 целевого SVG: два original requests, три image-retry0/1/2 cycle1 и mask-retry1/2. Плюс один sidebar GET/script200. Все8 requests имеют actual response и finished, без failed.0HEAD,0Fetch и0 отдельного asset200. CDP supported, сверены все8 request IDs с matching response/finished:7typeImage/404,1typeScript/200. Initiator sidebar — script stack из SchematicEditor/index; у5image requests typeparser с document URL/line317, у terminal image/mask retry2 — other. Эти initiators **не** доказывают конкретный React recovery branch и не дают точной DOM identity каждому network request.

У всех8 CDP originals loadingFinished.timestamp меньше responseReceived.timestamp; события сохранены без исправления. Поэтому внутренние CDP timestamps не используются для утверждения response-before-finished. Actual Playwright event order/finished и независимые browser DOM/native times устанавливают нужное окно. Внешний checker первоначально ошибочно требовал такой внутренний CDP timestamp order; исправлено только необоснованное требование checker, original timestamps/продукт/тест не менялись. Внешние print/checker также имели исправленные quoting/whitespace и классификационные ошибки; они не запускали браузер/CI и не меняли продуктовые данные.

Detached snapshot-clone request здесь **отсутствует**: case закончился примерно2.2s после navigation, до production FIRST_CAPTURE_MS4000.23PNG в ZIP побайтно совпадают с уже tracked source screenshots; это не новые screenshots этого case. Successful trace отсутствует по retain-on-failure; новая raw passive receipt сохранена primary+attachment byte-identical. Восьмой image404/отдельныйFetch200 старого failed1b остаются отдельной неатрибутированной веткой. Нельзя объявлять их исправленными или native recovery по этому короткому PASS.

### Узкое сравнение с сохранённым failed1b

Повторно прочитан только уже cached trace, без нового скачивания/браузера. Старый FAIL также имеет **два ранних original404**:486195.684 и486554.729ms, плюс те же image-retry0/1/2 и mask-retry1/2. Второй original временно совместим с каталогом, но HAR не записал native identity, поэтому точная consumer привязка не доказана. Третий original404490224.964ms и отдельный Accept:*/*200490222.992ms возникают позднее; их snapshot-совместимая гипотеза не объясняет первичное отсутствие failed publication без дополнительных ingress фактов.

Каталог уже есть в saved snapshot486858.753ms до terminal retry2 487460.917…487469.674ms. Trace call4906, title Scroll into view, содержит attached lookup487869.543…487887.823ms; log487884.31 говорит locator resolved to **visible** article. Following catalog expect начинается487925.143ms. Actual внутреннее scroll событие trace не содержит, но исходный awaited scroll ограничен этим интервалом после terminal retry2. Поэтому late scroll не является доказательством post-terminal mount. Ни отсутствие отдельного early request, ни late-mount-alone не выделяют FAIL из нового PASS. Следующая необходимая missing fact — actual native/React handler/effect/pending ingress старого отказа; конкретной ещё не проверенной причинной product ветки имеющиеся originals не доказывают.

## Доказательство и оставшаяся работа

Единственный новый log244492B SHA256 `63e29359ff993774d9489bc009e78c1d06938662f865b1854190786e1bd71d6d`. Artifact11695920240,3952377B SHA256 `89f75f992ba204e03aa2fe77dbdc70c5b99d58cd41669a1559100fcead42810e`, CRC28 PASS; скачаны ровно один раз и сохранены в7adc80ff-ci/run-38120687997. Raw478516B SHA256 `f57cf072ff5181d5fa9ef168a4db0b4051bedfe94dd29ff2595c928178f1916d`; primary и attachment exact original ZIP. Build49freshNx tasks (6+16+27),0cache hits, literal NX_SKIP_NX_CACHE=true и frozen dependencies фактически подтверждены в log.

Не доказаны: причина старого intermittent отказа, actual React handler/effect/shared subscription/pending branch, successful peer/changeasset/unmount в этом built эксперименте, snapshot clone атрибуция, частота на школьных устройствах. Existing mounted tests уже покрывают early delivery/late permanent/newasset/unmount; они здесь не повторялись и не выданы за новый browser proof.

Дальнейшее product изменение пока не обосновано. Возможный **отдельно выбранный** следующий диагностический срез — passive source observation конкретных hook ingress/effect/shared/pending branches, если контроллер считает эти missing facts необходимыми; текущий browser-only phase такого source diff не разрешает. Не broadcast failure успешным peers, не eager-fetch каталога, не увеличивать timeout/max7, не запускать неизменённый scenario/full suite «пока упадёт».

Repository/index/refs/current/card не изменялись этим reviewer; external proof scripts/report/manifest только temp. No deployment/DB/network/backup/installation/shared links actions. School K0/T3/class/owner pending. **STOP только этого диагностического independent review; контроллер продолжает №452.**
