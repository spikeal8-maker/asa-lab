# ASA Lab — исполнимый контролёр программы «Классы»

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

Предпочтительный путь установки — добавить файлы в репозиторий `spikeal8-maker/asa-lab` под отдельный каталог (например, `tools/classroom-program/`) и закоммитить. `receipts/<ID>.json` и `decisions/<KEY>.json` затем фиксировать отдельными коммитами для аудита. Нет автоматического обновления `docs/execution/current.yaml`: эту каноническую выборку делает только контролёр после согласования.

**Этот инструмент не** изменяет код приложений, не открывает PR/Issues без человека, не вызывает GitHub API, не перезапускает Docker, не применяет миграции БД и не рассылает уведомлений. Для реальной разработки по `AGENTS.md` и `START_HERE_FOR_AI.md` нужны штатные preflight/gates, ограниченная авторизация выбранного среза и настоящий GitHub Actions CI. `ACCEPTED_MAIN` не равно `DEPLOYED_VERIFIED` и не равно приёмке владельца.

## Известные границы

- Источник текущего GitHub `main` в поставке — наблюдение, **не живой SHA**. Перед каждым поручением указывайте заново проверенный `origin/main`.
- Доска — пользовательский наблюдатель, а не редактор evidence. Мутации делаются через CLI с версиями JSON в Git.
- Первоначально разрешён только `CTRL-00`; остальные задачи честно заблокированы зависимостями и/или неутверждёнными решениями.
- «34 требования» означает 17 октябрьских КЛ + 17 новых CLX, а «38 карточек» — атомарный план. Не путать с 31 текстовым E2E-сценарием v1.2.
- Нужно подготовить нормативную v1.3 в `main`: программа в реестре не становится автоматически утверждённым правилом, пока это не сделано.
