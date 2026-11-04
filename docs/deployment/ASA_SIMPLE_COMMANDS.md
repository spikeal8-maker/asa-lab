# ASA: повседневные команды владельца

Команда ASA объединяет существующие setup/manager, backup и systemd операции.
Новый менеджер данных, второй Compose stack и параллельный журнал состояния
не создаются. Основной профиль изменяющих операций — Ubuntu 24.04 amd64
с действующим 1Panel. Существующий Windows Apply сохранён.

**Без аргументов asa показывает компактную текущую сводку, а в интерактивном
терминале предлагает меню. asa update только проверяет выпуск.**
Обновление запускается исключительно через **sudo asa update apply**.
Без TTY или с параметром --json ввод не ожидается.

## Команды

| Команда | Назначение | Изменения и права |
|---|---|---|
| asa help, asa --help | Полная русская справка offline | Чтение; Docker, интернет, БД не нужны |
| asa help update, asa update --help, asa backup --help | Справка по разделу | Чтение |
| asa version | Версия CLI, записанный release и фактическая схема PostgreSQL раздельно | Чтение |
| asa status | Текущее состояние сервисов, БД, сайта и история резервирования | Чтение |
| asa doctor | Status плюс ОС, CPU/RAM, диски, физические датчики и cloud transport | Чтение |
| asa disk, asa disk usage | Свободные байты и inodes на разделах приложения, Docker, PostgreSQL, MinIO и backup | Чтение |
| asa disk health | SMART; для NVMe доступен резервный запрос nvme smart-log | Чтение; без прав/датчиков UNAVAILABLE |
| asa services, asa services status | Docker/Compose, состав, здоровье и совпадение pinned образов | Чтение |
| asa update, asa update check, asa check | Текущий и предлагаемый проверенный release | HTTP-чтение GHCR/GitHub; без Docker pull |
| asa update plan | SHA/digest, диапазон схем, backup space budget и блокеры | Чтение |
| sudo asa update apply | Обновление существующей установки с текущими locks, backup и приёмкой | Изменение; root supervisor, приложение от проверенного non-root оператора |
| sudo asa install | Установка в чистую цель, конфигурация и owner onboarding | Изменение; root supervisor |
| asa backup status | Последняя попытка, локальный успех и успешная доставка отдельно | Чтение |
| asa backup list | До 100 записей копий выбранной установки | Чтение |
| sudo asa backup create | Новая полная копия по сохранённой политике | Изменение; общий operation lock |
| asa backup verify | Проверка файлов и SHA-256 существующей локальной копии | Чтение всех файлов выбранного снимка; restore не выполняется |
| asa backup schedule | Сохранённая политика и фактический systemd timer | Чтение |
| sudo asa backup schedule enable | Включить сохранённое расписание backup | Изменение только расписания; общий lock |
| sudo asa backup schedule disable | Отключить расписание backup | Изменение только расписания; общий lock |
| asa cloud status | Политика, текущий контейнер транспорта и историческая доставка | Чтение; доступ к удалённым байтам сейчас не предполагается |
| sudo asa cloud sync | Повтор доставки существующего ciphertext; --snapshot-id выбирает другую копию | Изменение; существующий retry-cloud, без нового export/backup |
| asa restore plan | План с обязательным условием P1-R3A | Только чтение, BLOCKED_PLAN; decrypt/apply отсутствуют |
| asa history, asa update history | История попыток и результатов | Чтение |
| asa logs, asa logs update, asa logs backup | Безопасные события журнала операций | Чтение; raw stdout/stderr и секреты не выдаются |
| asa config show | Публичная проекция настроек по явному списку полей | Чтение; токены, пароли, ключи и AGE recipient не выводятся |

Сохраняется alias asa check для безопасного asa update check.
Команды asa backup и asa cloud показывают соответствующий status.

### Параметры и результаты

Общие параметры: --root с абсолютным путём, --json, --no-color, --help.
Переменная NO_COLOR также поддерживается. Сейчас вывод не содержит
ANSI-последовательностей ни в одном режиме.

Параметр --snapshot-id выбирает существующий снимок для verify/sync.
Без него backup verify и cloud sync выбирают указатель последней успешной
локальной копии. Для cloud sync обязательно уже существующее готовое ciphertext;
если его нет, команда блокируется, не создавая новый backup.
Параметр --operation-id выбирает журнал для logs
или продолжения штатной изменяющей операции. Параметр --config-file применяется
при первой установке: секреты находятся в приватном файле, не в argv.
Параметр --non-interactive запрещает вопросы и требует достаточной
конфигурации. JSON и отсутствие TTY автоматически включают этот режим.

| Код | Значение |
|---|---|
| 0 | Запрос или операция выполнены; отдельные компоненты имеют собственные статусы |
| 1 | Проверка не пройдена, либо актуальные сведения недоступны |
| 2 | Ошибка параметров/прав/конфигурации или безопасная блокировка |
| 130 | Прерывание оператором |

JSON возвращается одним объектом в stdout: format равен asa-cli-result-v1,
далее command, exitCode и типизированные данные. Изменяющая команда включает
managerExitCode и безопасную проекцию результата в operation: ID, outcome,
reasonCode, признаки приёмки и SHA. Неизвестный код менеджера нормализуется
в 1; исходный числовой код сохраняется. Автоматического повтора нет.

Поля format, command и exitCode задаёт CLI; данные команды их не переопределяют.
В asa config show версия исходной конфигурации передаётся отдельно как
configFormat: asa-setup-config-v1. Остальные поля настроек сохраняют плоскую
форму. Ответ содержит публичную проекцию разрешённых полей без секретов;
его нельзя импортировать как setup.json или передавать в --config-file.

## Подготовка Linux CLI до первой установки

Используется опубликованный setup release с отдельными аттестациями архива
и standalone acquisition helper. Публикация исходников сама по себе не создаёт
установленную или принятую систему. Candidate artifact из PR не является
разрешением исполнять его на действующем сервере.

Первичное получение выполняет **обычный администратор с sudo**, не root:
операторский файл acquisition helper нельзя запускать через sudo.
После проверки команда asa доступна из произвольного каталога, включая
root-терминал 1Panel, и остаётся доступной после перезагрузки.

Команды ниже запрашивают полный SHA разрешённого опубликованного setup
release. При отсутствующем release или неверной аттестации выполнение
останавливается до запуска кода из архива.

~~~bash
set -euo pipefail
test "$(id -u)" -ne 0
read -r -p 'Полный SHA разрешённого опубликованного setup release: ' asa_setup_revision
[[ "$asa_setup_revision" =~ ^[a-f0-9]{40}$ ]]
asa_setup_download="$(mktemp -d)"
asa_setup_helper="$asa_setup_download/asa-setup-acquire-$asa_setup_revision.py"
gh release download "setup-$asa_setup_revision" \
  --repo spikeal8-maker/asa-lab \
  --pattern "asa-setup-acquire-$asa_setup_revision.py" \
  --dir "$asa_setup_download"
gh attestation verify "$asa_setup_helper" \
  --repo spikeal8-maker/asa-lab \
  --signer-workflow spikeal8-maker/asa-lab/.github/workflows/setup-release.yml \
  --source-ref refs/heads/main \
  --source-digest "$asa_setup_revision" \
  --deny-self-hosted-runners
python3 -I -B "$asa_setup_helper" --revision "$asa_setup_revision"
asa help
sudo asa install
~~~

Helper загружает архив, создаёт защищённый root snapshot, проверяет его
GitHub attestation и только затем запускает пакетный extractor. После
извлечения регистрируются /usr/local/bin/asa и /etc/asa-lab/commands.json.
Для этого **не нужен installed-release.json**. Данные приложения и Docker
при регистрации не создаются.

Bundle допускается только в каталоге /opt/asa-setup/ с одним компонентом
полного SHA. Revision manifest совпадает с именем каталога; состав и хеши
всего bundle перепроверяются. Root-owned родители, исполняемые файлы и реестр
не допускают постороннюю запись, symlink или hardlink. Чужая существующая
команда asa не перезаписывается. Привилегированные Python-входы используют
-I -B и фиксированный PATH. Новый подготовленный bundle обслуживает и
прежде зарегистрированные установки, сохраняя их root/project/profile.

Исходная модель trust и prerequisites описана в
[UNIFIED_SETUP.md](UNIFIED_SETUP.md). Root SSH из внешней сети не требуется.

### Чистая установка

Штатная установка проверяет 1Panel, Docker, диски и чистоту цели, создаёт
выделенного оператора при необходимости, выбирает pinned release, подготавливает
конфигурацию, проводит owner onboarding, техническую и пользовательскую
приёмку и первую полную копию.

Для unattended-установки используются --root, --config-file и --non-interactive.
Формат входа — существующий asa-setup-config-v1, owner input —
asa-owner-onboarding-v1. Готовый onboarding принадлежит подтверждённому
оператору. Если оператор ещё не создан, первый проход может закончиться
OWNER_INPUT_REQUIRED после bootstrap. После подготовки приватного onboarding
повторяется та же установка. До сохранения setup journal onboarding следует
располагать **вне целевого root**, задав явный onboardingFile: посторонний
файл в .asa не превращается автоматически в чистую цель.

Install не становится update при обнаружении прежних данных. Supervisor
проверяет намерение до подготовки зависимостей. Затем текущий discovery и
journal проверяются повторно под общим operation lock до записи состояния.
Совместимый прямой bootstrap asa-setup.sh сохраняет свой прежний auto.

## Проверка и применение обновления

~~~bash
asa update check
asa update plan --json
~~~

Чтение выпуска использует ограниченный GHCR HTTP resolver: OCI index,
единственный linux/amd64 manifest, config и один слой scratch image с обычным
release.json. OCI хеши проверяются до JSON, а release и exact-SHA CI —
текущими валидаторами. Размеры, число запросов, redirects и распакованный tar
ограничены. Ссылки, traversal, лишние файлы и неизвестная структура отклоняются.
Bearer registry не пересылается blob host.

В target план возвращает source SHA, deployment digest, platform manifest
digest, schema и pinned service images. Поле apply содержит полную команду
с тем же --deployment-digest для применения проверенной immutable цели.

Без digest команда sudo asa update apply разрешает выпуск заново и показывает
новый план. Она не утверждает, что применяет ранее показанное значение stable.
Digest и намерение сохраняются в первом durable журнале до preflight.
Смена digest при resume блокируется. Переход в прежний protocol-1 setup
использует совместимые mode и полный release из того же журнала и тот же lock;
повторного выбора stable после такого перехода нет.

План различает измеренное и неизвестное:

- currentDatabase.schema читается из PostgreSQL; receipt не заменяет запрос.
- migrations показывает диапазон фактической и целевой схемы. Точный список
  требует verified migration runtime в изменяющей операции.
- backupSpaceEstimate использует текущие PG/MinIO bytes и число объектов,
  затем существующую формулу запаса snapshot, tar, ciphertext и readback.
  Это оценка backup, а не всего распакованного обновления.
- requiredSpaceBytes для полного обновления и estimatedDowntimeSeconds
  остаются null, пока нет измеренных данных. Причины указаны отдельно.
- Cloud transport, локальные квитанции и блокеры показываются отдельно;
  окончательные проверки повторяются под lock перед изменениями.

Для многократных GitHub CI проверок поддерживаются существующие необязательные
GH_TOKEN / GITHUB_TOKEN. Они передаются setup только через окружение,
затем в HTTP headers; в argv, публичном выводе и журнале CLI их нет.

## Что именно означает status

Контейнеры сопоставляются одновременно с Compose project и working directory.
Один healthy container, чужой root или старый успешный receipt не дают
зелёный статус. Release, действующая схема БД, pinned образы и текущие HTTP
endpoints читаются заново. Browser save/reopen не запускается командой чтения:
историческая приёмка имеет явную историческую область.

Недоступный Docker, закрытая .asa, отсутствие прав, тайм-аут датчика или
отсутствие физического диска в VM дают UNAVAILABLE. Ошибка SMART health с
ненулевым health bit отражается как FAILED, а не скрывается как отсутствие
датчика. Root читает только из проверенного bundle. Обычному пользователю
неизвестные защищённые данные не показываются как OK.

Backup status отдельно показывает последнюю попытку, последний локальный
успех и последнее доказательство доставки, дату снимка, возраст, размер и
расписание. Наличие каталога снимка и историческая проверка хешей различаются.
Backup verify проверяет реальные файлы и хеши, но не выполняет restore.

Cloud status не создаёт staging-каталоги транспорта, не обновляет OAuth
credentials и не скачивает объект. Контейнер транспорта проверяется сейчас;
дата и readback proof относятся к исторической доставке. Текущее наличие
и содержимое удалённых байтов остаются UNAVAILABLE, пока отдельная разрешённая
доставка с readback не подтвердила их. Cloud sync повторно использует
существующий ciphertext и штатные identity/lock проверки.

Расписание использует deterministic systemd units выбранной установки,
User проверенного non-root оператора и entrypoint конкретного root-owned
bundle. Enable/disable сохраняют настройку под общим lock; automaticUpdates
не изменяется.

## Несколько установок и диагностика

При нескольких зарегистрированных установках обязателен --root. Для явного
диагностического чтения допустим незарегистрированный абсолютный root;
изменения требуют системной регистрации. Служебный --registry разрешён
только в диагностике и не может выбрать root-dispatch.

Журналы CLI сохраняются в root-private /var/lib/asa-lab-operator, журнал setup —
в штатной приватной .asa/setup-logs. Публичный asa logs показывает типизированные
события, этапы и коды результата; произвольные raw сообщения не печатаются.
Config show не раскрывает неизвестные поля конфигурации.

## Windows

Сохраняются регистрация %LOCALAPPDATA%\ASA-Lab\cli\asa.cmd, пользовательский
PATH и существующий tools/asa-setup.ps1 -Mode update -Apply.
Default asa update выполняет безопасное чтение metadata на обеих ОС; прежний alias asa check сохранён.
Reader modules копируются рядом с прежним пользовательским CLI
из проверенного checkout.

Ubuntu preparation, install, backup/cloud writes и systemd в этом публичном
Windows адаптере пока блокируются кодом 2. Передача deployment digest в старый
Windows Apply также явно блокируется. Диагностика читает доступный Docker
Desktop; Linux-only датчики, mount paths и systemd могут быть UNAVAILABLE.
Это не декларация полной Windows operational acceptance.

## Проверка среза и внешняя приёмка

Focused tests запускают публичный entrypoint в subprocess: offline help,
noTTY, JSON/no-color, read routes, отсутствие новых файлов/locks/backup,
отказ опасного root dispatch и скрытие секретов. Отдельно проверяются OCI bytes,
tar/redirect bounds, смена stable, durable pin, гонка intent под lock,
совместимый handoff и расписание.

Модели Docker, пользователя и systemd в unit tests не являются испытанием
реальной Ubuntu + 1Panel. Требуются exact-SHA CI и независимый review, затем
разрешённая чистая установка, обновление с контрольными данными, реальные
cloud readback, systemd timer и reboot. До этого код не означает
READY_FOR_RELEASE.

Отсутствующая каноническая регистрация unified-setup-792 остаётся отдельным
preflight gap. Она не скрывается изменением current.yaml и не объявляется
SAFE_TO_START. Исходниковый срез выполняется по прямому разрешению владельца
продолжить существующий #845 и зависимый PR.
