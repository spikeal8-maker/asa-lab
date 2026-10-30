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
