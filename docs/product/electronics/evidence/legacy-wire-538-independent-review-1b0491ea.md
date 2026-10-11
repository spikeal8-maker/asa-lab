# Независимая итоговая проверка №538 — REQUEST_CHANGES

Точный проверенный SHA: `1b0491ea7b6924c8ebc12ec834653617b8bdc360`, tree `68ca602598f08e278c6fedb40b50aff97b145717`. Фактический main при завершении: `0cbe85598b0d071cab710f34f321aa122c716764`. Вердикт относится только к этому кандидату и ограниченной карточке E07 №538.

## Обязательное замечание

Обычный required Electronics workflow **38118290466** завершился FAILURE. Browser job **114407851393**, step **8**: сценарий `e2e/electronics-interactions.spec.ts:2084:7`, assertion **2116** не находит catalog battery-holder-aa status «Изображение детали не загрузилось» за прежние **5000 ms**. Итог: **144 passed, 1 failed (12.5m)**. Review-images **114410231520 SKIPPED**; пропуск не является PASS. Поэтому нет требуемого ALL8 SUCCESS и техническая интеграция/closeout №538 не одобрены.

Классификация **C: независимый существующий asset baseline**, соответствующий области №548. Полный проблемный test block и ProductionComponentVisual точно совпадают с main0c. В trace реально загружены три mock-ответа документа без проводов; изменённая E07 drag mutation в этом сценарии не участвует. Не ремонтировать assets внутри №538. Контроллеру сохранить exact кандидат и выбрать отдельный bounded repair/исследование доказанной причины, затем выполнить необходимые exact проверки и новый независимый review. Не увеличивать timeout, не ослаблять assertions, не запускать повтор всего набора в надежде на успех.

## Что проверено самостоятельно

- Прочитаны root/start, GitHub-first/delivery, Electronics router/card/subsystem, AGENT_GUIDE §§11–13, review protocol и UI layout contract. Собственный штатный preflight SAFE_TO_START: exact1b, main0c, CLEAN, ноль blockers/overlaps, control-plane PASS. Фактическая GitHub ветка указывает на1b, Issue538 OPEN, canonical wire lane выбран.
- Diff к новому baseline содержит ровно четыре разрешённых пути. Все **3876** чужих mode/blob/path записей совпадают с main0c. Все четыре task-пути байт-в-байт совпадают с ранее проверенным391, но старое одобрение не использовано как новая приёмка. Собственная обратная замена causal line восстанавливает product main целиком; прежние browser cases сохраняются целиком после удаления необходимых imports; subsystem map содержит только три добавления.
- Причина E07: отсутствующие vertices рисуются четырьмя default точками, прежняя mutation получала[]; теперь mutation получает промежуточные точки фактически отображённого маршрута. Explicit[], endpoints/IDs/color/netlist, no-op, неизменность прочих данных и предел48 сохранены. Исполнены **84** собственных проверки actual AST product/geometry/reader и ещё **7** actual session setup challenges. Использован настоящий production writer; чужие/legacy/invalid draft records не подхватываются. Настоящий auth controller возвращает user/account из одного accounts.id. Первое сравнение собственного VM harness встретило различие прототипов между VM; исправлен только внешний comparator на точный JSON. Repository/tests не менялись.
- Сохранённый BEFORE14815/run37965102300 перечитан по фактическим raw/trace/CRC и source inverse: mouse down +5 moves +up оставляли весь документ неизменным, vertices отсутствовали. Повторного BEFORE запуска не было.
- **Новые ordinary E07 mouse/touch оба PASS** (4.8/5.0s). Независимо проверены оба новых whole journey.json: все8 фаз, по два trusted native wire down, по5 trusted moves и release, средний/последний участок, Undo/Redo, весь документ с единственным изменением vertices, один настоящий PUT, revision2→3, полное совпадение server JSON, cookies-only новый context без local fallback, идентичная геометрия после открытия. Все JSON и16 PNG сверены с оригинальными ZIP bytes/CRC. Оба новых reopened PNG просмотрены: три изгиба и органы управления доступны. Успешные trace штатно не сохраняются; исторические traces не объявляются новыми.
- **General38118287082 ALL4 SUCCESS** на exact1b: Governance114407560971, Code114407742419, Data/RLS114408137455, Access114408137442. Focused114407572759 SUCCESS:633 engine +426 web; **70 свежих Nx** (1+42+27), три Cache Skipped, буквальное NX_SKIP_NX_CACHE=true, frozen-lockfile. Benchmark114407851391 SUCCESS. Browser сборка выполнила **49 свежих Nx**, cache0/6+0/16+0/27. Число PASS не отменяет единственный обязательный FAIL.

## Что доказывает новый trace отказа

Оригинал: `1b0491ea-ci/run-38118290466/extracted/reports/playwright/electronics-interactions-a-e9a68-ailure-on-stage-and-catalog/trace.zip`.

- В after@call@4820 действительно mounted catalog `<image href="/assets/electronics/component-database/components/battery-holders/aa-2.svg">`, без failed атрибута/badge в данном явном snapshot.
- Позже Stage явно имеет data-hit-mask-status=failed, data-owner-image-status=failed и status badge. Catalog badge assertion через5000ms заканчивается element(s) not found.
- Network содержит **восемь GET404** изображения, включая поздний original URL при490224.964; также **один continued GET200** того же SVG, Accept:*/*, при490222.992. Успешный запрос нельзя терять из анализа. Это конкретное сведение для причинного исследования, само по себе не доказанная причина.
- **Native error/load ingress НЕ записан**, subscription/internal recovery phase НЕ записаны. HTTP404/DOM snapshots не доказывают порядок native событий, доставку ошибки catalog или внутреннее состояние shared recovery. Финальные snapshot delta references не декодированы в утверждение об asset phase.
- Последующие max7/800ms/wholeDocument/zeroPUT/errors assertions не достигнуты. Нельзя объявлять их PASS или ослаблять max7 из-за восьми фактических404 без выяснения причины.

## Границы

LAYOUT_IMPACT:none — JSX/CSS/text/shared layout не менялись; изменена domain mutation маршрута. Новый E07 сценарий1440×1000 не является полной mobile layout приёмкой. Оригинальный E07 документ владельца недоступен: подтверждён конкретный механизм, не все неизвестные случаи жалобы. Школьный T3, K0 установленной версии/backups, совместная работа класса и owner acceptance остаются отдельно pending.

Ни repository/index/refs/current, ни product/test code рецензентом не менялись. Browser/CI/Docker/DB/сеть/deployment не запускались. Новые оригинальные логи и browser ZIP скачаны один раз; уже существующие старые originals переиспользованы. Общий General archive и большие review image tar не скачивались. REQUEST_CHANGES означает обязательный gate blocker, а не требование переделать доказанное E07 исправление. STOP независимого review; программа контроллера продолжается.
