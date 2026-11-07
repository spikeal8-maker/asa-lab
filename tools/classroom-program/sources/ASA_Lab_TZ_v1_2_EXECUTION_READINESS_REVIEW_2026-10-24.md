# ASA Lab — проверка готовности ТЗ v1.2 к исполнению ботами

**Дата:** 24 октября 2026 года.  
**Тип:** независимый контроль и план декомпозиции; не новая утверждённая версия ТЗ.  
**Репозиторий:** https://github.com/spikeal8-maker/asa-lab  
**Проверенный `main`:** `98485087a977eea97f46d183245d0023e3201c4b`.  
**Материалы:** полное ТЗ `ASA_Lab_TZ_Classrooms_Teacher_Student_UI_v1_2_TWO_ROW_MOBILE_2026-10-24.md` (753 строки), `ASA_Lab_TZ_v1_2_CRITICAL_AUDIT_2026-10-24.md` (169 строк), 17 замечаний от 23.10, КЛ-01…17, исходники и `AGENTS.md`, `START_HERE_FOR_AI.md`, `docs/execution/current.yaml`, Issues #589/#618/#211, текущие PR.  
**Метод:** документ + code/PR/control-plane inspection; реальную собранную страницу на D2-R2 и школьный сервер не запускали.

## 1. GO / NO-GO

**NO-GO для команды «один бот, выполни весь v1.2 до main».** Документ является хорошей картой продукта, но ещё не нормализован в атомарный исполнимый backlog. Исполнение без ведущего контролёра приведёт к неоднозначностям в задачах и возможным регрессиям.

**CONDITIONAL GO** только для организации программы, инвентаризации текущей версии, недеструктивных регрессионных тестов и затем отдельных точно выбранных безопасных срезов после утверждения их scope. Для проекта не требуется ждать реализации публичных проектов, нового рейтинга или единых вкладок до начала исправления SQL журнала, но нельзя объявлять всю программу завершённой раньше интеграционной приёмки.

| Контроль | Оценка | Обоснование |
|---|---|---|
| Есть продуктовая цель | Достаточно | CLX-01…17 и API/SQL/UX описаны |
| Есть полная ретроспективная матрица КЛ-01…17 | Недостаточно | Только общий E2E-21, нет отдельной доказательной прослеживаемости |
| Ясна конечная мобильная композиция | Частично | Две строки заданы, но реальные 320px / 125–200% / десктоп не проверены |
| Конфликты между версиями/источниками разрешены | Нет | Старый профиль на 8 вкладок, оценки и имена соседей; противоречие внутри v1.2 |
| Все API и SQL контракты готовы к реализации | Частично | Columns hide/read-side, новые факторы, уведомления и публикации требуют design gate |
| Работа нарезана на атомарные срезы | Нет | §12 содержит 6 больших этапов, а не ready-to-run task cards |
| Зависимости и порядок приёмки явны | Частично | UI grade editing и backend grading смешаны, перенос общих tabs неопределён |
| Разграничены авторы и опасные пересечения | Частично | Принцип есть, per-task path ownership/handoff нет |
| CI / browser / PostgreSQL проверяемы | Частично | 31 E2E-пункт — сценарии, а не 31 привязанный к task реально существующий тест |
| Каноническая ТЗ+срезы зарегистрированы в GitHub | Нет | v1.2 и независимый аудит находятся вне `docs/product/` текущего `main` |

## 2. Блокирующие противоречия / неясности

**BLOCK-01. Разные источники истины.** ТЗ v1.2 только как локальный Markdown; критический аудит — отдельный файл, его GAP-01…17 ещё не внедрены в v1.2. В GitHub есть `docs/product/ASA_TEACHER_STUDENT_PROFILE_UI_589.md`, требующий 8 вкладок; нынешнее задание — 9. Перед работой единый норматив должен быть принят в `main` с таблицей superseded-решений.

**BLOCK-02. Старый выбранный срез не охватывает программу.** В `docs/execution/current.yaml` в параллельной секции `teacher-student-profile-ui` есть `TASK-TEACHER-STUDENT-PROFILE-UI-589`: scope — восемь вкладок, обычная UI-разработка, **не API/SQL/Auth**; в `task.checkpoint` записан прежний acceptance. Новый рейтинг, скрытие столбцов и детская публикация в эту задачу не помещаются. Контролёр должен зарегистрировать современную программу и самостоятельные ограниченные задачи, не выдавая старую отметку за разрешение.

**BLOCK-03. Недостаточная атомарность §12.** Этап 2 совмещает IdentityRail, SectionRail, перенос настроек, игр, оценок и security-consumer regression. Этап 3 — два способа popover, изменение SQL причины оценки, lifecycle столбцов и связанные с учениками результаты. Этап 4 — серверная фильтрация проектов, миграция формулы рейтинга, события и «антирейтинг». Это не независимые задачи, а крупные программы.

**BLOCK-04. Противоречие оценок.** §5 CL-PROF-03 запрещает глобальную grade rail вне вкладки «Оценки», а §6 CL-JRN-06 требует отображение «в компактной ленте ученика и в его вкладке Оценки» как будто это два разных места. Исправить на: «в одной компактной ленте внутри вкладки “Оценки”, без дубля в общей шапке на мобильном». Для desktop зафиксировать отдельный целевой режим быстрых оценок либо явное снятие прежнего требования.

**BLOCK-05. Имена соседей.** Последнее поручение #589 требует настоящие видимые ФИО соседних учеников, включая телефон; v1.2 разрешает mobile стрелки без видимых ФИО. Нужно утвердить, что в 320–599 стрелки имеют полные aria-имена + доступны реальные ФИО в селекторе, а desktop показывает ФИО при ширине. Без решения бот выберет произвольно.

**BLOCK-06. Точные пиксельные hard caps без доказанного прототипа.** В 390px бюджете 52+44+32 ровно 128px; в 320px 56+44+44 ровно 144px. Не оставлено запаса на рамки, нестандартные шрифты и фактический padding `portal-content`. Это желаемые targets, не подтверждённая feasible архитектура. Сначала измерить реальный built React на 320/390 и с открытым sidebar, затем закрепить допустимые исключения/состояния. Никогда не сокращать hit targets, русский текст, аватар/имя для теста.

**BLOCK-07. Журнал: скрытие/удаление столбца.** Не зафиксировано, скрывает ли `hide` оценки у учащегося, влияет ли на рейтинг, старые notifications и deep-links, кто вправе восстановить, как читать архив. Не писать миграцию до согласования таблицы состояний и read-side ACL. Прямая физическая очистка immutable оценок недопустима.

**BLOCK-08. Рейтинг: не выбрана семантика отсутствующих данных.** §7 CL-RAT-02 содержит «рекомендуемый вариант» исключения недоступного фактора из знаменателя — это не утверждённое требование. Набор новых факторов также только «возможный», нет политики включения для старых классов и влияния на имеющийся `rating_threshold` для Games. Сначала утвердить точный DTO, formula_version, `NULL` vs 0, старые flags/weights и shadow comparison.

**BLOCK-09. Публикации и новые уведомления зависимы от других ботов.** P2-программа детской публикации предполагает новый moderation/public-read ACL, которого нет в нынешнем StudentSeat flow. E2E-17 преимущественно проверяет запреты: необходим положительный E2E. У событий изменения SafeMode/Games нет принятого learner-inbox event contract; нельзя создавать фальшивые уведомления только на frontend.

**BLOCK-10. «Все функции» недостаточно защищены.** Отсутствуют 1:1 проверки: 20 карточек А4 и читаемый PDF/QR, зарегистрированный Account и обработка заявки, код учеников и rotate, 6/5 показателей экранов, helperClasses, выдача заслуг, секретные и загружаемые аватары, приглашения преподавателей, редактор проектов/превью. `E2E-21` не принимает каждый из КЛ-01…17 отдельно.

**BLOCK-11. Карточки проектов 48–64px.** Без инвентаризации текущего `ProjectCard`/`WorkPreview`, модулей и реального teacher preview безусловная замена всех карточек строками изменит смысл экрана. Обеспечить compact teacher-only presentation; не редактировать общий ProjectCard без отдельной инвентаризации consumers.

**BLOCK-12. Границы теста vs процесса.** `AGENTS.md` требует один выбранный срез на запуск исполнителя, а контролёр при разрешённой программе продолжает цепочку. `direct_main` допускает прямой коммит без PR, поэтому «отдельный PR на каждый шаг» не может быть безусловной политикой; при каждом срезе выбрать безопасный тип интеграции. Нужны `SLICE_PASS` и отдельный `PRODUCT_UI_PASS`: не каждый промежуточный безопасный срез уже соответствует финальным двум строкам. Нельзя открывать неработающую девятую вкладку-заглушку ради поэтапности.

**BLOCK-13. Пересекающиеся старые PR.** #605: diverged, 559 behind /1 ahead, 7 файлов; #577: 715 behind /23 ahead, 31 файл, затрагивает почти все UI; #575: 741 behind /13 ahead, старый Gallery. Нельзя blind merge/rebase всего PR. #629 QR browser/print проверка — отдельная ещё не принятая ветка; не объявлять печать проверенной.

**BLOCK-14. Глобальный CI в текущем snapshot не весь зелёный.** `main=98485087...`: snapshot GitHub checks содержал failure в `PostgreSQL tests and RLS`, часть работы ещё исполнялась. Причина без логов неизвестна. Каждый автор должен запускать свой focused gate, а контролёр отдельно учитывать baseline. Не перекрашивать старый run в PASS и не исправлять чужой тест без отдельной задачи.

## 3. Перед стартом — обязательные продуктовые решения

| Решение | Варианты, которые нельзя оставить исполнителю на усмотрение | Предлагаемый норматив |
|---|---|---|
| Desktop оценки | всегда компактная preview-лента / только вкладка «Оценки» | сохранить быстрый desktop обзор, но без второго большого блока; mobile — только внутри «Оценок»; владелец утверждает |
| Mobile имена соседей | печатать оба имени / по стрелкам с selector и доступными именами | mobile 320–599: реальные имена доступны в picker и accessibility; desktop имена видны; владелец утверждает |
| 6/5 метрик списка/открытого класса | скрыть / компактная сводка | числа доступны не далее одного нажатия; desktop в компактной строке, mobile короткая сводка с раскрытием |
| Скрытие колонки | teacher-only hide / hide from learner / withdraw grade | отдельная таблица правил; `hide` не эквивалентен NULL оценке и не удаляет историю |
| Rating unavailable | исключить из denominator / 0 / заблокировать | отдельные правила: измеренный ноль=0; отсутствие источника=unavailable; при unavailable вычисление и game admission явно специфицировать |
| Новые факторы рейтинга | все сразу / по одному | по одному фактору после доказанного источника, правила по умолчанию для старых классов |
| «Антирейтинг» | негативные очки / приватная педагогическая аналитика | безопасная учительская аналитика «Требуют внимания», без публичного позора, после продуктового решения |
| Разрешённые работы для публикации | все classroom originals / отдельная свободная работа | только явно разрешённые free works, неизменяемая опубликованная версия и модерация; отдельное согласование с Public Projects |
| Редактор без причины | комментарий обязателен / nullable | nullable reason, backend immutable revision+author/time+receipt; отдельное изменение API/SQL |

## 4. Предлагаемые атомарные исполнительные карточки

**Правило:** одна карточка = один проверяемый конечный эффект + конкретные пути + focused tests + независимый review на точном SHA, когда требуется; без «заодно» чужих функций. Задачи с одним и тем же исходным файлом выполняются последовательно, не двумя параллельными writers. Ниже — предлагаемая карта, ещё не созданные GitHub Issues.

| ID | Что делает один исполнитель | Основные файлы/владелец | Зависит от | Определение готовности (основное) |
|---|---|---|---|---|
| CTRL-00 | Принять единый v1.3-контракт: объединить v1.2+GAP-01…17, утвердить решения, создать 34-ID ledger, обновить current.yaml в main | `docs/product/`, `docs/execution/current.yaml`; контролёр | — | один versioned source, точные scopes/accepted IDs, нет конфликтующих 8/9 tabs |
| QA-01 | Инвентаризация принятых возможностей КЛ-01…17, baseline built-browser/screenshots и геометрия | существующие e2e/CI; QA | CTRL-00 | SHA, before screenshots, реальные размеры, список закрытых/открытых регрессий |
| QA-02 | Изолированная регрессия print/QR: 20 А4, actual output, decode и коды без leak | `StudentAccessCards`/tests; Classroom QA | CTRL-00 | отдельные печатные сценарии, без изменения данных; учесть #629 |
| QA-03 | Account join/request/approve/reject/message и Student Code/teacher operations: регрессия | Classroom join/tests; Classroom + Account owners | CTRL-00 | реальные API/PG тесты на синтетической БД, сохранены личные проекты |
| DATA-01 | Исправить active journal roster для `removed` + PG negative cases | новая `migrations/NNNN_*.sql`, tests; classroom data | CTRL-00 | removed нет в активной таблице, история/связанный Account целы |
| DATA-02 | Аудит прочих active readers, исправлять только обнаруженные дефекты в отдельном срезе | актуальные SQL reader functions, tests | DATA-01 | documented matrix active/historical, 403/tenant/grants safe |
| SAFE-01 | Авторитетное effectiveSafeMode через API/DTO, read-only UI с class/seat/effective | Classroom API/UI, classroom profile/test | CTRL-00 | 3 комбинации + archival/403 и refresh, действующие запреты не меняются |
| UI-01 | Скомпоновать IdentityRail и desktop/mobile переходы между реальными учениками | `ClassroomStudentPage.tsx`, `classroom-student.css`, профильные e2e | QA-01 | видимые имена по принятому правилу, no stale profile, 1/100 roster, 320/390 |
| UI-02 | SectionRail: заменить громоздкую навигацию существующих восьми разделов на mobile selector, без изменения бизнес-API | те же frontend files, e2e | UI-01 | все прежние разделы достижимы, возвращение/back/focus, никакой пустой вкладки |
| UI-03 | Добавить **полностью рабочую** девятую вкладку «Настройки»: категории данных, доступа, безопасности, текущие callback; dirty guard | профиль/ClassroomPage/modals + focused tests; один frontend writer | UI-02, SAFE-01 | существующие операции доступны, без ложного сохранения, каталог 4 категорий |
| UI-04 | Перенести Games Seat policy внутрь категории «Игры» и монтировать лениво; убрать верхний блок | профиль/`ClassroomGamesSettings.tsx` + game tests | UI-03 | inherit/allow/deny/threshold работают после reload, нет верхнего блока |
| UI-05 | Отдельно доказать reachability заслуг, секретных/class аватаров, helperClasses, карт доступа, role и старых полных функций | профиль/`ClassroomParticipantPanels.tsx`/SeatAwards/tests | UI-03 | выдача/отзыв и правильные permissions на desktop/mobile без регрессии self-view |
| UI-06 | Компактные оценки **только выбранного teacher-раздела** с двумя page cursors; desktop режим по владельческому решению | `ClassroomStudentPage`, `ClassroomParticipantPanels`, tests | UI-02, owner decision | 0/1/30/100 manual+assigned, без дубля и teacher-history-кнопок |
| UI-07 | Переход от ручной оценки к настоящему редактору, от результата задания — к реальному review | профиль/gradebook/nav; tests | UI-06, JOUR-03 | edit current grade, NULL vs 0, 409; не перепутать два workflows |
| UI-08 | Уплотнить teacher-only список работ без регрессии `ProjectCard`/`WorkPreview`, с реальными ACL/preview | профиль/локальные project UI files | UI-02, QA-01 | один tap открывает реальную работу, сохранились preview и доступы |
| WORK-01 | Спецификация и server-side filter/sort до pagination, total/hasMore после ACL | participants API/SQL, PG tests | CTRL-00 | waiting item №70 появляется в первой странице выбранного фильтра |
| WORK-02 | Подключить мобильную кнопку «Фильтры», архив/status/sort и честное сохранение состояния | профиль/participant API client/test | UI-02, WORK-01 | нет локальной псевдосортировки по первым 30, owner-visible UX |
| JOUR-01 | Desktop anchored popover к ячейке с collision и focus | `ManualClassroomJournal`, CSS, E2E | CTRL-00 | левый/правый/нижний край, scroll/resize, real save, no overlay |
| JOUR-02 | Mobile bottom sheet для существующего журнала, numeric keyboard, focus/back | те же journal files, mobile e2e | JOUR-01 | 320/390, keyboard, Esc/back, 44px targets |
| JOUR-03 | Убрать mandatory reason на UI/API/SQL с сохранением immutable audit, receipt, notifications | новая SQL миграция, journal controller/client/editor/tests | CTRL-00 | 3→5 и 5→NULL без комментария, 409, replay, прежние записи целы |
| JOUR-04A | Утвердить lifecycle hidden column и read-side по teacher/learner/rating/inbox | product security decision + precise API matrix | CTRL-00, owner decision | нет двусмысленного «удалить» и нарушения истории/результатов |
| JOUR-04B | Implement archive/restore column с авторизацией и историей, new additive SQL | migrations/controller/PG tests | JOUR-04A | active/historical views и deep links согласованы, нет physical DELETE |
| JOUR-04C | Компактные 48–56px колонки и UI hide/restore, включая virtual | journal React/CSS/tests | JOUR-04B | ширина/скролл/первые 10 слотов/восстановление/касаемость |
| RATE-01 | Контракт новых weights/factor availability/version + shadow old/new, без смены legacy score | participants migration/API/PG tests | CTRL-00, owner decision | старые классы получают прежние результаты/игры, no silent drift |
| RATE-02 | Редактор весов и превью по запросу, без длинных плашек | `ClassroomParticipantPanels`, class settings UI/tests | RATE-01 | сумма, границы, saved/version/conflict, 320px, game threshold impact preview |
| RATE-03 | Изменить начисление за пустой вход, проверка UTC/edit/idle и game admission | rating SQL/API + PG/integration; Games coordination | RATE-01 | no idle bonus, корректные 0 vs NULL, threshold не ломается молча |
| RATE-04 | Добавлять **по одному** новому фактору с подтверждёнными событиями; отдельная карточка на фактор | rating SQL/API/UI/tests | RATE-01 | source/normalization/absence/abuse/ACL у каждого фактора доказаны |
| NOTIFY-01 | Проверить и сохранить текущие grade/result/inbox Seat/Account без создания новой системы | Learning/Seat results, notifications tests | CTRL-00 | клик по оценке до разрешённого результата, refresh, no duplicates |
| NOTIFY-02 | Новые policy/moderation events только после принятого event-контракта с владельцем Learning/Projects | Learning owner + Classroom consumer | NOTIFY-01, product decision | соответствующие события из настоящего backend, read/unread/ACL |
| PUB-01 | Совместно с Public Projects утвердить publishability, privacy, class/seat policy, moderation и revoke | Public Projects owner + owner decision | CTRL-00 | серверная модель допуска и положительный E2E специфицированы |
| PUB-02 | Реальный guarded publication request→moderation→public/read→revoke, с негативными сценариями | Public Projects backend, migrations, PG/E2E; **не Classroom UI бот** | PUB-01 | happy path и все deny/read-side/media/copy/security тесты |
| PUB-03 | Учительские настройки класса/Seat и точные статусы ученику по принятому API | Classroom UI, student settings, tests | PUB-02 | policy persisted, no fake toggle, работает после refresh |
| UX-01 | Отдельное решение по #577 shared tabs/toasts: перенос только нужного узкого примитива либо supersede | shared UI owner, tests | UI-02 | не переносить 31-file PR, единые стили без regression других экранов |
| QA-FINAL | Все 34 требования + модификации, полный browser/PG/E2E/visual, и separate deployment gate | QA/controller | принятые зависимые пакеты | exact SHA, PASS/FAIL/NOT_RUN отдельно; main ≠ deployed ≠ owner accepted |

### Правило параллельности

- Можно параллельно при непересекающихся путях: `QA-02` (печать), `DATA-01` (SQL journal), `UI-01` (профиль), `NOTIFY-01` (QA), после preflight и только одним writer на путь.
- **Последовательно:** `UI-01→UI-02→UI-03→UI-04`, `UI-06→UI-07`, `JOUR-01→JOUR-02`, `JOUR-04A→B→C`, `RATE-01→RATE-02/03`, `WORK-01→WORK-02`, `PUB-01→PUB-02→PUB-03`.
- Каждая отдельная карточка имеет самостоятельный `SLICE_PASS` и `NO_REGRESSION`; **полный `PROFILE_UI_DENSITY_PASS`** для всех двух мобильных строк — только на интегрированном профильном checkpoint после соответствующих UI-срезов, иначе отдельные безопасные промежуточные работы невозможно честно интегрировать без единого гигантского PR.
- Общее `main` не замораживать бессрочно; использовать один ограниченный convergence cycle, как в `AGENTS.md`, и проверять точный SHA. Пересечение файлов и security contracts — handoff или STOP. Отдельный исполнитель заканчивает одну карточку и останавливается; контролёр, уполномоченный вести программу, выбирает следующую.

## 5. Шаблон обязательной карточки для бота

```
TASK_ID:       ID только одного среза
OWNER_AREA:    например classroom/journal (не другой продукт)
BASE_SHA:      фактический origin/main при выборе
DEPENDENCIES:  принятые SHA предшественников, не «планируется»
STATUS:        READY | BLOCKED | IN_PROGRESS | REVIEW | ACCEPTED_MAIN | DEPLOYED
ONE_RESULT:    одно поведение, проверяемое глазами или тестом
IN_SCOPE:      точные paths/functions/DTO/API
OUT_OF_SCOPE:  чужие подсистемы, большие рефакторинги, production
FILES_OWNER:   один writer per intersecting path
TESTS:        focused commands / expected PG / real browser / negative cases
ACCEPTANCE:   список конкретных утверждений, каждый PASS/FAIL
HANDOFF:      что передаётся следующей карточке как контракт, точный SHA
STOP_IF:      конфликт файлов, неподтверждённый API/ACL, несовпадение смыслового решения,
              реальная ошибка безопасности/БД, требующий владельца product decision
REPORT:       base_sha, code_sha, changed_paths, test names/counts, CI run links,
              independent review, actual UI screenshot+measurement, main_sha,
              deployed_sha=NOT_RUN, next allowed card=none (решает контролёр)
```

**Исполнитель:** один выбранный срез до focused gate/self-review → независимая проверка (при необходимости) → интеграция контролёром, STOP.  
**Контролёр:** после acceptance обновляет registry/actual GitHub snapshot и выбирает следующую READY-карточку; сохраняет все 17+17 и не смешивает `merged`, `deployed`, `owner accepted`.  
**Reviewer:** read-only source/SQL/browser на точном SHA, не пишет продуктовый код.

## 6. Декомпозиция тестов

В v1.2 перечислен 31 текстовый E2E сценарий. Это **не** означает, что 31 отдельный автоматический тест существует или проходит. Для каждой карточки назначить 2–6 адресных PASS assertions + релевантные security negative checks. Отдельно создать ledger для всех исторических КЛ-01…17: не закрывать одним `E2E-21`.

Полный продуктовый checkpoint имеет уровни:

1. `SOURCE_PASS` — подтверждённые применённые исходники, не один текст PR.
2. `FOCUSED_PASS` — текущий SHA и тесты задачи, без `skip`, с явным PG/API где требуется.
3. `INDEPENDENT_APPROVE` — точный SHA, без самооценки автора.
4. `INTEGRATED_MAIN` — код после допустимой конвергенции присутствует в `main`, нет поражения других задач.
5. `UI_ACCEPTED` — независимый built React screenshot/geometry, внимание к старым функциям и мнению владельца.
6. `DEPLOYED_VERIFIED` — только после **отдельно разрешённого** rollout, проверки DB и build SHA.

Изолированный визуальный тест с synthetic API полезен для UI, но не подтверждает SQL/ACL, а e2e с реальным API/PG полезен для security, но не заменяет оценку композиции человеком.

## 7. Что можно начать, а что должно ждать

**Первым запуском контролёра:** `CTRL-00` (согласование/версионирование), затем `QA-01` (база изменений). Для уже установленного SQL-дефекта `DATA-01` и компактного учительского UI `UI-01` технически достаточно текущих исходников, **но начинать запись следует только после принятой карточки и безопасного preflight**, а не параллельно с прежней не согласованной #589.

**Не запускать пока:** `JOUR-04B/C` до таблицы решений, `RATE-01…04` до определения unavailable/rollout и эффектов на игры, `NOTIFY-02` до контракта событий, `PUB-02/03` до авторизованной модели Public Projects, `UX-01` как blind merge PR #577. Электроника #688/#689 — separate owner regression, не задача нового Classroom бота.

**Список прямых продуктовых решений:** desktop grade summary, отображение соседних ФИО на телефоне, мобильные 6/5 KPI, lifecycle удалённого столбца, отсутствие данных в рейтинге и влияние на игры, факторы и отдельный антирейтинг, допустимая публикация учащихся и условия модерации.

## 8. Окончательный вывод

Оставить v1.2 исходной продуктовой базой и объединить с аудитом в **v1.3 — норматив и исполнения**. Не публиковать одно огромное задание. Создать поэтапную программу с однозначным `READY/BLOCKED` для каждой карточки, одноразовым preflight и доказуемым terminal condition. После `CTRL-00/QA-01` можно двигаться по отдельным P0 срезам; полноценное «готово» означает accepted main + визуальный built-browser + сохранность старых функций, а deployment и owner acceptance — отдельные явные статусы.

**Ничего в GitHub, пользовательских данных, Docker и школе этим аудитом не изменено.**
