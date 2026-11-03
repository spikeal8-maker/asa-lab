# AGENT_CHANGE_WORKFLOW — изменение, публикация и развёртывание

Это постоянный маршрут coding-агента ASA Lab. Он не хранит активную задачу,
ветку, Issue, checkpoint или SHA. Текущее состояние всегда читается только из
[`../execution/current.yaml`](../execution/current.yaml).

Для серверов с готовыми образами применяется
[`PORTABLE_OPERATIONS.md`](../deployment/PORTABLE_OPERATIONS.md): единый менеджер,
полный backup и проверенный выпуск. Публикация кода не включает расписание сама.
Явное разрешение владельца на еженедельное обслуживание действует в настроенном
окне; повторного вопроса перед каждым запуском не требуется.

## 1. Сначала получи минимальный контекст

Выполни одну команду preflight; если план известен, перечисли каждый точный
repository-relative файл отдельным `--planned-path`:

```bash
pnpm agent:preflight --scope <lane> --check --planned-path <file-a> --planned-path <file-b>
```

Для картированного локального изменения вместо широкого `--scope` выбери один
из `--path`, `--surface` или `--control`. Когда план ещё неизвестен, получи
контекст без `--planned-path`, затем проверь полный точный план до первой записи.

Preflight уже обновляет `origin/main`, показывает Git snapshot, чужие dirty
worktree, пересечения, blockers, control-plane и scoped context. Читай только
документы и разделы из этого context. Отдельные `agent:context`, `agent:recover`
и `control-plane:check` нужны для диагностики или выполнения `SAFE_ACTION`,
а не как повторная обязательная цепочка. Политика Git и обновления рабочей
`main` из [`START_HERE_FOR_AI.md`](../../START_HERE_FOR_AI.md) сохраняется.

Запись начинается только при фактическом `SAFE_TO_START`. Реальные пересечения
и неизвестное состояние чужого worktree блокируют её даже при точном плане.
При ненулевом exit code или ином статусе новый срез не начинается: разбери
ошибку и выполни выданный `SAFE_ACTION`. Для recovery определи,
какие dirty paths и процессы относятся к прерванной работе, что уже было
committed/pushed/tested и можно ли безопасно завершить текущий срез. Запрещено
повторять migration, build, push, deployment или другую потенциально повторную
операцию только потому, что предыдущий tool-call не вернул ответ.

Для измерения стоимости маршрута на одном SHA сохраняй число команд, elapsed
и UTF-8 bytes фактических stdout+stderr. Это показатели вызовов и объёма
контекста, не model tokens. Недоступный расход токенов остаётся неизвестным;
снижение объёма вывода само по себе не доказывает экономию токенов или времени.

## 2. Сделай один цельный пакет

- Исправляй одну принятую владельцем задачу или один проверяемый срез.
- Не перезаписывай чужие незавершённые изменения.
- Запускай focused gate из контекста задачи. Полный gate нужен только там, где
  он действительно является критерием результата.
- Не создавай отдельный коммит после каждой мелкой правки. Сначала доведи срез
  до зелёного состояния, затем создай один осмысленный коммит.
- Добавляй в индекс только проверенные пути: `git add <file> ...`. Команда
  `git add .` запрещена при параллельной работе.

## 3. Опубликуй без потери параллельной работы

После focused gate проверь полный dirty и committed diff выбранного среза:

```bash
pnpm agent:preflight --scope <lane> --verify-plan --diff-base <known-ancestor> --planned-path <file-a> --planned-path <file-b>
```

Укажи весь план и известный commit, который является предком текущего `HEAD`.
`--check` и `--verify-plan` взаимоисключающие: первый требует `SAFE_TO_START`,
второй возвращает `PLAN_VALID` только для проверки scope. `PLAN_VALID` не
разрешает новые edits или публикацию сам по себе, не очищает recovery и не
отменяет handoff или blockers. Выполни соответствующий `SAFE_ACTION`; сохрани
разрешение и evidence выбранного среза. Если до публикации изменился состав
файлов или Git-состояние, повтори применимую проверку.

Перед коммитом и публикацией:

```bash
git diff --check
git status --short
git diff --cached --name-only
git commit -m "type(scope): coherent result"
git fetch origin refs/heads/main:refs/remotes/origin/main
git log --oneline --decorate --max-count=8 --all
git diff --name-only HEAD...origin/main
git diff --name-only origin/main...HEAD
```

Первая трёхточечная команда показывает новые удалённые пути после общей базы,
вторая — пути локального коммита. Так пересечение проверяется до изменения
истории.

Если `origin/main` не сдвинулся, отправь обычным `git push origin main`.

Эта команда применяется только для работы в `main`. Для выбранной существующей
feature-ветки fetch/check выполняется также для её remote ref, а обычный push
отправляет `HEAD` именно в неё; PR не означает разрешение публиковать в `main`.
Ограниченный цикл сближения feature-ветки описан в `AGENTS.md` §2.1.

Если он сдвинулся:

1. Сравни удалённые пути со своими.
2. При пересечении остановись и согласуй изменения; не выбирай победителя
   автоматически.
3. При отсутствии пересечений разрешено перенести только ещё не опубликованный
   локальный коммит поверх `origin/main`, затем повторить focused gate.
4. При конфликте отмени перенос, сохрани рабочие файлы и остановись.
5. Force-push, переписывание опубликованной истории и автоматическое разрешение
   конфликтов запрещены.

После push дождись CI именно для финального SHA. Новый push может отменить
промежуточный workflow, поэтому отменённый запуск не является ошибкой продукта,
но и не является доказательством. Один зелёный workflow на точном финальном SHA
достаточен.

## 4. Не смешивай уровни готовности

Каждый уровень фиксируется отдельно:

1. `edited` — файлы изменены;
2. `tested locally` — перечисленные команды действительно выполнены;
3. `committed` — создан локальный коммит;
4. `pushed` — SHA доступен в выбранной удалённой ветке (`main` либо task branch);
5. `CI success` — workflow зелёный на том же SHA;
6. `deployed` — конкретная установка обновлена и readiness подтверждён;
7. `owner accepted` — владелец принял видимый результат.

Push в GitHub не обновляет Docker и не означает deployment. Продуктовый бот не
перезапускает локальный или production runtime без прямого поручения владельца.
В отчёте нельзя использовать неоднозначное «опубликовано»: укажи отдельно
`pushed` (SHA находится в GitHub) и `deployed` (конкретная Docker-установка
подтвердила тот же SHA).

## 5. Обнови существующую Docker-установку

Scratch — сервис того же Compose project, не отдельная установка. До любых
команд найди каталог работающей PostgreSQL, проверь Web/API/Scratch, существующие
порты и overlays по [единому deployment-маршруту](../deployment/SCRATCH_INSTALLATION.md).
Занятый порт не разрешает создать новую установку или новый endpoint.

Сначала только проверка, без изменения runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production -EntryOrigin https://asa-lab.ru -CheckOnly
```

```bash
ASA_COMPOSE_PROFILE=production ASA_UPDATE_ENTRY_ORIGIN=https://asa-lab.ru bash tools/docker-update.sh --check
```

Вместо примерного HTTPS-адреса укажи фактический URL входа владельца; для
локальной сети это может быть `http://172.23.104.170:4610` в `dev`. Не
используй `localhost`, если владелец входит по IP. Только после прямого
поручения на обновление запусти ту же команду без `-CheckOnly` или `--check`.
Защищённый updater проверяет чистоту checkout,
fast-forward, зелёный CI точного SHA, создаёт проверенный backup, обновляет
Compose и ждёт `/health/ready`. Дополнительно он привязывает запуск к каталогу
работающей PostgreSQL, запрещает смешение контейнеров из разных checkout и
требует одинаковый точный SHA от API, Web `build-metadata.json` и Scratch
`asa-commit.txt`. Он также проверяет ASA и `/internal/blocks/` через указанный
адрес. Браузерный вход, сохранение и повторное открытие проекта остаются
`NOT_RUN` до отдельной приёмки; HTTP-health не заменяет этот путь. Подробности:
[`../deployment/GUARDED_UPDATE.md`](../deployment/GUARDED_UPDATE.md).

Не меняй `COMPOSE_PROJECT_NAME`: другое имя подключит другой PostgreSQL volume
и может выглядеть как потеря пользователей.

Не обновляй эту установку из другой копии репозитория. Если preflight сообщает
`CHECK BLOCKED` и перечисляет разные working directories, перейди в каталог,
которому принадлежит контейнер PostgreSQL, и только оттуда выполни полный
защищённый updater. Он пересоберёт Scratch, API и Web из одного `origin/main`.

## 6. Разверни на новом компьютере

Только на действительно новом целевом компьютере без выбранной ASA-установки
новая установка начинается с чистого клона `main`, приватного `.env` и
[`../deployment/QUICK_START.md`](../deployment/QUICK_START.md). Git содержит код
и миграции, но не содержит пользователей, токены, `.env` или дамп базы.
Общий startup включает Scratch автоматически. Не создавай для него второй
Compose project, отдельный backend или новый набор пользователей.

Если нужна история пользователей, сначала перенеси проверенный внешний backup,
а восстановление проверь в отдельной базе. Не копируй старую рабочую директорию
поверх нового клона и не коммить локальные секреты.

## 7. Резервная копия и восстановление

Создание проверенного backup:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-backup.ps1 -Profile production -Output backups/asa-lab-production.dump
```

```bash
ASA_COMPOSE_PROFILE=production bash tools/docker-backup.sh backups/asa-lab-production.dump
```

Проверочное восстановление всегда выполняется только в базу с суффиксом
`_test`:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-restore.ps1 -Profile production -Backup backups/asa-lab-production.dump -RestoreDatabase asalab_restore_test
```

```bash
ASA_COMPOSE_PROFILE=production bash tools/docker-restore.sh backups/asa-lab-production.dump asalab_restore_test
```

Эти helpers принципиально не восстанавливают рабочую базу. Восстановление live
БД — отдельная аварийная операция: требуется прямое решение владельца, свежий
backup текущего состояния, точное имя установки и БД, окно обслуживания и
план отката. Полные правила:
[`../deployment/DOCKER_BACKUP_RESTORE.md`](../deployment/DOCKER_BACKUP_RESTORE.md).

## 8. Итоговый отчёт

Отчёт обязан разделять:

```text
TASK, ISSUE, STATUS, COMMIT_SHA, CI, DEPLOYMENT, DATABASE_ACTIONS,
VISIBLE_RESULT, USER_FLOW, PORTS, DEMO_URLS, SCREENSHOTS, TESTS_RUN,
MAP_NODES_CHANGED, WORKING_TREE, NEXT_ALLOWED_TASK
```

Для `CI`, `DEPLOYMENT` и `DATABASE_ACTIONS` допустимо честное `not run` или
`not requested`. Нельзя заменять отсутствующее доказательство предположением.
