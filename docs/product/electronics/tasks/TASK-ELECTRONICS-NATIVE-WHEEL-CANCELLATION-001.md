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
