# AGENT_CHANGE_WORKFLOW — изменение, публикация и развёртывание

Это постоянный маршрут coding-агента ASA Lab. Он не хранит активную задачу,
ветку, Issue, checkpoint или SHA. Текущее состояние всегда читается только из
[`../execution/current.yaml`](../execution/current.yaml).

## 1. Сначала получи минимальный контекст

```bash
pnpm agent:context --list
pnpm agent:context --scope <lane>
pnpm control-plane:check
git status --short --branch
git fetch origin main
```

Читай только документы и разделы из блока `read`. Не сканируй весь репозиторий,
если точный модуль уже известен. До записи проверь незавершённые файлы и
последние изменения в `origin/main`.

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

После локальной проверки:

```bash
git diff --check
git status --short
git diff --cached --name-only
git commit -m "type(scope): coherent result"
git fetch origin main
git log --oneline --decorate --max-count=8 --all
git diff --name-only HEAD...origin/main
git diff --name-only origin/main...HEAD
```

Первая трёхточечная команда показывает новые удалённые пути после общей базы,
вторая — пути локального коммита. Так пересечение проверяется до изменения
истории.

Если `origin/main` не сдвинулся, отправь обычным `git push origin main`.

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
4. `pushed` — SHA доступен в `origin/main`;
5. `CI success` — workflow зелёный на том же SHA;
6. `deployed` — конкретная установка обновлена и readiness подтверждён;
7. `owner accepted` — владелец принял видимый результат.

Push в GitHub не обновляет Docker и не означает deployment. Продуктовый бот не
перезапускает локальный или production runtime без прямого поручения владельца.

## 5. Обнови существующую Docker-установку

Сначала только проверка, без изменения runtime:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production -CheckOnly
```

```bash
ASA_COMPOSE_PROFILE=production bash tools/docker-update.sh --check
```

Только после прямого поручения на обновление запусти ту же команду без
`-CheckOnly` или `--check`. Защищённый updater проверяет чистоту checkout,
fast-forward, зелёный CI точного SHA, создаёт проверенный backup, обновляет
Compose и ждёт `/health/ready`. Подробности:
[`../deployment/GUARDED_UPDATE.md`](../deployment/GUARDED_UPDATE.md).

Не меняй `COMPOSE_PROJECT_NAME`: другое имя подключит другой PostgreSQL volume
и может выглядеть как потеря пользователей.

## 6. Разверни на новом компьютере

Новая установка начинается с чистого клона `main`, приватного `.env` и
[`../deployment/QUICK_START.md`](../deployment/QUICK_START.md). Git содержит код
и миграции, но не содержит пользователей, токены, `.env` или дамп базы.

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
