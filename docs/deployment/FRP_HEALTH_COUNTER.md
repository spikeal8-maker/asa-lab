# FRP: проверка счётчика health-check и подготовка клиента

Этот срез готовит проверяемый кандидат FRP 0.71.1 и проверяет контракт на настоящих
бинарных файлах. Он **не обновляет работающий FRP**. Запрет останавливать или
перезапускать действующий FRP сохраняется. Публичный `frps` не используется в
тестах; его версия, настройки и совместимость с кандидатом остаются непроверенными.

## Подтверждённый дефект и граница вывода

В FRP 0.69.1 успешная health-проверка не обнуляет `failedTimes`. При
`maxFailed = 3` последовательность «успех, ошибка, успех, ошибка, успех, ошибка»
может снять исправный прокси после третьей накопленной ошибки. Это видно в
[исходнике v0.69.1, `checkWorker`](https://github.com/fatedier/frp/blob/v0.69.1/client/health/health.go#L105-L138).

В [v0.71.1, `handleCheckResult`](https://github.com/fatedier/frp/blob/v0.71.1/client/health/health.go#L144-L169)
успешная проверка обнуляет счётчик на строке 148. Исправление описано в
[официальном release v0.71.1](https://github.com/fatedier/frp/releases/tag/v0.71.1)
и соответствует [контракту `maxFailed`](https://gofrp.org/en/docs/reference/proxy/):
порог относится к последовательным ошибкам.

Этот отдельный дефект может преждевременно убирать маршрут после очередной ошибки
локальной readiness-проверки. Он не объясняет саму причину readiness timeout,
ошибку Windows `WSAENOBUFS`, обрыв внешнего соединения или работу VPN.
Сообщение `work connection pool full` само по себе также не доказывает потерю
пользовательского HTTP-запроса: в
[server/control.go v0.69.1](https://github.com/fatedier/frp/blob/v0.69.1/server/control.go)
это отказ принять избыточное подготовленное work connection, а получение
соединения для пользовательского запроса имеет отдельный путь и timeout.
Параметры pool, tcpMux, timeout и VPN этот срез не меняет.

## Пять файлов кандидата

| Файл | Назначение |
| --- | --- |
| `tools/deployment/frp-release.json` | Версионированный manifest официальных архивов и SHA-256 для кандидата и воспроизводящего дефект baseline. |
| `tools/frp-client-stage.ps1` | Подготовка проверенного Windows-клиента в явно заданном новом каталоге. |
| `tools/test_frp_health_contract.py` | Изолированный запуск настоящих `frpc` и `frps`, HTTP-проверки, reconnect и Windows staging checks. |
| `.github/workflows/frp-health-contract.yml` | Один и тот же исполнимый gate на Linux и Windows, с ограничением 10 минут на job. |
| `docs/deployment/FRP_HEALTH_COUNTER.md` | Границы, команды, доказательства и оставшиеся deployment blockers. |

Нет изменений ASA updater, действующих FRP-конфигураций, служб, Docker/WSL,
маршрутов, firewall, VPN, пользовательских данных или execution state.

## Источник и целостность

Manifest schema 1 разрешает только два явно закреплённых release из
`https://github.com/fatedier/frp`. Неизвестные поля, произвольные mirrors,
несогласованные имена/URL, неподдерживаемая schema и неограниченный размер
отклоняются. Переменные окружения не переопределяют версии, URL или checksum.
Изменение pins выполняется отдельным review в GitHub с повторным gate.

При подготовке pins сверены поля `digest` и `size` официального GitHub Releases
API для [v0.71.1](https://api.github.com/repos/fatedier/frp/releases/tags/v0.71.1)
и [v0.69.1](https://api.github.com/repos/fatedier/frp/releases/tags/v0.69.1).
Скачанный архив дополнительно проверяется по фактическому размеру и SHA-256 перед
извлечением. SHA-256 здесь закрепляет конкретный release artifact; это не
заявление о проверке отдельной цифровой подписи upstream.

| Роль | Архив | SHA-256 |
| --- | --- | --- |
| Кандидат | `frp_0.71.1_linux_amd64.tar.gz` | `1d9875210972a5d1a62b2dc4c48df45ab0af05d3ca1b5e494a014428259df803` |
| Кандидат | `frp_0.71.1_windows_amd64.zip` | `b90074b2b6a1d792a7a40f085ac6d276bcab2d1bc60201f8a86ca53ce65ce821` |
| Воспроизведение | `frp_0.69.1_linux_amd64.tar.gz` | `7be257b72dbbc60bcb3e0e25a5afd1dfac7b63f897084864d3c956dd3d5674e1` |
| Воспроизведение | `frp_0.69.1_windows_amd64.zip` | `829ac915f8655d4d4e021b8db61b46c3445205ed80d32b04cda7fa89d87c46e0` |

Архивы скачиваются по HTTPS из точных URL manifest. Допустимые конечные хосты
redirect — GitHub и его release storage. Проверка сертификата не отключается;
GitHub token не требуется. Распаковываются только заранее названные обычные
файлы, без `extractall`, ссылок, неизвестных путей и готовых upstream-конфигов.
Повреждённый файл в локальном download cache вызывает ошибку, а не молчаливую
замену. Cache содержит только проверяемые архивы, не результаты тестов.

## Поддерживаемая матрица этого gate

| Среда | CPU и runtime | Что проверяется |
| --- | --- | --- |
| GitHub `ubuntu-24.04` | amd64, Python 3.12, FRP 0.69.1 и 0.71.1 | Реальный health-контракт, HTTP, reconnect, cleanup. |
| GitHub `windows-2025` | amd64, Python 3.12, Windows PowerShell 5.1, те же FRP | Тот же контракт и отдельный вызов staging-скрипта в Windows PowerShell. |
| Локальный Linux amd64 | Python 3.12, Git, доступ к официальным release assets | Тот же native gate; Windows staging явно `NOT_RUN`. |

Для native gate планировать не менее 512 MiB свободного диска и 1 GiB доступной
RAM. Stager отдельно проверяет минимум 256 MiB свободного места на целевом диске.
Это маленький native transport test без Docker, Node, браузеров, базы данных и
нагрузки на ASA. Поддержка пользовательских браузеров здесь неприменима; gate не
является доказательством пользовательских сценариев ASA или полной поддержки
всех выпусков Windows. Точный OS/Python, source revision, dirty-состояние,
хеши пяти файлов и бинарных файлов попадают в report.

Windows job обязателен для проверки PowerShell 5.1. Linux PASS не заменяет его.
Отчёт с `sourceDirty: true` является проверкой рабочего дерева с указанными
хешами, а не доказательством неизменённого опубликованного commit.

## Как запускается контракт

Из корня checkout, одинаково локально и в CI:

```bash
python tools/test_frp_health_contract.py --output-dir tmp/frp-health-contract
```

Каталог результата должен быть новым. Повторный запуск не перезаписывает
существующее доказательство; для него задают другое явное имя каталога. Например:

```bash
python tools/test_frp_health_contract.py --output-dir tmp/frp-health-contract-repeat
```

Harness скачивает и проверяет реальные архивы. Для каждого release он запускает
собственные `frps` и `frpc` и Python HTTP backend только на `127.0.0.1`.
Порты выбираются один раз средствами ОС и резервируются до запуска своих
процессов. Во время reconnect используются те же выбранные порты; при конфликте
нет поиска нового порта или остановки чужого процесса. Домен
`frp-health-contract.invalid` передаётся только в локальном HTTP Host header.
Настоящий DNS, публичный tunnel и действующие учётные записи не используются.

Fixture включает TLS и tcpMux, `poolCount = 1`. Его health-параметры:
`maxFailed = 3`, interval 1 секунда, timeout 10 секунд. Увеличенный timeout нужен
для управляемой очереди HTTP-ответов теста; это не предлагаемая production
настройка. Backend отдаёт реальные HTTP 200/503, после каждого ответа harness
дожидается обработки настоящим `frpc` и проверяет доступность HTTP-маршрута.
Счётчик upstream не реализуется повторно в Python или Go.

| Проверка | 0.69.1 | 0.71.1 |
| --- | --- | --- |
| `200, 503, 200, 503, 200, 503` при maxFailed 3 | Третья непоследовательная ошибка снимает proxy: `EXPECTED_DEFECT_REPRODUCED`. | Proxy остаётся доступным, unhealthy transitions = 0. |
| После успеха три последовательных `503` | Не используется как критерий исправления старой версии. | Первые две ошибки сохраняют маршрут; третья снимает его ровно один раз. |
| Первый `200` после снятия proxy | Не используется как критерий кандидата. | Маршрут восстанавливается после первого успеха. |
| GET и POST с телом 14 KiB | Только GET для наблюдения дефекта. | Проверяется точный backend token, Host, метод, длина и SHA-256 тела. |
| Остановка и повторный запуск только собственного `frps` | Не требуется для воспроизведения счётчика. | Тот же `frpc` PID переподключается; GET и POST снова проходят. |

До reconnect тест сравнивает полную последовательность реально отданных
health-ответов с ожидаемой. Неожиданный дополнительный timeout/ответ делает gate
красным. В reconnect-фазе backend автоматически остаётся здоровым; ожидание
нового успешного login ограничено 20 секундами. Таймауты, размеры download/body,
размеры логов и время ожидания процессов ограничены.

В `finally` останавливаются только `Popen`-процессы, созданные этим запуском.
Сначала штатное завершение, затем при необходимости `kill` того же handle после
ограниченного ожидания. Поиск и остановка по общему имени `frpc`, `frps` или
системному списку процессов отсутствуют. Временные конфиги с синтетическим
токеном и runtime-каталог удаляются; token скрыт в сохраняемых логах.

`report.json`, per-role result и ограниченные native logs сохраняются в заданном
output-каталоге. CI публикует их как artifact на 14 дней. Успех команды означает:
baseline воспроизвёл известный дефект, кандидат выполнил контракт и собственные
процессы завершены. `EXPECTED_DEFECT_REPRODUCED` не является PASS старой версии.
`publicFrpsCompatibility` всегда остаётся `NOT_VERIFIED`, `liveApply` — `false`.

## Windows: только staging в новом каталоге

Скрипт запускают из проверенного clean checkout официального ASA Lab GitHub
repository. Перед вызовом оператор сверяет напечатанный SHA с одобренным
GitHub-кандидатом; `ExpectedRevision` — требование к источнику, не разрешение на
live deployment.

```powershell
$revision = (& git rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0) { throw 'Cannot resolve source revision.' }
Write-Output ('Source revision: ' + $revision)
$stage = Join-Path $env:TEMP ('asa-frpc-stage-' + [Guid]::NewGuid().ToString('N'))
powershell.exe -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File .\tools\frp-client-stage.ps1 -ExpectedRevision $revision -Destination $stage
if ($LASTEXITCODE -ne 0) { throw 'Staging failed; preserve its evidence and select a new directory for a later retry.' }
Get-Content -LiteralPath (Join-Path $stage 'receipt.json') -Raw
```

`RemoteSigned` применяется только к этому дочернему процессу. Скрипт не вызывает
`Set-ExecutionPolicy`, не меняет system/group policy и не использует `Bypass`.
Если действующая Group Policy запрещает выполнение, это blocker, а не повод
обходить её.

Перед созданием каталога проверяются:

- Windows amd64, Git и точное соответствие `HEAD` обязательному SHA;
- официальный `origin`, отсутствие dirty/untracked source и совпадение
  реальных script/manifest blobs с `HEAD`, включая Git line-ending filters;
- строгая schema manifest, canonical upstream URLs и закреплённые размеры/hash;
- явный абсолютный путь на локальном диске, существующий родитель,
  отсутствие существующей цели и junction/symlink в родителях;
- минимум свободного диска.

Новый каталог создаётся исключительно через `CreateDirectoryW`: даже если цель
появилась между проверкой и созданием, скрипт прекращает работу. Файлы открываются
с `CreateNew`. В целевом каталоге остаются только проверенный исходный ZIP,
`frpc.exe`, `LICENSE` и `receipt.json`. `frps.exe` и upstream-конфиги туда не
копируются; `frpc.exe` скриптом не запускается.

Receipt связывает source SHA, manifest SHA-256, archive URL/size/SHA-256, binary
SHA-256 и фактический новый каталог. Поля явно указывают `staged_only`,
`deployment: NOT_APPLIED`, `liveConfigurationRead: false`,
`liveBinaryReplaced: false`, `relayStarted: false`, `serviceRestarted: false`.
Ошибка после создания каталога сохраняет частичный staging и `failure.json`,
когда его можно записать. Действующая установка не затрагивается. Повторная
попытка требует нового каталога; скрипт ничего не удаляет и не перезаписывает.

Windows harness запускает этот же committed script через `powershell.exe`:
неверный SHA должен быть отвергнут до создания цели, существующий каталог с
sentinel должен сохраниться, новый staging должен иметь правильный receipt и
точно тот же `frpc.exe`, что извлечён из проверенного архива самим harness.

## Deployment contract и оставшиеся blockers

Срез следует
[deployment contract](../agent/contracts/deployment.yaml) и
[Portable Self-Hosted Deployment Standard](../architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md).

| Инвариант | Реализация / граница |
| --- | --- |
| DPL-HOST-001 | Матрица OS/amd64/runtime и бюджет диска/RAM указаны выше; браузерный acceptance не заявлен. |
| DPL-NET-003, DPL-CFG-001/002 | Production IP/домен/секреты не прошиваются. Версионированный manifest описывает public upstream artifacts, а не installation ingress. Неизвестные ключи отклоняются. |
| DPL-NET-005 | Избранные fixture-порты фиксированы на весь сценарий, включая reconnect; конфликт приводит к ошибке. Production порты не выбираются и не меняются. |
| DPL-SEC-003 | Только временный синтетический auth token, без чтения/export настоящих credentials. |
| DPL-REL-001 | Source SHA, manifest/архив/binary SHA-256, schema и actual binary version попадают в доказательства. |
| DPL-ARCH-002, DPL-UPD-001/002 | Нет второго постоянного стека или нового обходного updater. Staging не выполняет фазу switching. Prepared/failure evidence сохраняется, повторный запуск не переиспользует цель. |
| DPL-DAT-001, DPL-BAK-001/002, DPL-MIG-001 | Данные и схемы не меняются, миграции/switch/restore отсутствуют; backup/restore acceptance не заявлен. |
| DPL-TST-001/002/003 | Проверяется отдельный FRP contract. Loopback PASS не доказывает публичную совместимость, LAN/VPN, работу reverse proxy или полные ASA journeys. |

Для применения остаются отдельные обязательные шаги: получить доступ к
правильному публичному `frps`/reverse proxy и установить их exact version/config;
проверить совместимость и сквозные запросы в отдельно согласованном окружении;
подготовить GitHub-controlled maintenance/rollback plan; получить отдельное
разрешение на переключение действующего клиента. Наличие подключённого другого
testhost не подтверждает, что он обслуживает публичный ingress.

До этих шагов действуют два явных blocker: **публичная server-side совместимость
не проверена** и **остановка/перезапуск действующего FRP не разрешены**. Этот
candidate, его staging receipt или зелёный loopback gate не снимают их.
