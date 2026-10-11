---
task_id: TASK-ELECTRONICS-NATIVE-WHEEL-CANCELLATION-001
kind: repair
risk: medium
semantic_change: 'yes'
roadmap_slice: null
prerequisites:
  - Existing owner programme452 and independently confirmed saved native wheel failure
acceptance_boundary: slice
review: independent
---

# Исправление отмены native wheel в рабочем поле

Bounded [554](https://github.com/spikeal8-maker/asa-lab/issues/554), действующая программа452, отдельная зависимость549. Только current.yaml выбирает исполнение. Сохранить held544 целиком, candidate549 и все чужие направления.

## Доказательство и граница вывода

Built BEFORE37e48f2ec372dccdf44bb8ebaaa1db501ecf8905/run38145444404:144 trusted nativewheel/144 passive cancellation errors, ноль ошибок в контролях безwheel. Actual Stage onWheel=c.handleWheel вызывает preventDefault; pinned React18.3.1 production listener passive:true. Read-only observer не отменяет события. Новый независимый reportc40cfc839787349580ed79fcf465e9398683b1fec0dc28df71000ad35fd3b8f8/manifest6117bd1378713a44539c48cc8015279da2fde167b76f86718abbe45f03c2d2cd, root7external/12Git/32trace originals проверены. Existing main4d relevant product/lockfile bytes совпадают. Реальные defaultPrevented/cancelable/scroll offsets старой записью не захвачены; частота в школе и фактическая прокрутка страницы НЕ доказаны. Не повторять прежний16case запуск ради этой причины.

## Один продуктовый срез

ONE новый author исправляет stage-local отмену события: ровно один native wheel listener passive:false на том же SVG, актуальный controller callback, cleanup/re-render/remount/StrictMode. Убрать дублирующий React onWheel. Не отменять события на document/body и внеstage. Сохранить существующие cursor anchor/zoom0.88/1.14/clamp/minmax и drag/vertex/segment/pinch guards; не менять параметры жестов. Автор выбирает минимальное корректное связывание native event/types в двух разрешённых production paths, без нового runtime helper или изменения математики.

## Точный source budget

- apps/web/src/electronics/WorkbenchStage.tsx
- apps/web/src/electronics/use-electronics-workbench.ts
- NEW apps/web/src/electronics/testing/workbench-native-wheel.spec.ts (Vitest include .spec.ts, mounted production/actual hook; meaningful behavior, не source-string assertions)
- NEW e2e/electronics-native-wheel.spec.ts
- docs/product/electronics/components/ui-assets-persistence.yaml ONLY additive tests for electronics.ui.workbench
- package.json ONLY additive newbrowser in BOTH e2e:electronics and e2e:electronics-simulation, preserve all existing commands/scripts
- .github/workflows/electronics-r4-m1-focused.yml ONLY additive newbrowser path filter; no job/step/command/security/timeout replacement

Все existingtests/browserfixture/Visual/CSS/solver/Arduino/Worker/physics/API/auth/schema/dependencies/lockfile/ownerassets/current/card/digests read-only. Не смешивать с549outline или meterlocator. При потребности другого файла остановиться и обосновать отдельное расширение.

## Проверка actual продукта

До browser новое meaningful mounted regression должно воспроизвести старую отмену/единственность native event, fresh callback, cleanup/replacednode/remount/StrictMode, zoom обоих знаков и существующие guards. Не подменять actual production event registration копией implementation. Старые измерения не повторять.

Один маленький SAME-BYTES built BEFORE/AFTER pupil сценарий на1440/1024/390/320, frozen dependencies/NX_SKIP_NX_CACHE=true. RealAPI/schema-valid independent prevalidated wholefixture, native mouse.move/wheel обоих знаков. Passive read-only observer capture + чтение original event послеpropagation фиксирует trusted/cancelable/defaultPrevented, target/coordinates, timestamps, console/pageerrors и page/document scroll offsets. Если event cancelable=true, AFTER требует defaultPrevented=true; нельзя требовать невозможную отмену cancelable=false. Existing baseline должен дать только ожидаемый cancellation/console failure; остальные взаимодействия/документ строгие. Контроль внеstage не отменяется Electronics. Ни fakeevents/Worker/Audio/API, ни injectedstyle/runtime/callback, ни forceclick, ни увеличенный timeout.

Сначала определить реальный persistence контракт: applyViewport меняет локальный viewport/writeLocalElectronicsViewport, не document. Wheel обязан давать ровно один существующий zoom update с тем же cursor anchor и zeroPUT/whole originaldocument unchanged. Не менять сохранениеviewport радиoracle. Затем одно намеренное разрешённое изменение параметра, один explicit wholeSave/CAS+1, весь PUT/server document совпадает с independently expected, cookies-only freshreopen безdraft возвращает ту же wholeсхему/Arduino/провода/hiddenfields/параметры. Не deriveexpected из serveractual и не normalizeactual/projection.

Сохранить originalraw/trace/nativePNG/whole document/network/console/lastcheckpoint и первичную ошибку приPASS/FAIL. На4widths проверить доступностьstage/controls/scroll/overlap; это функциональный ремонтбезCSS, не окончательная визуальнаяприёмка. Running result еслинаблюдается толькоcomplete finite ready C=H; yielded/incomplete=null, no physicalprecision/runtime reset.

## Gate, review, integration, STOP

Fresh canonicalpreflight/card/dirtypaths; один bounded author, focusedlocal meaningfultests/narrowformat/lint/types/discovery/card/selfreview/foreign-tree originalmanifest, ONE unpublished exactSHA затемSTOP. Никаких authorpush/dispatch/browser/localstack/install/deployment/DB/network/backups.

Root independently verifies actualsource/evidence, NEWdifferent source reviewer before directed built BEFORE/AFTER; после финальнойконвергенции required exact pnpm gate:electronics-m1 / pnpm gate:electronics-m1:browser / pnpm gate:repository и NEWindependent product acceptance. General red классифицировать, чужоймодуль нечинить. Не менять waits/consolecollector/physics/budget. Source-ready/старыеCI не являются приёмкой. У programme count2 since542; после третьего принятого product результата выполнить006 перед дальнейшей новойproductphase. School/K0/T3/class/device/owner/deployment отдельноpending. NEXT_ALLOWED_TASK: STOP.


## R3 actual native anchor coordinates — test only

Keep sourcefbbd and invalid frozen BEFORE2130341c/run38156222655 immutable. All4 genuine trusted native wheel inputs reach the existing product handler, but first positive wheel fails strict anchor x before Save/reopen: requested fractional clientX488.88/314.16/163.8/134.4 is delivered natively as488/314/163/134. Independent arithmetic at actual delivered coordinates satisfies the same existing precision; product math is not defective on this evidence. No browser rerun of unchanged source. Source-only approval and old CI do not accept the new composition.

ONE author changes ONLY new e2e/electronics-native-wheel.spec.ts. Validate original event identity/trusted/stage/delta, delivered coordinates within the native input pixel of the requested hit point; use that actual native event clientX/clientY as the input to BOTH independent before/after world-anchor calculations. Keep exact existing toBeCloseTo precision3 and independent xMidYMid/slice formula. Do not derive expected from changed viewport/product callback, normalize actual outputs or round expected product results. Prove all4 saved points with directed actual-function arithmetic and a deliberately wrong same-input anchor negative case; all unchanged source/evidence stays immutable.

Both signs, one viewBox update, all strict whole document/Save/CAS/cookies/default waits/console/observer/primary journals remain. Baseline actual events were cancelable=false because all native wheel listeners are passive; preserve that fact. SAME-BYTES soft >=1cancelable expectation can fail as part of expected BEFORE cancellation failure. AFTER MUST have at least one genuine cancelable=true perwidth and defaultPrevented=true, or FAIL/NOT_PROVEN. Never inject nonpassive observer/fake events, remove the nonvacuous AFTER check or claim cancellation from noncancelable events. Missing actual event remains FAIL. No production/type/binding/math/physics/CSS/Arduino/other6paths changes.

Read canonical current/card directly for this metadata-only phase update; approved proper merge618dd already preserves newmain5245 product/shared baseline. Do not chase subsequent metadata-only commits with extra merges. Fresh preflight, source inverse outside the explicit delivered-coordinate oracle, frozen6/whole foreign proof, narrow format/lint/types/discovery/card/self-review/hashmanifest, ONE unpublished SHA thenSTOP. NEW different independent review before one corrected strict same-bytes BEFORE; only valid expected cancellation failures with all other pupil steps complete permit AFTER. Final exact gates and new independent product acceptance remain required; school/K0/T3/owner pending.


## R4 native compact inspector entry — test only

Keep published63a9701 and invalid SAME-BYTES BEFOREd8f54c5e/run38158193370 immutable. Root verified34external/24Git and original4native PNG, full raw/trace/whole payloads. All8 signed stage wheels pass actual-coordinate anchor/one-update/whole-local/scroll;4 outside controls pass. Desktop1440/1024 complete whole SaveCAS2→3 and cookies reopen before expected passive-wheel/cancelability failure. Mobile390/320 stop before edit/Save because the new test skips the existing collapse-library action: actual CSS at max-width980 hides inspector while library is open, initial libraryOpen=true, actual trace has zero collapse clicks, resistance input220 exists but display:none. A longer wait cannot reveal it. No product/CSS defect is established by this failure.

ONE bounded author changes ONLY new e2e/electronics-native-wheel.spec.ts above exact63a9701. On390/320 use the real visible accessible button «Свернуть библиотеку» before editing the selected load; assert actual collapsed shell/library state and inspector/input visibility. Perform the same real entry after cookies-only reopen before reading the inspector value. Desktop actions remain unchanged. Preserve all old assertions and quantify additive assertions precisely; inverse only these explicit additions must restore entire63a test. Record actual entry order/state in the primary journal without fabricated isTrusted evidence. Meaningful narrow actual-source action-order and negative checks, types/format/lint/discovery/card, whole foreign/frozen6 proof, selfreview/hashmanifest, ONE unpublished SHA thenSTOP.

Do not force hidden controls, inject styles/runtime, change fixture/product/math/precision/physics/Arduino/observer/console/default waits/timeouts, or project whole documents. BOTHsigned wheel and outside controls,0draftPUT before intentional edit/Save,333.3whole Save/CAS+1/cookies/no-extraPUT and primary journals remain strict. AFTER still requires at least one genuinely cancelable native event perwidth and defaultPrevented=true; preserve noncancelable baseline honestly, no nonpassive observer or vacuous skip.

Read canonical current/card directly for this metadata-only phase. Existing approved proper merge618dd already preserves shared product baseline5245; do not chase later metadata-only changes with extra merges. New independent exact-source review is required before ONE corrected strict SAME-BYTES BEFORE. ONLY expected cancellation/console failures with all4 other pupil journeys complete permit AFTER. Required exact gates and NEW independent product review, held549, count2 and school/K0/T3/owner pending remain unchanged. NEXT_ALLOWED_TASK: STOP.


## R4 directed proof complete; final convergence required

Root independently verified source d247 strict SAME-BYTES BEFORE51ed517f/run38160845832 and AFTEReb08dba5/run38161873665. All4 widths complete native signed stage wheels/outside control/anchor/single viewBox/scroll/whole local, single intentional333.3 SaveCAS2to3 and cookies-only full reopen with empty local draft keys. Mobile2 genuine collapse actions each, desktop0. BEFORE8stage noncancelable/unprevented+8passive errors; AFTER8/8 genuinely cancelable/defaultPrevented, console/page/network failures0. BEFORE34external/23Git; AFTER33external/24Git, outer+nestedCRC/full originalbytes and4native PNG each root checked. Root corrected only its external trace reader to join actual unique addCookies context, because numeric trace-file indices differ; no product/test/CI change or rerun. Accepted555 one-query baseline enables ONE final automatic convergence with actual main, conflict STOP. Preserve all seven source entries and foreign baseline; unchanged required focused/full ordinary browser/repository exact gates and NEW independent product review. Neither source-ready nor directed4PASS accepts new composition. Held549/count2/owner/device/school pending remain.
