# Windows: восстановление обновления и видимость Scratch

Руководство для уже работающей установки ASA Lab на Windows с Docker Desktop.
Основной маршрут — [защищённый updater](GUARDED_UPDATE.md), а не ручной запуск
Compose из случайного checkout. Ниже разобраны ошибки обновления 16.09.2026
на D2-R2-X; датированные результаты не заменяют проверку будущего целевого SHA.

## 1. Сначала определить установку и фактическую версию

Доступ к GitHub в ChatGPT и авторизация `gh` на сервере — разные подключения.
Компьютер с Remote Desktop Commander может быть самой рабочей установкой:
не переносить её на другой сервер и не создавать второй Compose-проект без поручения.
Пример ниже относится к существующему проекту `asa-lab-dev` и только читает состояние.

```powershell
$project = 'asa-lab-dev'
$ids = @(docker ps -q --filter "label=com.docker.compose.project=$project" --filter 'label=com.docker.compose.service=postgres')
if ($LASTEXITCODE -ne 0 -or $ids.Count -ne 1) { throw 'Не найдена единственная работающая PostgreSQL установки.' }
$records = @(docker inspect $ids[0] | ConvertFrom-Json)
if ($LASTEXITCODE -ne 0) { throw 'Не удалось прочитать метки PostgreSQL.' }
$root = $records[0].Config.Labels.'com.docker.compose.project.working_dir'
if (-not $root -or -not (Test-Path -LiteralPath $root)) { throw 'Каталог работающей установки не определён.' }
Set-Location -LiteralPath $root
git status --short --branch
git rev-parse HEAD
Invoke-RestMethod http://127.0.0.1:4610/health/ready
Invoke-RestMethod http://127.0.0.1:4610/build-metadata.json
```

Не менять `COMPOSE_PROJECT_NAME`, `.env`, том PostgreSQL или transport overlay.
Порт 4610 в примере — порт этой установки; он не определяет другую установку автоматически.

## 2. GitHub CLI не авторизован или API возвращает 403

Симптомы: `gh auth login`, `You are not logged into any GitHub hosts`,
`CI BLOCKED: GitHub API 403`. Не отключать exact-SHA CI-проверку updater.
На целевом компьютере выполнить обычную авторизацию; одноразовый код подтверждает владелец.

```powershell
gh auth status --hostname github.com
gh auth login --hostname github.com --git-protocol https --web
```

Вторая команда нужна только при отсутствии рабочего входа. Не выводить `gh auth token`,
не просить пароль/токен в чате и не публиковать device-коды, `.env` или auth-файлы.
HTTP 403 сам по себе не доказывает исчерпание лимита: проверить сообщение и заголовки
`X-RateLimit-Remaining`, `X-RateLimit-Reset`, при наличии — `Retry-After`.
При нулевом остатке дождаться reset или использовать штатную авторизованную проверку;
не повторять запросы бесконечно. GitHub connector не заменяет проверку updater на сервере.

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\docker-update.ps1 -Profile production -CheckOnly
```

Переходить к обновлению только после `CHECK OK`. `Transport=auto` сохраняет локальный
`compose.frp.yaml`, если он существует; не менять маршрутизацию ради обхода проверки.

## 3. Красный, отсутствующий или отменённый CI

Проверять workflow целевого `origin/main`, а не последнего удачного старого коммита.
`cancelled` и пропущенные зависимые jobs не означают PASS. Сначала определить failed job/step:
ошибка текущего изменения, чужого модуля или инфраструктуры. Исправление Games/Prettier
не добавлять в Scratch-пакет только ради зелёного CI; дождаться исправленного baseline.

## 4. Сборка падает на npm/DNS: ETIMEDOUT или EAI_AGAIN

Наблюдавшийся сбой: `pnpm install --frozen-lockfile` завершился с
`getaddrinfo EAI_AGAIN registry.npmjs.org`; другой build был отменён как зависимый.
Это не доказательство ошибки TypeScript или несовместимости миграций.
Сначала прочитать конец build log и код завершения, затем проверить DNS/доступ к registry.
Не менять lockfile, версии зависимостей, HTTPS-проверку или источник пакетов на случайное зеркало.

**После такого сбоя checkout уже может быть новым, а работающие контейнеры — старыми.**
Повторно сравнить `/health/ready`, `/build-metadata.json` и Git; проверить, запускалась ли
миграция. Не перезапускать её вручную и не восстанавливать dump автоматически.
Если предыдущий процесс ещё работает, не запускать второй updater параллельно.

При восстановившейся сети можно подготовить образы последовательно — `api`, затем `web`.
Это только сборка: никакого `up`, `down`, применения миграций или переключения контейнеров.
Условия: канонический каталог из §1, чистый checkout, проверенный целевой main,
неизменные Dockerfiles, Compose и production-настройки. Сначала ещё раз выполнить `-CheckOnly`.
Пример для установки с `production` и необязательным существующим FRP overlay:

```powershell
$revision = (git rev-parse HEAD).Trim()
$target = (git rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $revision -ne $target) { throw 'Сначала согласуйте checkout с проверенным target.' }
if (@(git status --porcelain).Count -ne 0) { throw 'Рабочее дерево изменено; сборка остановлена.' }
$env:ASA_BUILD_REVISION = $revision
$env:ASA_IMAGE_TAG = $revision.Substring(0, 12)
$versions = @(Get-ChildItem migrations -Filter '*.sql' -File | ForEach-Object {
    if ($_.Name -match '^([0-9]+)_') { [int]$Matches[1] }
})
if ($versions.Count -eq 0) { throw 'Версия схемы не определена.' }
$schemaVersion = ($versions | Measure-Object -Maximum).Maximum
$env:ASA_EXPECTED_SCHEMA_VERSION = "$schemaVersion"
$composeArgs = @('compose', '-f', 'compose.yaml', '-f', 'compose.production.yaml')
if (Test-Path -LiteralPath 'compose.frp.yaml') { $composeArgs += @('-f', 'compose.frp.yaml') }
& docker @composeArgs config --quiet
if ($LASTEXITCODE -ne 0) { throw 'Некорректная Compose-конфигурация.' }
foreach ($service in @('api', 'web')) {
    & docker @composeArgs build $service
    if ($LASTEXITCODE -ne 0) { throw "Не удалось собрать $service; контейнеры не переключать." }
}
```

После успешной сборки выполнить штатный updater: сначала `-CheckOnly`, затем ту же
команду без этого флага при сохранённом разрешении владельца на обновление.
Он повторно проверит CI, создаст backup, применит миграции и подтвердит readiness.
Не подменять его ручным `compose up`. При движении main проверить уже новый target;
успех предыдущей сборки не даёт права приписать новому SHA старые результаты.

## 5. Мало памяти Docker и перезапуски соседних контейнеров

В инциденте Docker показывал около 2 GiB общей памяти. Во время первой параллельной
сборки изменились времена запуска двух тестовых API и «Публикатора» при прежних ID.
Все вернулись в healthy, но OOM-событие не подтверждено: причина перезапусков неизвестна.
Ограниченная память — риск, а не установленный диагноз. До и после сборки записывать
ID, health, StartedAt/RestartCount выбранных сервисов; проверять событие, а не гадать.

Не выполнять `wsl --shutdown`, перезапуск Docker Desktop, очистку volumes или остановку
чужих проектов на рабочем компьютере без отдельного окна обслуживания и разрешения.
Последовательная сборка снижает одновременную нагрузку, но не гарантирует отсутствие
перезапусков. Изменение лимитов WSL/Docker — отдельная операция, не часть тихого repair.

## 6. Ошибка Unicode в оболочке после успешной сборки

Наблюдалось `UnicodeEncodeError: 'charmap' codec can't encode character '\u2192'`
при печати UTF-8 build log через Python с консолью cp1251. Обе дочерние команды сборки
уже завершились с кодом 0. Ошибка вывода не должна ни повторно запускать deployment,
ни скрывать настоящий сбой дочерней команды. Проверить отдельные exit codes,
существование образов и их revision, затем устранить кодировку оболочки.
Для будущего запуска Python использовать UTF-8-режим:

```powershell
$env:PYTHONUTF8 = '1'
$OutputEncoding = [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
```

Хранить исходный log и exit code до печати его хвоста. Не применять глобальное
подавление ошибок. В квитанции отдельно описывать сбой оболочки и результат Docker.

## 7. Что означает успешное обновление

Одновременно нужны: exit 0 updater и миграции, одинаковый target SHA Web/API/Scratch,
ожидаемая фактическая версия схемы, `synchronized: true`, healthy Web/API/Scratch/PostgreSQL,
прежний том БД и сохранённая конфигурация. Проверить реальную страницу в браузере;
анонимный smoke не доказывает работу всех ролей, сохранения и каждого редактора.

Custom-format dump, успешный `pg_restore --list` и SHA256 подтверждают создание
и читаемость архива, но не заменяют проверочное восстановление в отдельную `_test` БД.
Восстановление рабочей БД никогда не выполнять автоматически после неудачной сборки.
Сохранять все backup/receipt; они содержат локальные данные и не загружаются в GitHub.
При повторном updater поле предыдущего checkout SHA может уже указывать новый код:
фактическую прошлую версию работающего сервиса брать из before-readiness, не из имени dump.

Локальная готовность не подтверждает внешний домен. Если запрос к домену завершился
тайм-аутом, отдельно проверить DNS, TLS и маршрут FRP снаружи. Не объявлять сайт
доступным из интернета по одному loopback-запросу и не менять HTTPS/firewall вслепую.

## 8. После обновления на главной нет Scratch

Текущая инструкция — [Scratch: штатная установка и обновление](SCRATCH_INSTALLATION.md).
Основной `compose.yaml` уже включает сервис `scratch`; модуль `blocks`
active/creatable по умолчанию. Старый `ASA_BLOCKS_PREVIEW` не управляет доступом.
Не добавлять preview overlay, отдельный Compose project, новый порт или новую
БД как способ включить модуль в работающей ASA.

```powershell
$payload = Invoke-RestMethod http://127.0.0.1:4610/api/modules
$blocks = @($payload.items | Where-Object { $_.moduleKey -eq 'blocks' })
if ($blocks.Count -ne 1) { throw 'Scratch не найден: проверьте endpoint и форму ответа API.' }
$blocks | Select-Object moduleKey, displayName, availability, creatable
```

Форму ответа сверять с `apps/api/src/modules.controller.ts`. Адрес примера —
стандартный локальный вход; для существующей нестандартной установки взять
её согласованный адрес, а не менять порт. Диагностика не создаёт проект.

| Симптом                                 | Проверка в существующей установке                                                           | Не делать                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Нет раздела на главной                  | Точный running SHA API/Web, ответ `/api/modules`                                            | Включать устаревший preview-флаг, пересоздавать пользователей                 |
| Раздел есть, редактор не загружается    | Сервис `scratch` того же project/working_dir, порт из `.env`, `/healthz`, `/asa-commit.txt` | Искать свободный порт и запускать второй runtime                              |
| Runtime healthy, но порт не отвечает    | Host ingress и сеть runtime по руководству установки                                        | Доверять только `docker exec`, публиковать API/БД или выключать origin guard  |
| На одном адресе работает, на другом нет | Точные parent/runtime origins и сохранённая топология                                       | Подменять адрес ученика localhost или молча менять DNS/TLS/FRP                |
| Найден TEST/diagnostic с похожим именем | Project, working_dir, config_files, revision, host IP/port                                  | Подключать старый TEST к основному сайту или удалять его данные автоматически |

Updater проверяет выбранную ревизию и обновляет общий состав; итог принимает
путь «главная → создать программу → Scratch», а не открытый отдельно runtime.
Локальные проверки выполнять через существующие порты; внешнюю маршрутизацию
не менять без отдельного запроса владельца.

### Историческое объяснение, не рецепт обновления

В ранней ревизии `c5033c9` основная установка не содержала runtime и возвращала
`coming_soon`. Этот эпизод описан ниже. Прежние рекомендации включать
`ASA_BLOCKS_PREVIEW=1`, добавлять preview-сервис или ждать M4-001 для видимости
не применяются к текущей стандартной установке. Они не разрешают второе
развёртывание. Локальные `.sb3` работают, серверное сохранение остаётся отдельной
задачей. Постоянная нижняя сноска в готовом редакторе не требуется.

## 9. Проверенный случай D2-R2-X — 16.09.2026, Москва

Это история инцидента раннего обновления, не состояние текущей установки и
не инструкция для будущих развёртываний. Текущий порядок приведён в разделе 8.
Полная [квитанция в PR №259](https://github.com/spikeal8-maker/asa-lab/pull/259#issuecomment-5688467449).

| Поле          | Подтверждённое значение                                                                                    |
| ------------- | ---------------------------------------------------------------------------------------------------------- |
| Установка     | Существующий `asa-lab-dev`, production + прежний FRP, компьютер D2-R2-X                                    |
| До            | Web/API `670173cf0da4913564475c533c788716b0139501`, схема 106                                              |
| После         | Web/API `c5033c9b056298e9624997007b84bcc1eccfa339`, схема 141, synchronized=true                           |
| Объём         | 310 уже объединённых коммитов main; миграции 0107–0141; чужие незавершённые PR не сливались                |
| Данные        | Прежние PostgreSQL и volume сохранены; без reseed и live restore                                           |
| Backup        | Два custom-format dump и квитанции сохранены локально; проверены читаемость и SHA256, не restore rehearsal |
| Запуск        | Миграция exit 0, три основных сервиса healthy, анонимный браузерный smoke без ошибок                       |
| Внешний домен | Тайм-аут проверки; доступность извне не подтверждена                                                       |
| Scratch       | Preview в основной установке выключен; старый отдельный TEST не обновлялся                                 |

Первый запуск остановился на npm/DNS после backup и fast-forward исходников.
После последовательной сборки и повторного защищённого updater обновление завершилось.
Перезапуски соседних тестовых API и «Публикатора» наблюдались; их причина не доказана.
Нельзя описывать этот случай как «все остальные контейнеры гарантированно не затронуты».
Отсутствие Scratch на главной объясняется выключенной интеграцией, не откатом обновления.
Согласование внешнего вида Scratch, merge PR, deployment и приёмка всего B/E различаются.

## Контракты и источники

- [Правила обновления](GUARDED_UPDATE.md) и [backup/restore](DOCKER_BACKUP_RESTORE.md).
- [Штатная установка Scratch в ASA](SCRATCH_INSTALLATION.md) и [runtime reference](../../infra/scratch-editor/README.md).
- [Scratch deployment/activation contract](../product/visual-programming/VSCR-D0-005-DEPLOYMENT-ACTIVATION-CONTRACT.md).
- [API registry](../../apps/api/src/module-registry.ts) и [выдача списка модулей](../../apps/api/src/modules.controller.ts).
- [Условия главной страницы](../../apps/web/src/pages/CreatorHomePage.tsx) и [Web build flags](../../apps/web/vite.config.ts).
- [GitHub CLI: auth login](https://cli.github.com/manual/gh_auth_login).
- [GitHub API: rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
- [Docker Desktop: resource settings](https://docs.docker.com/desktop/settings-and-maintenance/settings/).
