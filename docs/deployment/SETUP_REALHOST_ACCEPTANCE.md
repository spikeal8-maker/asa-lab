# Приёмка ASA CLI на настоящей Ubuntu VM с 1Panel

`.github/workflows/setup-realhost.yml` запускает ограниченный сценарий
`tools/deployment/ci_setup_realhost.py` на обычном публичном GitHub-hosted runner
`ubuntu-24.04`. Внутри QEMU работает отдельная Ubuntu 24.04 со своим ядром,
PID 1 `systemd`, настоящим Docker и официальным 1Panel. Команды установки,
обновления, резервирования и управления расписанием проходят через публичный
`asa`. Сценарий не подключается к действующим установкам, Proxmox или платным VM.

## Границы результата

PR по умолчанию проверяет candidate CLI из **точного PR HEAD SHA**. Сборщик
проверяет байты исходников пакета относительно этого SHA; архив проверяется и
помещается в защищённый `/opt/asa-setup/<SHA>` только внутри одноразовой VM.
В режиме `candidate` поле `publishedSetupAcquisition` остаётся `BLOCKED` с
причиной `CANDIDATE_NOT_PUBLISHED_ATTESTED`.

Отдельный явный режим `published` проверяет настоящее получение уже
опубликованного attested setup release. Он доступен только через
`workflow_dispatch` на `refs/heads/main`. Полный `approved_setup_revision`
должен совпадать с `GITHUB_SHA`, `SOURCE_REVISION` и фактическим Git HEAD.
Checkout всегда берётся из события workflow: SHA из input не выбирает иной
checkout и не позволяет запустить privileged runner scripts из PR. Получение
выпуска не выполняется при обычном PR-run и не создаёт tag/release самостоятельно.

Вход в приложение внутри гостя — `http://127.0.0.1:4610`. Оба origin редактора
совпадают с ним, используются штатные same-origin и browser checks. Публичный
домен, сертификат и внешний HTTPS этим тестом не подтверждаются:
`publicHTTPS=NOT_RUN`. Шифрование локальных synthetic backup выполняет настоящий
AGE. Авторизация Yandex в VM не передаётся, поэтому
`realYandexFromGuest=NOT_RUN`, cloud в backup честно `NOT_CONFIGURED`, а результат
политики `best-effort` содержит предупреждение.

Доставка существующего synthetic ciphertext через отдельный разрешённый
реальный шлюз, её readback/SHA256 и повтор — другое evidence. Успех такого
транспорта не аттестует новый CLI SHA или гостевой end-to-end cloud workflow.
Восстановление production и P1-R3A в этом сценарии отсутствуют.

## Получение опубликованного setup release

| Dispatch input | Значение и проверка |
| --- | --- |
| `acquisition_mode` | `candidate` по умолчанию; `published` выбирается явно |
| `approved_setup_revision` | Пусто для candidate; полный согласованный SHA текущего main для published |

Перед реальным published-run нужны отдельные решения владельца об интеграции
и публикации setup release. Release должен уже существовать под точным тегом
`setup-<SHA>` с asset `asa-setup-acquire-<SHA>.py` и архивом
`asa-setup-<SHA>.tar.gz`. Их provenance проверяется только для
`spikeal8-maker/asa-lab/.github/workflows/setup-release.yml`, source ref
`refs/heads/main`, полного approved source digest и GitHub-hosted signer.
Workflow получает `attestations: read`; write permissions и публикация ему не нужны.

После настоящего 1Panel bootstrap отдельная фаза `published_setup_acquisition`
проверяет отсутствие `/opt/asa-setup`, `/usr/local/bin/asa`, системного registry
и установленной ASA/operator receipt. В этом режиме bootstrap **не вызывает**
manual `setup_bundle.py stage` или CLI `prepare`. Ошибка загрузки, attestation,
прав, source binding, timeout либо неопределённый исход останавливает сценарий;
fallback к candidate отсутствует.

Для проверки используется официальный fixed GitHub CLI **2.101.0**:

- [Архив Linux amd64](https://github.com/cli/cli/releases/download/v2.101.0/gh_2.101.0_linux_amd64.tar.gz), **15 282 175 bytes**;
- archive SHA256 `9bca2d1c16825f109907a23307628a2f0698fbf99662b73a5cf0b020293072b8`;
- source revision `0cf1092493af067646fc5f3db9421c6a6ec9c938`;
- ELF SHA256 `ea857a3f0f7d4276cf5848b236542c5048e2eaa7bdd1b6ddec238f8793e74bff`.

Гость сначала создаёт новую root-owned неизменяемую копию архива и сверяет её
size/SHA256. Из архива читается только ожидаемый regular `bin/gh`; links,
traversal, дубликаты, неожиданные типы и превышение границ отклоняются. ELF
проверяется по architecture/size/hash до первого исполнения и помещается в
новый защищённый каталог, без перезаписи существующего системного `gh`.
Проверяются версия и все четыре provenance flags: `--signer-workflow`,
`--source-ref`, `--source-digest`, `--deny-self-hosted-runners`.
Prerequisite для обычного владельца описан в [UNIFIED_SETUP.md](UNIFIED_SETUP.md).

Обычный cloud-init administrator `asa-ci` скачивает standalone helper. Root
копирует только прочитанные ограниченные bytes в новый protected snapshot;
путь исходного owner-writable файла не исполняется от root. Attestation
проверяет именно snapshot. До исполнения повторно сверяются его bytes и
identity. Тот же snapshot запускается обычным `asa-ci` через Python `-I -B`
из `/`, с фактическими UID/GID и supplementary groups. Затем неизменённый
публичный `asa_setup_acquire.py` сам выполняет download → root snapshot →
attestation → trusted stage → CLI preparation.

Exit 0 не является достаточным доказательством. Harness отдельно читает
фактически полученный protected archive, его digest/manifest, сравнивает полный
набор файлов и bytes с независимым source oracle, проверяет bundle ownership,
registry с пустым списком установок и точный wrapper. До первой установки
запускается публичный `asa help --json --no-color` из `/` и подтверждается
отсутствие install receipt. Source oracle никогда не заменяет опубликованный
архив в acquisition path. Далее выполняется тот же install/control/update/
backup/reboot маршрут.

Публикация нового main меняет default `deployment:stable`. Поэтому published
режим до VM независимо разрешает этот channel через Registry HTTP и проверяет
CI/revision: default target должен быть approved setup/main SHA. Его отдельный
`cliDefaultTargetExpectation` используется только для bare `update`, `check`
и `plan` в read suite. Управляемая пара runtime **98d7 → 959d**, её digests и
schema 304 остаются прежними. Evidence различает `defaultCliTarget` и
`controlledUpdateTarget`. Движение stable после подготовки даёт честный
`RELEASE_PIN_MISMATCH`; target не берётся из проверяемого CLI stdout.

Фаза ограничена 900 секундами, внешний guest process — 930 секундами внутри
прежнего общего бюджета 175 минут. Все child commands имеют закрытый stdin,
общий deadline и проверку завершения принадлежащей группы процессов. Token
поступает из существующего private-файла только в controlled environment
нужных дочерних процессов; argv, raw streams и секреты не попадают в artifact.
Независимый `publishedSetupAcquisition=PASS` сохраняется, даже если последующая
установка упадёт; общий run тогда остаётся FAIL. До owner-authorized публикации
и actual guest evidence published acquisition остаётся `NOT_RUN`, а не PASS.

## Проверяемый маршрут

1. Проверить, что runner действительно GitHub-hosted Ubuntu 24.04 amd64 и
   checkout совпадает с указанным полным SHA. До установки инструментов измерить
   свободное место, RAM и CPU.
2. Проверить подпись Ubuntu `SHA256SUMS.gpg` штатным Ubuntu keyring, сверить
   ожидаемый pinned SHA256 в подписанном manifest, скачать image и проверить
   реальные байты. Официальный архив 1Panel также проверяется по SHA256 и
   размеру; его `install.sh` имеет отдельный SHA256. Непроверенный `curl | bash`
   и изменяемый `quick_start.sh` не используются.
3. Запустить QEMU и запросить `query-kvm`: наличие `/dev/kvm` само по себе не
   считается доказательством ускорения. Если проблема только в правах, текущий
   UID данного disposable runner получает ACL только на существующее character
   device `/dev/kvm`; затем фактический KVM проверяется повторно через QMP.
4. Выполнить официальный non-interactive installer 1Panel. Проверить активные
   `1panel-core`, `1panel-agent`, Docker и совпадение установленных бинарных
   файлов с проверенным архивом. Зафиксировать Docker daemon identity,
   версии пакетов, конфигурацию и unit/binary hashes 1Panel.
5. В candidate mode зарегистрировать candidate CLI; в published mode пройти
   отдельную acquisition-фазу выше. Первый `asa install` создаёт штатного
   non-root оператора и ожидаемо останавливается на `OWNER_INPUT_REQUIRED`.
   У оператора после этого уже известен UID: fixture создаёт его приватный
   synthetic onboarding **вне целевого checkout**, в фактическом home из
   проверенного operator receipt. Повтор той же установки и installation ID
   проходит через публичный `asa install` с приватным `--config-file`.
   Этот подготовительный останов не объявляется успешной установкой.
6. Установить предыдущий опубликованный ASA runtime по immutable digest.
   Проверить штатные технические и браузерные результаты, готовность owner,
   первый полный backup и сохранение исходного Docker/1Panel.
7. Штатным закреплённым browser runner создать отдельную контрольную группу:
   teacher, student seat, classroom, course, Scratch и electronics projects.
   Она использует другой приватный fixture file, поэтому обычная browser
   acceptance обновления не меняет контрольные drafts. Сохранить только хеши
   и число контрольных строк, включая `project_drafts`; отдельно хешировать
   роли и пароли PostgreSQL, ACL/RLS, настройки и storage identity. Записать и
   прочитать контрольный объект через authenticated S3.
8. До обновления выполнить обязательный этап `installed_cli_read_acceptance`:
   31 отдельный public process из `/`, точная семантическая проверка JSON и
   настоящие pipe/PTY формы bare `asa`. Сверить выбранные control files и
   независимо измеренные контрольные данные до и после команд чтения.
9. Выполнить `asa update check`, `plan`, `apply` для другого опубликованного
   runtime; проверить реальную смену release и сохранность контрольной группы.
   Повтор той же операции и следующий `NO_CHANGE` не должны создавать backup.
   Пара pinned runtime имеет одинаковую схему 304: миграция между различными
   версиями схемы этим результатом не доказывается.
10. В собственной одноразовой VM подготовить отдельный pinned rclone transport
    с пустой конфигурацией, отсоединить только его сеть и доказать отсутствие
    внешнего маршрута. Только затем импортировать явно фиктивный OAuth config.
    Проверить реальный `asa cloud sync` существующего ciphertext при best-effort
    и один новый `asa backup create` при required. Требуются завершившийся
    rclone network attempt, исходные данные и точная матрица исходов ниже.
    После проверки удалить только принадлежащие fixture container/network и
    dummy config, восстановить исходные private setup bytes/owner/mode.
11. Через `asa backup create` создать полный synthetic backup, проверить его
   `asa backup verify`, повторить тот же operation ID и выполнить `asa cloud
   sync` существующего snapshot. SHA256 ciphertext и число снимков сохраняются;
   отсутствие облачной конфигурации не превращается в подтверждённую доставку.
12. В отдельном дочернем network namespace выполнить публичный `asa update check`.
    Зафиксировать разные inode namespace, отсутствие внешнего интерфейса,
    exit 2 / `RELEASE_UNAVAILABLE`, неизменность namespace родителя и данных.
    Это реальный отказ сети для release lookup; доступность Yandex этим не проверяется.
13. Создать отдельный synthetic S3 object через authenticated API, прочитать его
    обратно и сверить SHA256. Перед file-limit fault доказать, что сохранённые
    `database.dump` и `globals.sql` меньше 8 МиБ, а фактический MinIO `part.N`
    именно этого объекта больше 8 МиБ. Запустить публичный `asa backup create`
    с per-child `RLIMIT_FSIZE=8 MiB` и `RLIMIT_CORE=0`. Только реальные неполные
    bytes нужного part, достигшие лимита, считаются выполненной инъекцией.
14. Другой публичный backup прервать SIGINT в наблюдаемом окне после dump/globals
    и создания `objects`, до manifest/final. Краткий SIGSTOP собственной группы
    фиксирует окно; затем SIGINT и обязательный SIGCONT. Дождаться всех своих
    потомков, освобождения lock и стабильных partial bytes. Для обоих fault
    operation IDs повтор публичного backup должен восстановить оставшийся
    owned hold и вернуть публичный FAILED / exit 1 (manager ERROR), с nested
    backup receipt BLOCKED / `BACKUP_RESUME_SNAPSHOT_MISSING`, сохранив
    исходный partial и последний успешный backup. После этого отдельная новая
    операция должна создать и проверить полный AGE backup; success pointer
    должен перейти к нему. Оба incomplete snapshot сохраняются до уничтожения VM.
15. Выполнить настоящий `systemctl reboot` гостя. Host runner и процесс QEMU
    продолжают работу; требуется новый `boot_id`, готовое приложение и прежние
    data/config/1Panel/Docker fingerprints. Перезапуск контейнера либо service
    не заменяет эту проверку.
16. Выбрать ближайшее время только в тестовом private `setup.json` через штатные
    `validate_config`/`save_private`. Это подготовка fixture, а не заявление о
    публичной CLI-команде изменения произвольного времени. Затем исключительно
    через `asa backup schedule enable/disable` проверить enable → disable →
    enable, отсутствие дублирующих units и независимость от automatic update.
17. До календарного времени проверить нулевое число попыток данного slot,
    выключить гостя, дождаться пропущенного времени на host и запустить **тот же
    qcow2**. Часы не переводятся, `Persistent=true` и штатные units не изменяются.
    После загрузки требуется успешный backup пропущенного slot.
18. Проверить настоящий systemd retry после ошибки. Если первый missed запуск
    был успешен, краткий процесс проверенного оператора удерживает штатный
    общий lock; второй старт штатного service получает реальную ошибку. Lock
    освобождается, а неизменённый `RestartSec=300` выполняет третий старт
    автоматически. Фиксируются failed exit, `NRestarts`, успешное завершение и
    прежние snapshot/SHA256. Если ошибка и automatic retry уже произошли при
    загрузке, используются их наблюдённые evidence, чтобы не расходовать slot
    сверх лимита. Без наблюдения реальной ошибки PASS запрещён. Четвёртая
    попытка должна быть отклонена start limit либо `ExecCondition`; receipts и
    часы для этого не подменяются. В конце timer выключается публичным `asa`.
19. Сверить контрольные данные после reboot/backup/timer и вновь выполнить
    штатные browser save/reopen journeys контрольной группы.

## Обязательная проверка команд чтения установленного CLI

Этап `installed_cli_read_acceptance` расположен после успешной установки
предыдущего runtime и создания отдельной контрольной группы, до первого
`update apply`, backup fault или изменения расписания. Ошибка этого этапа
останавливает следующие фазы. Каждый вызов использует настоящий
`/usr/local/bin/asa`, `cwd=/` и `--no-color`; для JSON дополнительно требуются
единственный UTF-8 object, штатный `asa-cli-result-v1`, фактический exit code и
отсутствие stderr. Набор содержит ровно 31 процесс:

| Группа | Формы | Число |
| --- | --- | --- |
| Справка, JSON | `help`, `--help`, `help update`, `update --help`, `backup --help` | 5 |
| Bare, JSON | `asa --root /srv/asa-lab --json --no-color` | 1 |
| Состояние | `version`, `status`, `doctor`, `services`, `services status` | 5 |
| Диски | `disk`, `disk usage`, `disk health` | 3 |
| Обновление без применения | `update`, `update check`, `update plan`, `update history` | 4 |
| Резервные копии | `backup status`, `backup list`, `backup verify`, `backup schedule` | 4 |
| Cloud и конфигурация | `cloud status`, `config show` | 2 |
| История | `history`, `logs`, `logs update`, `logs backup` | 4 |
| План восстановления | `restore plan` для существующего локального snapshot | 1 |
| Bare, human | Закрытый stdin без TTY; настоящий PTY с Enter после приглашения | 2 |

Обе human формы проверяют компактную сводку, фактические release/schema и
последний локальный backup. Pipe не ждёт ввода; PTY должен показать меню,
принять Enter и завершиться в пределах timeout. Проверка не заменяется
подстановкой `isatty()`.

Перед первым вызовом этой фазы все файлы candidate bundle сверяются с
первоначальным SHA256-проверенным архивом, включая отсутствие лишних модулей.
Root-owned registration должна указывать единственную fixture installation
и точный `/opt/asa-setup/<sourceRevision>`, а защищённый wrapper — запускать
именно этот bundle с `/usr/bin/python3 -I -B`. Каталоги проверяются через
`openat`/`O_NOFOLLOW`; у файлов не допускаются symlink, дополнительные hard
links или запись другим пользователем. `realhost_cli_checks.py`,
`realhost_cli_runtime.py` и verifier `setup_bundle.py` доставляются отдельно
как root-owned 0644. Их hashes сверяются с точными Git bytes и архивом;
импорт исполняет уже проверенные bytes под явным именем в `sys.modules`,
включая корректную работу dataclasses при `-I`.

Ожидания не выводятся из проверяемых CLI ответов. Host заранее разрешает два
immutable deployment digest через Registry HTTP resolver, проверяет OCI
digests, CI, publication run, revision/schema и пять service image refs.
В госте installation ID, operation ID и snapshot ID дополнительно связываются
с приватными config, journal, последней успешной квитанцией, backup receipt и
pointers. Пути Docker/PostgreSQL/MinIO получаются отдельным наблюдением
закреплённого локального daemon, project/service/working directory, Compose
files и image references. `asa update` и `update check/plan` наблюдают `stable`
без подстановки ожидаемого digest в argv: сдвиг mutable tag относительно
утверждённого target даёт FAIL с несовпадением pin, а не новый ожидаемый target.

Проверяющий модуль сопоставляет точные status, exit, reason и required fields;
общего разрешения `0/1/2` для этих результатов нет. Недоступный physical SMART
сохраняется как `UNAVAILABLE`; отключённый cloud и его transport/remote также
остаются `UNAVAILABLE`. Это допустимые границы fixture, а не подтверждение
здоровья диска или доставки в облако. Вложенные ограничения `doctor` сохраняются.
`restore plan` ожидаемо возвращает exit 2 / `BLOCKED_PLAN` /
`P1_R3A_REQUIRED`, `applyAllowed=false`. Общая потребность в месте и downtime
не выдаются за измеренные значения, когда CLI сообщает unknown; отдельная
backup-space оценка проверяется вместе с её измеренными полями и reason.
`configFormat` описывает исходный setup format внутри CLI envelope; вывод
`config show` остаётся sanitized projection.

Порядок проверки неизменности: DB/S3 callback → filesystem fingerprint →
31 CLI process → повторный fingerprint → повторный callback. Подготовка
fixture и root-owned metadata для callback завершаются до первого fingerprint;
backup write freeze в этой фазе отсутствует. Fingerprint охватывает только
`.env`, `.asa/setup.json`, `installation.json`, optional
`runtime-configuration.json`, `installed-release.json`, setup journals,
last-attempt/last-successful, backup receipts/pointers/bindings и системный
`/etc/asa-lab/commands.json`. Для каждого файла проверяются protected ancestry,
владелец, mode, единственная link, device/inode, размер, mtime/ctime и content
hash; atime исключён. Наружу выходят counts, combined hashes и `UNCHANGED` либо
закрытая причина ошибки. Live PostgreSQL/MinIO files и raw logs не хэшируются;
это не доказательство неизменности всей файловой системы.

Callback работает от проверенного non-root оператора и возвращает ровно
`databaseSha256`, `databaseRows`, `objectsSha256`, `objectCount`, `objectBytes`.
Один PostgreSQL `SELECT` с `default_transaction_read_only=on` и
`statement_timeout` читает закреплённую группу пяти таблиц и её drafts.
Authenticated S3 read читает один ранее созданный объект и сверяет фактические
bytes. Для этого запускается временный Compose client с уникальными name и
nonce label; запись его локальной client config и создание Docker container
происходят вне filesystem window. Application data callback не меняет.
Контейнер удаляется только после проверки точных ID/name/nonce/project/root и
image; чужая identity останавливает cleanup. Поэтому этот этап не называется
write-free Docker probe.

Оба callback используют собственный общий deadline не более 60 секунд,
передают остаток бюджета дочерним командам и резервируют время на очистку
принадлежащих им процессов. Coordinator имеет 900 секунд; внешний guest
process — 1200 секунд внутри прежнего общего host deadline. Ошибка сохраняет
первую причину, завершённые closed projections и доступные результаты
сравнения. `cliReadEvidence.examples` содержит реальные sanitized примеры
help/help-update/status/disk/update-check; `observations` отдельно сохраняет
ограничения doctor/cloud/restore и остальных команд. Raw stdout/stderr,
messages, env, SQL rows, пароли, произвольные dict и log strings в artifact
не копируются. До exact-SHA VM run это source-checked сценарий, не runtime PASS.

## Ограничения ресурсов и времени

| Ресурс | Граница |
| --- | --- |
| Runner | Только стандартный GitHub-hosted Ubuntu 24.04 amd64 |
| Host RAM / CPU | Не менее 13 GiB RAM и 4 CPU |
| Гостевая VM | 3 vCPU, 10 GiB RAM |
| Диск гостя | qcow2, 40 GiB виртуальной ёмкости, sparse |
| Реально свободное место до запуска | Не менее 24 GiB |
| Резерв host filesystem | При остатке менее 3 GiB гостевые записи останавливаются, результат `BLOCKED` |
| SSH | Только `127.0.0.1:2222`; 1Panel и ASA не публикуются через host forwarding |
| TCG | Boot/bootstrap не более 20 минут; при превышении `BLOCKED_TCG_BUDGET` |
| Job | 180 минут; orchestrator ограничен 175 минутами для сохранения evidence |
| Установленный CLI read suite | 900 секунд; внешний guest process 1200 секунд |
| Каждый DB/S3 callback | Не более 60 секунд вместе с остаточными timeout и собственной очисткой |
| Общий fault budget | Не более 75 минут внутри прежних 175 минут; общий deadline не продлевается |
| Cloud connection/policies | 40 минут, включая резерв очистки 180 секунд; внешний guest process до 2430 секунд |
| Public cloud sync / required backup | Не более 720 / 1200 секунд и не более остатка cloud phase |
| Каждый backup fault | 1800 секунд, плюс до 30 секунд на host transport/cleanup |
| Окно interruption / краткий SIGSTOP | До 180 секунд ожидания; остановленная группа не более 3 секунд |
| Ожидание потомков / same-ID recovery | 600 / 650 секунд; штатные start 90 + readiness 300 + writers 90 не сокращены |
| Namespace connection phase | До 900 секунд вместе с контрольными наблюдениями |
| Место перед fault | Не менее 6 GiB свободно и на host, и в guest; прежний host reserve 3 GiB сохраняется |

Виртуальные 40 GiB не считаются реально свободным местом. Проверка остатка
продолжается при скачивании, ожидании subprocess, reboot и offline timer wait.
Сценарий не освобождает место глобальным Docker prune или удалением неизвестных
каталогов. Если среда не подходит, artifact содержит измерения и точную причину.

## Ошибки соединения и политика резервирования

`public_cloud_connection_policies` выполняется после published runtime update,
до положительного `public_backup_and_retry`. Фаза доступна только в fresh
nonce-bound QEMU/KVM госте Ubuntu 24.04 с уже доказанными operator, candidate
bundle, application identity и исходным Docker daemon. До подготовки должны
отсутствовать `/srv/asa-cloud-storage`, project/container и одноимённая сеть.
Существующие ресурсы не усыновляются. Публичные операции вызываются через
настоящий `/usr/local/bin/asa`; Python manager boundary не подменяется.

Используются неизменённый `cloud_storage.py` из Ops revision
`a328523a20b1a63775206aa3096a7052930a03e8`, SHA256
`e494038f3d1ad7e6ae7bc72f0cc0ff8bb3ab3a18d8a96a42d0302f46764ae760`, и образ
`rclone/rclone@sha256:2687085f718d3c628f7fdfb77c52a1d344332aed543110bb88088f2c70d43eb5`.
Для Linux amd64 закреплён image ID
`sha256:7ab08c1ee84502fb76ec95b3dc759aa46a9074cce2967d540e0ab50d8c844af4`
и проверяется версия 1.75.2. Подготовка вызывает существующий trusted launcher
сначала **без credentials**. Сохраняются полные container/network IDs,
creation/start timestamps, image ref/ID, Compose project/root/config-file
labels, ровно два bind mounts, user 1000:1000, read-only root, отсутствие
public ports и дополнительные privilege ограничения. Перед каждым воздействием
identity проверяется повторно; daemon и сети приложения не изменяются.

Отсоединяется только новый transport от его собственной сети. Требуются пустой
`NetworkSettings.Networks`, отдельный inode network namespace, только loopback
interface и отсутствие внешних IPv4/IPv6 маршрутов. Credential import разрешён
только после свежего root-private isolation receipt и повторной проверки
PID/starttime/namespace. Transport продолжает работать. Штатная preparation
повторно использует running container без pull, recreate или reconnect.

Фиктивный single `[yandex]` config содержит явно synthetic access/refresh token,
тип OAuth и будущий expiry. Они нужны для прохождения локального разбора pinned
backend без token upgrade/refresh и не являются авторизацией провайдера.
`rclone version` и `listremotes` читают конфигурацию локально после изоляции;
её точные bytes и file identity контролируются до и после операций. Raw config,
token, token hash, provider stderr, inspect JSON и command argv не публикуются.

Меняется только fixture `backup.policy` и разрешённые cloud fields в private
setup configuration, через штатные `validate_config` / `save_private` под общим
operation lock от проверенного оператора. До каждого изменения нужны terminal
journals, отсутствие maintenance hold, прежние writers и контрольные DB/S3
fingerprints. Исходные config bytes/owner/mode сохраняются отдельно и затем
восстанавливаются точно. Это fixture setter, а не публичная CLI-команда настройки.
Installation ID, root, runtime, origins, recipient, browser, ports/data и
`localKeep=null` / `remoteKeep=null` не меняются; retention не проверяется.

| Публичная операция | Local / encryption / cloud | Backup receipt | Setup outcome | Public status / exit | Число новых snapshot |
| --- | --- | --- | --- | --- | --- |
| Best-effort `asa cloud sync --snapshot-id ... --operation-id ...` | OK / OK / FAILED | WARNING | WARNING | OK / 0 | 0 |
| Required `asa backup create --operation-id ...` | OK / OK / FAILED | BLOCKED | ERROR | FAILED / 1 | 1 |

В обоих случаях protection остаётся false и требуется именно
`CLOUD_TRANSFER_FAILED`. Required не ожидает exit 2: сохранённый локально backup
при обязательной недоставленной cloud-копии преобразуется штатным setup result
в ERROR. Повтор доставки использует исходный complete ciphertext и сохраняет
его source operation ID; новый retry journal имеет собственный operation ID.
Manifest/ciphertext SHA256, размер и полный inventory подтверждают отсутствие
повторного экспорта. Required создаёт ровно один новый synthetic snapshot,
поскольку политика старой receipt неизменяема. Его локальный success pointer
продвигается согласно producer, несмотря на общий ERROR; прежний ciphertext
сохраняется. Пустой штатный `encrypted/.staging` допустим, незавершённое
шифрование блокирует вход в сценарий.

Доказательство transport failure включает полный daemon event lifecycle
`exec_create` → `exec_start` → `exec_die` ровно одного pinned `rclone mkdir`
в изолированном container, с естественным exit 1 или 5. Local spool и штатные
healthcheck exec различаются по точным producer command forms; они должны
завершиться с exit 0. Отсутствие части lifecycle, неизвестная команда, обрезанная
история Docker (в ней не более 256 последних событий), timeout, duration limit
exit 10, сигнал, configuration/auth/tool error, missing/stopped transport или
`CLOUD_NOT_CONNECTED` не считаются connection-fault PASS. Каждая standalone
transport call имеет product budget 600 секунд и rclone `--max-duration 595s`.

Закрытая категория результата —
`TRANSPORT_FAILURE_UNDER_PROVEN_NO_EGRESS`; точный errno/provider response
остаётся `UNAVAILABLE`. `realProviderAuthentication=NOT_RUN` и
`realYandexUploadReadback=NOT_RUN` обязательны: фиктивная авторизация не доказывает
отказ или доступность настоящего Yandex. Первичный сетевой запрос pinned Yandex
backend может выполняться при его инициализации внутри команды `mkdir`.

Очистка учитывает, что Docker exec не принадлежит host CLI process group.
После доказанного завершения принадлежащей тесту группы отдельно проверяются
container exec IDs. Затем останавливается только exact bound transport;
необходимы exited state, PID 0, пустые exec IDs и завершение исходного init
процесса. Только после этого удаляется exact dummy config, восстанавливаются
setup bytes/owner/mode и удаляются stopped container и пустая собственная сеть.
Сеть не подключается обратно ни на одном этапе. Пустой private spool сохраняется
до уничтожения VM. Identity loss или недоказанная очистка останавливают дальнейшую
приёмку; исходный публичный отказ и cleanup failure записываются раздельно.

После успешной очистки следующая положительная backup-фаза работает с исходной
cloud-disabled best-effort конфигурацией. Она создаёт новый complete backup,
восстанавливает ожидаемый truthful WARNING / NOT_CONFIGURED last attempt и
проверяет retry до остальных partial/interruption/timer сценариев. Все cloud,
последующая positive backup и остальные fault phases разделяют прежние 75 минут;
их индивидуальные максимумы не суммируются поверх общего бюджета. Cloud-фаза
не стартует без полного оставшегося 40-минутного admission budget. Истечение
времени/места даёт BLOCKED, а не положительный исход политики. До exact-SHA VM
evidence этот раздел описывает сценарий и source/test contracts, не runtime PASS.

Тот же focused test entrypoint проверяет `required` и `best-effort` на изолированных
synthetic manager fixtures. Bound socket на loopback без `listen` даёт настоящую
ошибку TCP-соединения; тестовый transport boundary передаёт её менеджеру как
`CLOUD_TRANSFER_FAILED`. `required` должен вернуть `BLOCKED` и возобновить старых
писателей; `best-effort` — `WARNING` с сохранённой локальной копией. Обе ветки
сохраняют truthful cloud/restore status. Это отдельная manager-level проверка,
её BLOCKED не подменяет public exit 1 из таблицы выше. AGE в этом узком policy test подменён
существующей тестовой fixture, поэтому это не evidence криптографии или реального
провайдера. Ключи Yandex и сеть общего шлюза не затрагиваются.

## Реальные runtime fault-сценарии

Три дополнительных guest-фазы используют публичный `asa`. В них нет подмены
Python manager, production test hooks, записи в receipts или ручной очистки
maintenance. Публичная операция сохраняет свои штатные guards и recovery.

File-limit действует только на отдельный CLI subprocess и его потомков.
Лимит относится к каждому файлу, поэтому один лишь размер S3 object не является
доказательством инъекции: проверяются реальные исходные и partial MinIO parts.
64 MiB случайного synthetic payload загружаются и читаются authenticated S3;
fixture uploader завершается до резервирования. Ни один polling observer не
открывает DB session во время freeze. Наблюдение читает только файлы журнала,
partial metadata и `/proc`. Контрольные строки/roles/ACL, storage identity и
исходные container IDs/running states проверяются после готовности приложения.

Interruption опирается на inotify и повторное наблюдение окна после SIGSTOP.
Если manifest/final уже появились или нужное окно пропущено, результат BLOCKED;
успешный backup не выдаётся за проверку отказа. Evidence называет базовое окно
`AFTER_DUMPS_BEFORE_OBJECTS_COMPLETE`. Утверждение `interruptedDuringCopy=true`
допускается только при ненулевых object bytes и подтверждённом native
`docker cp` соответствующего MinIO container в этот partial.

Session leader сохраняется unreaped до завершения живых потомков: числовой
PGID не может быть использован заново в промежутке. Перед каждым сигналом
проверяются PID/starttime/PGID/SID и реальные участники группы. После quiescence
группа закрывается для дальнейших сигналов. Exit 130 внешнего CLI недостаточен:
нужны завершившиеся потомки, свободный штатный lock и два одинаковых наблюдения
partial с хешами. `PENDING`, `RUNNING`, `RECOVERY_REQUIRED` до recovery остаются
неопределёнными исходами, успешным backup они не считаются.

До запуска fault child проверяется совпадение `/proc` с фактическим PID
namespace. Несовпадение блокирует runtime probe до создания subprocess;
обнаруженный потомок, вышедший из принадлежащей тесту process group, также даёт
BLOCKED. Три focused native ownership tests имеют явный capability skip для
scratch с чужим `/proc`; это отражается в `testsSkipped` и
`nativeProcessOwnership=NOT_RUN`, а не считается native PASS. В стандартном
GitHub-hosted Linux namespace эти тесты выполняются. Нативные file-limit и
inotify tests не требуют обхода этого guard и сохраняют собственную проверку.

Same-ID команда проверяется отдельно от cleanup после SIGINT: evidence отмечает,
оставался ли maintenance hold перед её запуском. Её ожидаемый результат —
публичный FAILED/exit 1 (manager ERROR) и nested BLOCKED с
`BACKUP_RESUME_SNAPSHOT_MISSING` в durable backup receipt, без нового export.
Наличие complete backup или обновление прошлого
success pointer до отдельной новой успешной операции считается FAIL. Synthetic
S3 key удаляется только целевым authenticated `mc rm` после подтверждённой
готовности приложения; никакой recursive очистки нет. Incomplete snapshots и
их receipts не удаляются вручную.

Первоначальный ориентир 20 минут для faults заменён общим максимумом 75 минут:
он не покрывал худший случай штатного восстановления нескольких операций.
Пределы отдельных фаз не складываются поверх общего 175-минутного deadline.
Исчерпание времени/места harness классифицируется BLOCKED acceptance;
наблюдённое нарушение контракта продукта — FAIL. Все материалы этого раздела
остаются сценарием до появления соответствующего exact-SHA VM evidence.

Локальная focused проверка:

```bash
python3 -B -m unittest discover -s tools/deployment -p 'test_ci_setup_realhost.py' -v
```

Тот же набор вызывается orchestrator с `--evidence` и записывает явный
`synthetic_cloud_policy_contracts` этап. VM-сценарий допускается только в
GitHub-hosted runner; там используется:

```bash
python3 tools/deployment/ci_setup_realhost.py --revision "$(git rev-parse HEAD)"
```

## Evidence и секреты

Workflow всегда загружает только
`test-results/setup-realhost/evidence.json`. Этапы имеют `PASS`, `FAIL`, `BLOCKED`
или `NOT_RUN`; исключение не может превратиться в PASS. Общий PASS означает
только перечисленный candidate/loopback/guest scope. Отсутствующий опубликованный
setup release, публичный HTTPS, Yandex из гостя и production restore остаются
видимыми отдельными границами.

При неожиданном отказе первой публичной установки сохраняются исходный
`cliActions` и общий FAIL. Отдельное `postFailureDiagnostic` с `observedAt`
содержит новое read-only наблюдение после этого отказа: настоящий pinned
`asa_setup.py intent-check --intent install --root /srv/asa-lab --json`
запускается от уже подтверждённого непривилегированного оператора с `cwd=/`.
Штатные проверки protected bundle, operator receipt и владельца выполняются
повторно; probe не создаёт оператора или target и не продолжает установку.
В evidence разрешены только закрытые reason/error enums, exit code, фактический
non-root UID и mode/read/traverse известных путей bundle. При общем отказе
intent-check дополнительно наблюдаются нативные Docker/Compose и
`docker_inventory`/`classify_installation`: только availability exit codes,
complete, state и закрытые reason codes. Каждое внешнее наблюдение ограничено
64 КиБ суммарного stdout/stderr; intent-check имеет бюджет 45 секунд, проверка
путей 10 секунд, дополнительная инвентаризация 65 секунд, затем ограниченная
очистка только собственных process groups. Raw output, traceback, env и
содержимое конфигурации не публикуются. Успешный поздний probe или изменение
инвентаризации не доказывает состояние первой попытки и не меняет её FAIL.

Linux probe удерживает непосредственно созданный процесс через
`waitid(WEXITED | WNOHANG | WNOWAIT)`: `poll()`/`wait()` не освобождают PID до
последнего сигнала очистки. Перед TERM и KILL проверяются принадлежность child,
PGID и SID; потерянное подтверждение не восстанавливается повторной попыткой.
После TERM ожидание ограничено одной секундой, после KILL — двумя секундами;
только затем leader reap, pipes закрываются при любом исходе. Групповые сигналы
адресуются и потомкам, удерживающим pipes после выхода leader; чужая либо
неподтверждённая группа не сигналится.
Nested probe без собственной session сигналит только свой прямой child PID.
Неизвестная/reaped identity не даёт права на сигнал; ошибки ownership/cleanup
имеют закрытые reason codes. `cleanupReasonCode` не заменяет исходный timeout,
лимит вывода или исходный публичный FAIL.

При неожиданном nonzero exit публичных `install`, `update apply`, `backup create`
или `cloud sync` дополнительное поле `commandFailureDiagnostic` сохраняет
закрытую проекцию текущей операции. Operation ID и installation ID берутся из
вложенного `result.operation` того же public invocation и публикуются только
после сверки с существующими private `setup.json`, точным
`setup-operations/<operationId>.json` и `setup-last-attempt.json`. Проверяются
root, non-root operator UID, mode, exit, outcome и reason; полный `journal.result`
должен совпасть с receipt в памяти. Полное `st_mtime_ns` last-attempt должно
попадать во включённый интервал `startedNs <= st_mtime_ns <= finishedNs` без
округления до секунд. Диагностика не продолжает
операцию и не приобретает mutation lock. Это новое read-only наблюдение после
отказа, обозначенное `AFTER_PUBLIC_FAILURE` и `observedAt`.

Для отказа `backup schedule enable/disable` отдельный format
`asa-root-action-observation-v1` в `commandFailureDiagnostic` наблюдает только
фиксированную private `setup-root-actions.json`: baseline снимается до public
вызова, после него повторно проверяются владелец, обычный файл без ссылок,
installation/root и изменение файла; полные mtime/ctime ns должны лежать внутри
интервала вызова. Выводятся только закрытые status/reason и описанный ниже снимок. Это
`AFTER_PUBLIC_FAILURE`, `binding: UNVERIFIED`, `causalProof: false`: файл не
доказывает автора записи или причину именно этого child. Его operation ID может
ссылаться на предыдущий last-attempt и не выдаётся за новую schedule operation.
Даже receipt `OK` не меняет исходный public FAIL; stale/unsafe/неполное состояние
даёт `UNAVAILABLE`, без повторного включения timer или повтора отказавшей команды.

При `BACKUP_SCHEDULE_INACTIVE` поле `scheduleObservation` сохраняет уже полученный
снимок непосредственно перед существующим guard: закрытые `loadState`,
`activeState`, `unitFileState`, логические `installed`/`running` и `timerQuery`.
`queryError` различает отказ запроса `TIMER` и отказ последующего запроса `SERVICE`;
`NONE` допустим только при отсутствии ошибки обоих запросов. Отсутствующее свойство
успешного timer-запроса — `MISSING`, неизвестное значение — `UNRECOGNIZED`,
несостоявшийся запрос — `UNAVAILABLE`. Сбой service-запроса сохраняет прочитанные
timer-поля и сам по себе не объявляется причиной startup failure. Повреждённый
снимок даёт закрытый `UNAVAILABLE`, не стирая исходный reason или public failure.
Новых запросов, ожиданий или повторов нет; snapshot наследует `UNVERIFIED` и
`causalProof: false` внешнего файлового наблюдения. Default public status/API
и прежний критерий enabled+active остаются неизменными.

В artifact разрешены только известные `journalPhase`, `receiptStage`, state,
intent/done/failed для фиксированного списка стадий и типизированные acceptance
flags. Неизвестные имена, uppercase reason strings и значения заменяются
закрытыми маркерами; приватные events, bootstrap config, env и произвольные
вложенные словари не копируются. Revision/schema показываются как подтверждённые
только при завершённой стадии `release` и совпадении с закреплённым runtime.
Digest дополнительно должен совпасть с сохранённым selector. Намерение pull
или длительность операции сами по себе не подтверждают выбранный release.

`receiptDetails` дополняет эту проекцию только после тех же полных binding checks,
из уже прочитанных config/journal/receipt, без дополнительных файлов, логов или
команд. Верхний reason имеет отдельное состояние `MISSING`, `NULL`,
`RECOGNIZED` или `UNRECOGNIZED` с закрытым признаком string/non-string. Это
различает отсутствие причины агрегированного `ERROR` и неизвестный код.
Показываются статусы шести фиксированных строк отчёта, а не их приватное содержимое.

Browser связан с parent operation/installation, instance технической приёмки,
точным `stages.browser.evidence` и подтверждённым runtime pin. Completed report
дополнительно сверяется с сохранёнными revision/origin/invocation и pinned Ops
component; эти приватные значения не публикуются. Ранний `incomplete` или
`environment_failed` может иметь `runtimeProvenance: NOT_RECORDED`: это наблюдение
отказа, а не подтверждение browser runtime. Выводятся только шесть фиксированных
checks, закрытые reason/stage/error маркеры. Только точный ASCII `API_STATUS_nnn`
для 100–599 превращается в `API_STATUS` и числовой HTTP status; near matches,
Unicode, неизвестные коды и неверные типы не копируются.

Backup связывается с parent operation либо с явно записанным
`stages.first_backup.backupOperationId`; последний обозначается
`DECLARED_FIRST_BACKUP_CHILD`, без утверждения о новом чтении child journal.
Проверяются installation/snapshot/policy и полное stage evidence за исключением
добавляемых finalizer полей status/restore/schedule и его штатной нормализации
отсутствующего local snapshot. Неизвестная связь, включая неописанный source ID
отдельного cloud retry, даёт `UNAVAILABLE`. Публикуются policy/outcome, три
component statuses и закрытые ошибки (не более 16 из списка, с признаком
усечения); пути, credentials, origins, fixture IDs и произвольные поля исключены.
Неподтверждённые вложенные данные не меняют исходные public exit/outcome/FAIL.
`done` стадии `browser` или `first_backup` само по себе не означает успешную
приёмку; новая проекция не устанавливает задним числом причину прежнего native run.

Для классификации `COMMAND` используются два отдельных приватных источника:

- CLI log из результата того же вызова: фиксированный каталог
  `/var/lib/asa-lab-operator`, точные action/PID/UTC-second в имени, root ownership,
  mode 0600. Каталог `/var/log` на Ubuntu 24.04 обычно root:syslog 0775,
  поэтому не используется как доверенный предок; исключений из no-group-write нет.
  Каждое полное `st_ctime_ns` и `st_mtime_ns` должно отдельно попадать
  во включённый интервал `startedNs..finishedNs`; metadata не округляется.
  Только UTC-second самого имени сравнивается с секундными границами вызова.
- Fixed `.asa/setup-logs/<operationId>.log` проверенного оператора: до публичного
  вызова снимаются только метаданные, а после отказа читаются только новые bytes
  с сохранением device/inode. Старый диапазон повторной операции не считается
  диагностикой нового отказа. При отсутствии baseline источник `UNAVAILABLE`.

Metadata timestamp до начала или после завершения вызова отвергается даже
внутри той же календарной секунды. Гранулярность filesystem и изменение часов
не расширяют допустимый интервал: если свежесть не подтверждена, диагностика
остаётся `UNAVAILABLE`. Проверка timestamps дополняет binding IDs и безопасных
путей; сама по себе она не доказывает причину отказа или неизменность всей
установки после команды. Исходный public `COMMAND`/exit и общий FAIL сохраняются.

Каждый компонент пути открывается через `openat` с `O_NOFOLLOW`; допустимы
только защищённые каталоги и обычные приватные файлы с одной hard link. Чтение
config ограничено 256 КиБ, journal/receipt — 2 МиБ каждый; CLI/setup log могут
иметь размер не более 34/64 МиБ, из них читаются не более 128 КиБ нового хвоста.
Повторный `fstat` должен подтвердить неизменность файла во время чтения. Baseline
ограничен 512 entries и 5 секундами; после проверки доверенного гостя/оператора
диагностические чтения имеют общий deadline 30 секунд. Дополнительные mutating
команды и сетевые запросы не запускаются.

Из log text выходят только фиксированные rule IDs для известных форм Docker
daemon, registry access/manifest/DNS/TLS/HTTP, `docker pull`, `git fetch` или
Compose, и фактически указанные допустимые числовые коды. URL, argv, headers,
body, traceback и совпавшие строки остаются приватными. Текст `unauthorized`
не превращается в предположительный HTTP 401. `NO_MATCH` означает лишь отсутствие
распознанной формы в разрешённом диапазоне: capture=True subprocess stderr
может отсутствовать в обоих log files. Ошибка чтения или binding имеет отдельный
`UNAVAILABLE`, не стирает уже проверенную stage projection и не меняет исходные
public exit, reason `COMMAND` и общий FAIL. Эта диагностика не устанавливает
задним числом причину завершившегося run без нового evidence.

### Наблюдение после отказа Compose при установке

Только после связанного `install / switch / COMMAND`, с `switch: intent` и
подтверждённым pinned release, `switchObservation` выполняет дополнительное
read-only наблюдение. Оно не требует уже установленного release или готового
приложения и не вызывает `owner_installation()`. Подтверждённый non-root operator
исполняет только `docker info`, `ps`, `inspect`, `logs` через локальный
`unix:///var/run/docker.sock`. Token/proxy/remote Docker environment не передаётся.
Hash daemon ID до и после должен совпасть с исходным Docker/1Panel baseline.
Команды `up`, `exec`, restart, миграции и DB sessions не запускаются.

Inventory ограничен восемью сервисами: `postgres`, `minio`, `migration`,
`minio-init`, `api`, `search`, `web`, `scratch`. Список container IDs сверяется
повторно; каждому ID должны соответствовать точные project, root, config-files,
service и image. Containers должны быть созданы в интервале текущей установки.
One-off, чужие, дублирующиеся и неполностью прочитанные записи отклоняются до
чтения logs. Ссылки ASA images, включая aliases migration/API и minio-init/MinIO,
сверяются с immutable release. PostgreSQL отдельно сверяется с
`postgres:17.7-bookworm` из обоих закреплённых `compose.yaml`: это проверка
Compose reference, не заявление о наличии PostgreSQL в ASA image manifest.

Inspect template учитывает raw-map fallback Docker CLI с `missingkey=error`:
отсутствующий или null `State.Health` даёт явный `none`. Пустой объект, scalar
вместо Health и отсутствующий обязательный Status не маскируются как отсутствие
healthcheck; неизвестный/null Status отклоняется закрытой проверкой inventory.
Это проверено настоящим Go `text/template` по поведению
[Docker CLI inspector.go](https://github.com/docker/cli/blob/fb2fe0eac78bb48b63905b31d95f3950dcb1b588/cli/command/inspect/inspector.go).
Format reproduction не является запуском Docker daemon и не устанавливает
причину прежнего `DIAGNOSTIC_DOCKER_EXIT` без измеренного failed verb.

Перед публикацией повторяются inventory и проверка immutable identity. Изменение
ID/name/created/image/image ID/project/root/config-files/one-off означает
`UNAVAILABLE`: собранные log classifications не выдаются как связанные с прежним
ресурсом. Изменение текущего состояния при стабильной identity сохраняется как
две типизированные точки `before`/`after` и `stateChanged`. В evidence разрешены
только закрытые state/health, bool running/dead/OOM, restart count и container
exit code. `processExited` отделяет остановленный процесс от нулевого exit field
ещё работающего контейнера. Exit контейнера не является exit Compose или public
CLI; числовой `composeExitCode` остаётся `UNAVAILABLE`. `NOT_PRESENT` разрешён
только после полного стабильного inventory.

Logs выбираются только для failed/unhealthy собственных containers или при
`restarts > 0`, в том числе при текущем `running/starting`. Приоритет имеют
PostgreSQL, MinIO и оба one-shot service. Разрешены не более четырёх
samples по 64 КиБ суммарного stdout/stderr, `--tail 200`, `--since` и `--until`
с полными timestamps текущего invocation. Каждая строка дополнительно должна
иметь Docker timestamp внутри интервала. `--follow` и `--details` не используются.
Общий новый budget — не более 60 секунд, отдельная Docker-команда — до 8 секунд
с резервом на очистку только собственного probe. Превышение времени или bytes
даёт `UNAVAILABLE`, частичный поток не классифицируется как полный.

Если сама Docker-команда не дала допустимого результата, `failedObservation`
сохраняет только закрытые step/verb/category, bool `attempted`, допустимый
числовой `exitCode` либо `UNAVAILABLE` и известный cleanup reason. Шаги различают
`daemonBefore`/`daemonAfter`, `beforeList`/`afterList`,
`beforeInspect`/`afterInspect`, `beforeRecheck`/`afterRecheck` и `containerLogs`.
Categories отделяют budget/timeout/output limit, nonzero exit, UID mismatch,
ownership/cleanup, invalid result и probe failure. Это exit именно
диагностического Docker process, не Compose, контейнера или публичного CLI.
Отказ до запуска явно имеет `attempted: false`; raw output и argv исключены.

Native Compose dependency/one-shot/container errors имеют закрытые rule IDs.
Operation log охватывает несколько стадий, поэтому его классификация явно
помечена `PUBLIC_INVOCATION_MULTI_STAGE`, `causalProof: false`. Аналогично позднее
состояние контейнера и совпадение log rule сами по себе не доказывают причину
завершившегося Compose. Распознанные формы `tools/migrate.mjs` и необработанного
Node/pg error из `docker/provision-runtime-role.mjs` различаются. SQLSTATE выходит
только из полного error block внутри одного stdout или stderr с распознанным
source/protocol frame и единственными severity/code после opening frame. Потоки
не склеиваются; неполная/нетипизированная/out-of-range timestamp строка разрывает
объект. Code/severity до opening frame и дубли, включая одинаковые значения,
отклоняются. Разные полные объекты могут независимо подтвердить разные коды из
закрытого списка PostgreSQL; message-only migration error не превращается в
предполагаемый SQLSTATE. SQL, private object names, stack frames, credentials,
argv, env и исходные строки остаются приватными. Неизвестные формы — `NO_MATCH`.

Для `api` дополнительно распознаётся однострочный stderr JSON `api_lifecycle`
из обоих pinned releases: ровно `kind`, `level`, `time`, `phase`, `errorCode`,
`errorClass`, все строковые. `level` равен `error`; допустимы только
`startup_failed` / `nest_error`, четыре кода `database_query_timeout`,
`database_connection_timeout`, `upstream_connection_failed`, `internal_error`
и классы `Error`, `ClassroomCodeSecretConfigError`, `StudentCodeProtectionConfigError`.
Docker timestamp и строго разобранное ISO-время события должны попадать в
исходный invocation window. Дубли ключей, вложенные/дополнительные поля,
неизвестные значения и фрагменты между строками или потоками дают `NO_MATCH`.
Выход содержит только `API_STARTUP_FAILED` / `API_NEST_ERROR` и закрытые тройки
`apiLifecycle` (`phase`, `errorCode`, `errorClass`); исходное время не экспортируется.
Перезапуск и совпавшее событие не доказывают причину отказа Compose:
`causalProof` остаётся `false`.

При `DIAGNOSTIC_PERMISSIONS` CLI log дополнительно разрешены только metadata
фиксированных labels `var`, `varLib`, `logDirectory`, `logFile`: UID/GID, mode,
тип, link count и закрытые IDs нарушенных проверок. Walk использует
`O_PATH | O_NOFOLLOW`, останавливается на первом отвергнутом компоненте и не
читает содержимое. Permissions gate не ослабляется; chmod/chown не выполняются.
Эта информация объясняет отказ самой диагностики отдельно от Compose failure.
Любая ошибка дополнительного observer сохраняет исходные `COMMAND`, exit и FAIL.

Используется только временный `github.token` с read permissions. Он переносится
в root-owned file 0600, поступает в subprocess через environment и не попадает
в argv, логи evidence или artifacts. Официальный 1Panel installer выводит
начальный пароль: его raw stdout/stderr, serial logs, CLI private logs,
onboarding, browser fixture passwords, AGE identity, SSH private key и диски
не публикуются. После завершения уничтожаются только собственный процесс QEMU
и созданный им временный каталог данного job.

Pins находятся в `tools/deployment/fixtures/setup-realhost-pins.json`.
Первичные источники: [Ubuntu signed cloud artifacts](https://ubuntu.com/docs/public-images/public-images-reference/artifacts/),
[Ubuntu image verification](https://ubuntu.com/docs/public-images/public-images-how-to/verify-image-checksum/),
[Ubuntu keyring package](https://packages.ubuntu.com/noble/all/ubuntu-keyring/filelist),
[1Panel v2 installer](https://github.com/1Panel-dev/installer/tree/v2).
Runtime provenance повторно проверяет штатный release verifier по точным
publication и General CI runs; зелёный workflow со skipped publish не считается
опубликованным runtime.

## Закрытый диагностический отчёт из artifact

Отдельный job `Closed native evidence report` выполняется после `realhost`
и читает artifact `asa-realhost-evidence-<source SHA>` только из своего
workflow run. Его короткий job log доступен через обычный GitHub Actions API
для чтения логов. Это дополнительный способ получить диагностику, когда
локальное чтение ZIP временно недоступно. Исходные `evidence.json` и
`runner-preparation.json` продолжают сохраняться штатным upload step.

Job использует точный source SHA события, закреплённые checkout/download
actions и только `contents: read` / `actions: read`. В нём нет VM, Docker,
sudo, установки пакетов или provider действий. `continue-on-error` относится
только к этому дополнительному job: исходные команды, permissions, бюджеты
и результат `realhost` остаются прежними. Отказ exporter не превращает
native FAIL в PASS.

`ci_realhost_evidence_report.py` читает ровно два фиксированных файла,
не импортирует harness/product/checker, не запускает дочерние процессы и
не обращается к сети. Файлы открываются через закреплённые directory/file
descriptors без следования symlink; hardlink, чужой владелец, group/world
write, специальные файлы и изменение metadata во время чтения запрещены.
Нормализованный download-artifact режим 0644 допустим: требование 0600
от private файлов работающей установки к скачанному artifact не применяется.
Пределы: 4 MiB для native evidence, 64 KiB для runner preparation, 128 KiB
для выходного JSON; глубина JSON 32 и общий бюджет 50 000 узлов. Duplicate
keys, неверный UTF-8, NaN/Infinity и превышение лимитов дают закрытую причину
UNAVAILABLE без исходного содержимого или текста исключения.

Перед native projection должны совпасть source revision обоих документов,
а `runner-preparation.runId/runAttempt` — с текущими GitHub run и attempt.
Одного имени artifact и SHA недостаточно для повторной попытки того же run.
Ранний runner guard может не записать эти identity fields: тогда binding
остаётся UNAVAILABLE. Нет поиска предыдущего успешного artifact или fallback
к другому attempt. При отмене workflow или отсутствии upload отчёт также
может отсутствовать либо сообщать UNAVAILABLE.

Между маркерами `ASA_REALHOST_REPORT_BEGIN` и
`ASA_REALHOST_REPORT_END` выводится только ASCII JSON формата
`asa-realhost-evidence-report-v1`. `reportStatus` описывает доступность
экспорта, `nativeConclusion` — исходный результат job, а `sourceStatus`
в native разделе — записанный outcome harness. Даже AVAILABLE не является
новой приёмкой: `revalidatedRuntime` всегда false. Неизвестные значения
не публикуются как произвольные строки; закрытые unavailable/unrecognized
состояния и отсутствующие поля сохраняются отдельно.

Экспорт включает записанные native phases/checks, runner resources, общие
lifecycle/control/backup/reboot факты и связанные с публичным отказом
`receiptDetails`. Сохраняются различия MISSING/NULL/UNRECOGNIZED,
browser runtime provenance, шесть browser checks и ошибки из конечного
списка, а также policy/outcome/local/encryption/cloud у backup.
`DECLARED_FIRST_BACKUP_CHILD` остаётся заявленной родителем связью;
exporter не читает новый child journal и не повышает её до такого доказательства.
Он также не повторяет binding работающего manager или проверку runtime pins.
Raw browser component pin strings, сообщения, logs, stack traces, paths,
URLs, credentials, cookies и тела API-ответов в этот отчёт не попадают.

CLI-раздел показывает только реально записанные completed cases, отдельные
human pipe/PTY results, filesystem/control comparisons и четыре существующих
checked JSON-примера: help, status, disk, update-check. Дополнительные
observations сохраняют optional disk/cloud UNAVAILABLE и restore
BLOCKED_PLAN. JSON update-plan отдельно не сохраняется producer, поэтому
доступен только его case outcome. Failed case может отсутствовать среди
completed cases; exporter не придумывает его exit или stdout. Каталог help
из 29 команд не является доказательством их выполнения: 29 JSON cases и
два bare modes — отдельный состав read suite, а write calls видны только
в записанных `cliActions` соответствующей фазы. Частичный suite сохраняет
полезные выполненные examples, одновременно показывая FAIL, failedCase и
CHANGED/UNAVAILABLE у filesystem/control. Неизмеренные полное место и
downtime не превращаются в числовые обещания.

Отчёт намеренно не является полным дампом artifact и не заменяет критерии
приёмки. Отсутствующий phase/check/action не означает PASS. Принудительно
ожидаемый отказ облачной fault case, same-ID recovery с отказом повторного
экспорта и успешный новый backup остаются разными записанными фактами.
Новая native приёмка и причина исторического browser failure из наличия
exporter не следуют.
