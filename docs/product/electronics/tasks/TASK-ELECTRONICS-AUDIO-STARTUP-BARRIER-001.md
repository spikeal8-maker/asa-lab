---
task_id: TASK-ELECTRONICS-AUDIO-STARTUP-BARRIER-001
kind: repair
risk: high
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Accepted zero-horizon startup and observation cadence contracts remain unchanged.
acceptance_boundary: slice
review: independent
---

# E12: optional audio must not hold electrical startup

Bounded [552](https://github.com/spikeal8-maker/asa-lab/issues/552), programme #452, owner E12 LED delay after Run. This bounded slice removes only the demonstrated conditional pre-Worker audio barrier. It does not accept every E12 school incident or repeat #513/#516.

## One pupil result

A genuine Run gesture starts the canonical electrical Worker even if native optional AudioContext.resume stays pending or rejects. Complete ready results remain the only electrical publication authority. Normal native tone, Stop/noTone and project persistence still work.

## Component and risk

Primary component: electronics.ui.workbench, components/ui-assets-persistence.yaml. High semantic startup-boundary risk; independent exact-SHA review is required. Layout impact: none (no DOM/CSS/text/layout change).

## Entry and exact sources

Canonical selected lane/task must already exist on main. Run pnpm agent:preflight --scope electronics-startup --check and pnpm validate:electronics-agent-docs --task TASK-ELECTRONICS-AUDIO-STARTUP-BARRIER-001 before writes. Preserve all held candidates, foreign dirty work and school installation.

Read START_HERE.md, COMPONENT_MAP.yaml, components/ui-assets-persistence.yaml; owner priority specification E12 and K4 startup timing; README MATH-8 audio; AGENT_GUIDE sections 2,5,6,11,12,13. Exact production sources: use-piezo-audio.ts; read-only caller use-electronics-workbench.ts:toggleSimulationWithAudio, use-workbench-project-state.ts:toggleSimulation, live-simulation-worker-controller.ts startup/ready boundary.

## Expected write paths / budget

- apps/web/src/electronics/use-piezo-audio.ts (only production file)
- apps/web/src/electronics/testing/piezo-audio.spec.ts (new focused mounted regression)
- e2e/electronics-startup-audio.spec.ts (new exact built pupil journey)
- docs/product/electronics/components/ui-assets-persistence.yaml (add exact hook/test mappings)
- package.json (append the new browser file to both existing Electronics scripts only)
- .github/workflows/electronics-r4-m1-focused.yml (append new browser path filter only if required)

No caller/controller/solver/Arduino/physics/recovery/product-schema change, dependency/lockfile update, cleanup or protected artwork. Exceeding this exact budget requires controller coordination, not silent expansion.

## Minimal mechanism

Keep unlockPiezoAudio's public Promise<void> API and native AudioContext creation/resume inside the real button gesture. Request native resume synchronously but handle its asynchronous rejection locally without making its settling a prerequisite for the electrical start. Preserve synchronous constructor/resume failure handling and native tone graph/state behavior. Pending optional audio must not introduce a new startup timeout or fabricated electrical result. Late audio completion cannot resurrect a stopped, unmounted or replaced project's voices.

## Required evidence

1. One focused mounted test of actual useElectronicsWorkbench, real usePiezoAudio, controller/evaluator and whole schema4 document. jsdom substitutes only transport and native audio boundary, not audio hook/physics. Pending native resume: actual preflight/ready and running precede release; rejection and synchronous failure do not block; late completion after Stop/unmount does not resurrect sound. Keep whole document/revision unchanged by runtime actions. This is controlled conditional regression, not proof of a natural school cause.
2. Identical before/after production-browser test and fixtures on fixed dependencies. First natural native gesture characterization records context creation/state/resume, Worker request/response, requested/committed horizons, ready/yielded, computeMs, DOM LED publication and rAF/native PNG. No fake Worker/result or audio autoplay flag. Native already-running/no resume must be reported honestly.
3. Simple DC LED, Arduino immediate HIGH and separate intentional delay control. Prove complete ready finite/quality data before LED; intentional delay remains a model-time event, not a startup defect. Keep assets/loading separate from compute/audio. No original bitwise-program acceptance claim.
4. Native tone(1000) and Stop/noTone: preserve native oscillator/gain/destination; parallel passive native analyser with original PCM windows, context progression/sample rate and independently measured frequency/energy. Headless digital PCM is not school speaker audibility. No synthetic waveform or audio replacement.
5. Native Run/Stop changes do not save. One deliberate pupil parameter edit then one explicit full-document Save/CAS revision+1 and cookies-only fresh reopen preserve the complete document, all wires, Arduino source/state and authorization. Finally retain raw observations, whole documents, original traces/PNGs and failure evidence.
6. Exact final SHA focused pnpm gate:electronics-m1, full canonical pnpm gate:electronics-m1:browser and repository gate in CI, NX_SKIP_NX_CACHE=true and fresh counts; independent reviewer checks actual source/GitHub/original evidence. The author does not declare final acceptance from local tests or its own report.

## Limitations and STOP

School cause/frequency and original incident fixture remain unproved; T3 actual school device, class evidence and physical audio are pending. Do not deploy, restart containers, change DB/network/backups, increase timeout, lower physical accuracy, publish yielded/incomplete as ready, repair #548 or alter #525/#546/#537 candidates. One unpublished bounded candidate plus focused checks/self-review/report to controller, then STOP. No push/convergence/CI dispatch without controller coordination. NEXT_ALLOWED_TASK: STOP.

## R1: независимые замечания к новому тесту

Новый source reviewer точного 806a5a412da360790d2a489010c4062b51ad93ad вернул NEEDS_FIX. Report SHA2560924cf533e846d26ca6cae92545625b3b497fc8238f540731c5e09905b1bdee4, manifestb6248e006fbe4c46ca10f30de1d12a97e334ae9d48c1b98671e9b0c09cce8627; оригиналы у контроллера. Контроллер сверил84 external+22 Git originals и11 composition originals. Это не продуктовая приёмка.

Для этого запуска разрешён ровно один путь: e2e/electronics-startup-audio.spec.ts. Остальные5 source paths кандидата806a сохранять byte-exact, включая product hook, mounted unit, component map, package и workflow. Canonical selection наследовать автоматическим бесконфликтным merge; при конфликте STOP координации. Старую ветку/кандидат/оригиналы сохранить.

1. Исправить доказанную слабость assertFrames: сопоставлять настоящие requests/responses по workerId/requestId/generationId/projectSessionId и активному Run/cancel. Положительная DOM LED публикация должна соответствовать полному finite/quality ready result того же активного поколения, с фактическим clamp/round/projection. Последний Worker frame не обязательно уже опубликован React: разрешён доказанный предыдущий complete ready этого поколения с совпадающим результатом. Никакой timestamp-only/stale/yielded authority, product markers, fake Worker/audio или ослабления физики. Сохранить настоящие raw данные окна публикации.
2. Сохранение evidence: Node-owned incremental raw/checkpoints до рискованных browser await. В finally сначала сохранить имеющиеся originals, затем guarded DOM/PNG/server supplements. При недоступности записать NOT_AVAILABLE/оригинальную ошибку/последний checkpoint. Supplement failure не заменяет первичный assertion; неполное evidence не становится PASS. Сохранить cold/warm/cookies/tone/Save/noTone/Stop проверки, исходные timeout и неизменные whole fixtures.
3. Направленные контрпримеры к фактическому predicate и failure-control-flow, narrow format/lint/types/discovery, whole foreign-tree/source proof/hashmanifest и bounded self-review; один неопубликованный SHA, затем STOP. Повтор неизменного mounted/full/browser gate не нужен. После ремонта новый другой независимый source reviewer проверяет точный SHA. Source-ready не final acceptance.

Native canonical piezo journey отдельно блокируется подтверждённым №553; [причина](../evidence/piezo-clock-553-prerequisite.md). Не чинить scheduler внутри №552, не подменять PCM presenter unit и не запускать заведомо падающий ordinary browser до разрешения зависимости. После отдельной приёмки №553 — новая финальная композиция, одинаковый построенный BEFORE/AFTER, whole Save/CAS/cookies reopen, native PCM и обязательные exact-SHA gates/NEW product review. Установка школы не меняется. NEXT_ALLOWED_TASK: STOP.


## R2: согласованная финальная композиция после принятого №553

Владелец прямо разрешил сохранить все части двух подготовленных конфликтов и проверить новый SHA. №553 уже технически принят на e1328940fd215b1aec48975c33d42bda22e01e2e и закрыт; его код и доказательства не переделывать. Сохранить весь R1/R1b и точный кандидат29f5d21e18b6c0577dc03fb7d0b3f65ecd2c1241/tree06e2c524955394f2a34ede467a38c403ef4428ac. Его SOURCE_READY не принимает новую композицию.

Один НОВЫЙ integration author наследует канонический main proper merge в новой ветке существующего чистого552 worktree. Разрешены только два конкретных ручных конфликта: в package.json обе Electronics-команды сохраняют все старые сценарии, принятые piezo-clock/native-wheel и добавляют startup-audio; в components/ui-assets-persistence.yaml сохраняются все mappings и добавляются ровно три hook/unit/e2e строки552. Контроллер хранит byte-exact proposals: package SHA256 f4b12a1bdeb5f6aedbd66a4dc0319b339d69306e70809696582abf1ffc057425; map SHA256 ace5ddcaf506e1505a1c9570bcb190c191d724a28933ab772f9017fd4eee6c76. Workflow — только штатное автоматическое объединение с сохранением всех прежних путей. Любой новый конфликт/пересекающаяся чужая dirty правка — STOP согласования.

use-piezo-audio.ts, testing/piezo-audio.spec.ts и e2e/electronics-startup-audio.spec.ts сохранить byte-exact29f5. Никаких новых product/test/timeout/physics/dependency изменений, импортирования observer548 или соседних кандидатов. current.yaml, task cards, все чужие source bytes и принятые553/554 сохранить из нового main. Узкие format/types, discovery7, проверка фактических frozen dependencies, whole foreign-tree/inverse proof и self-review; один неопубликованный SHA/tree/hashmanifest, затем STOP. Исполнитель не делает push/CI dispatch/browser/install и не выбирает следующую задачу.

Контроллер самостоятельно сверяет actual source и передаёт НОВОМУ независимому source reviewer точный SHA. Затем нужны одинаковые production-built BEFORE/AFTER с реальным исходным отказом, native optional AudioContext, complete ready Worker/LED/PCM, whole Save/CAS/fresh cookies-only reopen и сохранённые первичные FAIL/PASS originals. Финальные focused/full ordinary browser/repository gates — на точном итоговом SHA, frozen dependencies, NX_SKIP_NX_CACHE=true, свежие Nx counts; НОВЫЙ независимый PRODUCT APPROVE. Старое одобрение, mounted7 или зелёный553 не заменяют эти доказательства. Acceptance blocker сохраняется до полного выполнения контракта.

По новому указанию владельца всё, что требует школьной установки, отложено; не запрашивать доступ и не выполнять школьные update/DB/server/network/backup/restore действия. T3/класс/owner acceptance остаются отдельно pending. №466/E06 продолжается независимо без изменения его выбранной карточки. NEXT_ALLOWED_TASK: STOP.


## R3: только дискриминирующий built native startup witness

НОВЫЙ независимый reviewer точного b813d82b9be32747efeafd3ffe7af87e3e093374/tree4cbfba07e7e99d9a503bd4f7171500b84a62b435 вернул REQUEST_CHANGES: [полный verdict](../evidence/startup-audio-552-r2-independent-source-b813d82b.md). Композиция, сохранность и15направленных oracle/failure challenges прошли. Root проверил57external+25Gitoriginals. Новый product defect не доказан; product hook/№553 не переписывать.

Один НОВЫЙ bounded author может изменить только e2e/electronics-startup-audio.spec.ts после наследования канонического R3 main proper merge. Сохранить b813/29f refs и остальные пять source paths b813 byte-exact, current/card и все foreign bytes из выбранного main. Существующие7 natural/PCM cases, timeout/fixtures/assertions/wholeSaveCAS/cookies/incremental primary FAIL не ослаблять и не удалять. Допустимо исправить в этом же файле исторический metadata552 о блокирующем553:553 уже принят.

Добавить пассивное наблюдение invocation/settlement/rejection ТОГО ЖЕ native resume promise и contextId/Run/request/order, возвращать исходный native promise неизменённым. Собственная ветвь наблюдения rejection не меняет product semantics. Настоящий native suspend после cold Run/Stop и trusted warm Run — исследуемый путь, не обещание поведения Chromium. Подтвердить фактический suspended state, достижимый вызов resume, состояние наблюдения и порядок непосредственно при настоящем Worker preflight postMessage. Новый oracle требует preflight выбранного Run до settlement именно его resume; старый await не должен удовлетворять ему. Не путать callback observation с доступом к внутреннему состоянию native Promise; явно сохранить предел наблюдения. Если resume пропущен/settled раньше preflight, это NOT_DISCRIMINATING, не PASS и не повод повторять запуск в надежде на другую race.

Никаких fake/deferred promise, replacement AudioContext/Worker/physics/result, autoplay flags, искусственных задержек, product markers или роста timeout. Полный конечный finite/quality ready(0), настоящий LED, Save/CAS/fresh cookies-only reopen без потерь и без runtime-save обязательны. Не требовать LED до короткого native settlement и не объявлять доказанным продолжительный pending/школьную частоту. Сохранить реальные raw originals и первичный FAIL до рискованных await; неподтверждённый checkpoint не PASS.

До дорогого CI: actual source call/order proof, направленные отрицательные oracle/failure counterexamples, узкие format/lint/types/discovery, физические frozen dependencies, whole foreign/inverse proof, self-review и ОДИН неопубликованный SHA/tree/hashmanifest, затем STOP. NO push/browser/CI/install/school. Root actual verification → НОВЫЙ independent SOURCE review → одинаковый genuine frozen built BEFORE/AFTER с конкретным исходным отказом → обязательные exact-SHA focused/full ordinary browser/repository gates/NXtrue/fresh counts → НОВЫЙ independent PRODUCT APPROVE. Acceptance blocker и школьные ограничения сохраняются. E06/№466 не менять. NEXT_ALLOWED_TASK: STOP.
