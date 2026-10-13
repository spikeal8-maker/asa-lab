# Независимая проверка №544 — REQUEST_CHANGES

| Поле | Фактически проверенный результат |
|---|---|
| Точная версия | `ebf3622f7572d59b418fc09f302dba460fcf1dd6`, tree `dd842fe350d425f3418a4d519bb9fb333d5fc7d6`; удалённая ветка совпадает; рабочее дерево чистое |
| Вердикт | **REQUEST_CHANGES**. Приёмка №544 запрещена до отдельного устранения подтверждённого отказа обязательного браузерного gate и новой проверки финальной объединённой версии |
| Причина | Категория C по AGENTS §2.1: независимый отказ существующего восстановления изображения в каталоге. Дефект нового field diff не обнаружен |
| Последний main | `5bfbf852f1e8bd9a870a7798f11300126c9b1e8c`. Уже добавлены принятые изменения БП в общие hook/map; для №544 понадобится согласованная контролируемая конвергенция, сохранение обоих изменений и новый exact-head review |
| Вход | Начальный и заключительный preflight SAFE_TO_START / control-plane PASS / dirty0 / overlap0; заключительный preflight наблюдал main997b0ed2, дальнейшее движение main проверено через GitHub отдельно |

## Единственный блокер обязательной проверки

| Проверка | Факт |
|---|---|
| Exact-head General | [38007112131](https://github.com/spikeal8-maker/asa-lab/actions/runs/38007112131): все четыре задания SUCCESS; Governance114078332879, Code114078641196, Data114079593042, Access114079593025 |
| Exact-head Electronics | [38008086985](https://github.com/spikeal8-maker/asa-lab/actions/runs/38008086985): focused114081453902 SUCCESS; benchmark114081990701 SUCCESS; browser114081990705 **FAILURE**; review-images114086250220 **SKIPPED** |
| Конкретный отказ | `e2e/electronics-interactions.spec.ts:2084`, «a permanently missing ordinary image shows an accessible failure on stage and catalog»; строки2114–2117: `.workbench-catalog-card[data-family-id="battery-holder-aa"]` → status «Изображение детали не загрузилось» отсутствует за исходные5000ms |
| Что прошло до отказа | Ошибка изображения на сцене видима; её `owner-image-error` и `data-owner-image-status=failed` прошли. Карточка прокручена в видимую область. Обязательный запуск завершился 170 passed / 1 failed за15.5min |
| Сохранённый trace | 657242B, SHAbce8b04a2b5299bd8763d0ea814ac0d2f59c4c352b89be487c80a1ee323496f8,65CRC; фактическая выбранная карточка battery-holder-aa-2, запросы aa-2.svg/ретраи404; присутствует отдельный200 для того же URL, поэтому причины транспорта/общего recovery нельзя подменять предположением |
| Классификация | Сам тест2084–2126, ProductionComponentVisual, component-preview, WorkbenchSidebars и production-asset-contracts побайтно одинаковы с исходным main19b92 и последним main. До отказа trace содержит навигацию/expect/scroll, без native drag/press. Изменённые handleStagePointerDown и componentDragDelta здесь не выполняются. Это отдельный baseline-блокер, а не разрешение ремонтировать recovery внутри №544 |
| Минимальный отдельный маршрут | Отдельная каноническая bounded задача: начать с сохранённого trace и mounted-consumer/shared-recovery событий в `ProductionComponentVisual.tsx:361` (useOwnerImageHref, публикация failed каталога), сохраняя существующий2084 сценарий и5000ms. Точную внутреннюю причину ещё требуется доказать направленно; `production-asset-contracts.ts` расширять только при доказанном пересечении. Никакого повторного полного набора без нового изменения/гипотезы, повышения timeout или удаления проверки |

## Независимая проверка самого ремонта поля

| Область | Проверка |
|---|---|
| Scope | Всего пять отличающихся путей от main19b92: WorkbenchStage, hook, новый mounted field test, одна регистрация component map, interactions browser scenario. Owner artwork, solver, API, схемы, зависимости, workflows и остальные файлы сохранены |
| Stage | Единственное изменение разрешает уже существующий alpha fallback на actual SVG root, как на grid. Проверки левой кнопки/pending terminal, Shift, target priority, fail-closed маски остаются |
| Drag | В componentDragDelta снято абсолютное ограничение координат. Сохранены реальная screen/world матрица, текущий viewport, порог3px, rounding/preview/commit, group/breadboard/history; добавлена проверка конечных delta. Все остальные функции hook побайтно равны main19b92 |
| R3 | Только первый полный expected document дополняет выбранную деталь существующим canonical `holeBindings:{}`. Полный обратный patch даёт точный spec родителя36738b2c;3796 остальных записей дерева не изменены. Четыре наследуемых product/test/map blob равны1ee34813. `translatedDragDocument` в workbench-drag-preview.ts не изменялся |
| Старые BEFORE | Прочитаны сохранённые5627d900 (trusted root alpha255 не двигает деталь), beef3ab9 (скачокx=-980),14c33dbd (точное движение, старое expected{} FAIL). Ничего не скачивалось и не запускалось повторно |
| Собственные проверки | Реально запущены35 mounted production-hook и5 preview checks:40/40 PASS; отрицательные/групповые/breadboard/history/nonfinite проверки сохранены. Отчёт исполнителя доказательством не использовался |
| Single AFTER | [38007121220](https://github.com/spikeal8-maker/asa-lab/actions/runs/38007121220), probe2933bfa9:1 PASS. Полный original raw456726B SHAc1e6cc8d90b793aff1414e2d03460876243020dd35c4de4b5a4efa1e11b330e7 проверен: native root movement,1 реальный полный PUT/revision2→3, fresh cookies-only localNULL, второй grab, вся схема/скетч сохранены |
| Полная матрица AFTER | [38007608206](https://github.com/spikeal8-maker/asa-lab/actions/runs/38007608206), probe5e86a258:32 PASS. Независимо прочитаны все32original raw:4 ширины1440/1024/390/320 ×8 границ/углов;64 native gestures (48mouse,16touch),32полныхPUT/revision2→3,64правильных смещения, целые4детали/3провода/Arduino и cookies-only regrab. Все реальные viewport совпадают; alpha255/ready/viewBox/no page overflow подтверждены |
| Exact ordinary field evidence | В failed ordinary run38008086985 все32 field journeys тоже прошли. Все32 новые raw отдельно проверены целиком тем же независимым checker:64 gestures,32PUT, whole document/sketch/reopen/regrab PASS |
| Native события | Mouse записал7 pointermove на жест, touch1. Исходный browser test требует настоящий move между down/up, не выдуманные6 touch events; source/assertions не менялись |
| Визуальное evidence | Самостоятельно просмотрены реальные phase PNG1440,1024,390,320: органы сохранения/кода доступны, деталь видима/доступна для проверенных жестов. Layout/CSS/DOM product не менялись; полная школьная visual acceptance этим не объявляется |
| Тесты/кэш | Focused633engine+440web; Data3244+16; Access652+10+286. Frozen dependencies и буквальный NX_SKIP_NX_CACHE=true.303 задач Nx действительно выполнены заново: General166, focused70, benchmark18, browser images49; hit0. Ещё22 review-image задачи **не запускались**, поскольку jobSKIPPED;325fresh или8SUCCESS заявлять нельзя |

## Оригиналы и границы результата

| Оригинал | Hash / статус |
|---|---|
| Single ZIP11651279767 | 4917728B; SHAa9f1fa8e0e6a4915df2441f70be174e95132737755d399701315338433d1b56a;35CRC; скачан один раз |
| Full32 ZIP11651494651 | 27751159B; SHAcfc74e4b31fedf9c2505c7d364ca0c884953c678762cbd7b8e6496000d2e4ed4;314CRC; скачан один раз |
| Ordinary ZIP11653026782 | 63495881B; точныйSHA/CRC сохранён в независимом финальном manifest; скачан один раз |
| General ZIP | 392895B; SHA3a732f55da2ed59a8764c2019b7c7263a190f6c7bb1efc2014efbc156502f851;61CRC |
| Изменения рецензента | Product/current.yaml/Issue/Git/CI dispatch/push/deployment не изменялись; созданы только внешние отчёт/proof/manifest и read-only caches |
| Ограничения | №544 не принят/не закрыт; новая объединённая версия ещё не проверена. E15 terminal-zone и другие первоначальные жалобы этим ограниченным ремонтом не закрываются. Школьная версия/backupK0 NOT_VERIFIED, T3/class/owner/deployment pending |
| Остановка | Рецензент STOP после этого одного вердикта. Контроллер продолжает программу через отдельный подтверждённый baseline repair и новую проверку exact final SHA |
