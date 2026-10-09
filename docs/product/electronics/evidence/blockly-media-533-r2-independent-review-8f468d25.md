# Независимая проверка №533 R2

**VERDICT: REQUEST_CHANGES. STOP.**

Новый независимый рецензент `electronics_533_r2_new_exact_independent_review`. Автором этого изменения и предыдущим рецензентом не являюсь. Проверял фактические Git objects, GitHub и оригиналы уже однократно сохранённых CI/browser evidence. Отчёт исполнителя не использован как доказательство. Продуктовый код, тесты, execution state и Git refs не менял; проверки и CI не запускал, кроме штатного read-only preflight. Этот внешний отчёт — единственная запись.

## Точная версия и вход

- Repository: `spikeal8-maker/asa-lab`; программа №452; задача `TASK-ELECTRONICS-BLOCKLY-MEDIA-INIT-001`; Issue №533 OPEN.
- Source: `8f468d2560b4955a5ebfbbede25301b393ad5f9e`.
- Tree: `8e7e05d3afd88e71ff907eb0fa7acfb2816d9ab2`.
- Published ref: `codex/electronics-blockly-media-init-533-r2`; самостоятельно проверен `git ls-remote`.
- GitHub main / origin/main: `611db0e86b7300aa8b3b4916ad1a3dfc47dd7660`; independently fresh API при окончании проверки.
- Parent: `3d7f993c45d1ca82c0fa283bd6e9e3d88d1168b2`, обычный merge опубликованного R1 `45acab06` и выбранного main. Source содержит main: divergence `0 / 5`.
- Собственный `pnpm agent:preflight --scope electronics --check`: **SAFE_TO_START**, selected533/in_progress, checkpoint `r2_bounded_media_cache_revalidation_test_repair`; dirty paths0, blockers0, overlaps0, remote refresh PASS, actual control plane PASS. Журнал `preflight-533-r2-independent-8f468d25.log` во внешнем temp.
- Прочитаны root policy/entry/GitHub-first/change workflow, Electronics router, точная task card с R1/R2, component `electronics.persistence.project`, AGENT_GUIDE §§2/5/11–15, review protocol, UI layout contract и CircuitDocument §5. Deployment compact прочитан как глобальный маршрут; никакие deployment действия не выполнялись.

## Фактический scope

Полностью просмотрен main→source diff: ровно пять путей, **546 additions / 1 deletion**. Это ArduinoCodePanel4+, Vite27+, focused contract test52+, новый browser region462+ и одна generated digest замена.

Самостоятельная byte-проверка подтверждает:

- ArduinoCodePanel.tsx, vite.config.ts и arduino-code-contract.spec.ts полностью равны первому preserved source `680ab8bf`, а не переписаны в R2.
- Parent→R2 меняет только новый media test region и generated browser digest.
- Если удалить только новый media region и новый `createHash` import, весь оставшийся e2e/electronics-simulation.spec.ts byte-identical main. Все прежние120 случаев и принятый531 сохранены.
- CSS/Header/SchematicEditor/runtime/auth/solver/persistence/dependencies/workflow/protected artwork не входят в diff.
- Единственная JSON разница generated/component-coverage.json — `generatedFrom.browserEvidenceSha256`, actual SHA256 всего browser source `2b833c82861fd575615f3ad3c410c62787190606f8261f419d81dc7d934f9fa6`.
- В новом регионе нет timeout increase, sleep, force, route interception/fulfillment или отключения кеширования. Исходные budgets сохраняются. Проверки полного source, server draft/revision и local document сохранены.

Продуктовый механизм причинно соответствует BEFORE: `media` передаётся до ScratchBlocks.inject, а четыре уже имеющихся vendor файла выпускаются под исходными filenames в общей content-fingerprinted directory. Независимо пересчитан fingerprint `002c0b316c9c399c`; оригинальные bytes:

| Файл | Bytes | SHA256 |
| --- | ---: | --- |
| sprites.png | 4146 | 1818e665c0ef16301f0e36cb05727727c4064a065938de307d6225f85a22de5c |
| zoom-in.svg | 634 | c384c0c03cca7ededeec1330a95bc5f17f41be10ddbbe9b207d3b777cc39e8c0 |
| zoom-out.svg | 582 | 525427509ed6e060359d90c65eeb2eba35a66bf51b6145217b9cd484d5a3ddfc |
| zoom-reset.svg | 501 | 02e1a5f57a418421d6b988f6c7282d917db8ea9d0fb229a510ea4e37ec075253 |

## R2 observer и controls

Новый observer сохраняет every URL/status/validators, требует реальные initial200 body hashes; обработчик ошибки прикрепляется к каждому promise сразу. Ошибки попадают в observerErrors и должны строго проверяться в конце. Для304 body не читается: требуется предыдущий hash-verified200 того же полного URL и exact request If-None-Match равный его response ETag; optional If-Modified-Since сверяется с прежним Last-Modified. Оба response ETag сохраняются; это позволяет наблюдать фактический gzip variant без произвольного допуска redirect/3xx. Location и redirectedFrom запрещены. Непрочитанный200, missing prior200, wrong validators/bytes или unexpected status не становятся успешными.

По фактическому upstream scratch_zoom_controls.ts кнопки имеют36×36. Trashcan действительно использует два SVG image с отдельными clip rects тела и крышки; измерение полного spritesheet было бы неверным. Новый код измеряет видимый union и проверяет viewport, ancestor clips и пять actual elementFromPoint hits каждого control. Обычные click и scale assertions есть до и после reload; handler reset существующий, не подменён тестом.

Эти исправления в ONE directed R2 диагностике работают. Это ограниченный положительный результат, не приёмка всего среза.

## Exact CI и оригиналы

Source General **37904849942**, exact `8f468d25`: при последнем fresh запросе workflow **in_progress**. Governance113735727985 SUCCESS; Code113736108697 SUCCESS; Data/RLS113737349579 SUCCESS; Access113737349523 ещё in_progress. Незавершённый run не называется PASS. Ordinary source Electronics workflow **NOT_RUN**; API вернул только указанный General run.

ONE changed-cause directed child **320a7c3b3820c32c92137f3a594a5275a6ebc746**, run **37904865576**, job **113735785623**, terminal **FAILURE**. Независимый Git diff child к source содержит только временный workflow; child не является source acceptance. Проверен production Compose build, frozen dependencies и literal `NX_SKIP_NX_CACHE: 'true'`; raw build cache0/16+0/6+0/27, то есть49 freshly executed build tasks, не reused evidence. Оба случая завершились FAIL на `expect(after.draft).toEqual(before.draft)` в строке3273: mixed6.0s, blocks5.4s. Это не30s timeout.

Оригиналы прочитаны из уже созданного кеша `C:/Users/spike/.codex/temp/electronics-e01/320a7c3b-ci/run-37904865576/`; повторного скачивания не было:

- Job log245754B SHA256 `e3b4099a091e5407b24d591abacf706ef19c2bf87373b4c9ccf001764daa8dc3`.
- Artifact11604410608 ZIP30690680B SHA256 `1210ee1377d2032ee1eb25f8e53d7a7f9e5b3f0f97f7158b1cd235550eac6d99`; самостоятельно46 entries/CRC PASS.
- Mixed trace184 entries/CRC PASS, SHA256 `2665bb59fba03e9658d9ca8e0164116ccfd72caf74eac99d3d9b9563fb0ef5ee`.
- Blocks trace176 entries/CRC PASS, SHA256 `1898a9977bbefdfceb55462f99d6ab89dcd479bad898bb4448a99446a719d8e1`.
- Mixed media.json SHA256 `0cf88edce3adf415ebc263c3aa6dff19c4fbd292460c6770b53e472c521a8bd6`.
- Blocks media.json SHA256 `172d8cd9f945d8cb5d1963758664efe67a3a00b97bc7c07cb7ca9670e9644f11`.

Самостоятельные проверки raw JSON: каждый режим8 requests/8 responses, четыре200 с оригинальными hashes и четыре304 с точной привязкой к200, observerErrors=[], все origins same ASA, no external demo media. Все семь записанных phases на режим содержат правильные controls/clip/5hits и реальные scale0.8600000143→0.9460000396→0.8600000143. Все14 оригинальных screenshot calls завершились до After Hooks: mixed последний7074.919–7155.058 <7231.700; blocks последний13427.452–13508.635 <13553.596. В отличие от прежнего R1 это не post-teardown PNG. Однако обоих intent.json **нет**: строгое server equality assertion оборвало тест до записи. Нельзя назвать это полным пользовательским PASS.

Открыл именно оригинальные initial.png/reopened.png обоих режимов, четыре файла. Controls видимы внутри workspace; смешанный режим содержит полный generated source; повторное открытие и zoom/reset действительно наблюдались. Визуальная проверка ограничена этой resource/control surface1440×900; полный layout acceptance всех viewport не заявляется, CSS не менялся. Hash открытых PNG:

- mixed initial190135B `1881bdf39b3299545cff8c2853134cbb314d7d35ff9024ca165dabd4764e9822`;
- mixed reopened191387B `9d1b5c0fd25de07f8f72853fc2357a6bfd1273a797932d844e6f951e4b741370`;
- blocks initial171528B `23a276a31c55bb5009a6c842a989a535960ca5c223382e8460c3f04014e9bfed`;
- blocks reopened172555B `6ef2b4595d7b62dfaf8d0757551786db128464e7b17ded09232cb16951c8a294`.

## P1 — новый fixture не соответствует уже существующей initial normalization

**Файл:** e2e/electronics-simulation.spec.ts:2959–2988,3273. Fixture задаёт оба hats x330 и использует старую arduinoInputDocument без явных resistor powerRatingWatt/button contactState defaults. Он сохраняется напрямую API, а серверный `before` читается до монтажа редактора. Такой документ допустим по schema, но не является fixed point уже существующих client initialization rules. Нельзя ошибочно назвать его невалидным пользовательским документом или доказать только этим, что все реальные сохранённые работы безопасны.

Фактические producer rules независимо прочитаны:

1. use-workbench-project-state.ts:102 normalizeLoadedDocument добавляет имеющиеся catalog defaults; production-manifest-adapter.ts:340/367 задаёт resistor powerRatingWatt0.25 и button contactState released.
2. ArduinoCodePanel.tsx:227/645 keepWorkspaceClearOfFlyout выполняется при загрузке workspace; default flyout290/startScale0.86 задаёт target `290/0.86+42≈379.209`. x330 попадает в зарезервированную область и оба hats перемещаются; сериализация сохраняет x379.
3. ArduinoCodePanel.tsx:709–713 безусловный initial publish сериализует уже подготовленный workspace. Эти функции и state producer byte-identical main; четыре новые строки media не меняют их семантику.
4. use-workbench-project-state.ts:633–654 safety flush на pagehide пишет несохранённый текущий документ при reload. Его actual keepalive PUT и последующий GET видны в оригинальном network trace.

Самостоятельно декодированы все три полных readLocal результата из trace каждого режима. **Ещё до первого zoom** mixed readLocal4186.458–4197.313 и blocks10593.402–10606.414 уже содержат x379/0.25/released. initial screenshot начинается только4399.880/10808.795. Полные localBefore, localAfterZoom и localAfterReload равны во всех трёх точках каждого режима; они не null. Значит эти три delta появились до проверяемых zoom/reopen, а не были созданы новым cached media observer или gesture.

Точный network порядок:

| Режим | Pre-reload GET | Reload starts | Safety PUT | Следующий GET |
| --- | --- | --- | --- | --- |
| blocks-text |5501.260, revision2|5515.863|5534.163, baseRevision2|5648.366, revision3|
| blocks |11780.804, revision2|11790.887|11806.540, baseRevision2|11933.225, revision3|

Фактический PUT body и итоговый server document отличаются от `before` ровно тремя paths: serialized arduinoWorkspace (оба x330→379), resistor powerRatingWatt отсутствовал→0.25, button contactState отсутствовал→released. Full source, IDs, connections, component positions и остальные document fields сохранены. У unload PUT trace status−1, поэтому HTTP response PASS ему не приписывается; фактическая server запись доказывается последующим real GET revision3 и полным документом.

**Классификация:** A — непригодная новая measurement fixture для конкретного media-preservation regression. Наблюдается также существующая bootstrap normalization, но новый product defect, вызванный media diff, не доказан. Её общая желательность/частота и сохранность всех legacy схем этим тестом не установлены. Без отдельной canonical selection нельзя менять normalization/publish/save ради зелёного №533.

## Требуемый отдельный bounded repair

Новый автор должен подготовить именно новую media fixture до первого API save: явно сохранить уже известные catalog defaults и начальную позицию hats вне доказанной flyout области (например x400 при текущем default290/scale0.86), сохранив nonempty real blocks/full generated source/схему. Это коррекция исходных данных конкретного теста, не разрешение менять продукт. Разумна явная проверка пригодности fixture/первого local snapshot, чтобы отличие до gesture не оказалось скрыто.

Обязательно сохранить строгие full server document/revision и full local comparisons, реальный reload и safety behavior, все14 phases/PNG, initial200 body identity/validated304, actual clicks/scale/clips/hits и старые120/531. Запрещено удалять paths/revision из equality, подменять before послепроверочным document, normalise только expected after, добавлять save/ожидание, чтобы замаскировать новый write, поднимать timeout или чинить product спекулятивно. Если при подготовленной до save fixture вновь доказана мутация от пользовательского действия — STOP и отдельно формально выбрать подтверждённый product repair.

Сохранить опубликованный R2 source/history. После canonical selection нужен NEW bounded автор, controller actual source/raw check, ONE changed-cause diagnostic, необходимые обычные exact source General/Electronics all8 и **новый независимый** reviewer. Данный отрицательный verdict не превращается в approval новым коммитом или завершением текущего General.

## Ограничения и остановка

Приёмки №533 нет; Issue закрывать нельзя. Source General ещё pending, обычный Electronics NOT_RUN, full intent receipts отсутствуют. Local strict differential8→8 либо probe14 assertions не являются полным strict/product acceptance и здесь не использованы как такое доказательство. K0 school installed version/full backups и T3 owner device evidence, owner/class/release acceptance остаются отдельно pending. Deployment/DB/network/backups не выполнялись. Preserved532/530/526/525 и все ранее принятые результаты не изменены.

Рабочее дерево исходного checkout осталось clean на exact8f468d25. Рецензент завершил этот bounded review и **STOP**. Контроллер продолжает программу через отдельный repair.
