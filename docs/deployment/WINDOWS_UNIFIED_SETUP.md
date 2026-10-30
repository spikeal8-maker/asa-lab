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

## Docker Desktop с исчерпанным пулом подсетей

На компьютере с большим количеством проектов Docker Compose может получить
ошибку all predefined address pools have been fully subnetted. Не меняйте
конфигурацию Docker Desktop, Windows VPN/WSL/routes и не удаляйте сети
других проектов ради чистой установки ASA.

Для одного **нового** изолированного QA-проекта можно явно выбрать три
свободных private 10.x subnet диапазона (/24..28). Перед записью приватного
Compose overlay мастер проверит их на взаимное пересечение, существующие
Docker networks и маршруты Windows. В overlay .asa/docker-networks.yaml
сохраняются **только сети этого Compose project**, без изменения настроек
Docker Engine или хоста. Требуется дополнительное согласие
-ConfirmPrivateDockerNetworks. Пример с D2R2:

    powershell -NoProfile -ExecutionPolicy Bypass -File .\tools\asa-setup.ps1 -Root 'D:\ASA-CleanQA' -Mode auto -DataSource blank -Project 'asa-lab-cleannetqa-20261030' -WebPort 18620 -BlocksPort 18623 -NetworkCidrs '10.249.232.0/27,10.249.232.32/27,10.249.232.64/27' -Profile production -Apply -ConfirmBlankDatabase -ConfirmPrivateDockerNetworks

Это **не** автоматическое резервирование CIDR для всех компьютеров.
На обычном чистом Docker Desktop параметр -NetworkCidrs не требуется;
сети выделяются штатно. При коллизии CIDR установка останавливается.

На D2R2 первый пробный проект asa-lab-cleanqa-20261030,
Web 18610/Scratch 18613 не смог создать database network из-за
переполненного штатного пула. Его пустые тома и журналы ошибки оставлены
для аудита, без очистки. Новый независимый тест с явными CIDR работает в
проекте asa-lab-cleannetqa-20261030, Web 18620/Scratch 18623.
Существующие 4610, 4620, 18570 и production H-04 не изменяются.
