# Защищённое обновление работающей установки

Этот сценарий предназначен только для уже работающей Docker-установки ASA Lab.
Он не создаёт новую базу и не подменяет production-секреты. Для первого запуска
используйте [`QUICK_START.md`](QUICK_START.md).

## До запуска: согласовать состав и видимый результат

Записать конкретный компьютер, Compose-проект и каталог работающей PostgreSQL.
Обновление main переносит все уже объединённые изменения выбранного SHA, а не
только последний PR. Незавершённые ветки не объединяются командой обновления.
До работы записать отдельно Git SHA checkout и фактические Web/API/Scratch revision,
схему БД, используемые overlays и ожидаемые пользователем доступные модули.

Scratch уже входит в основной `compose.yaml` как сервис `scratch`. Updater
обновляет его вместе с Web/API в существующем Compose project; ни preview-флаг,
ни дополнительное развёртывание редактора не требуются. Сохранить прежние
`ASA_BLOCKS_PORT`, parent/runtime origins, `.env` и transport overlays.
Порт 4613 — предусмотренный endpoint компонента, не новый портал. Не выбирать
новый порт или вторую установку при ошибке.

[Обязательная проверка идентичности установки](SCRATCH_INSTALLATION.md) выполняется
до изменения. Зелёный CI/merge не заменяет deployment и проверку пути пользователя
«главная → программа → Scratch». Внешние DNS/TLS/FRP меняются только по отдельному
разрешению; приоритет локальных проверок не разрешает обход origin-защиты.

Ошибки GitHub/DNS/памяти, безопасный повтор сборки и причины отсутствия Scratch:
[Windows: восстановление обновления и видимость Scratch](WINDOWS_UPDATE_RECOVERY.md).

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
- текущий checkout совпадает с Compose working directory работающей PostgreSQL;
- имеющиеся Web, API, Scratch и PostgreSQL не принадлежат разным checkout;
- для production отключено тестовое наполнение: `ASA_SEED_DEV=false`;
- итоговая Compose-конфигурация корректна.

После этого updater создаёт и проверяет custom-format дамп PostgreSQL, сохраняет
текущие API/Web/Scratch-образы с rollback-тегами, выполняет `git pull --ff-only`, собирает
Scratch, API и Web последовательно с тегом точного Git SHA; только после успешной
сборки всех трёх заменяет сервисы и запускает одноразовую миграцию через Compose.
Успех объявляется только если `/health/ready` и Web
`/build-metadata.json`, а также runtime `/asa-commit.txt` и `/healthz` подтвердили:

- точный новый `revision`;
- одинаковый точный `revision` API, Web и Scratch;
- фактическую и ожидаемую версии схемы;
- `synchronized: true`.

Проверка runtime внутри контейнера не заменяет доступ через опубликованный порт.
До приёмки дополнительно проверить host-порт Scratch и редактор через ASA;
сохранить точные адреса и ограничения проведённого теста.

В каталоге `backups/` остаются дамп и текстовая квитанция с SHA256. Они
игнорируются Git. Updater никогда не выполняет `reset --hard`, не удаляет volume
и не восстанавливает базу автоматически после ошибки: совместимость отката
схемы должен сначала проверить человек.

## Проверка без изменений

Сначала выполните безопасный preflight. Он читает состояние, делает `git fetch`,
проверяет CI точного SHA через GitHub API и рендерит Compose, но не создаёт
backup, не делает pull и не перезапускает контейнеры.

Если preflight обнаруживает Web/API/Scratch/PostgreSQL из разных checkout, он выводит
`CHECK BLOCKED`. Это не повод запускать Compose из случайного каталога. Полный
updater разрешён только из каталога, записанного в метке работающей PostgreSQL;
после пересборки он повторно проверяет, что смешения больше нет.

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

До повтора определить, завершился ли предыдущий процесс, какие образы созданы,
применялись ли миграции и какой revision реально отдаёт Web/API. После failed build
checkout уже может совпадать с target, а контейнеры — оставаться на старой версии.
Не объявлять deployment успешным по `git pull` или только существованию образа.
Повторный receipt может описывать прошлый checkout, а не прошлый running revision.
Сохранять исходный before-readiness и все квитанции. Подробный порядок разбора —
в [руководстве восстановления](WINDOWS_UPDATE_RECOVERY.md).

Не запускайте `down --volumes`, не удаляйте каталог `backups/` и не применяйте
дамп поверх рабочей БД. Сохраните напечатанные пути backup/receipt и выполните:

```powershell
docker compose -f compose.yaml -f compose.production.yaml ps
docker compose -f compose.yaml -f compose.production.yaml logs --tail 200 api migration web scratch
```

Если использовался FRP overlay, добавьте к обеим командам
`-f compose.frp.yaml`. Rollback-образы сохраняются как
`asa-lab-api:rollback-<SHA>`, `asa-lab-web:rollback-<SHA>` и
`asa-lab-scratch:rollback-<SHA>`, но переключать их
до проверки совместимости новой схемы со старым API нельзя.

## Перенос на другой компьютер

Обычное обновление и перенос данных — разные операции. На действительно новом компьютере
сначала клонируется чистый `main` и устанавливается весь состав ASA со Scratch.
Отдельный репозиторий/Compose project редактору не нужен. Для переноса реальных пользователей отдельно
нужны проверенный дамп PostgreSQL, исходный `.env` (особенно прежний
`ASA_SETTINGS_ENCRYPTION_KEY`) и локальный transport overlay. Эти файлы нельзя
коммитить в GitHub. После восстановления данных первый запуск также принимается
только по точному `revision`, версии схемы и `synchronized: true`.
