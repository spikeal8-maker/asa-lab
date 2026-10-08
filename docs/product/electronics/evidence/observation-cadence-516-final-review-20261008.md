# №516 — NEW independent product and published-state review

VERDICT: **APPROVE** для точного `dd97aea620e37b270b969213f9d3812e2e029cae`.

Независимый read-only рецензент не автор ремонта или verification. Новый обзор проверяет сохранённый результат №516 после отдельно устранённых baseline blockers. Исполнитель завершил verification и STOP; его self-review ae8e41061d469defb7554949fd64b7150b602aa500dbd8027b906bc711d7533f прочитан и проверен, но доказательства получены из фактического Git, GitHub API, исходников, оригинальных trace и logs. Замеры, тесты и workflow рецензент не запускал, повторных скачиваний нет.

## Источник и причины

В canonical current.yaml на dd97 выбран TASK-ELECTRONICS-OBSERVATION-CADENCE-001, №516, in_progress; штатный recovery вернул SAFE_TO_START, dirty0. GitHub contents current.yaml побайтно совпал с Git blob. Пять документов выбора/закрытия изменяют только Electronics; №505/PR506 и чужие направления сохранены. Acceptance blocker №516 разрешает проверку; его закрытие относится к следующему документальному действию контроллера.

Самостоятельно сверены 14 файлов архива before-execution-source.zip с actual Git bytes/blobs/SHA256; digest `0bf6354265b5b3af66bd0ad0a5feaf999706306d44826b01ac22eaf28e081e81`, tree `c0bce72ee48fe032b28db09167d7ed50986f612e`. Три blob ремонта controller/controller tests/domain replay tests равны в ba05381, 4bad8a7f, 29da и dd97. Продуктовый engine, Worker evaluator и Arduino scheduler в этом ремонте не менялись.

Ученик мог видеть старое полное состояние светодиода, пока вычисление догоняло растущий host horizon. Сохранённый controller запрашивает очередное завершённое окно не далее C+500000 мкс, удерживает весь поздний спрос и завершает прежний yielded target. Ветка yielded возвращается до onResult; ready(0), fault/cancel/stale, порядок и сохранность inputs/serial не изменены. Регрессии сравнивают полный state, observation и diagnostics при разных горизонтах и бюджетах, включая RC, Arduino, нагрев, двигатель и повреждения; физические поля не исключаются из равенства. Подтверждённого дефекта сохранённого ремонта не найдено.

## Независимые исходные измерения

Оригинальные normal/load ZIP digest 1215bd07…/e4a51cce… совпали с API; raw JSON 827f8d8a…/12df4449… побайтно совпали с trace attachments. Из actual raw самостоятельно пересчитаны 448/439 событий:

| Режим/поколение | ready/yielded | max ready gap, мс | compute median/max, мс | LOW ready→DOM, мс |
|---|---:|---:|---:|---:|
| normal1 |45/42|771.1|277.7/413.7|9.2|
| normal2 |44/42|628.8|262.85/354.1|2.4|
| load1 |43/41|1944.3|550.65/1118.1|8.9|
| load2 |43/43|1426.2|508.35/852.1|2.2|

Во всех measured ready C=H, очередной запрос не дальше 500000 мкс от прежнего полного наблюдения. В loaded2 ready20.000s ещё предшествует LOW-инструкции; фактический LOW ready20.500s. Полный исходный Arduino Reset body обоих probe HEAD совпал с ba053 после исключения только форматирования try/finally; четыре production source файла byte-equal. Старые HIGH/LOW/Reset assertions, LOW poll60s, scenario180s и физика1ms сохранены. CPU log подтверждает 3×90s и196.104387 CPU seconds.

## Обязательные exact-head gates

Свежий API подтвердил оба workflow terminalSUCCESS на dd97, все четыре jobs каждого SUCCESS; выполнены зарегистрированные recipes, frozen lockfile и literal NX_SKIP_NX_CACHE=true.

- [General37732525782](https://github.com/spikeal8-maker/asa-lab/actions/runs/37732525782): Code/Data/Access/Governance SUCCESS. Оригинальные cached logs независимо прочитаны и hash сверены. 166 fresh Nx tasks: Code96, Data43, Access27; Cache skipped/0 hits. Data3136 tests/357 files +16RLS; Access631 unit/76 files,10 real journeys,228 UI.
- [Electronics37732936127](https://github.com/spikeal8-maker/asa-lab/actions/runs/37732936127): focused633+374=1007, browser117/117, benchmark и exact-revision package SUCCESS. Original Reset52.5s. 159 fresh Nx tasks: focused70, browser49, benchmark18, package22; Cache skipped/0 hits.
- Browser artifact11531600151 actualZIP19450993B/131 entries independently hashed `6955bb54612b8c0ae21414b3a1f32071f2d4d646b78145f8b8619e85be0ae5df`, совпадает с fresh API digest и exact-run identity. Повторно не скачан.

## Финальное опубликованное состояние и пределы

После проверки exact dd97 удалённый main стал `3ff8fc3369538280928a519b7d58e2df6e52043a`: нормальный потомок dd97 с независимой Portal документацией (registry, Portal ETZ, только Portal lane current.yaml). Самостоятельный diff не выявил изменения Electronics lane/card/source/recipes/lock. Exact verification ref и clean executor checkout остаются dd97. Это движение не подменено утверждением о CI3ff: обязательные gates относятся именно к dd97. По AGENTS §2.1 несвязанное изменение не аннулирует exact-SHA evidence; контроллер обязан сохранить новый Portal state при closeout. Actual PR506 OPEN/DRAFT, HEAD350d2442d044d8992374ca4deef2758b6c95c61f.

Окно500ms — модельное время, а не wall-clock throughput promise. computeMs включает preemption; UI trace фиксирует DOM, не paint; normal/load — разные CI runners, passive observer имеет overhead, второй LOW после окончания конечной нагрузки. Частота школьных сбоев и реальные устройства класса не измерены. T3, owner/class acceptance, полный hygiene milestone, release и deployment не объявлены. Исторические ограничения №517 остаются квалифицированными и не используются как доказательство №516.

**APPROVE / STOP.** Подтверждённые source/review/CI blockers для технического closeout №516 отсутствуют; формальное обновление Issue/control-plane принадлежит контроллеру. Рецензент следующий срез не выбирает.

Original independent review SHA256: `1f99b510f8959e9111e3489f11bb7453dbd9205a0714670cd82a9e8a5a531871`. Repository Markdown formatting is normalized; the immutable original remains in the verification handoff.
