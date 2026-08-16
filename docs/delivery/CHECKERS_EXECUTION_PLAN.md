# ASA Checkers M1 — исполнимый план реализации

## 1. Назначение документа

Этот документ превращает продуктовый замысел Checkers в последовательность
проверяемых вертикальных поставок. Он не хранит текущее состояние задачи.
Актуальные task, Issue, ветка, PR, lease, checkpoint и SHA всегда читаются из
[`docs/execution/current.yaml`](../execution/current.yaml).

Источники требований:

- owner scope из активного Issue, указанного в `current.yaml`;
- [`CHECKERS_EDUCATION_MARKET_ANALYSIS.md`](../product/CHECKERS_EDUCATION_MARKET_ANALYSIS.md);
- [`MODULE_PLATFORM_SPEC.md`](../product/MODULE_PLATFORM_SPEC.md);
- [`EXECUTION_MANIFEST.yaml`](EXECUTION_MANIFEST.yaml);
- [`active-task-tests.yaml`](../testing/active-task-tests.yaml).

## 2. Исполнительное решение

M1 не принимается как один большой набор доменных классов и макетов экранов.
Он поставляется семью последовательными срезами: `G0`, `V1`–`V6`. После `V1`
в продукте уже существует полезный пользовательский результат. Каждый следующий
срез добавляет законченную возможность поверх предыдущего и повторно доказывает
весь накопленный путь.

Основные решения:

1. Первая и единственная система правил M1 — русские шашки-64.
2. Сначала поставляется легальная сохраняемая партия, затем обучение, задания,
   боты и классная игра.
3. In-memory repository, статический экран или компонентный тест не считаются
   пользовательским результатом.
4. Существующая draft-реализация является источником повторно используемого
   кода, но не доказательством готовности. В поставку входит только то, что
   проходит вертикальные критерии этого плана.
5. Checkers не добавляет предметные `if (moduleKey === 'checkers')` в Project
   Core или Classroom Core.
6. ML-обучение ботов не требуется. Сначала нужен детерминированный движок,
   объяснимая сила и воспроизводимая калибровка.
7. Свободного общения детей не будет: только серверный allowlist реакций.

## 3. Что было не так с прежним планом

| Проблема | Последствие | Исправление в этом плане |
| --- | --- | --- |
| Шесть крупных checkpoint без mergeable-результатов | Можно написать много кода и ничего не показать пользователю | Каждый `V`-срез заканчивается реальным браузерным journey и может быть принят отдельно |
| Правила, обучение, боты, реакции и UI развивались одновременно | Ошибки интеграции обнаруживаются в конце | Строгий порядок: правила и persistence → обучение → педагог → боты → класс |
| In-memory модели смешивались с продуктовой готовностью | После перезапуска состояние исчезает | Начиная с `V1`, принимаются только реальные API и persistence |
| Не был выделен нейтральный wiring | Пакет существует, но маршрут и registry остаются неактивными | `G0` заранее определяет product и integration paths, `V1` включает wiring |
| Не учитывалась незрелость student membership Classroom | Учительский сценарий можно было только имитировать | Перед `V3` обязателен capability readiness gate; обход Classroom запрещён |
| Все тесты сводились к одной широкой команде | Нельзя понять, какой пользовательский контракт доказан | Для каждого среза задан journey, evidence и накопительный gate |
| Не было правила работы с широким draft-кандидатом | Большой PR трудно проверить и безопасно приземлить | В `G0` владелец выбирает: сузить кандидат до `V1` или supersede его без потери полезного кода |

## 4. Граница продукта и владение данными

### Checkers владеет

- правилами русских шашек-64, позицией, ходами, нотацией и результатом;
- версионированным Checkers project payload;
- каталогом уроков, позиций и задач;
- предметными попытками, событиями решения, evidence и mastery;
- прогрессом по ботам и очередью повторения ошибок;
- Checkers game session и безопасными реакциями;
- Checkers UI, API adapter и предметной аналитикой.

### Project Core владеет

- `ProjectEnvelope`, `ProjectDraft`, checkpoint и immutable `ProjectVersion`;
- optimistic concurrency, save/reload и доступом к проекту;
- модульно-нейтральной маршрутизацией через Module SDK.

### Classroom и Identity владеют

- tenant, школой, классом, membership, ролью и authorization;
- аудиторией задания: класс, группа или ученик;
- возможностью педагога работать с конкретным классом.

Checkers хранит ссылки на эти идентификаторы, но не копирует membership и не
вычисляет права доступа из клиентских данных.

## 5. `G0` — governance и готовность к исполнению

### Цель

Устранить процессные блокировки до следующего продуктового коммита.

### Обязательные решения владельца

1. Issue, указанный в `current.yaml`, должен быть открыт либо явно заменён новым
   owner transition. Закрытый Issue при `status: in_progress` считается drift.
2. Широкий draft-кандидат либо сужается до результата `V1`, либо помечается как
   superseded. Нельзя одновременно считать его полным M1 и постепенно
   принимать отдельные срезы.
3. `owned_paths` Checkers должны разрешать предметные пути, необходимые для
   заявленного результата:
   - `contexts/checkers/**`;
   - `apps/web/src/checkers/**`;
   - Checkers-specific API controller/adapter и его тесты;
   - Checkers-specific migrations и PostgreSQL tests;
   - `tests/checkers/**` и `e2e/checkers-module.spec.ts`.
4. Нейтральные wiring paths должны быть назначены integration owner:
   - module registry и API composition root;
   - web router/Editor Host adapter;
   - package/workspace scripts и focused workflow.
5. Student membership read capability Classroom должен существовать до `V3`.
   Если его нет, владелец либо активирует отдельную нейтральную prerequisite
   задачу, либо честно откладывает `V3` и `V5`; Checkers не читает classroom
   tables напрямую.

### Выходной критерий

- `pnpm control-plane:check` — PASS;
- `blocking` пуст;
- product и shared paths не пересекаются;
- одна выбранная стратегия для текущего draft-кандидата записана owner
  transition;
- команды focused gate ссылаются только на реально существующие suites;
- продуктовый код в `G0` не изменяется.

## 6. `V1` — первая видимая версия: сыграть и продолжить

### Результат для ученика

Ученик открывает Checkers из ASA Lab, создаёт партию, делает только легальные
ходы, закрывает страницу, возвращается и продолжает ту же позицию. Шапка ASA
показывает название проекта и честное состояние сохранения.

### Реализация

- независимый `@asa-lab/checkers` module provider;
- официальные правила: обязательное взятие, выбор полного capture sequence,
  backward capture для простых, flying kings, превращение во время серии;
- победа, поражение и заявленные правила ничьей;
- детерминированная нотация, replay и digest;
- versioned JSON schema и минимум одна backward-compatibility fixture;
- Project Core create/open/save/reload/checkpoint без Checkers conditionals;
- активный lazy route и нейтральный Editor Host adapter;
- responsive board, mouse/touch/keyboard, видимый focus и reduced motion;
- undo только в явно учебном режиме; сохранённая соревновательная история
  остаётся immutable.

### Acceptance journey

```text
student login
→ открыть раздел Checkers
→ создать русскую партию
→ выполнить обычный ход и обязательное взятие
→ увидеть сохранение
→ перезагрузить браузер
→ получить ту же позицию, очередь хода и replay digest
→ завершить партию легальным результатом
```

### Доказательства

- official-rules fixtures и property tests генератора ходов;
- schema compatibility и byte-stable replay tests;
- API integration test create/save/conflict/reload;
- реальный desktop и mobile browser journey;
- accessibility scan плюс полный keyboard journey;
- lazy-bundle assertion: Checkers не загружается на чужих маршрутах.

### Запрещённая подмена

Нельзя принимать `V1`, если UI получает данные из константы, состояние живёт
только в React/in-memory repository или маршрут открывается только напрямую в
тестовом harness.

## 7. `V2` — самостоятельное обучение и доказуемый прогресс

### Результат для ученика

Возвращающийся ученик видит реальное Checkers Home: продолжение урока,
незаконченные попытки, очередь повторения и следующий доступный материал.
Прохождение упражнения меняет сохранённый mastery на основании move-level
evidence, а не клика «готово».

### Минимальный учебный контент M1

- 6 версионированных тем: доска и ход, обязательное взятие, серия и превращение,
  комбинации, игра дамкой, базовые окончания;
- не менее 18 интерактивных уроков — минимум по 3 на тему;
- не менее 48 вручную проверенных позиций — минимум по 8 на тему;
- для каждой позиции: solution lines, допустимые альтернативы, hint ladder,
  concept tags, explanation и ruleset version;
- контент проходит автоматический legality/replay validator до сборки.

### Реализация

- versioned activity catalog;
- цикл `explain → demonstrate → student move → feedback`;
- attempt events с idempotency key и server timestamp;
- hint usage, retries, completion rule и evidence reference;
- mastery projection по concept tags;
- spaced-review queue из ошибок и просроченных повторений;
- home aggregate одним API-контрактом без цепочки клиентских N+1 запросов;
- loading, empty, offline и recoverable error states.

### Acceptance journey

```text
new student
→ начать первую тему без объяснения педагога
→ пройти урок и задачу с одной ошибкой и подсказкой
→ получить понятное объяснение
→ вернуться на Checkers Home
→ увидеть обновлённый mastery и задачу в review queue
→ повторить её после наступления review time
```

### Доказательства

- content legality report для 100% опубликованных позиций;
- persistence test attempt/events/mastery/review;
- тест повторной отправки события без duplicate progress;
- browser journey нового и возвращающегося ученика;
- запрет на mastery без связанного evidence.

## 8. `V3` — задание педагога и точное evidence

### Readiness gate

До начала `V3` Classroom/Identity обязаны дать server-side capability для
проверки педагога, класса, student membership и аудитории задания. Отсутствие
этого контракта означает `BLOCKED`, а не разрешение создать локальный список
фиктивных учеников.

### Результат

Педагог назначает версию урока, позиции, набора задач или Checkers project
классу, группе либо ученику. Ученик видит задание на Checkers Home, выполняет
его, а педагог открывает точную попытку и ход, породивший результат.

### Реализация

- pinned `ActivityVersion`, чтобы последующая правка контента не меняла задание;
- audience, due date, attempt limit, completion rule и teacher note без
  ученик-ученик messaging;
- единый assignment adapter к Classroom, без предметного кода в Classroom;
- immutable submission/evidence reference на project/activity version;
- teacher dashboard: назначено, начато, завершено, accuracy, hint usage,
  recurring concepts;
- drill-down `ученик → попытка → позиция → ход → объяснение`;
- tenant/RLS и отрицательная authorization matrix.

### Acceptance journey

```text
teacher login
→ выбрать собственный класс и опубликованный материал
→ назначить его ученику с due date
→ student login
→ увидеть только своё задание и выполнить его
→ teacher login
→ увидеть завершение и открыть точный ошибочный ход
```

### Доказательства

- PostgreSQL/RLS tests для teacher, assigned student, чужого ученика и другого
  tenant;
- immutable activity/submission version test;
- multi-role Playwright journey с реальными API и БД;
- evidence digest воспроизводится из сохранённых событий.

## 9. `V4` — линейка ботов и разбор партии

### Результат

Ученик проходит шесть честно различимых уровней ботов. Любой ход бота легален,
поиск не блокирует UI, а после партии ученик получает доказуемые turning points
и упражнения из собственных ошибок.

### Уровни M1

1. `Новичок` — seeded legal choice, предпочитает завершить обязательное взятие.
2. `Собиратель` — material-aware и видит немедленные взятия.
3. `Тактик` — ищет короткие комбинации и избегает простой отдачи.
4. `Стратег` — учитывает mobility, promotion и контроль ключевых полей.
5. `Мастер` — углублённый search в ограниченном бюджете.
6. `Тренер` — настраиваемая сила плюс объяснение выбранного учебного мотива.

Названия не переводятся в Elo без отдельной калибровки. Разблокировка основана
на результатах и concept evidence; педагог может переопределить её с audit.

### Реализация

- Web Worker protocol с cancellation, hard timeout и stale-result guard;
- seeded tie-breaking для тестов;
- одинаковый rules engine для UI, validator и search;
- reference-position suite и round-robin calibration matrix;
- post-game classification: missed mandatory capture, tactical loss,
  promotion race, king trap, endgame conversion;
- turning points с before/after line и ссылкой на rules evidence;
- mistake-to-puzzle pipeline в личную review queue.

### Acceptance criteria

- 100% bot moves проходят legal validator;
- timeout/cancel не оставляет UI заблокированным и не применяет поздний ход;
- сила уровней монотонна в утверждённой calibration matrix с записанным
  допустимым интервалом;
- одинаковые position/seed/budget дают одинаковый выбор в тестовом режиме;
- browser остаётся responsive во время поиска;
- завершённая bot game сохраняет review и progress после reload.

## 10. `V5` — безопасная игра внутри класса

### Readiness gate

Требуются реальная student membership и серверная авторизация участников.
Публичный matchmaking и поиск детей вне класса не создаются.

### Результат

Ученик принимает вызов одноклассника или входит в событие педагога, играет
серверно подтверждаемую партию, восстанавливается после разрыва соединения и
может отправлять только разрешённые реакции.

### Реализация

- class-scoped challenge или teacher-created event;
- server-authoritative game state, move sequence и idempotent command handling;
- reconnect snapshot + ordered event cursor;
- clocks только после доказанного reconnect/timeout protocol;
- allowlist не более 8 позитивных/нейтральных реакций;
- server rate limit, mute, teacher visibility и append-only audit;
- report-to-teacher signal без свободного текста;
- friendly/team/class-goal режимы отделены от будущего rated play.

### Security и safety acceptance

- нельзя вызвать ученика без общей разрешённой class membership;
- нельзя подменить actor/class/tenant в request body;
- неизвестная reaction code отклоняется fail-closed;
- rate-limit проверяется на сервере, а не только disabled-кнопкой;
- mute действует после reload и на другом устройстве;
- аудит не содержит credentials, произвольного контента или скрытых сообщений;
- reconnect не дублирует ход и не меняет очередность событий.

### Acceptance journey

```text
teacher создаёт friendly class event
→ student A вызывает student B внутри класса
→ student B принимает
→ оба делают легальные ходы
→ student A отправляет разрешённую реакцию
→ student B включает mute
→ соединение B разрывается и восстанавливается
→ партия продолжается с единой позиции
→ teacher видит событие и audit, но не личный чат
```

## 11. `V6` — hardening и owner acceptance

### Полнота пользовательского результата

- новый ученик начинает без помощи педагога;
- возвращающийся ученик видит актуальное состояние;
- педагог создаёт задание за один связный сценарий и видит move-level evidence;
- ученик проходит ботов и получает review из собственных партий;
- два ученика одного класса безопасно играют без произвольного контента;
- чужой tenant/class не получает данные ни через UI, ни через API.

### Hardening

- desktop, tablet и mobile для student и teacher journeys;
- keyboard-only и screen-reader labels для доски, ходов и feedback;
- colour-safe board, zoom 200%, reduced motion и touch targets;
- save conflict, network loss, expired session, invalid document, bot timeout и
  live reconnect имеют явные recoverable states;
- Checkers route остаётся lazy; чужие модули не тянут Checkers bundle;
- additive migrations, rollback без удаления пользовательских данных;
- telemetry не содержит child content, project payload или credentials;
- audit покрывает teacher override, assignment publication, class challenge,
  reaction mute/report и result correction;
- dependency/license inventory включает bot/search runtime.

### Owner evidence run

На одном точном SHA выполняются:

```bash
NX_SKIP_NX_CACHE=true pnpm gate:checkers-m1
NX_SKIP_NX_CACHE=true pnpm gate:checkers-m1:browser
NX_SKIP_NX_CACHE=true pnpm gate:repository
```

Отчёт обязан указать реально выполненные Nx tasks, состояние кэша, browser
artifacts и причину любого `SKIPPED`/`BLOCKED`. Hosted job с `steps: []` не
является результатом тестов.

## 12. Контракты данных M1

Названия физических таблиц определяются реализацией, но границы записей
обязательны.

| Запись | Владелец | Обязательные свойства |
| --- | --- | --- |
| Checkers project document | Checkers payload в Project Core | ruleset/schema version, initial position, moves, side to move, result, replay digest |
| Activity version | Checkers | immutable content version, concept tags, legal solution, explanation, publication state |
| Attempt | Checkers | actor, activity version, assignment reference, timestamps, status, idempotency |
| Attempt event | Checkers | ordered move/hint/retry/complete event, evidence anchor, server time |
| Mastery evidence | Checkers | concept, evidence source, projection version, earned/updated time |
| Review item | Checkers | source mistake, due time, schedule version, completion state |
| Bot progress | Checkers | level, calibration version, evidence, teacher override audit |
| Live game | Checkers | participants by authorized membership, ordered commands/events, result, reconnect cursor |
| Reaction event | Checkers | allowlisted code, actor, game, time, moderation/audit fields |

Все tenant/class/user identifiers выводятся из server-side session и
authorization; клиент не выбирает tenant. Любая persistence migration additive
и обязана иметь RLS tests до принятия.

## 13. Минимальные API capability contracts

Пути могут быть уточнены до `V1`, но capability и authorization semantics
фиксированы:

- `CheckersHomeReader` — агрегат состояния текущего ученика;
- `ActivityCatalogReader` — только опубликованные и доступные версии;
- `AttemptCommandService` — idempotent start/event/complete;
- `MasteryEvidenceReader` — projection плюс ссылки на источники;
- `TeacherAssignmentService` — через Classroom authorization port;
- `TeacherEvidenceReader` — только разрешённая аудитория;
- `BotSearchWorker` — request/cancel/result с version и correlation id;
- `ClassChallengeService` — общая membership или teacher event;
- `LiveGameCommandService` — server-authoritative commands;
- `ReactionService` — allowlist/rate-limit/mute/audit.

Контроллер не содержит правил шашек. Он проверяет transport shape, получает
server context и вызывает application capability.

## 14. Накопительная матрица приёмки

| Срез | Обязательный реальный journey | Новое доказательство | Повторяемое доказательство |
| --- | --- | --- | --- |
| G0 | отсутствует | governance и scope | control plane |
| V1 | play/save/reload | rules, Project Core, route, a11y | governance |
| V2 | lesson/error/review | content, attempts, mastery | V1 journey |
| V3 | teacher assign/student complete/evidence | authorization, RLS, immutable versions | V1–V2 |
| V4 | bot game/review/unlock | worker, calibration, timeout | V1–V3 |
| V5 | class challenge/reaction/reconnect | live authorization и safety | V1–V4 |
| V6 | student + teacher + class на 3 viewport | resilience, privacy, performance | все предыдущие |

Focused unit/integration gate и browser gate остаются раздельными, но для
приёмки среза нужны оба, если в нём заявлен пользовательский journey. Полный
repository gate обязателен перед owner acceptance.

## 15. Стратегия PR и приземления

1. `G0` выполняется отдельным governance PR без продуктового кода.
2. Каждый `V`-срез — отдельный reviewable product result. Следующий не начинает
   запись, пока предыдущий не принят владельцем либо явно продолжен тем же
   owner transition.
3. Product PR меняет только Checkers-owned paths. Нейтральный registry/router/
   package wiring идёт через integration owner и проверяется в объединённом
   integration candidate до landing.
4. Нельзя merge product branches между собой, переписывать опубликованную
   историю или обходить `current.yaml` сообщением в чате.
5. Module registry остаётся `coming_soon` до готовности `V1`. После принятия
   `V1` модуль становится видимым; rollback выполняется возвратом availability,
   а не удалением данных.
6. Каждый PR содержит только один заявленный вертикальный результат, список
   реальных journeys и uncached evidence на head SHA.

## 16. Риски и условия остановки

| Риск | Ранний сигнал | Действие |
| --- | --- | --- |
| Неопределённость официальных правил ничьей | fixtures расходятся с authority | остановить rules work, записать конкретную трактовку и новые fixtures |
| Нет student membership capability | невозможно доказать аудиторию server-side | `V3`/`V5` BLOCKED; не читать classroom DB из Checkers |
| UI опережает persistence | демо требует hardcoded state | не принимать срез; сначала API/DB vertical journey |
| Бот блокирует main thread | input/animation зависают во время поиска | worker boundary обязателен до уровня выше простого seeded bot |
| Уровни ботов отличаются только названием | calibration matrix не монотонна | не публиковать уровень и не выдавать награду |
| Live play допускает divergence | разные event cursor/digest у игроков | fail-closed, запрет продолжения до authoritative resync |
| Safety существует только в UI | API принимает неизвестную reaction/user | stop release, server authorization/allowlist tests обязательны |
| Большой горизонт снова смешан в одном PR | нет одного законченного journey | вернуть PR к одному `V`-срезу |
| CI не выделил runner | job завершён с `steps: []` | отметить external blocker и выполнить локальный uncached evidence, не заявлять CI PASS |

## 17. Definition of Done всего M1

M1 завершён только когда одновременно выполнено следующее:

- Checkers активен в ASA Lab и загружается отдельным lazy bundle;
- все ходы и результаты подтверждены одной версией rules engine;
- проект, обучение, задания, bot progress, review и live game переживают reload;
- ученик получает свой реальный home aggregate;
- педагог назначает версионированную работу и открывает точное evidence;
- шесть уровней ботов имеют legality, calibration и timeout evidence;
- class play ограничен authorization, реакции — server allowlist, mute и audit;
- desktop/tablet/mobile и keyboard journeys завершены реальными пользователями
  test fixtures через API и PostgreSQL;
- Checkers не добавил предметные зависимости в Project/Classroom Core и не
  изменил поведение Chess, Electronics или 3D;
- focused, browser и repository gates имеют честный результат на reviewed SHA;
- owner acceptance выполнен отдельным переходом состояния.

Наличие исходников, количество компонентов, зелёный unit suite или красивый
статический экран по отдельности не означают выполнение M1.
