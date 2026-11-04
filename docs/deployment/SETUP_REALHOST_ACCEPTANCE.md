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
10. Выполнить настоящий `systemctl reboot` гостя. Host runner и процесс QEMU
    продолжают работу; требуется новый `boot_id`, готовое приложение и прежние
    data/config/1Panel/Docker fingerprints. Перезапуск контейнера либо service
    не заменяет эту проверку.
11. Выбрать ближайшее время только в тестовом private `setup.json` через штатные
    `validate_config`/`save_private`. Это подготовка fixture, а не заявление о
    публичной CLI-команде изменения произвольного времени. Затем исключительно
    через `asa backup schedule enable/disable` проверить enable → disable →
    enable, отсутствие дублирующих units и независимость от automatic update.
12. До календарного времени проверить нулевое число попыток данного slot,
    выключить гостя, дождаться пропущенного времени на host и запустить **тот же
    qcow2**. Часы не переводятся, `Persistent=true` и штатные units не изменяются.
    После загрузки требуется успешный backup пропущенного slot.
13. Проверить настоящий systemd retry после ошибки. Если первый missed запуск
    был успешен, краткий процесс проверенного оператора удерживает штатный
    общий lock; второй старт штатного service получает реальную ошибку. Lock
    освобождается, а неизменённый `RestartSec=300` выполняет третий старт
    автоматически. Фиксируются failed exit, `NRestarts`, успешное завершение и
    прежние snapshot/SHA256. Если ошибка и automatic retry уже произошли при
    загрузке, используются их наблюдённые evidence, чтобы не расходовать slot
    сверх лимита. Без наблюдения реальной ошибки PASS запрещён. Четвёртая
    попытка должна быть отклонена start limit либо `ExecCondition`; receipts и
    часы для этого не подменяются. В конце timer выключается публичным `asa`.
14. Сверить контрольные данные после reboot/backup/timer и вновь выполнить
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
