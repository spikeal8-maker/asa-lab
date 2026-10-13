# №548 — причинный разбор нового сохранённого отказа 1b0491ea

## Вердикт

**NO_PROVEN_PRODUCT_OR_FIXTURE_REPAIR.** Новый отказ подтверждён; ни product-код, ни тест, ни current.yaml, ни Git/index/refs в этом исследовании не менялись. Школьных действий, нового браузерного запуска, CI rerun, установки зависимостей и повторного скачивания оригиналов не было. Это не финальный review и не приёмка №548, №538 или №544.

Свежий собственный preflight: SAFE_TO_START, canonical main/HEAD `0cbe85598b0d071cab710f34f321aa122c716764`, выбран TASK-ELECTRONICS-ORDINARY-IMAGE-CONSUMER-FAILURE-001/in_progress, 0 dirty paths, 0 overlaps, 0 blockers, control-plane PASS. Работа строго read-only, внешние доказательства сохранены в temp.

## Фактический новый отказ

Source `1b0491ea7b6924c8ebc12ec834653617b8bdc360`, ordinary38118290466/browser114407851393: assertion2116 старого2084 сценария не нашёл доступный catalog status за исходные5000ms. Trace614163B, SHA256 `fbe84720d6e60a342029a4b50714e07a7f3b32dc1aa700bba8c86f3a36cd312c`, CRC PASS. Кэш скачан независимым reviewer; здесь только повторно прочитан локальный оригинал.

Собственный checker подтвердил побайтное равенство исходного2084 case source/main. Шесть точных production/mounted-test путей равны source, main0cbe, прежнему observer5fde и прежнему failed ebf. Поэтому это независимый categoryC asset baseline, а не причинный результат E07 wire diff.

Полностью декодированы все16 DOM delta snapshots, а не только новые узлы. Catalog отсутствует в486536.353ms, впервые присутствует в486858.753ms; это границы сохранённых снимков, **не точный момент mount**. Retry0 cycle1 уже404 в486315.109ms, retry1 в486830.548ms, retry2 в487460.917ms. Все11 snapshots, содержащих catalog, показывают original href и отсутствие failed/badge вплоть до492954.055ms. Stage battery и holder уже failed/badge в487821.537ms.

Итак, конкретный новый сохранённый порядок: **каталог появляется, когда общий finite recovery уже начался; его failure не публикуется в DOM**. Nativeerror/load, React handler ingress, effect setup/cleanup, pending state и точные node identities baseline не записал. Из сохранённых фактов нельзя выбрать между отсутствующим nativeerror, потерянным вызовом handler, повторным mount или иным consumer lifecycle.

## Отдельный GET200 — не восстановление

Network содержит9 GET того SVG:8 image-accept404 с fulfilled missing body и один continued GET200 Accept:*/*. Guard исходного route обслуживает404 только resourceType=image; сам HAR resourceType/initiator не сохраняет. Native decode/load успех не записан.

200 начался490222.992ms; дополнительный original-image404 —490224.964ms. Это происходит **внутри** ожидания4910,487925.143…492933.083ms, до FAIL. Следовательно, это НЕ finally cleanup после отказа. У исходного2084 case вообще нет собственного finally.

Найден конкретный совместимый production источник: project-snapshot.ts FIRST_CAPTURE_MS=4000; SchematicEditor регистрирует rasteriseSvgStage; svg-snapshot.ts cloneNode(true) оставляет original SVG image href до асинхронного inlineImages и выполняет fetch(force-cache) того же URL. Такой capture способен объяснить близкую пару fetch200 и detached clone image404. Это **источник-совместимая гипотеза, не доказанная атрибуция initiator**. Нет оснований менять fixture на404 всех fetch/HEAD, называть200 browser recovery или увеличивать max7.

После отказа2116 исходные800ms quiet, max7, whole-document equality, zeroPUT и zeroErrors **не достигнуты**. Их нельзя приписывать этому FAIL. Восемь404 уже показывают, что будущему причинному эксперименту требуется отдельно отличать detached snapshot image requests от mounted consumer recovery; порог сейчас не меняется.

## Сравнение с прежним observer PASS

Локальный original4491a00c/run38012528685 reread:3 trusted connected nativeerrors (stage battery/holder/catalog),7 GET/image404, три failure badges, initial==server==editor,0 draft PUT/errors/localDrafts. Это неизменённый продукт и другая удачная observation, не исправление. Она не содержит точного контролируемого late-mount порядка нового FAIL. Старый ebf trace также не записал native ingress. Общий набор не повторён.

Исходники уже предусматривают early event replay и late permanent error. Existing mounted tests проверяют earlyerror, earlyload-last, newasset cleanup/stale completion, unmount, latepermanent before/after passive. Повторять их под новым названием или рассылать failed всем consumers нельзя. Успешный peer того же URL обязан сохранить свой собственный success.

## Один следующий конкретный эксперимент; здесь НЕ выполнялся

После канонического выбора диагностического изменения использовать уже сохранённый observer2084 сценарий5fde на неизменённом production. Управлять **только** lazy WorkbenchSidebars chunk: удержать его ответ до фактического первого asa-image-retry=0 cycle1 image404, затем отпустить до terminal retry2. Стадия грузится напрямую, Sidebars lazy; это соответствует порядку сохранённого FAIL без повторения всего набора.

Сохранить все старые assertions и5000/stage10000/800/max7, полный документ и0PUT/errors. Никаких synthetic error/load, clock/runtime/Image/fetch monkeypatch, новых ожиданий или product-патча. Passive capture: native target identity/connected/href/consumer; DOM added/removed identities; фактический request.resourceType/status; CDP initiator, если доступен без изменения продукта. Отдельно отличать detached snapshot clone от mounted catalog/stage. Сохранять finally originals и на PASS, и на FAIL. Если поздний catalog получает собственный error и terminal recovery, но failed не появляется, это causal BEFORE для lifecycle; если собственного error нет, нужна ровно эта missing-signal ветка, а не безусловный broadcast failure. Контроль успешного peer, смены asset и unmount обязателен перед product repair.

### Точная маршрутизация lazy chunk и границы наблюдения

В новом trace настоящий module request — `http://web:8080/assets/WorkbenchSidebars-BllNH7Oq.js`, начало486191.487ms,200. Имя с hash не прошивать: matcher pathname `/assets/WorkbenchSidebars-*.js` и resourceType=script, фиксировать фактический URL. SchematicEditor.tsx371–373 содержит отдельный Suspense только для Sidebars; Stage вне него. Поэтому задержка только этого ответа не блокирует Stage recovery.

Точный порядок одного диагностического прогона: до openEditor установить route на один настоящий Sidebars script; route лишь ожидает externally resolved promise, затем `route.continue()` без подмены bytes/status. В существующем image404 handler сохранить прежнее fulfill404 и счётчик. Пассивный page response listener при actual status404 нужного URL query `asa-image-retry=0&asa-image-cycle=1` освобождает только Sidebars gate. Не ожидать этого promise перед page.goto; listener обслуживает его конкурентно. В finally освободить gate, чтобы не оставить зависший route. Из оригинальных network events проверить, что Sidebars response реально завершился после retry0 и до retry2; если порядок не получился, результат `ORDER_NOT_ESTABLISHED`, а не product PASS/FAIL. Никаких задержек fixed milliseconds, больших timeout или повторов «пока получилось».

Native и DOM observer могут доказать actual mount/error/load/connected/identity и outcome, но **не** внутренние shared subscribe/recovery branches. Источниковые факты (effect подписывается; false retry не fanout; recover пропускает pending) не выдаются за записанные execution facts.

Если контроллеру требуется записать внутренние branches в этом же диагностическом прогоне, нужен отдельно явно выбранный **observer-only source diff**, а не runtime monkeypatch или копия hook. Минимальная граница — ProductionComponentVisual.tsx useOwnerImageHref и production-asset-contracts.ts subscribeSharedQuietAssetRecovery: optional passive sink без вычисления/изменения state, timers, promises, retries или returns. Места записи: (1) effect setup/cleanup со stable существующим handlers-ref identity; (2) notify kind/asset/handler-match/early; (3) recover вход и exact return branch active/pending/permanent/currentfailed; (4) load start/settle с active/asset/current-cycle, непосредственно перед existing setLoaded; (5) shared subscribe/cancel/failed/recovered и действительные listeners/failedListeners counts. Чтобы связать hook instance с native DOM consumer, существующие onError/onLoad wrappers должны только передать currentTarget в observation; сами notify и порядок вызовов остаются прежними. Не добавлять lifecycle hooks или component keys, не использовать диагностические значения в условиях. Это отдельное разрешённое наблюдение, **не предложенный ремонт**, и его полный обратный diff/нулевое изменение recovery логики должен проверить контроллер. Автор не должен сам добавлять эти строки, если canonical phase ограничен только browser file.

Пока доказанного минимального product diff нет. Условная граница остаётся useOwnerImageHref в ProductionComponentVisual.tsx + один meaningful mounted lifecycle test; production-asset-contracts.ts только после доказанной shared publication необходимости и выбора контроллером. Не менять owner SVG, hit masks, физику, сохранение, авторизацию, конечный retry budget или late recovery.

STOP bounded investigation. Контроллер может продолжать независимые задачи; №548/№544 и acceptance blocker не сняты этим отчётом.
