# ASA Lab — исполнимый контролёр программы «Классы»

> **Основной режим — GitHub, а не ZIP/Windows.** [Программа #715](https://github.com/spikeal8-maker/asa-lab/issues/715) → [текущий ограниченный Issue #716](https://github.com/spikeal8-maker/asa-lab/issues/716) → выполнение ботом → exact-SHA CI/review → receipt в GitHub → следующая карточка. После отдельного review и интеграции [PR #712](https://github.com/spikeal8-maker/asa-lab/pull/712) в `main` появится [GitHub Actions → Classroom Program — Next GitHub Issue](https://github.com/spikeal8-maker/asa-lab/actions/workflows/classroom-program-next-issue.yml): действие `inspect` проверяет очередь, `create` создаёт ровно один следующий Issue при выполненных зависимостях. Действие **не запускает программирование** и **не меняет main**. До merge Actions workflow недоступен в default branch.

Полный порядок: [GITHUB_FIRST.md](GITHUB_FIRST.md). Локальный CLI и HTML-доска ниже — вспомогательные инструменты и не являются канонической очередью поручений.


**Рабочая версия 1.0 · 24.10.2026.** Не ещё одно ТЗ и не самостоятельный бот, который правит школьный сервер. Это исполнимый **реестр задач и доказательств**, который блокирует некорректный порядок и генерирует ограниченные поручения другим ботам. Код не использует внешние пакеты и не требует интернета для просмотра/проверки зависимостей.

## Состав

- `classroomctl.py` — работающий CLI: `validate`, `status`, `next`, `list`, `show`, `decisions`, `decide`, `brief`, `start`, `record`, `accept`, `stop`, `resume`, `board`.
- `registry.json` — 38 атомарных карточек (34 исходные из аудита + 4 пропущенные области), зависимости, разрешённые пути, 34 исходных требования КЛ/CLX, проверяемые критерии, 9 блокирующих продуктовых решений.
- `sources/` — оригинальные v1.2, критический аудит, анализ готовности и замечания владельца; не редактируются инструментом.
- `receipts/` — независимые JSON-файлы по одной задаче, создаются по ходу работы. Это позволяет нескольким ботам фиксировать независимые направления без общего конфликтующего `state.json`.
- `decisions/` — отдельные ревизуемые файлы принятых продуктовых решений. Ни одного решения заранее не выдано за согласованное.
- `classroom-board.html` — локальная интерактивная доска: поиск, фильтр, зависимости, блокеры, детальная карточка и копирование ограниченного поручения. Это **снимок**, не live-данные GitHub и не средство бесконтрольной отправки изменений.
- `PRIMER_CTRL-00.md` — уже сформированное поручение для первого контролёра.
- `tests/test_controller.py` — unit-тесты блокировок, зависимости/решения/CI/SHA и генерации доски.

## Запуск (Windows / macOS / Linux)

Требуется только Python 3.10+ и Git для подтверждения интеграции. В терминале из каталога распакованного архива:

```powershell
python classroomctl.py validate
python classroomctl.py status
python classroomctl.py next
python classroomctl.py board --output classroom-board.html
python -m unittest discover -s tests -v
```

Откройте `classroom-board.html` двойным щелчком. Доска обновляется после повторного запуска команды `board`; данные хранятся в JSON и не зависят от localStorage браузера.

## Реальная работа контролёра

```powershell
# 1. Вывести доступные и заблокированные задачи
python classroomctl.py next
python classroomctl.py show CTRL-00
python classroomctl.py decisions

# 2. Создать поручение на точном origin/main SHA:
python classroomctl.py brief CTRL-00 --base-sha 98485087a977eea97f46d183245d0023e3201c4b --output CTRL-00-task.md

# 3. Исполнитель сначала реально выполняет preflight в репозитории:
# pnpm agent:preflight --path docs/product/<нужный-путь> --check
# Вывод должен содержать SAFE_TO_START и НЕ содержать RECOVERY_REQUIRED/WAITING_HANDOFF.
# Запишите stdout в preflight.txt и зафиксируйте его с SHA.
python classroomctl.py start CTRL-00 --base-sha <АКТУАЛЬНЫЙ_SHA> --actor controller-bot --preflight preflight.txt

# 4. После настоящей работы записывайте реальные receipts по точному коду:
python classroomctl.py record CTRL-00 --kind source --sha <SOURCE_SHA> --uri https://github.com/spikeal8-maker/asa-lab/commit/<SOURCE_SHA> --result PASS --actor executor-bot
python classroomctl.py record CTRL-00 --kind focused --sha <SOURCE_SHA> --uri https://github.com/spikeal8-maker/asa-lab/actions/runs/<REAL_ID> --result PASS --actor executor-bot
python classroomctl.py record CTRL-00 --kind review --sha <SOURCE_SHA> --uri https://github.com/spikeal8-maker/asa-lab/pull/<REAL_PR> --result PASS --actor independent-reviewer
python classroomctl.py record CTRL-00 --kind integration --sha <MAIN_SHA> --uri https://github.com/spikeal8-maker/asa-lab/commit/<MAIN_SHA> --result PASS --actor controller-bot

# 5. Только внутри клона с обновленным origin/main:
python classroomctl.py accept CTRL-00 --main-sha <MAIN_SHA> --repo-root <ПУТЬ_К_РЕПОЗИТОРИЮ>
python classroomctl.py next
```

Никаких фиктивных SHA, ссылок на CI или заверений об успешных тестах. `record` проверяет формат/наличие evidence и **явно маркирует внешние URL как не проверенные автоматически**. `accept` дополнительно требует реально существующий `origin/main`, включающий исходный коммит. При squash без сохранения исходного commit SHA безопасная ручная конвергенция требует отдельного доказательства; инструмент её не подделывает.

Для отдельной задачи с SQL понадобятся настоящие PostgreSQL evidence (`pg`), для видимого UI — `visual`, для всех — `focused`, `review`, `integration`, `source` на согласованных SHA. `review` от самого автора запрещён. При `FAIL` задача переходит в `STOPPED`; новая попытка — `resume` только с новым preflight.

## Продуктовые решения

9 вопросов сохраняют статус **UNRESOLVED** до подтверждённого решения владельца. Для записи одного выбранного варианта:

```powershell
python classroomctl.py decisions
python classroomctl.py decide desktop_grades --choice compact_inline --evidence https://github.com/spikeal8-maker/asa-lab/issues/<APPROVAL_ISSUE> --actor controller-bot
```

**Нельзя считать пример выше реальным одобрением.** Инструмент не устанавливает решения автоматически. Каждое записанное решение требует верификации контролёром; при изменении решения необходима новая согласованная редакция спецификации, не молчаливое перезаписывание файла.

## GitHub-first и границы безопасности

GitHub-репозиторий `spikeal8-maker/asa-lab` является основной средой. Файлы уже находятся в Draft PR #712 под `tools/classroom-program/`; после независимого review и разрешённой интеграции их каноническая версия будет в `main`. `receipts/<ID>.json` и `decisions/<KEY>.json` затем фиксировать отдельными коммитами для аудита. Нет автоматического обновления `docs/execution/current.yaml`: эту каноническую выборку делает только контролёр после согласования.

**Этот инструмент не** изменяет код приложений, не создаёт PR/Issues без явного запуска владельцем/контролёром, не перезапускает Docker, не применяет миграции БД и не рассылает уведомлений. Исключение — ручной GitHub Actions workflow `classroom-program-next-issue.yml`: после принятой интеграции в `main` он читает GitHub API и при `create` открывает **один** следующий разрешённый Issue. Он не выполняет продуктовый код. Для реальной разработки по `AGENTS.md` и `START_HERE_FOR_AI.md` нужны штатные preflight/gates, ограниченная авторизация выбранного среза и настоящий GitHub Actions CI. `ACCEPTED_MAIN` не равно `DEPLOYED_VERIFIED` и не равно приёмке владельца.

## Известные границы

- Источник текущего GitHub `main` в поставке — наблюдение, **не живой SHA**. Перед каждым поручением указывайте заново проверенный `origin/main`.
- Доска — пользовательский наблюдатель, а не редактор evidence. Мутации делаются через CLI с версиями JSON в Git.
- Первоначально разрешён только `CTRL-00`; остальные задачи честно заблокированы зависимостями и/или неутверждёнными решениями.
- «34 требования» означает 17 октябрьских КЛ + 17 новых CLX, а «38 карточек» — атомарный план. Не путать с 31 текстовым E2E-сценарием v1.2.
- Нужно подготовить нормативную v1.3 в `main`: программа в реестре не становится автоматически утверждённым правилом, пока это не сделано.


## Контракт безопасности приёмки (исправление P1, 24.10.2026)

После независимого review контролёр переведён в **fail-closed** режим. CLI `record` сохраняет отчёт исполнителя, но не удостоверяет его: ссылки и метки `PASS` не являются доказательствами.

- `start` и `resume` самостоятельно выполняют действующий `pnpm agent:preflight --check` в каноническом Git checkout, проверяют фактический код завершения, SHA `HEAD`/`origin/main` и выбор конкретной карточки в `docs/execution/current.yaml`. Переданный `--preflight` — только исторический протокол, сам по себе право начать не даёт.
- После `FAIL` следующий `resume` увеличивает идентификатор цикла. Все старые положительные evidence остаются в истории, но **не используются** для новой приёмки.
- `decide` записывает **заявку**, а не утверждённое решение. Блокер снимается только при подтверждённом комментарии владельца в главной Issue #715: отдельная строка `ASA-CLASSROOM-DECISION:<ключ>=<вариант>`, ссылка вида `https://github.com/spikeal8-maker/asa-lab/issues/715#issuecomment-<id>`, автор `spikeal8-maker`, проверено через API GitHub.
- `accept` требует `GH_TOKEN`/`GITHUB_TOKEN`, реальный текущий GitHub `main`, исходный SHA — его предок, действительно merged PR для указанной карточки, независимый APPROVED-review на тот же SHA **либо** завершённый clean GitHub Codex review, реальные успешные GitHub Actions на exact SHA и соответствующие успешные job. Локальный Git, URL или поддельный текст самостоятельно ничего не разрешают. Для `pg` и `visual` проверяются соответствующие job. Работа без доступного GitHub API означает STOP, а не слепую приёмку.
- Создание следующей задачи через GitHub Actions проверяет активный Issue, его зависимости, подтверждение решения владельца и происхождение от контролёра. Единственное ручное bootstrap-исключение — открытая владельцем Issue #716 (`CTRL-00`).
- `ACCEPTED_MAIN` **не** означает `DEPLOYED_VERIFIED` или `OWNER_ACCEPTED`. Школьная БД, контейнеры и production этим контролёром не затрагиваются.

Пока PR контролёра не получил **новые exact-HEAD CI SUCCESS и независимый clean review**, контролёр остаётся Draft. Первый следующий этап — только CTRL-00 по #716, не профиль/журнал/рейтинг.


### Сопоставление focused CI с конкретной карточкой

После CTRL-00 нельзя переиспользовать успешный workflow контролёра в качестве доказательства для
продуктовой карточки: он проверяет реестр и Python-контролёр, а не inbox, журнал, API или
браузерную функциональность. В `verified_github.py` для CTRL-00 закреплены точный путь
`.github/workflows/classroom-controller.yml`, job `validate` и три обязательных успешных
шага проверки реестра и тестов контролёра.

**Каждая другая карточка перед своей приёмкой обязана получить явно проверенный и
опубликованный вместе с нормативом контракт `focused_ci`** в каноническом
`registry.json`. Поля: `task_id` (точный ID карточки),
`workflow_path` (действующий `.github/workflows/*.yml` или `*.yaml`),
`required_jobs` (список точных имён успешных jobs),
`required_steps` (список точных имён успешно исполненных шагов; как минимум
один явно включает ID карточки). Изменение контракта нужно внести также в источник
генерации `build_registry.py`, чтобы регенерация сохраняла байтовую детерминированность.
Привязка в реестре и сам workflow проходят отдельное независимое ревью до приёмки
карточки; нельзя подменять их строками receipt или наименованиями обычного CI.

При отсутствии такой карточной привязки `accept` выдаёт **BLOCKED**, а не
принимает ближайший успешный «Classroom» workflow. При наличии привязки сверяются
точный source SHA, GitHub repository, статус и conclusion workflow, его
`path`, полный список jobs, названия и успешный статус требуемых steps.
Отдельные `pg` и `visual` gate остаются обязательными, если указаны в карточке.
Это защищает от ложного `ACCEPTED_MAIN` без реальных пользовательских сценариев;
это не разрешение автоматически выдавать все 38 задач или сливать Draft.
