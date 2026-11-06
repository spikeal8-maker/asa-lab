# TASK-ELECTRONICS-ROBOTICS-FIELD-002 — поле и динамика предметов

## Goal / user-visible result

В обычном проекте робототехники пользователь составляет метрическое поле из плиток,
редактирует полосы, размещает мяч, стоящую металлическую банку и брусок и наблюдает
взаимное влияние робота и предметов при контакте. Выбранная задача, Issue, ветка,
checkpoint и ревизии находятся только в [current.yaml](../../../execution/current.yaml).

## Component IDs и ownership

- Robotics владеет authored world, механикой, редактором поля и геометрией предметов.
- `electronics.engine.public-api` и `electronics.worker.live-controller` остаются
  источником committed motor observations, времени и входов HC-SR04.
- `electronics.ui.arduino-editor` и `electronics.ui.workbench` используются без копии.
- Project Core остаётся источником прав, сохранения, revisions/CAS и публикаций.

## Minimal read set

[План поля](../../robotics/FIELD_V2_PLAN.md), [Robotics README](../../robotics/README.md),
[Portal contract](TASK-ELECTRONICS-ROBOTICS-PORTAL-001.md),
[review](../../../agent/review-protocol.md),
[UI acceptance](../../ASA_UI_LAYOUT_ACCEPTANCE_SPEC.md).
Исходные входы: `contexts/robotics/domain/world-document.ts`, `world-physics.ts`,
`world.ts`, `document.ts`, `apps/web/src/robotics/RobotFieldEditor.tsx`, `RobotField.tsx`
и существующие public-artifact contracts. Для необходимого no-echo входа HC-SR04
обязательны локальные Electronics AGENTS и точные runtime/timed-input contracts;
изменение electrical solver и clock scheduler не входит в срез.

## Expected write paths и бюджет

Registration: эта карточка, `docs/product/robotics/FIELD_V2_PLAN.md` и
`docs/execution/current.yaml`. Product source не входит в registration.

Product: точный список фиксируется preflight до записи. Ожидаются чистые
`contexts/robotics/domain/**`, их exports/provider/tests, локальные Robotics UI,
allowlisted public-artifact geometry и её совместимость, существующий main-site
Robotics browser journey, документация модуля. При необходимости зрелого 2D
движка допускается одна ограниченная dependency с лицензией, точным pin и проверкой
lockfile/build/bundle; второй electrical solver и новый сервис запрещены.
Для большого поля разрешён отдельный ограниченный no-echo slice существующего
HC-SR04: явное наличие отражения, штатный timed input и естественный pulseIn timeout.
Существующая корректная Trig/Echo семантика и legacy defaults сохраняются.

## Контракт

1. Размер поля, editor grid, плитка и масштаб изображения независимы. Плитка 30 см
   означает 0,3 метра, а не 30 пикселей. Сетка не является стеной или полосой.
2. Полосы/дуги/цветные зоны — authored разметка. Новые датчики линии/цвета не
   выдумываются: их электрический runtime не входит в эту задачу.
3. Предметы имеют конечные размеры/массу; стоящая банка скользит, мяч имеет
   сопротивление качению, брусок имеет прямоугольный ориентированный контур.
   Preset values доступны для редактирования и обозначены как учебные оценки.
4. Legacy учебный профиль сохраняет прежнюю семантику. Новый динамический 2D
   профиль учитывает массу и инерцию, ограниченную механическую тягу/сцепление,
   реакцию на контакты, трение пола и отскок. Точность меняет численный расчёт,
   но не массу, материалы или случайность.
5. Время поступает только из committed source time. Визуальный frame rate не
   задаёт физическое время. Подшаги и количество предметов ограничены; одинаковые
   входы дают воспроизводимый результат; пауза останавливает весь мир.
6. Mechanical drive limit — явный параметр модели. Контактная нагрузка не
   записывается как вымышленный электрический момент, ток заклинивания или RPM.
   Нельзя заявлять двухстороннюю electromechanical co-simulation без её реализации.
7. World source и runtime positions/velocities разделены. Reset восстанавливает
   старт робота и всех предметов. Drag/штамп/поворот создаёт один шаг общей истории.
8. Старые сохранения принимаются с прежней семантикой. Новые поля не отбрасываются
   старым parser/provider; downgrade/replacement protection сохраняет данные.
   Неизвестные профили и невалидные/неограниченные числа отвергаются.
9. Save/reopen использует общий документ аккаунта. Preview/public viewer рисуют
   сохранённую геометрию без приватных программы, схемы, bindings и runtime.
   Исторические immutable публикации остаются читаемыми.
10. Увеличение поля и настройка плиток не обрезают предметы молча. Невозможное
    размещение, пересечение и выход за границу дают ошибку, сохраняя валидный source.
11. На 1440/1024/390/320 доступно редактирование поля и свойств, сохранение,
    запуск, Reset и Undo/Redo. Новые инструменты не сжимают подписи на телефоне.
12. Объект вне диапазона HC-SR04 даёт явное отсутствие эха в общем runtime.
    Запрещены clamp до 4 м, повтор старого Echo и новый локальный датчик.
    Признак наличия отражения фиксируется на принятом Trig; последующее изменение
    мира не отменяет уже запланированный импульс Echo.

## Acceptance и evidence

- 4×6 плиток по 30 см дают поле 1,2×1,8 м; смена grid не меняет геометрию.
- Прямая/поворот/перекрёсток разметки размещаются и редактируются, дублируются,
  удаляются и восстанавливаются через историю и повторное открытие проекта.
- Мяч, банка и брусок узнаваемы и имеют редактируемые размеры и массу.
- Физический прогон показывает различие лёгкого/тяжёлого предмета и качения/
  скольжения; контакт робот–предмет–стена не позволяет пройти через препятствие.
- Off-centre контакт и вращение прямоугольного тела проверены; режим точности не
  меняет физические коэффициенты, детерминизм и finite-state сохраняются.
- Отрицательные tests: неизвестный profile/version, NaN/Infinity, invalid geometry,
  stale source, чужой private project, runtime state в authored save.
- Main-site browser: редактирование → сохранение → новый сеанс → публикация →
  просмотр другим аккаунтом. Существующий program/Arduino путь не заменяется mock.
- Independent final-SHA review проверяет механику, source/clock, rollout и UI.

## Tests / gates

Registration: scoped preflight, control-plane/doc checks и governance.
Product: `pnpm test:robotics`, `pnpm gate:projects-publication`,
`pnpm gate:projects-publication:browser`, typecheck/build/bundle и требуемый General.
No-echo dependency проверяет настоящий HC-SR04 runtime, timed input, pulseIn timeout,
сохранение уже принятого Echo и отсутствие изменения legacy импульсов.
Focused browser с dev-host — дополнительное evidence, не замена основного сайта.
Реальные Web/API/PostgreSQL/browser evidence выполняются в изолированном GitHub CI.

## Explicitly not doing

3D, вертикальные подскоки/падения/ступеньки, опрокидывание и деформация банки,
калибровка конкретного набора оборудования, motor load/stall seam, новый драйвер
моторов, новые датчики цвета/линии/энкодера, шум, tenant/RLS redesign, рабочая БД,
deployment, изменение owner SVG и ремонт посторонних CI failures.

## Review и Stop

Контроллер ведёт выбранный результат, регистрацию, integration и CI. Авторы
работают по согласованным непересекающимся путям одного checkout, выполняют
focused/self-review и останавливаются. Независимый reviewer проверяет финальный
SHA. Main integration не закрывает owner acceptance или unrelated failures.
