# E06: независимый разбор превышения размера сборки

Вердикт: **подтверждён дефект gate кандидата; предлагается ограниченный ремонт реализации. Приёмки нет.**

Проверен чистый exact HEAD `99f76124eb759f9ce07c2b08c99164e134fb758d`; наблюдаемый origin/main — `acedf8f1c3982ae15f1e59e02385fda1f50dd538`. Запись только внешних evidence; исходники и Git не изменялись. Локальные build/test/install, CI rerun, Docker и школьная установка не запускались.

## Что доказано

- Сохранённый оригинал failed Code step run `38184087641`, job `114602735959`: build завершился, затем `FAIL electronics editor: 211790/209000 bytes`. Требуется убрать минимум **2790 байт** при прежнем лимите. Остальные перечисленные bundle-проверки в этом step прошли.
- Сохранённый original job `114595432211` run `38181607447`, exact `975f1fef…`: `206550/209000 PASS`. Разница 5240 B — только сравнение итогов. 975 содержит отдельный кандидат 552 с изменением audio hook и e2e-команд, поэтому это не точное измерение стоимости E06 или отдельной функции.
- Budget checker, pnpm-lock и Vite config побайтово совпадают между current main, 99 и 975. E06 относительно main меняет три runtime-файла: Stage +82/-2, drag preview +176/-9, geometry +94/-0 (352 добавленные строки, 11 удалённых). Число строк не равно размеру минифицированного кода.
- `createComponentDragPreview` строки 336–375 создаёт callback `path(delta)` отдельно для каждого основного/локального paint/hit/selection path. Для каждого локального path он вызывает `translatedDragDocument(document, componentIds, delta)`, затем повторно ищет connection/parts, вычисляет terminals и все PSU approaches. При N локальных path это N полных translations за одну draw, хотя `componentDragWires` строки 178–215 уже определяет moving/binding endpoints, движение vertices и canonical route.
- `psuEntryPresentation` строки 94–123 вызывается Stage для каждой БП. Для каждого route он вызывает `psuWireApproaches` (строки 43–82), который сканирует все компоненты и обе клеммы каждой БП, а потом presentation отбрасывает результаты других БП. Это повторение порядка P × W × C, плюс повтор для pending. Результат нужен только для канонически указанных двух endpoints; независимый hit по геометрическому соседству запрещён.
- `translatedDragDocument` используется canonical controller при окончательном изменении. Удалять её нельзя. Сокращать следует новый повторный вызов в presentation preview, сохраняя canonical commit behaviour.

## Предлагаемый один ограниченный ремонт R2

До записи контроллер формально расширяет текущий R1 до R2 на main в существующем Issue466: только три перечисленных runtime-файла и существующий `workbench-presentation.spec.ts` при необходимости. Browser test exact99 и generated digest остаются побайтово неизменными; сохранённый b06 BEFORE сохраняется для проверки применимости. Остальные существующие тесты только выполняются. Это устраняет blocker того же E06.

1. Сделать вычисление подхода endpoint-driven: максимум два endpoint вместо полного обхода всех БП/обеих клемм. Сохранить проверку type/key, actual anchor epsilon, endpoint identity, from/to direction и существующее canonical self-return dedup. Для покомпонентного render передавать конкретную БП/фильтр до вычисления route; не вычислять чужие approaches с последующим удалением.
2. В `componentDragWires` повторно использовать один canonical способ получения shifted route points для основного wire и его локальных entry paths. Данные компонента/endpoint metadata и принадлежность DOM узла определить при создании preview. В одной draw вычислять route/entry presentation один раз на wire/terminal и раздавать d всем paint/hit/selection paths. Избежать новой полноценной копии document на каждый DOM path. Для moved PSU применять тот же delta к corners и anchor; для stationary PSU оставить их неподвижными. Это должно сохранять binding semantics уже существующего componentDragWires.
3. Прежде всего сократить собственное новое дублирование. Сохранить нынешний analytic quadratic first-exit алгоритм, rounded route, control/readout clip, DOM paint/hit ownership и Stage ordering. Если потребуется затронуть Stage/geometry для настоящего сокращения, менять только добавленные E06 конструкции в пределах R2. Не выносить eager bytes в другой chunk, не менять budget, не делать общий cleanup или decomposition.
4. После одного цельного кандидата выполнить исходную production сборку и неизменный `bundle:check`. Достижение <=209000 **пока не доказано**. Если сокращения недостаточно, представить точное измерение и оставшийся diff контроллеру; не маскировать отказ изменением budget или проверок.

## Необходимые проверки нового SHA

- Все существующие presentation/geometry/drag-preview assertions сохранены. Особенно analytic first exit при возврате кривой внутрь, rotation/mirror 16 вариантов, zero-length segment, обе клеммы, pending start/arrival и same-terminal dedup.
- Directed unit на группу: moving PSU / stationary PSU + moving load / оба moving / две БП / несколько проводов; preview path и clip соответствуют canonical translated document, restore возвращает исходные attributes. Breadboard-bound endpoint и detach semantics из существующего drag-preview spec обязательны.
- Проверка устранённого повторения измеряет реальные вызовы на нескольких entry paint/hit/selection paths за одну draw. Это новая целевая проверка причины, а не общий performance benchmark.
- Frozen dependencies, focused gate, production budget, новый независимый exact-SHA source review, затем необходимые реальные E06 browser сценарии на новом exact SHA и final repository/independent product review. Сохранить positive/negative selection, controls/readout priority, cancel/undo/history, component-group preview, reconnect, Run lock, whole-document Save/CAS/cookies. До завершения эти сценарии не объявлены доказанными на новом кандидате.
- Не менять e2e timeout/assertions/fixtures, физику, авторизацию, owner SVG, документы учеников. Никаких школьных операций.

## Ограничение выводов

Структурное повторение доказано чтением exact source; его влияние на минифицированный размер по функциям не измерялось. Ускорение/экономия памяти на школьных устройствах и достижение бюджета новым вариантом не доказаны. `89` ранее выполненных unit — историческое evidence контроллера, здесь они не запускались. AFTER 99 не выполнялся этим исследованием. Существующий BEFORE сохраняется; независимый reviewer определит применимость к новому product SHA при неизменном сценарии.

STOP: read-only диагностика и конкретный план завершены.
