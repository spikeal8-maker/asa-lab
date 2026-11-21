# WIN-02A — подготовка Windows перед ASA Lab

Этот этап не устанавливает само приложение ASA Lab и не заменяет независимый
установщик WIN-01. Первая проверка выполняется обычным PowerShell **без повышения
прав и без изменения конфигурации хоста**.

## Только проверка (по умолчанию)

Из **уже полученного и проверенного официального исходника ASA Lab**, а не из
непроверенного сетевого скрипта:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-prerequisites.ps1
```

Мастер проверяет наличие и исправность Git for Windows, Python версии 3.11+
(включая `py -3`), Docker Desktop с работающим Linux/amd64 engine и Compose v2.
Печатаются цветные `PASS / WARN / BLOCKED`. Код завершения: `0` при
`WIN02_READY` или `2` при `WIN02_NOT_READY`. Предварительный запуск никогда
не вызывает `winget install`, Docker create/stop/up, отключение служб или
изменение системы.

## Явная установка только Git и Python

Если они отсутствуют, доступны *только* два фиксированных идентификатора
пакета: `Git.Git` и `Python.Python.3.13`. Для их установки необходимы
**одновременно** два параметра:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-prerequisites.ps1 -Apply -ConfirmWingetTools
```

Мастер допускает только штатный app execution alias
`%LOCALAPPDATA%\Microsoft\WindowsApps\winget.exe` с атрибутом reparse-point
и установленный Store-подписанный пакет `Microsoft.DesktopAppInstaller` с
официальным PublisherId `8wekyb3d8bbwe`. Любой произвольный
`winget.exe` из PATH блокируется до запуска; подменять
программу из пользовательских папок нельзя. Пакетный менеджер вызывается с
`--exact --source winget --silent --disable-interactivity
--accept-package-agreements --accept-source-agreements`. Перед выполнением
оператор обязан проверить доверенность исходника, источник пакетов и
подтвердить изменение Windows.
При отсутствии Winget процесс блокируется, Microsoft Store не открывается.
После установки открыть новое окно PowerShell и снова выполнить проверку —
активная сессия может содержать старый PATH. Скрипт не удаляет программы,
не изменяет реестр/сеть самостоятельно и не обходит системные ограничения.

## Docker Desktop и компоненты Windows — только вручную

Если `docker.exe` отсутствует, Docker Desktop не запущен, используется Windows
containers или Compose v2 недоступен, мастер сообщает точный блокер. Он
**никогда автоматически** не устанавливает и не запускает Docker Desktop,
не включает WSL2/Hyper-V, не меняет BIOS/виртуализацию, службы, сетевые
адаптеры, маршруты, DNS, VPN, прокси, брандмауэр, Kaspersky, сертификаты и
не выполняет перезагрузку. Эти действия могут повлиять на соседние
проекты и требуют отдельного решения владельца машины.

Возможный ручной источник установки Docker Desktop: официальный издатель
Docker. Не запускать `winget install Docker.DockerDesktop` автоматически
из инструмента. Состояние `WIN02_READY` достигается только после реально
работающего Docker Linux/amd64 и Compose v2.

## Запуск WIN-01 после успешной проверки

Из отдельного **чистого** официального checkout текущего `main` с полным SHA,
самостоятельно сверенным через GitHub HTTPS:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-bootstrap.ps1 -InstallBootstrap -ExpectedCommit (git rev-parse HEAD).Trim()
```

Bootstrap независимо перепроверяет официальный SHA `main` через HTTPS и
отказывает при несовпадении либо недоступности источника. Для дальнейших
запусков используется постоянный `%LOCALAPPDATA%\ASA-Lab\Installer\asa-bootstrap.ps1`,
а не меняющийся каталог приложения.

**Граница выполнения:** WIN-02A — минимальная проверка и явная установка
Git/Python. Полноценная чистая Windows c Docker/WSL, безопасная подготовка
без Winget, Resume/Repair и импорт PostgreSQL+MinIO+ключей остаются
отдельными задачами; считать их уже выполненными запрещено.

## Проверки

В Windows CI тесты `tools/deployment/test_win02_prerequisites.py` имитируют
отсутствующие программы и подставляют локальный временный `winget.cmd`,
не обращаясь к реальному пакетному менеджеру или Docker.
