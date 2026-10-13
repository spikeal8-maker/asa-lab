# №548 — внешний проект наблюдения прежнего permanent-case

**VERDICT: EXTERNAL_PREPARATION_ONLY. NOT_APPLIED / NOT_ACCEPTED. STOP исполнителя подготовки.**

| Граница | Фактический результат |
| --- | --- |
| Исходник | Чистый root checkout `C:/Users/spike/.codex/worktrees/electronics-hygiene-480/ASA-lab`, HEAD `20d3229a002ae4f8a0be1a1fec2815c8c81bdb84`, dirty0 до и после. Это pinned source, не утверждение о неизменности удалённого main. |
| Canonical selection | В прочитанном current.yaml №548 ещё имеет `r1_catalog_search_node_owned_failure_evidence_test_only`; новая observational phase не выбрана. Поэтому только внешняя подготовка по поручению контроллера; карточку/current не менял, исполняемый срез не начал. |
| Основание | Сохранённый `548-new9f-cause-report.md`, SHA256 `59f37c823a9b1d833bbb39f4b2bbf1f0a7c147785bf4a0c42471287a9d090040`: неверный AA2 target исключён, SAME-node native→React→hook цепочка отсутствует, NO_PROVEN_CAUSE. Не скачивал и не пересчитывал старую trace. |
| Предложение | Точный unified patch и два полных proposed файла во внешнем `C:/Users/spike/.codex/temp/electronics-e01/`; ни один файл репозитория не менялся. |
| Разрешённые будущие пути | Только `apps/web/src/electronics/ProductionComponentVisual.tsx` и существующий permanent-case в `e2e/electronics-interactions.spec.ts` плюс additive fs imports того же файла. Нового Search-case нет. |

## Что именно предложено

**Production:** буквально исходный observation-only delta исторического `f67d7e5b34b3c9742d8a913ef3a443be1789831f`. Его parent visual blob `ae7086be659e9713d9b048f628150da94a1b85fa` равен actual main20d visual blob; observer в actual main отсутствует. Добавлены только read-only details текущих asset/href/failed/pending/queued и уже существующих quiet resolved/rejected callback ветвей. Это не recovery repair.

`observeOwnerImage` ловит отсутствующий, бросающий getter и бросающий sink. JSX при отсутствии sink сохраняет оригинальную функцию обработчика. При включённом sink запись actual `event.currentTarget`/native trusted выполняется через guarded notification, после чего исходный обработчик вызывается ровно один раз. Ref callback — диагностическая граница commit; `ref(null)` не называется lifecycle cleanup. State, promises, caches, href, active/pending assignments, subscriptions, original conditions и recovery policy сохраняются. Новых `permanent()`/`isCurrentOwnerImageHref()`/fetch calls нет.

**Старая browser case:** все девять исходных matcher expressions, stage10000, default catalog5000, quiet800, max7, whole-document equality, zeroPUT, errors, полная исходная fixture и исходный image-only404 route сохранены. Ни один другой case/helper не изменяется. Добавлен только пассивный журнал:

- `createElementNS` вызывается через Reflect с исходными receiver/arguments; его результат и исключение возвращаются без подмены. К созданному SVG image прикрепляются passive error/load listeners до href и до возврата node в React. Отдельная запись подтверждает attachment с фактическим href.
- Одна WeakMap назначает разные стабильные IDs DOM objects, consumer roots, hook refs и callback functions. Записи render-bind сериализуют настоящие onError/onLoad IDs; React callback записывает actual currentTarget; commit-ref связывает тот же node с настоящим callback; effect/setup/cleanup/queue/replay/recovery используют hook-ref token.
- Native record содержит isTrusted, connected, actual href/status, root identity, current-document root, family/component/selected variant и consumer ancestry на момент события. Нет угадывания target по URL.
- MutationObserver отмечает наблюдённые added/removed/status/href изменения; это время доставки observer, не точное время исходной DOM mutation. Clone происхождение всегда `NOT_INFERRED`; detached/отсутствие commit/совпавший href не превращаются в доказанный snapshot clone.
- Node JSONL создаётся синхронно до первого browser await. Browser records передаются неблокирующим binding и немедленно дописываются Node; реальные request/response/finished/failed receipts, resourceType/method/status и PUT payload сохраняются отдельно. Browser callbacks не ждут binding.
- Catch сохраняет исходную primary Error и повторно бросает тот же объект. Finally сначала пишет Node primary/checkpoint/NOT_AVAILABLE, затем отдельно guarded browser/full DOM/draft/editor/nativePNG/attachment supplements. Отсутствующее обязательное evidence при отсутствии primary делает проверку FAIL. Зависший supplemental await не мешает уже существующему raw original.
- Browser buffer ограничен 8192 records; dropped по channel, produced/delivered/pending/transportErrors/observerErrors и граница collect явно записываются. Records после collect имеют отдельные sequence; они не присваиваются прежней полноте receipt.

## Сможет ли журнал различить нужную цепочку

**Да, при наличии реальных полных записей** он различит: attachment до href → native error на конкретном **connected catalog object/root** → последующий diagnostic ordinary ref callback на **том же объекте** → effect на hook ref, связанном через настоящий render callback. Он также различит React delivery на actual currentTarget этого object, queued notify, replay и cleanup. Два объекта с одинаковым href имеют разные IDs; повторный render callback имеет собственный ID при том же hook-ref ID.

Наблюдение `native before ordinary-commit-ref` означает именно порядок относительно ref callback. Это не доказательство начала/завершения всей React commit phase или причины React target gating. Если native ingress есть, React ingress отсутствует, а позже тот же object commits/effects, это недостающий факт для следующего причинного разбора — не готовый ремонт.

**Причинный вывод запрещён**, если target/root/function/hook identity неизвестна, пропала любая часть chain/cleanup, native event не trusted или target не connected catalog, отсутствует later SAME-node ref/effect, есть dropped/transport/observer/write errors, produced/delivered не равны или pending не ноль. Неизвестное происхождение отдельного GET200 не считается native load. HTTP request с одинаковым URL у двух consumers не привязывается к node без дополнительного факта; CDP initiator этот проект не заявляет.

## Выполненная узкая внешняя проверка

`548-r2-observation-prepare-check.cjs` проверяет actual complete proposed source через установленный TypeScript parser и исполняет **извлечённые actual функции** в ограниченном VM control. Это проверка механики журнала, не built browser/продуктовый тест.

| Проверка | Результат |
| --- | --- |
| Полные proposed TS/TSX syntax | PASS, 0 parse diagnostics; project types/lint/gate NOT_RUN. |
| Все старые assertions | PASS, все9 expression tokens точны; исходные fixture/404 route точны. |
| Весь browser-file inverse | PASS, замена одного selected case и additive imports возвращает каждый byte main20d; все чужие cases/helpers точны. |
| Production inverse/provenance | PASS: убрать только дополнительные read-only details → exact f67 visual; настоящий reverse git apply исторического patch → exact main20d visual. |
| Двухфайловый patch | PASS: настоящий git apply --check/apply/reverse **только в external scratch** даёт оба точных proposed файла и оба исходных main файла. |
| Absent/throwing sink | PASS: фактические guards; восемь actual JSX Error/Load sink controls, оригинальный callback ровно один раз и actual currentTarget/function retained. |
| Hook transparency | PASS: actual extracted baseline/proposed hook, 6 ограниченных lifecycle/promise сценариев × absent/throwing sink дают одинаковые setLoaded/recovery/shared-call receipts. Stub control не заменяет React/native браузер. |
| Creation/identity transport | PASS: actual extracted init observer, passive listeners до href; исходное creation exception сохранено; callback/hook/SAME-node IDs связаны; равный href другого объекта не путается. |
| Native-before-ref capability | PASS только в fake control: connected catalog native до ref, затем ref/effect на SAME object/root, callback→hook связь. Шесть отрицательных controls с потерями/неизвестной identity запрещают интерпретацию. Это не измеренный native браузерный порядок. |
| Primary retention | PASS: actual extracted catch/finally, secondary browser/PNG/attach rejection, append-write error, absent-primary missing-evidence FAIL, unresolved browser supplement. Исходный primary Error сохранён, raw существует до зависания. |
| Запрещённые stimulus | Нет synthetic events, native cancellation, CPU delay, request/module hold, clock/React/Image/fetch patch, forced action, timeout/assertion weakening. |

Итого14 bounded proof groups PASS. При первой внешней inverse-проверке `git apply` применил Windows autocrlf в **external scratch**, так что байты отличались только CRLF. Checker уточнён явными command-local `core.autocrlf=false/core.eol=lf`; итоговый inverse побайтовый. Репозиторий/конфиг Git не менялись, browser/CI не повторялись.

## Ограничения и следующий разрешённый шаг контроллера

1. WeakMap, callback notifications, passive listeners, MutationObserver, binding и синхронные Node appendFileSync **могут изменить тайминг**. Buffer ограничен; wall-time overhead не измерен и нулевым не объявлен. Existing successful f67 run уже не поймал окно. Один natural passing run этого проекта снова даст NO_PROVEN_CAUSE, а не исправление.
2. Клоны не перехватываются; нет cloneNode wrapper. Без положительного происхождения detached node остаётся unknown. Это не мешает положительно узнать SAME connected catalog consumer, но не позволяет раздать все сетевые запросы clones/consumers.
3. `readEditorDocument` — существующий helper: actual attributed local draft либо mock server document при отсутствии local draft. Не новый доступ к внутреннему canonical runtime store. Full DOM и draft bytes сохраняются, whole original document assertion не ослаблен.
4. Нужны обязательный checkpoint556 контроллера, свежие Git/main/current/CI/preflight, **новая canonical observational phase**, bounded author application только этих двух путей с сохранением актуального main и свежими узкими formatter/lint/project-type/discovery/card/inverse checks, точный source SHA и **NEW independent source review до browser**. Внешний проект не авторизует root становиться product author.
5. Затем только ONE directed existing permanent-case в изолированном fixed-dependency production browser с literal `NX_SKIP_NX_CACHE=true`, после source review. При невоспроизведённом отказе/потерях/неполной SAME-node цепочке — NO_PROVEN_CAUSE/STOP данного experiment, без повторов в надежде и без recovery fix. Новая доказанная причина требует отдельной формальной repair phase.

Не выполнялись: repository edits/commit/push, install/build/lint/project-typecheck/discovery/gates, browser/CI/download/probe, изменение current/card/workflows/shared recovery/masks/physics/DOM/CSS/assets, school/DB/network/backup/deployment. №548/553/538/544 не приняты, blocker/count не изменены. Чужая работа сохранена.

**STOP.**
