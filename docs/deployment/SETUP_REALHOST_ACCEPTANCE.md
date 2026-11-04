# Приёмка ASA CLI на настоящей Ubuntu VM с 1Panel

`.github/workflows/setup-realhost.yml` запускает ограниченный сценарий
`tools/deployment/ci_setup_realhost.py` на обычном публичном GitHub-hosted runner
`ubuntu-24.04`. Внутри QEMU работает отдельная Ubuntu 24.04 со своим ядром,
PID 1 `systemd`, настоящим Docker и официальным 1Panel. Команды установки,
обновления, резервирования и управления расписанием проходят через публичный
`asa`. Сценарий не подключается к действующим установкам, Proxmox или платным VM.

## Границы результата

Это проверка candidate CLI из **точного PR HEAD SHA**. Сборщик проверяет байты
исходников пакета относительно этого SHA; архив проверяется и помещается в
защищённый `/opt/asa-setup/<SHA>` только внутри одноразовой VM. Ручной trusted
staging здесь явно отделён от получения опубликованного выпуска с GitHub
attestation. Поле `publishedSetupAcquisition` остаётся `BLOCKED` с причиной
`CANDIDATE_NOT_PUBLISHED_ATTESTED`.

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
5. Зарегистрировать candidate CLI. Первый `asa install` создаёт штатного
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
8. Выполнить `asa update check`, `plan`, `apply` для другого опубликованного
   runtime; проверить реальную смену release и сохранность контрольной группы.
   Повтор той же операции и следующий `NO_CHANGE` не должны создавать backup.
   Пара pinned runtime имеет одинаковую схему 304: миграция между различными
   версиями схемы этим результатом не доказывается.
9. Через `asa backup create` создать полный synthetic backup, проверить его
   `asa backup verify`, повторить тот же operation ID и выполнить `asa cloud
   sync` существующего snapshot. SHA256 ciphertext и число снимков сохраняются;
   отсутствие облачной конфигурации не превращается в подтверждённую доставку.
10. В отдельном дочернем network namespace выполнить публичный `asa update check`.
    Зафиксировать разные inode namespace, отсутствие внешнего интерфейса,
    exit 2 / `RELEASE_UNAVAILABLE`, неизменность namespace родителя и данных.
    Это реальный отказ сети для release lookup; доступность Yandex этим не проверяется.
11. Создать отдельный synthetic S3 object через authenticated API, прочитать его
    обратно и сверить SHA256. Перед file-limit fault доказать, что сохранённые
    `database.dump` и `globals.sql` меньше 8 МиБ, а фактический MinIO `part.N`
    именно этого объекта больше 8 МиБ. Запустить публичный `asa backup create`
    с per-child `RLIMIT_FSIZE=8 MiB` и `RLIMIT_CORE=0`. Только реальные неполные
    bytes нужного part, достигшие лимита, считаются выполненной инъекцией.
12. Другой публичный backup прервать SIGINT в наблюдаемом окне после dump/globals
    и создания `objects`, до manifest/final. Краткий SIGSTOP собственной группы
    фиксирует окно; затем SIGINT и обязательный SIGCONT. Дождаться всех своих
    потомков, освобождения lock и стабильных partial bytes. Для обоих fault
    operation IDs повтор публичного backup должен восстановить оставшийся
    owned hold и вернуть BLOCKED / `BACKUP_RESUME_SNAPSHOT_MISSING`, сохранив
    исходный partial и последний успешный backup. После этого отдельная новая
    операция должна создать и проверить полный AGE backup; success pointer
    должен перейти к нему. Оба incomplete snapshot сохраняются до уничтожения VM.
13. Выполнить настоящий `systemctl reboot` гостя. Host runner и процесс QEMU
    продолжают работу; требуется новый `boot_id`, готовое приложение и прежние
    data/config/1Panel/Docker fingerprints. Перезапуск контейнера либо service
    не заменяет эту проверку.
14. Выбрать ближайшее время только в тестовом private `setup.json` через штатные
    `validate_config`/`save_private`. Это подготовка fixture, а не заявление о
    публичной CLI-команде изменения произвольного времени. Затем исключительно
    через `asa backup schedule enable/disable` проверить enable → disable →
    enable, отсутствие дублирующих units и независимость от automatic update.
15. До календарного времени проверить нулевое число попыток данного slot,
    выключить гостя, дождаться пропущенного времени на host и запустить **тот же
    qcow2**. Часы не переводятся, `Persistent=true` и штатные units не изменяются.
    После загрузки требуется успешный backup пропущенного slot.
16. Проверить настоящий systemd retry после ошибки. Если первый missed запуск
    был успешен, краткий процесс проверенного оператора удерживает штатный
    общий lock; второй старт штатного service получает реальную ошибку. Lock
    освобождается, а неизменённый `RestartSec=300` выполняет третий старт
    автоматически. Фиксируются failed exit, `NRestarts`, успешное завершение и
    прежние snapshot/SHA256. Если ошибка и automatic retry уже произошли при
    загрузке, используются их наблюдённые evidence, чтобы не расходовать slot
    сверх лимита. Без наблюдения реальной ошибки PASS запрещён. Четвёртая
    попытка должна быть отклонена start limit либо `ExecCondition`; receipts и
    часы для этого не подменяются. В конце timer выключается публичным `asa`.
17. Сверить контрольные данные после reboot/backup/timer и вновь выполнить
    штатные browser save/reopen journeys контрольной группы.

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
| Общий fault budget | Не более 75 минут внутри прежних 175 минут; общий deadline не продлевается |
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

Тот же focused test entrypoint проверяет `required` и `best-effort` на изолированных
synthetic manager fixtures. Bound socket на loopback без `listen` даёт настоящую
ошибку TCP-соединения; тестовый transport boundary передаёт её менеджеру как
`CLOUD_TRANSFER_FAILED`. `required` должен вернуть `BLOCKED` и возобновить старых
писателей; `best-effort` — `WARNING` с сохранённой локальной копией. Обе ветки
сохраняют truthful cloud/restore status. AGE в этом узком policy test подменён
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
публичный BLOCKED/exit 2 и `BACKUP_RESUME_SNAPSHOT_MISSING` в durable backup
receipt, без нового export. Наличие complete backup или обновление прошлого
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

В artifact разрешены только известные `journalPhase`, `receiptStage`, state,
intent/done/failed для фиксированного списка стадий и типизированные acceptance
flags. Неизвестные имена, uppercase reason strings и значения заменяются
закрытыми маркерами; приватные events, bootstrap config, env и произвольные
вложенные словари не копируются. Revision/schema показываются как подтверждённые
только при завершённой стадии `release` и совпадении с закреплённым runtime.
Digest дополнительно должен совпасть с сохранённым selector. Намерение pull
или длительность операции сами по себе не подтверждают выбранный release.

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

Logs выбираются только для failed/unhealthy собственных containers. Приоритет
имеют PostgreSQL, MinIO и оба one-shot service. Разрешены не более четырёх
samples по 64 КиБ суммарного stdout/stderr, `--tail 200`, `--since` и `--until`
с полными timestamps текущего invocation. Каждая строка дополнительно должна
иметь Docker timestamp внутри интервала. `--follow` и `--details` не используются.
Общий новый budget — не более 60 секунд, отдельная Docker-команда — до 8 секунд
с резервом на очистку только собственного probe. Превышение времени или bytes
даёт `UNAVAILABLE`, частичный поток не классифицируется как полный.

Native Compose dependency/one-shot/container errors имеют закрытые rule IDs.
Operation log охватывает несколько стадий, поэтому его классификация явно
помечена `PUBLIC_INVOCATION_MULTI_STAGE`, `causalProof: false`. Аналогично позднее
состояние контейнера и совпадение log rule сами по себе не доказывают причину
завершившегося Compose. Распознанные формы `tools/migrate.mjs` и необработанного
Node/pg error из `docker/provision-runtime-role.mjs` различаются. SQLSTATE выходит
только из полного error block с распознанным source/protocol frame, severity и
кодом из закрытого списка PostgreSQL; message-only migration error не превращается
в предполагаемый SQLSTATE. SQL, private object names, stack frames, credentials,
argv, env и исходные строки остаются приватными. Неизвестные формы — `NO_MATCH`.

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
