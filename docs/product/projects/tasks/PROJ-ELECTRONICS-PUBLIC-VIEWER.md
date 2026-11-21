# Первый настоящий просмотрщик — электроника и рабочая область публикации

Программа #211, прямое требование владельца дать заметный работающий результат.
03A принят #781 (ceb28cca). Активное состояние — только current.yaml.

## Один законченный пользовательский сценарий

Открыть опубликованную электрическую схему → увидеть настоящие компоненты и
соединения из точной опубликованной версии → перемещать, масштабировать и
вписывать схему в экран → обновить страницу без изменения исходного проекта.
Большая рабочая область занимает ширину страницы; компактная панель управления
вместо прежней правой карточки «Работа с проектом». Описание и сведения ниже.

Это один функциональный вертикальный срез: внутренние03B registry,03C service
и03D security acceptance выполняются вместе с первым inert Electronics viewer.
Их safety criteria не отменяются. Никаких отдельных пустых UI-кнопок или
обложки, выдаваемой за интерактивную схему.

## Сервер и контракт

- Сохранить v1 без payload неизменным. Отдельная версия контракта для настоящего
  read-only Electronics display: строгий bounded shape, публичная provenance,
  только безопасные компоненты/соединения/визуальные параметры. Нет editor DTO,
  private/classroom metadata, кода Arduino, секретов, URL/HTML из документа.
- Module adapter registry вместо большого controller switch. Переиспользовать
  чистую переносимую валидацию из copy, сохранив его license/authorization gates.
  Не вызывать copy для просмотра и не создавать пользователю новый Project.
- Exact publication/revision service берёт данные только связанной immutable
  ProjectVersion, никогда Draft. Canonical readability проверяется перед выдачей,
  cache hit и304; private/revoked/unlisted/Learning/stale не обходятся.
- Новая additive SQL функция по фактическому frontier, strict role/RLS/grants,
  fixed search_path, equality project/tenant/revision/current state. Не брать
  отложенный f41afd4c; его0260 не опубликована и не является зависимостью.
- Public GET доступен обычному гостю и ученику для допустимых публичных работ.
  Нет Account-only viewing или влияния будущих publish/download переключателей.
- Ограничить bytes/depth/counts/coordinates/paths и память cache/in-flight.
  Не кэшировать raw document или приватную identity. Безопасные ошибки без PII.
  Неподдерживаемые документы честно остаются обложкой, без обещания выполнения.

## Реальный frontend и визуал

- Только инертный presenter из проверенных rendering primitives: component
  visuals/catalog geometry, wirePoints/roundedWirePath. Не монтировать
  WorkbenchStage/controller/useWorkbenchProjectState, не подключать autosave.
- Схема действительно SVG/scene, не растянутая картинка. Локальный viewport,
  pan/zoom/fit, доступные кнопки/клавиатура; fullscreen только если работает.
  Touch не запирает прокрутку страницы; обработчики освобождаются при уходе.
- Не выполнять simulation/Arduino/serial/audio и не показывать Run/Download,
  которые ещё не реализованы. Управляемый worker-run — следующая capability.
- Полноширинная рабочая область, короткий header title/author/type, одна
  компактная панель. Убрать большую правую карточку и постоянные служебные
  объяснения. Условия копирования раскрываются компактно, policy не ослабляется.
  Сохранить настоящие copy/share/badges и доступное полное название.
- Lazy viewer, cover/error fallback, отмена старых ответов, teardown при новой
  revision/отзыве, без мерцания и бесконечных повторных запросов.

## Проверка результата

1. Pure/schema/unit validators, sanitized properties и точные exports; только
   scoped cross-project imports. Typed fixtures включают весь ApiError shape.
2. Реальные PG/API/HTTP: только current immutable version; V1 не меняется при
   draft V2, обновление/revoke/stale/private/Learning, гостевой и Seat view,
   direct app DML denial, никакого raw code/private field leak, payload budgets.
3. Chromium: настоящий редактор создаёт/сохраняет/публикует схему; public route
   рисует компоненты и провода. Pan/zoom/fit реально меняют viewport, не документ.
   Проверить отсутствие save/mutation запросов и unchanged original DB state.
4. Все7 widths320/360/390/430/768/1024/1440, нормальный реальный circuit,
   screenshots320/390/1440 и до/после pan/zoom; клавиатура, touch/page scroll,
   loading/error/unsupported. Контроллер визуально проверяет снимки.
5. Сохранить весь существующий Public Projects regression. Exact-SHA focused
   и General, отдельные независимые Code/Security и structural/L2 boundary review
   (нет editor/save/runtime imports, bounded resource lifecycle и bundle).
   Не выдавать это за проверку5000 одновременных пользователей.

## Координация одной ветки

Backend lead владеет contracts/API/SQL/PG tests. Frontend writer — web viewer,
page/styles/client и UI units. QA writer — отдельный browser spec и publication
gate wiring. Раздельные пути согласованы явно; никто не редактирует чужие файлы.
Общий typed interface lead фиксирует первым и передаёт остальным. Один lead
делает coherent commit/push только после STOP остальных, затем независимый review.
Feature branch не выбирает execution task и не редактирует current.yaml.

Games, классные права/Identity, скачивание, публикационный редактор и социальные
функции вне этого среза. Их утверждённые требования сохраняются. Рабочий Docker,
база и сайт не меняются. После приёмки контроллер продолжает всю программу.
