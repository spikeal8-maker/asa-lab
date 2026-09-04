# Защищённое обновление работающей установки

Этот сценарий предназначен только для уже работающей Docker-установки ASA Lab.
Он не создаёт новую базу и не подменяет production-секреты. Для первого запуска
используйте [`QUICK_START.md`](QUICK_START.md).

## Что гарантирует updater

Перед изменением кода команда обязательно проверяет:

- текущая ветка — `main`, рабочее дерево чистое;
- локальная история допускает только fast-forward до `origin/main`;
- обязательный workflow `ASA Lab Governance and Code Gates` завершился успешно
  именно для целевого SHA (`gh` с выполненным входом используется первым;
  иначе применяется GitHub API, а для private-репозитория нужен `GH_TOKEN`);
- `.env` содержит прежний `COMPOSE_PROJECT_NAME`, определяющий существующий
  PostgreSQL volume;
- PostgreSQL выбранного Compose-проекта уже запущен;
- для production отключено тестовое наполнение: `ASA_SEED_DEV=false`;
- итоговая Compose-конфигурация корректна.

После этого updater создаёт и проверяет custom-format дамп PostgreSQL, сохраняет
текущие API/Web-образы с rollback-тегами, выполняет `git pull --ff-only`, собирает
образы с тегом точного Git SHA и запускает одноразовую миграцию через Compose.
Успех объявляется только если `/health/ready` подтвердил одновременно:

- точный новый `revision`;
- фактическую и ожидаемую версии схемы;
- `synchronized: true`.

В каталоге `backups/` остаются дамп и текстовая квитанция с SHA256. Они
игнорируются Git. Updater никогда не выполняет `reset --hard`, не удаляет volume
и не восстанавливает базу автоматически после ошибки: совместимость отката
схемы должен сначала проверить человек.

## Проверка без изменений

Сначала выполните безопасный preflight. Он читает состояние, делает `git fetch`,
проверяет CI точного SHA через GitHub API и рендерит Compose, но не создаёт
backup, не делает pull и не перезапускает контейнеры.

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production -CheckOnly
```

Linux:

```bash
ASA_COMPOSE_PROFILE=production ./tools/docker-update.sh --check
```

## Обновление

Windows:

```powershell
powershell -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production
```

Linux:

```bash
ASA_COMPOSE_PROFILE=production ./tools/docker-update.sh
```

Если рядом с `compose.yaml` существует локальный игнорируемый файл
`compose.frp.yaml`, режим `auto` включает его и явно печатает
`transport=frp`. Это сохраняет локальную маршрутизацию при обновлении, но не
публикует её настройки в GitHub. Управлять поведением можно явно:

```powershell
# Требовать FRP-файл или заведомо не использовать его
.\tools\docker-update.ps1 -Profile production -Transport frp
.\tools\docker-update.ps1 -Profile production -Transport none
```

```bash
ASA_COMPOSE_PROFILE=production ASA_COMPOSE_TRANSPORT=frp ./tools/docker-update.sh
ASA_COMPOSE_PROFILE=production ASA_COMPOSE_TRANSPORT=none ./tools/docker-update.sh
```

## Если обновление остановилось

Не запускайте `down --volumes`, не удаляйте каталог `backups/` и не применяйте
дамп поверх рабочей БД. Сохраните напечатанные пути backup/receipt и выполните:

```powershell
docker compose -f compose.yaml -f compose.production.yaml ps
docker compose -f compose.yaml -f compose.production.yaml logs --tail 200 api migration web
```

Если использовался FRP overlay, добавьте к обеим командам
`-f compose.frp.yaml`. Rollback-образы сохраняются как
`asa-lab-api:rollback-<SHA>` и `asa-lab-web:rollback-<SHA>`, но переключать их
до проверки совместимости новой схемы со старым API нельзя.

## Перенос на другой компьютер

Обычное обновление и перенос данных — разные операции. На другом компьютере
сначала клонируется чистый `main`. Для переноса реальных пользователей отдельно
нужны проверенный дамп PostgreSQL, исходный `.env` (особенно прежний
`ASA_SETTINGS_ENCRYPTION_KEY`) и локальный transport overlay. Эти файлы нельзя
коммитить в GitHub. После восстановления данных первый запуск также принимается
только по точному `revision`, версии схемы и `synchronized: true`.
