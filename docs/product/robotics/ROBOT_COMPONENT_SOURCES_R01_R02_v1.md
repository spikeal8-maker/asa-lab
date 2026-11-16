# ASA Lab — источники механических и электронных компонентов для конструктора роботов

**ART-01 / Discovery inventory v1.1 — RESEARCH ONLY · NOT_SELECTED · NOT_ACCEPTED**  
**Дата первичной квалификации:** 17.11.2026 (источники из производителя и read-only инвентаризация D2-R2).  
**Программа:** [Issue #1225](https://github.com/spikeal8-maker/asa-lab/issues/1225). **Концепция:** [ROBOT_ASSEMBLY_WORKSPACE_VISION_v1.md](ROBOT_ASSEMBLY_WORKSPACE_VISION_v1.md), [FIELD_CORE_SPEC.md](FIELD_CORE_SPEC.md) §9/§17/§20.

**Назначение:** сохранить доказуемые источники исходной геометрии для R01-A miniQ Ø127 мм, отдельного R01-B DFRobot Ø122 мм, будущего R02 TT-2WD и R05/R06. Запись в каталоге **не означает** подтверждение точной посадки, юридической допустимости распространения, физической достоверности или принятие в работающий редактор. Защищённые owner-assets не изменять. В продуктовый runtime/публичный каталог ничего не копировать без отдельного согласованного ART/KIT-среза.

## 1. Что действительно найдено на D2-R2

В каталоге *только на рабочем компьютере* \`C:\Users\spike\Downloads\ASA_LAB_Robotics_Libraries_2026-11-16\` уже существуют и read-only проверены:

| Оригинал | Ревизия | Физическое свидетельство | Лицензия / шлюз |
| --- | --- | --- | --- |
| \`Adafruit_CAD_Parts_main.zip\` | \`9f2a89f3d5c3491886d58cb7fe83385417563cf4\` | 1 195 707 274 байта; ZIP SHA256 \`dbd3dd81febfea924ef23e908eb4e371ad8427db962800b3163fe00d294cd0e0\`; по локальному манифесту 489 STEP, 477 F3D, 340 STL | [Adafruit CAD Parts](https://github.com/adafruit/Adafruit_CAD_Parts), MIT; соблюдать notice и происхождение |
| \`Amperka_hardware_drawings_master.zip\` | \`9f70cd626402c8cc18a84609e827691d6bbc0c56\` | 17 133 864 байта; ZIP SHA256 \`47ef8a40f29ae9c968461773de9ebfc2c918ba1f77c61188d28c315def31eb08\`; 519 SVG | [Amperka drawings](https://github.com/amperka/hardware-drawings), CC BY-NC-SA 4.0: **не переносить оригиналы/производные в коммерческий продукт без отдельной проверки прав** |

Дополнительно **фактически скачаны и прочитаны как `ISO-10303-21` STEP**, в отдельной папке `Pololu_candidates` внутри этой же локальной библиотеки (в GitHub бинарники не перенесены):

| Локальный кандидат | Прямая ссылка производителя | Размер и полный SHA256 |
| --- | --- | --- |
| `micro-metal-gearmotor-with-1089-extended-bracket.step` | [Pololu STEP: motor + bracket #1089](https://www.pololu.com/file/0J1711/micro-metal-gearmotor-with-1089-extended-bracket.step) | **1 119 707 байт**; `3234099385D88B456AB3F431FC7B03BAE11A528978F88B5453632A4AE94F45CA` |
| `pololu-wheel-42x19mm.step` | [Pololu STEP: wheel #1090](https://www.pololu.com/file/0J1710/pololu-wheel-42x19mm.step) | **5 005 728 байт**; `B8E4EF94A5B3CC549AEFE0E076BB2314104B0FECDD77E564EE4690B34D3D4C3B` |

**Проверено:** байтовая загрузка и заголовок ISO STEP. **Не проверено:** единицы/целостность solid-shell CAD в геометрическом ядре, реальный bounding box и крепёжные посадки, лицензия на перераспространение. Это именно **LOCAL_STEP_CANDIDATE**, а не готовый `robotAssembly`, `GLB` или manufacturing-file. Производитель Pololu — источник этих *двух* моделей; они **не доказывают** совпадения с деталями Amperka/DFRobot.

В той же папке проверены \`README_ASA_LAB_Robotics_Libraries.md\`, \`Adafruit_CAD_Manifest.json\`, \`Amperka_SVG_Manifest.json\`, \`Amperka_SVG_Index.csv\`, \`ASA_LAB_Robots_Catalog_v2_2026-11-16.csv\`. *Не добавлять в Git исходный архив Adafruit на 1.2 ГБ, архив Amperka, owner ZIP или временные исходники.* Если исходные файлы позже публикуются, для каждого нужен лицензионный review, паспорт, минимизация/санитизация и неизменяемый hash.

Проверка непосредственно внутри ZIP Adafruit подтвердила следующие **реально присутствующие** файлы:

| Part / назначение | Точные файлы в директории архива | Формат | Контрольная часть SHA256 STEP (16 знаков) |
| --- | --- | --- | --- |
| \`CAD-TT-3777\`, TT-мотор для R02 | \`3777 TT Motor/3777 TT Motor.{step,stl,f3d}\` | STEP + STL + F3D | \`12e0fa5457608501\` |
| \`CAD-TT-3802\`, TT металлическая передача | \`3802 TT Motor Metal Gear/3802 TT Motor Metal Gear.{step,stl,f3d}\` | STEP + STL + F3D | \`b17f227c7a178b3b\` |
| \`CAD-MS-1438\`, Adafruit MotorShield V2 | \`1438 Adafruit MotorShield/1438 Adafruit MotorShield.step\` (+F3D) | STEP | \`600a37b31421d17d\` |
| \`CAD-SERVO-1143\`, micro servo металлический редуктор | \`1143 Micro Servo - High Torque Metal Gear/1143 Micro Servo High Torque Metal Gear.{step,stl,f3d}\` | STEP + STL + F3D | \`949e219540d8889b\` |
| \`CAD-SERVO-2201\`, submicro SG51R | \`2201 Submicro servo/2201 Submicro Servo SG51R.{step,stl,f3d}\` | STEP + STL + F3D | \`66fa3c9570de91e6\` |
| \`CAD-BATT-3842\`, 3×AA батарейный блок | \`3842 3xAA Battery/3842 3xAA Battery.step\` (+F3D) | STEP | \`61c94a1890d542e1\` |
| \`CAD-BATT-1321\`, прямоугольная батарея 9 В | \`1321 Battery 9V/1321 Battery 9V.step\` (+F3D) | STEP | \`be0717e78c93fb05\` |
| \`CAD-SERVO-815\`, 16-канальный драйвер сервоприводов | \`815 Servo Driver 16 Channel/815 Servo Driver 16 Channel.{step,stl,f3d}\` | STEP + STL + F3D | STEP есть; полный SHA здесь не вычислялся |

**Важно:** SHA в четвёртом столбце — *префиксы* для контроля при распаковке, не полные хеши и не замена SHA ZIP. Эти модели соответствуют **конкретным позициям Adafruit**; их нельзя автоматически считать посадочно идентичными generic TT, SG90, L298N или другим ревизиям.

## 2. R01-A miniQ Ø127 — компоненты первого робота

Обозначения статуса:

- **LOCAL_3D** — настоящий STEP/F3D/STL обнаружен внутри уже загруженного ZIP на D2-R2, но точная совместимость с R01-A не принята.
- **SOURCE_3D** — производитель предлагает CAD-файл, но он **не скачан и не верифицирован внутри ASA Lab**.
- **LOCAL_STEP_CANDIDATE** — файл STEP скачан и контрольная сумма проверена, однако mechanical BRep/единицы/точные крепления ещё не аттестованы.
- **LOCAL_SVG_REFERENCE** — оригинальный SVG доступен локально, но **только как иллюстрация** и с лицензионным шлюзом.
- **DRAWING_ONLY** — данные/чертежи производителя есть, готового достоверного 3D/laser файла пока нет.
- **MISSING_EXACT_CAD** — нужно собственное CAD-моделирование/обмер либо найти проверенный источник.

| ID | Деталь / количество | Источник / имеющийся исходник | Реальный статус, что проверить |
| --- | --- | --- | --- |
| \`R01A-CHASSIS\` | Рама Ø127 мм, 3 мм, ×1 | [Amperka miniQ-base](https://amperka.ru/product/miniq-base) | **DRAWING_ONLY:** Ø127 и t=3 заявлены; координаты отверстий/слотов и manufacturing CAD **не подтверждены**; отдельный бренд-нейтральный CAD-master после обмера |
| \`R01A-MOTOR-L/R\` | Micro metal gearmotor N20 ×2 | [Pololu micro metal gearmotors STEP](https://www.pololu.com/product/3068/resources); [DFRobot FIT0094](https://www.dfrobot.com/index.php?filter_name=FIT0094&product_id=354&route=product%2Fproduct) | **LOCAL_STEP_CANDIDATE:** пример мотор+крепление #1089 скачан, каталог всех вариантов моторов — нет; это не доказанно тот же N20; проверить длину редуктора, вал/посадку, передаточное число, ток, лицензирование |
| \`R01A-BRACKET-L/R\` | Extended крепление N20 ×2 | [Pololu #1089 STEP](https://www.pololu.com/product/1089/resources), [DFRobot FIT0160](https://www.dfrobot.com/product-510.html) | **LOCAL_STEP_CANDIDATE:** Pololu STEP «мотор + крепление» скачан; FIT0160 — другой товар; сверить крепёжные отверстия/сопряжение с рамой и колесом, не подменять геометрии |
| \`R01A-WHEEL-L/R\` | Колесо 42×19 мм ×2 | [DFRobot FIT0085](https://www.dfrobot.com/product-353.html); [Pololu #1090 42×19 STEP](https://www.pololu.com/product/1090/resources) | **LOCAL_STEP_CANDIDATE:** STEP колеса Pololu скачан; точная идентичность FIT0085 **не установлена**, проверить ступицу и D-вал 3 мм; Pololu #1090 «Not Recommended for New Design» |
| \`R01A-CASTER\` | Шаровая опора nominal Ø12 ×1 для рамы Amperka | [Amperka miniQ-base](https://amperka.ru/product/miniq-base) | **MISSING_EXACT_CAD**: нужен паспорт крепления, X/Y/Z и реальная высота под опорной нагрузкой; не заменять DFRobot FIT0007 (металлический шар Ø15, другая геометрия) |
| \`R01A-FASTENERS\` | Винты, гайки, стойки, spacer | Конкретизация по механике мотора/рамы, [Pololu #1089](https://www.pololu.com/product/1089) | **MISSING_EXACT_CAD**: перечень BOM, тип/шаг резьбы/длина только после выбора mounts, не присваивать случайно M2/M3 |
| \`R01A-CONTROLLER\` | Arduino UNO Rev3 или другой точно выбранный контроллер ×1 | [Arduino UNO Rev3](https://store.arduino.cc/products/arduino-uno-rev3), официальные EAGLE/DXF; существующий ASA Lab SVG: \`apps/web/public/assets/electronics/owner-approved/arduino-uno.svg\` | **DRAWING_ONLY/EXISTING_SVG:** контур 68.6×53.4 мм указан производителем; реальное отверстие, стойки и модель платы — проверить по official DXF и выбранной ревизии; owner-approved SVG **переиспользовать**, не перерисовывать |
| \`R01A-MOTOR-DRIVER\` | Один проверенный двухканальный драйвер | В существующей электронике ASA Lab уже реализуется L298N; альтернативный исходник [Adafruit MotorShield V2 STEP](https://github.com/adafruit/Adafruit_CAD_Parts/tree/main/1438%20Adafruit%20MotorShield) | **LOCAL_3D только для Adafruit 1438**; MotorShield V2 НЕ является L298N; выбор конкретной платы/тока/пинов/питания — после REQ-KIT/D02; не создавать 3D «универсального L298N» по чужой фотографии |
| \`R01A-BATTERY\` | Источник питания и держатель ×1 | В локальном Adafruit: \`3842 3xAA Battery.step\`, \`1321 Battery 9V.step\` | **LOCAL_3D** как геометрические кандидаты; электрически допустимое питание НЕ выбрано, батарейка «Крона» не считается доказанной силовой батареей для двух моторов |
| \`R01A-POWER-SWITCH\` | Выключатель питания ×1 | Каталог электроники ASA Lab, механическая вариация зависит от шасси | **MISSING_EXACT_CAD**; отдельные крепление, корпус, полюса и оговорённая электрическая топология |
| \`R01A-SENSOR-ULTRA\` | HC-SR04 или совместимый модуль ×0/1 | В локальном Amperka ZIP файл \`hc-sr04-ultrasonic-sensor-distance-module.svg\` | **LOCAL_SVG_REFERENCE** с CC BY-NC-SA, 3D/отверстия не подтверждены; реальный датчик выбирается и привязывается к Arduino/engine отдельно |
| \`R01A-SENSOR-LINE\` | Один/несколько датчиков линии ×0..N | Открытый выбор в каталоге электроники/Amperka SVG; отдельный паспорт платы | **MISSING_EXACT_CAD**, не задавать положение оптической оси и распиновку без выбранной модели |
| \`R01A-WIRING\` | Провода, контакты, разъёмы | Фактический ASA Lab circuit и каталог терминалов | **Данные схемы**, а не самостоятельные декоративные провода: геометрия должна быть привязана к реальным terminals; без второго solver |
| \`R01A-DECK\` | Второй ярус/стойки, опционально | [Amperka miniQ deck](https://amperka.ru/product/miniq-deck) | **MISSING_EXACT_CAD**: отдельный вариант и отверстия, не автоматически часть базовой рамы |

**Граница по варианту:** Amperka отдельно указывает Ø127 мм у *голой рамы* и для неё микромоторы шириной 12 мм, колёса 42×19 мм и шар Ø12. Общий габарит 122 мм в карточке *собранного* miniQ не является координатами отверстий R01-A. Для чертежа обязательно проверить отдельное исполнение по изготовленному образцу или достоверному CAD.

**Блокер:** без подтверждённых центров всех отверстий/прорезей не выпускать \`cut.svg\`/\`cut.dxf\` для лазера. Для визуального предпросмотра возможна самостоятельная метрическая условная модель со статусом \`ILLUSTRATIVE / NOT_FOR_MANUFACTURING\`, не копия защищённых owner-эталонов.

## 3. R01-B — DFRobot miniQ ROB0049, самостоятельная аппаратная ревизия

Источник: [DFRobot ROB0049](https://www.dfrobot.com/product-367.html) — **диаметр корпуса 122 мм, дорожный просвет 15 мм, колесо Ø42 мм**. Поставляются два мотор-редуктора, два колеса, два шаровых колеса, два кронштейна, крепёж; **это не BOM R01-A**.

В той же текущей карточке указаны противоречащие друг другу исполнения: в таблице моторов спецификация **50:1 / 260 об/мин при 6 В**, а в shipping list **Micro Metal Gear Motor with Connector (75:1)**. Рядом существует [DFRobot MiniQ Motor Wheel Set with Encoder](https://www.dfrobot.com/product-827.html) с **75:1**, FIT0457/FIT0085/FIT0160. Эти параметры нельзя склеивать в один физический паспорт. \`physicalVariantId\` обязан хранить поставщика, SKU, дату ревизии, исходник и проверку реальной коробки. Производственный CAD отверстий ROB0049 не найден/не квалифицирован.

Отдельный [DFRobot FIT0007](https://www.dfrobot.com/product-225.html) — **металлическая шаровая опора** с Ø15 мм шара, высотой корпуса 20 мм и собственными креплениями; **не считать её равной 12-мм опоре Amperka**.

## 4. R02 / R05 / R06 — готовые основы для следующих семейств

| Цель | Что уже можно использовать как исходник | Статус / лицензия / ограничение |
| --- | --- | --- |
| **R02 TT-2WD** | В D2-R2 ZIP имеются \`3777 TT Motor.{step,stl,f3d}\`, \`3802 TT Motor Metal Gear.{step,stl,f3d}\` | **LOCAL_3D / MIT**; после проверки размеров преобразовать в GLB; корпус/колёса/колея — отдельно, «150×96» в старом прототипе не производственный размер |
| **R02 основание** | [Thingiverse 2544002](https://www.thingiverse.com/thing:2544002) — ранее обозначенный ориентир | **SOURCE_CANDIDATE, NOT_VERIFIED:** точное содержание файлов, лицензия, отверстия и форма не аттестованы; не маркировать как cutting file |
| **R05 servo/угловая рука** | В архиве Adafruit: \`1143 Micro Servo High Torque Metal Gear.{step,stl,f3d}\`, \`2201 Submicro Servo SG51R.{step,stl,f3d}\` | **LOCAL_3D / MIT**, но это *не* гарантированная модель распространённого SG90; проверить horn, ось/углы/момент |
| **R05 MeArm 4DOF** | [MeArm/MeArm](https://github.com/MeArm/MeArm) — конструкция и 3-мм DXF по версиям | **SOURCE_DXF / hardware CC BY-SA 3.0**; фото из README имеют иные условия (NC), не переносить без проверки; точный шарнир/servo BOM и ревизия подлежат квалификации |
| **R06 Otto-подобный бипед** | [OttoDIY/Otto](https://github.com/OttoDIY/Otto) — источник, упомянутый в открытом README и локальном каталоге роботов; кандидаты STL/assembly/BOM | **SOURCE_CANDIDATE**; проверить конкретные STL, author license/version и электрическое сопряжение перед использованием; без обещания готовой физики шагания |
| **R03/R04/R07–R09** | Архитектурные семейства определены в vision; часть источников есть в локальном \`ASA_LAB_Robots_Catalog_v2_2026-11-16.csv\` | **PLANNED**: точные STL/STEP, кинематика, лицензии и физика пока не квалифицированы; не размножать готовые модели путём переименования |

## 5. Отдельный локальный SVG miniQ — только художественная геометрия

На D2-R2 находится \`C:\Users\spike\Downloads\ASA_Lab_MiniQ_ROUND_2WD_SVG.zip\` (681 299 байт; 11 элементов): \`ASA_Lab_MiniQ_ROUND_PLATE.svg\`, \`ROUND_TOP.svg\`, \`ROUND_SIDE.svg\`, \`WHEEL_42x19.svg\`, PNG-превью, \`ASA_Lab_MiniQ_GEOMETRY.json\`, README.

**Непосредственно прочитан \`GEOMETRY.json\`:** \`type = independent editable vector illustration, not manufacturer CAD\`; задан **Ø122 мм**, условная колея **88 мм**, колёса X=±44 мм и задняя опора на 44 мм. В исходнике прямо сказано, что координаты креплений и колея — **иллюстративные допущения**. Этот набор **не применять для сверления/резки Ø127 R01-A и не использовать как физический эталон**. Не заменять им защищённые owner-файлы. Для 3D-сцены допускается только отдельная ясная маркировка «Условная модель».

## 6. Лицензионный, метрологический и продуктовый шлюз

1. **Adafruit:** MIT на репозиторий; исходный полный MIT license/notice и источник указывать для распространяемых производных. Нельзя без проверки утверждать, что размеры сторонних generic компонентов точны.
2. **Amperka:** CC BY-NC-SA 4.0; оригинальные и производные SVG нельзя автоматически использовать как assets коммерческого ASA Lab. Ссылки на источник и чтение для инженерной справки — отдельная операция от распространения графики.
3. **Pololu, DFRobot и прочие CAD производителя:** публичная ссылка на STEP/чертёж **не равна лицензии на зеркалирование и переработку**. До разрешения хранить только URL и метаданные; внешние оригиналы не коммитить.
4. **MeArm:** hardware DXF под CC BY-SA 3.0 и фото с иными условиями. Различать геометрию и изображения; соблюдать attribution/share-alike там, где применимо.
5. **Пользовательский файл:** никакие внешние GLB/STL/SVG не переносить в продукт без size/type/geometry/security gates и ACL/RLS. GLB в качестве визуального ресурса не приносит автоматически доверенные masses, rigid bodies, pins или joints.
6. **Не смешивать** Amperka R01-A, DFRobot R01-B, Pololu #1090 wheel и generic N20 даже при совпадающих округлённых диаметрах; source+revision+hash+точные anchors обязательны.
7. **Производство:** отдельный номинальный CAD-master, затем CUT_OUTER/CUT_INNER/ENGRAVE в SVG/DXF 1:1 мм, измерения отверстий, kerf/материал, пробная резка и физическое сопряжение. До этого \`NOT_FOR_MANUFACTURING\`.
8. **KIT-01:** 3D preview не является работающим электрическим роботом; единый circuit, motor driver, power, pin bindings, Arduino source и физическая поддержка квалифицируются отдельно после E2/D02 по REQ-KIT-01…06.

## 7. Узкая следующая поставка моделей: что сделать первым

**ART-01A — без product/source/deployment:**

1. Согласовать единственную physicalVariant R01-A (Amperka Ø127 мм) и типы N20, колеса, кронштейна, шаровой опоры. Получить CAD/обмер/схему **всех** отверстий; записать variantId, hardware revision, tolerances и evidence. Если измерений нет, не ждать их для независимого R02 TT.
2. Взять уже имеющийся \`3777 TT Motor.step\` и \`3802 TT Motor Metal Gear.step\` как **первый проверяемый конверсионный стенд** (R02, лицензия MIT), получить редакторский GLB и простой коллайдер, сравнить размеры CAD↔GLB в мм и coordinate transform Y-up→Z-up.
3. Для R01 параллельно проверить Pololu STEP motor+bracket #1089, Pololu wheel #1090 и их лицензирование; затем подтвердить реальное совпадение креплений с исходным Amperka физическим изделием (не только по изображению).
4. Сделать *собственный* parametric round chassis master, первый ортографический SVG сверху и GLB. CUT-file остаётся disabled до точных отверстий и реальной тестовой резки.
5. Заполнить \`partId, variantId, source URL, source revision, file SHA256, mm dimensions, orientation, anchors, collisions, material/mass source, electrical terminal IDs or unsupported, license, evidence, verification status\`.
6. Опубликовать результаты только в выбранном узком ART-01 с предусмотренными focused/CI/review; без смены \`current.yaml\` самостоятельно, без интеграции 3D в рабочий редактор до отдельного UX/KIT-милестоуна.

**Минимально полезный результат текущего discovery:** подтверждены локальные CAD-файлы TT, micro servo, батарей и MotorShield; SVG-референсы Arduino, DC motor, HC-SR04; скачаны два кандидата STEP для мотор+крепление N20 и колеса 42×19; отмечены непреодолённые пока измерительные и лицензионные границы круглой рамы. **Ни один комплект не помечен готовым для изготовления или подтверждённой симуляции.**
