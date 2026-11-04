# TASK-PROJ-ELECTRONICS-PUBLIC-PLAYBACK-001

Один ограниченный срез программы211 после принятого PR866. Источник состояния —
projects lane в current.yaml. Решение владельца DEC123 разрешает реальный
публичный запуск электроники и делает программу опубликованной версии
доступной readonly. Рабочий сайт в этом исходном срезе не обновляется.

## Видимый результат

Настоящие Начать/Остановить/Сбросить, native LED/output presentation и временные
кнопки/переключатели/потенциометр. Большая область схемы, компактный toolbar
с zoom/fit/fullscreen, компактные название/автор/лайк/ссылка. Описание и сведения
ниже; телефон одной колонкой. Код при наличии читается без IDE/редактирования.
Desktop допускает компактное разделение основной области и сведений по UI/UX
sections10/11, но не возвращает отвергнутые большие действия, открытие картинки
и техническую перегрузку. Не выводить фиктивные controls неподдержанной схемы.

## Граница данных и исполнения

- Строгий версионированный V3 simulation artifact из immutable опубликованной
  версии; сохранить V1/V2 fallback. Явный allowlist физических свойств/программы,
  byte/depth/node/component/connection/source limits; не raw Draft/property bag,
  storage keys, private URLs, persisted runtime frames или произвольные AST.
- Программа Arduino является public по DEC123; короткое пояснение в существующей
  публикации. Никакой новой consent-галочки или SQL-миграции без необходимости.
  Согласовать фактическую ArduinoSource/Workspace semantics с каноническим
  runtime: опубликованная Blockly-программа не должна незаметно заменяться
  устаревшим текстом или default Blink. Readonly source выводится как текст.
- Reuse существующих Worker/client/LiveSimulationWorkerController и presentation
  primitives через тонкий host adapter; не use-electronics-workbench, palette,
  toolbox, IDE или второй solver. Все вычисления в bounded local Worker, не
  отдельный backend/service и не main-thread fallback.
- Один in-flight/coalesced demand, явные CPU/operation/time/input budgets и
  проверяемые timeout/unsupported/fault states. Остановка, отмена поколения и
  dispose при смене публикации/версии,unmount,background и потере доступности.
- Кнопки: pointer/mouse/touch/keyboard, обязательное отпускание на cancel/lost
  capture/Stop/reset; временные inputs не пишутся в Project/Draft/Version. Pan
  не перехватывает нажатия компонентов, клавиатура не застревает.
- Native results из committed result stream, не выдуманные уровни/частоты.
  Неподдержанные элементы не запускаются частично с ложными значениями.
- API проверяет публикацию/revision/readability/provenance; private/revoked и
  рассогласование версии fail closed. Новые runtime imports требуют узкого
  обновления public build admission; авторские/IDE/Blockly imports остаются
  запрещены. Не удалять build graph assertions ради зелёного gate.

## Приёмка

Реальный Worker/native браузер на built Web и реальном API/PG: источник-кнопка-LED,
Arduino Blink и Arduino с кнопкой; проверить опубликованную Blockly-программу
по фактической форме сохранения. Start/Stop/reset/restart, видимое изменение
LED/output от нажатия, touch/keyboard/отпускание, zoom/fit/fullscreen без сброса
модели, CPU timeout/dispose и отсутствие post-unmount/result-generation утечек.
Проверить immutable V1 vs private V2 и отсутствие Project write-запросов.
Негативные private/revoke/stale/oversize/malformed/unsupported cases.
Сохранить Scratch/likes/copy и публичные ограничения. Реальные скриншоты
320/390/1024/1440, без горизонтального скролла и полноэкранных заглушек.

Один новый author, self-review/narrow local checks once per meaningful change,
независимые exact Code/Security, Public Projects real PG/API/native browser и
General до Main. Затронутые Electronics runtime contracts получают релевантные
существующие focused checks; не расширять срез на старые 839/544 и не объявлять
их решёнными. При доказанной зависимости отдельный report/controller decision.
Тяжёлые build/PG/browser только GitHub; no dependency reinstall/relink, local
Docker/live DB, CI bypass, Games, рейтинги, Scratch copy или file export.
Автор отдаёт SHA/отчёт и STOP, контроллер ведёт review/CI/integration.

## Реализация и границы проверки

V3 содержит только проекцию опубликованного immutable document, явный allowlist
физических/визуальных свойств, model identity/connectivity и сохранённый
`arduinoSource`; `arduinoWorkspace` и производные editor/display поля исключаются.
Сохранённый `maxIterations` передаётся как `solverIterations` (4–100), без смены
физических параметров. Неизвестная конфигурация или Arduino без source остаётся
инертным V2, а не запускается с default Blink. Saved Blockly генерирует source
в настоящем редакторе до публикации; public host не импортирует Blockly.

Host budgets: один Worker request, deadline 4 секунды, сессия 5 минут, максимум
30 изменённых inputs/секунду и 512/сессию. Повторные одинаковые release исключены
до очереди. Превышение отменяет весь Worker/generation вместе с pending inputs;
release не отбрасывается при живом зажатом вводе. Потенциометр управляется
дискретным нажатием/стрелками, не неограниченным pointermove. Native asset lease
ожидается до 3 секунд; ACK только после общего layout и active/current leases.
Фон/потеря фокуса останавливают просмотр, Stop/reset очищают transient state.

Разрешён механический перенос export `ordinaryLedVisualState` из Workbench в
`apps/web/src/electronics/component-result-presentation.ts`; тело без изменений,
normalized-whitespace SHA256:
`10f0847a670d7f7af373d427dcc8f342022cd56460daca1ab65bef7285cd3ee4`.
Ни lifecycle, ни solver/editor semantics в Workbench не изменяются.

Build admission: отдельный private exact-revision Worker module index рядом с
существующим private web index, вне dist; фиксированный список 53 canonical
runtime modules в `tools/public-electronics-worker-modules.json`, SHA/bytes,
dependency closure и emitted client→worker link. Main-thread solver, authoring,
IDE и Blockly сохраняются запрещёнными. Docker public `/srv` получает только
dist; private indices остаются в существующем `/usr/share/asa-web-symbols`.

Приёмка остаётся обязательной: локальные focused проверки не заменяют real
PG/API/native built browser screenshots и независимые exact-SHA reviewers.

Дополнительно разрешён механический pure leaf `contexts/electronics/timed-state.ts`
с package subpath `@asa-lab/electronics/timed-state`. Он содержит прежние timed
version constant и reset function; engine импортирует и реэкспортирует их без
изменения поведения/идентичности. Controller runtime import переключён на leaf;
engine остаётся только type import. Причина: engine статически тянет simulation,
solver и top-level registries, что недопустимо в main-thread public closure.
Константа normalized SHA256:
`3acdc50340324fb0a4577bc1ef12220cbce84f492909eb54ebc187ebeb0051ad`;
reset normalized SHA256:
`d0bd1f4d516faa68b87eadc712863a85e16fac45d1f3ca3e13726971783cb7cc`.
Solver/clock/model semantics и wire version не меняются. После добавления leaf
Worker admission содержит 53 точных module IDs; main engine/solver запрещены.
