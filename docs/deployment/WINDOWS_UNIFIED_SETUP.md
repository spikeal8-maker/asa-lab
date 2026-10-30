# Единая установка ASA Lab на Windows — подготовка и чистый запуск

## Одна команда для уже полученного официального установщика

Используйте PowerShell в Windows, 64-разрядный процессор и **отдельную папку** для каждой
установки. Файл tools/asa-setup.ps1 находится в официальном репозитории или в
проверенном пакете ASA Lab. Не запускать удалённый код через сетевой pipe | iex.

Предварительный план без записи на диск или изменения Docker:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-setup.ps1 -Root 'D:\ASA-Lab' -Mode auto -Profile production

Чистая установка с пустой БД:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-setup.ps1 -Root 'D:\ASA-Lab' -Mode auto -DataSource blank -Project 'asa-lab-install' -WebPort 4610 -BlocksPort 4613 -Profile production -Apply -ConfirmBlankDatabase

Обновление того же каталога использует сохранённые project, тома и ключи:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-setup.ps1 -Root 'D:\ASA-Lab' -Mode auto -Profile production -Apply

При отсутствии Git-каталога установщик клонирует только официальный
https://github.com/spikeal8-maker/asa-lab.git в целевую папку, если она отсутствует.
Родительская папка должна быть создана заранее. Менеджер выбирает только
опубликованный deployment:stable с прошедшими GitHub CI и immutable image digest,
а не произвольный исходный SHA.

## Предварительные проверки

Режим clean/update определяется по точному файлу .asa/installed-release.json,
не по имени папки и не по порту. Проверяются Git, Python 3.11+, работающий
Docker Desktop с Linux/amd64, Docker Compose v2, настройки установки и ресурсы.

Если программа отсутствует, мастер останавливается до изменения установки и
предлагает отдельные команды для самостоятельной установки:

    winget install Git.Git
    winget install Python.Python.3.13
    winget install Docker.DockerDesktop

**Без отдельного согласия не устанавливаются Docker/WSL и не меняются
VPN, DNS, firewall, proxy, Windows certificates, routes, hosts или адаптеры.**
Docker Desktop может потребовать прав администратора и перезапуска Windows;
это отдельная согласованная операция владельца, не часть тестирования ASA Lab.

На новой установке проверяются: уникальный Compose project asa-lab-*;
отсутствие контейнеров, томов (включая безымянные orphan volumes) и Compose
сети с таким идентификатором; свободные локальные Web/API/Scratch порты;
отсутствие чужой private .env и maintenance markers; подлинность GitHub origin.

После проверок новая private .env создаёт независимые случайные ключи для
PostgreSQL/MinIO/StudentCode/Settings, согласует Web/API/Scratch, origin и
production ASA_SEED_DEV=false. Демонстрационные аккаунты не создаются.
При ошибке не запускается prune, down -v, удаление контейнеров, томов или
перезапись прежней .env.

## Источник данных

- При выборе -DataSource blank разворачивается новая пустая PostgreSQL/MinIO.
  Это новая установка, **не восстановленная школьная база**.
- -DataSource backup -BackupPath ПУТЬ позволяет проверить complete manifest,
  SHA файлов, database.dump, objects и private.env. Age-файл сначала
  расшифровывается в отдельном приватном каталоге владельцем с его ключом.

**Импорт полного архива пока не выполняется автоматически** — после проверки
прерывается с RESTORE_IMPORT_PENDING. Нельзя импортировать только SQL dump
в произвольно созданную БД: должны совпадать оригинальные StudentCode и
Settings ключи, MinIO объекты, PostgreSQL роли/ACL/RLS, origin и схемы.
Отдельный guarded restore будет протестирован и включён позднее.
Мастер не подменяет выбранный архив пустой базой молча.

## Проверка после установки

Менеджер проверяет все шесть Docker сервисов, образа и SHA, схемы и
встроенный Scratch origin. Реальное пользовательское испытание
входа, сохранения и повторного открытия проекта проводится отдельно.
Публикация портов в LAN/Internet и включение автоподновления не производится.

На D2R2 изолированная пробная установка использует
проект asa-lab-cleanqa-20261030, порт Web 18610 и Scratch 18613.
Существующие порты 4610, 4620, 18570 и production H-04 не изменяются.
