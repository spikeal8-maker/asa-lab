# ASA Lab — быстрая установка сервера, 1Panel и проверяемое восстановление

> **Актуальный GitHub — единственный источник установщика.** Не копируйте скрипты
> из чатов и не используйте старые zip-архивы. Прежде чем восстанавливать
> пользовательские данные, читайте [Portable Operations](PORTABLE_OPERATIONS.md).
> Публикация внешнего сайта, обновление настоящей школьной БД и ротация секретов
> не запускаются автоматически без выбранного оператором источника/домена.

## Поддерживаемые варианты

| Узел | Панель | Установка ASA Lab | Требования |
| --- | --- | --- | --- |
| Ubuntu **24.04 LTS**, **amd64** | **1Panel OSS v2.3.2** (native systemd) | Готовые проверенные образы GHCR, через `asa_manager.py` | root/sudo, Git, Python 3.11+, Docker Engine + Compose v2, UFW, минимум 16 ГиБ свободного места |
| Windows 10/11, x64 | **1Panel не поддерживается нативно** | Готовые образы в Docker Desktop **Linux containers** | Git, Python 3.11+, Docker Desktop + Compose v2, работающая WSL2 |

Основной штатный менеджер проекта остаётся **`tools/asa_manager.py`**. Обёртки не
создают второй независимый механизм миграций, генерации паролей или обновления.
Они не отключают CI-проверки и не пересобирают исходники при наличии выпуска.
На Windows 1Panel открывается в браузере на **Linux-сервере**, не устанавливается
в Windows/Docker.

## Ubuntu: один запуск 1Panel + ASA Lab

```bash
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
sudo python3 tools/bootstrap/install-ubuntu-1panel.py install \
  --operator "$(id -un)" --root "$PWD" --profile staging \
  --panel-port 19192 --admin-cidr '192.168.1.0/24'
```

`--admin-cidr` **обязательно замените на настоящую сеть администратора**. В
домашней сети это может быть `192.168.1.0/24`, для публичного VPS — **явный
доверенный IP администратора с `/32`**, для другой сети — другой CIDR.
Скрипт не подбирает его автоматически. Если SSH-клиент не входит в указанный
CIDR, опасное изменение UFW блокируется, чтобы не потерять доступ. Для
первой установки с консоли VPS параметр задаёт администратор.

`staging` — реальная техническая конфигурация без демонстрационных пользователей,
но предназначена для испытаний. Для постоянного рабочего сервера выберите
`--profile production` **до первой установки**: нельзя менять профиль
работающего проекта простой сменой параметра. Стек по умолчанию слушает только
`127.0.0.1:4610`; его веб-порт нельзя напрямую пробрасывать с роутера на API
или PostgreSQL. Требуется контролируемый HTTPS reverse proxy с одним origin,
как описано в [Linux deployment](LINUX_DOCKER_DEPLOYMENT.md).

Скрипт выполняет preflight ОС, пользователя, диска, Docker/Compose, загружает
**официальный** 1Panel `v2.3.2` с закреплённым SHA-256, устанавливает с русским
языком, **не переустанавливает уже имеющийся Docker**, генерирует отдельные
данные входа и ограничивает SSH/1Panel по UFW. Затем ставит ASA Lab из
**неизменяемых образов** GitHub с проверкой общего CI и публикации.

Если официальный CDN 1Panel завис, скачайте архив
`1panel-v2.3.2-linux-amd64.tar.gz` с официального
`https://resource.1panel.pro/v2/stable/v2.3.2/release/` на доверенном
компьютере, затем положите в
`/var/cache/asa-server-rebuild/1panel-v2.3.2-linux-amd64.tar.gz`.
Установщик **проверяет SHA-256 и никогда не запускает непроверенный архив**.
Точный ожидаемый SHA-256: `f1265a4fadeaab3d7066dd71e3c6904ac54bb687baab1b205a23c369abb61cac`.

После установки реквизиты панели находятся **только на самом Linux, у root**:
`/var/log/asa-server-rebuild/1panel-initial-credentials.env` (0600). Не
публикуйте их в GitHub, скриншотах или логе. Настройте 2FA и HTTPS для панели
после первого входа. Не открывайте её порт на МТС. Панель предназначена для
управления Docker, ресурсами, файлами и журналами; **обновление ASA Lab идёт
только через штатный менеджер** в единственном каталоге Compose.

## Полный сброс приложений без удаления Ubuntu

**Разрушительная операция только для указанного сервера.** Сохраняет
Ubuntu, системный systemd, SSH, Tailscale, настройки сети, учётные записи,
UFW с разрешениями SSH. Удаляет приложения ASA Lab, 1Panel, Docker Engine,
контейнеры/образы/volumes, созданные служебные systemd units и локальные
резервные копии. На главном сервере и в школе не запускать.

**Обязательно:** свежий зашифрованный полный backup проверен и присутствует
**вне очищаемого компьютера**, например в Яндекс Диске Windows; имеется
age identity на отдельной флешке; полный SHA-256 идентифицирован.
Ни архив, ни флешку нельзя очищать вместе с Ubuntu.

Первые две команды запускаются на целевом Ubuntu и требуют явного
hostname, SHA256 и подтверждения действия. Путь к скрипту должен указывать
на скопированный из GitHub файл.

~~~bash
sudo python3 /tmp/asa-full-rebuild/reset-managed-host.py \
  --hostname ИМЯ_СЕРВЕРА --snapshot-sha256 64_HEX_АРХИВА \
  --offhost-copy-verified
# После успешного dry-run и только после подтверждения off-host архива:
sudo python3 /tmp/asa-full-rebuild/reset-managed-host.py \
  --hostname ИМЯ_СЕРВЕРА --snapshot-sha256 64_HEX_АРХИВА \
  --offhost-copy-verified --execute --confirm ERASE:ИМЯ_СЕРВЕРА
~~~

После сброса убедитесь, что SSH и Tailscale остаются доступными, Docker,
1Panel и прежний checkout/volumes отсутствуют. Не удаляйте Ubuntu или
сетевые настройки.

### Полная установка из чистой Ubuntu с восстановлением данных

Получите скрипты install-ubuntu-1panel.py и restore-verified-backup.py
**одной и той же проверенной GitHub-ревизии** в /tmp/asa-full-rebuild/.
Подготовьте свежий распакованный ASA backup в приватном каталоге
/srv/asa-restore/<snapshot>. age identity должна оставаться на Windows;
зашифрованный снимок можно передать с помощью
prepare-age-backup.py и transfer-backup-ssh.py.

Если официальный CDN 1Panel медленно загружается, опционально положите
на сервер подписанный установочный tar.gz; SHA-256 будет проверен скриптом.

~~~bash
sudo python3 /tmp/asa-full-rebuild/install-ubuntu-1panel.py install \
  --operator admins --root /srv/asa-lab --profile production \
  --panel-port 19192 --admin-cidr 192.168.1.0/24 \
  --panel-archive /var/tmp/asa-verified-1panel-v2.3.2.tar.gz \
  --require-restore --restore-backup /srv/asa-restore/<snapshot> \
  --target-hostname ИМЯ_СЕРВЕРА --restore-snapshot <snapshot> \
  --max-snapshot-age-hours 48 --min-active-students 300 --min-seats 400
~~~

Для **новой** установки `production` теперь необходимо явно выбрать
`--require-restore --restore-backup` (копия существующей системы) либо
`--fresh-empty` (заведомо новая пустая система). Без архива и без
`--fresh-empty` установщик **останавливается до создания пустой базы**.
Для копии школы применяйте первый вариант. Скрипт проверяет свежесть
снимка и минимум пользователей выбранного источника: при расхождении
числа ученических мест работа прекращается *до* переключения данных.
Флаги `--min-active-students` и `--min-seats` на чужой новой школе
задавайте по её фактическим ожидаемым значениям, не используйте 300/400
как глобальные нормативы.

Скрипт должен установить Docker/Compose, затем 1Panel OSS, затем
синхронизированный выпуск ASA Lab и **сразу восстановить** PostgreSQL,
MinIO и нужные ключи из проверенного снимка. Создаётся checkpoint
в /var/backups/asa-restore-rehearsal/; при обычной ошибке выполняется
попытка автоматического отката. После аварийного отключения питания
оператор обязан сверить checkpoint, не запускайте повторную очистку вслепую.

**HTTPS и авторизация:** Production-система остаётся закрытой в localhost
до явной настройки общего безопасного HTTPS browser origin для API и Scratch.
Без него открытый LAN HTTP не гарантирует вход пользователей. Нельзя
отключать origin policy, CSRF или выставлять PostgreSQL/MinIO наружу.

## Windows: быстрый запуск без установки Linux-панели

```powershell
git clone https://github.com/spikeal8-maker/asa-lab.git
powershell -ExecutionPolicy Bypass -File .\asa-lab\tools\bootstrap\install-windows.ps1 `
    -Action Install -Root .\asa-lab -Profile staging
```

Если Docker Desktop не установлен или Linux containers не запущены,
команда сообщает об этом и **не меняет настройки сети компьютера**.
Аналогичные команды после установки:

```powershell
powershell -ExecutionPolicy Bypass -File .\asa-lab\tools\bootstrap\install-windows.ps1 -Action Doctor -Root .\asa-lab -Profile staging
powershell -ExecutionPolicy Bypass -File .\asa-lab\tools\bootstrap\install-windows.ps1 -Action Check -Root .\asa-lab -Profile staging
powershell -ExecutionPolicy Bypass -File .\asa-lab\tools\bootstrap\install-windows.ps1 -Action Update -Root .\asa-lab -Profile staging
powershell -ExecutionPolicy Bypass -File .\asa-lab\tools\bootstrap\install-windows.ps1 -Action Backup -Root .\asa-lab -Profile staging
```

Нельзя обновлять систему командой `git pull && docker compose up` поверх
канонического выпуска: она обходила бы pinned manifest/backup/check.

## Linux: повторы, диагностика, backup и restore-check

Оставаясь в исходном каталоге из `git clone`:

```bash
sudo python3 tools/bootstrap/install-ubuntu-1panel.py doctor --operator "$(id -un)" --root "$PWD" --profile staging
sudo python3 tools/bootstrap/install-ubuntu-1panel.py backup --operator "$(id -un)" --root "$PWD" --profile staging
sudo python3 tools/bootstrap/install-ubuntu-1panel.py update --operator "$(id -un)" --root "$PWD" --profile staging
```

**Важно для повторного запуска после первого релиза:** штатный менеджер
переводит рабочий Git checkout в проверенный выпуск (detached HEAD).
Этот выпуск может быть старше самого установочного скрипта. Перед первым
запуском Linux-обёртка сохраняется вне заменяемого checkout в
`/var/lib/asa-server-rebuild/install-ubuntu-1panel.py`; для проверки и
обновлений используйте именно эту копию, указывая `--root`:
```bash
sudo python3 /var/lib/asa-server-rebuild/install-ubuntu-1panel.py doctor \
  --operator "$(id -un)" --root /srv/asa-lab-test --profile staging
```

На Windows обёртка сохраняется в
`$env:LOCALAPPDATA\ASA-Lab\bootstrap\install-windows.ps1`:
```powershell
powershell -ExecutionPolicy Bypass -File "$env:LOCALAPPDATA\ASA-Lab\bootstrap\install-windows.ps1" `
  -Action Doctor -Root .\asa-lab -Profile staging
```

Повторяйте установку из исходного checkout лишь при первичной инициализации;
постоянная обёртка независимо доступна, даже если checkout закреплён на
старом проверенном SHA. Для получения **новой** версии bootstrap скачивайте
её из GitHub отдельно и проверяйте перед заменой.

`update` выполняйте в согласованное окно. Backup состоит из PostgreSQL, MinIO,
конфигурации и метаданных образов; проверка восстановления обязательна. Папка
`backups` и `.env` содержат конфиденциальную информацию. На обычном обновлении
права доступа и ключи сохраняются.

**Повторный `install` не удаляет** чужие Docker-стенды и действующие тома. Если
есть подозрение на незавершённую установку, конфликт каталогов или уже
существующую `.env`, операция останавливается для разбирательства. Порт
`19192` — зафиксированный выбор этого сценария; другой порт задаётся один раз.

## Доступ к ASA Lab по локальной сети: порт 4610

Штатная публикация ASA Lab использует только 127.0.0.1:4610,
поэтому после чистой установки страница http://LAN-IP:4610/ не открывается
на соседнем Windows-компьютере. Это не ошибка МТС и не отказ Docker.

Опциональный GitHub-скрипт lan-preview-ubuntu.py создаёт локальный
systemd socket TCP proxy LAN-IP:4610 -> 127.0.0.1:4610; в UFW разрешается
только выбранная частная подсеть и физический LAN-интерфейс.
Нельзя открывать порт для всех адресов или менять Compose на 0.0.0.0.

### Автоматический режим установщика

При первой установке или повторном запуске GitHub-установщика Ubuntu
к обычным опциям команды install добавьте:

~~~text
--lan-preview-ip 192.168.1.115
--lan-preview-cidr 192.168.1.0/24
--lan-preview-interface eno1
--ack-production-http-preview
~~~

Адрес IP, подсеть и физический интерфейс должны соответствовать
конкретному серверу. Все три опции обязательны одновременно;
для production-профиля также нужно явное подтверждение.
Порт 4610 не открывается в интернет или Tailscale.
Действующая БД, Docker volumes, образы и конфигурация приложения
не меняются; повторный install проверен как идемпотентный.

После штатной установки возможен и отдельный запуск скрипта
lan-preview-ubuntu.py из ТОЙ ЖЕ проверенной GitHub-ревизии:

~~~bash
sudo python3 /tmp/asa-full-rebuild/lan-preview-ubuntu.py install \
  --root /srv/asa-lab --lan-ip 192.168.1.115 \
  --cidr 192.168.1.0/24 --interface eno1 \
  --ack-production-http-preview
sudo python3 /tmp/asa-full-rebuild/lan-preview-ubuntu.py check \
  --root /srv/asa-lab --lan-ip 192.168.1.115 \
  --cidr 192.168.1.0/24 --interface eno1 \
  --ack-production-http-preview
~~~

**Ограничение безопасности:** это только локальный HTTP-просмотр
страницы, а не способ работать с настоящими школьными паролями.
API для HTTP LAN origin отвечает 403 origin_forbidden; Scratch
использует исходный канонический origin localhost.
Для полноценного входа и сохранения работ нужен один подтверждённый
HTTPS origin, согласованный с API и Scratch. Не отключайте CSRF,
антибота или проверки origin ради HTTP-просмотра.

Реальная проверка: 17.10.2026, на Ubuntu admins-MS-7D22 с
профилем production после очистки и чистой установки GitHub.
14/14 тестов ingress прошли, GitHub installer install с явными
LAN флагами PASS, по Windows D2-R2: HTTP 200 главной, ready API,
Scratch health HTTP 200, браузер Chrome без JavaScript-ошибок,
доступен только LAN 192.168.1.0/24. БД с историческими аккаунтами
после последней очистки ещё не восстановлена. HTTP не является
прохождением пользовательской приёмки.

## Актуальная копия ASA Lab из Яндекс Диска

**Подтверждённый источник на D2-R2 (17.10.2026):**
`E:\Yandex.Disk\Yandex.Disk\ASA-Backups` — это локально
синхронизированное представление личного Яндекс Диска, не папка Ubuntu.
Последний архив: `asa-lab-20261016T231505Z-7b457013.tar.age`,
`production`, schema 212, SHA256 шифротекста
`ced850b5e7759741e82d36bcef7edb3ee5174415b0c96add4bffb5b4b20ff3a3`.
Проверена точная расшифровка, 2046 файлов и restore-check на
самостоятельной PostgreSQL-БД. В снимке **89 обычных аккаунтов**,
**418 уникальных логинов ученических мест**, из них **327 со статусом active**
(ещё 66 issued, 19 suspended, 6 removed), **31 класс**. Таблица
`accounts` **не** содержит все ученические логины — их источник
`classroom_student_seats`. Поэтому суммарное число пользователей
не равно только `COUNT(*) FROM accounts`.

**Почему предыдущая установка оказалась пустой:** Ubuntu не знает
личные учётные данные Яндекс Диска и не видит каталог `E:\...` Windows;
скрипт `install` тогда был запущен без `--restore-backup`. Он создал
новую production-БД на 0 аккаунтов и сообщил `healthy` по инфраструктуре,
не выполняя восстановление. Новый параметр `--require-restore`
устраняет этот неявный сценарий.

**Рекомендуемая автоматизация резервного источника:**
производящий сервер ежедневно создаёт консистентный архив БД + MinIO,
шифрует `age` и загружает в `ASA-Backups` Яндекс Диска.
Доверенный Windows-оператор, на котором уже работает Яндекс Диск,
через `prepare-age-backup.py` выбирает *последний полностью загруженный*
архив, проверяет манифест и все SHA256 и через SSH отправляет его
на новый Ubuntu. Приватный `age identity` остаётся на офлайн-носителе.
На Ubuntu архив хранится в закрытой `/srv/asa-restore/<snapshot>`,
а команда `install --require-restore` выполняет восстановление.
Без подтверждённого источника `RESTORE_SUCCESS` не выдаётся.

**НЕ настраивать двустороннюю синхронизацию живой PostgreSQL-базы:**
Яндекс Диск здесь хранит *неизменяемые зашифрованные снимки*, а не файлы
работающего PostgreSQL. Автоматическое обновление копии возможно
только проверенной процедурой backup → verify → restore → readiness
с остановкой писателей и rollback; ежедневно без разрешения действующую
БД не заменять.

На Windows с авторизованным приложением *Яндекс Диск 4* и доступной флешкой:

```powershell
py .\asa-lab\tools\bootstrap\prepare-age-backup.py
```

По умолчанию утилита берёт реальный `CurrentUserSyncPath` из реестра Яндекс Диска
и выбирает **последний** архив `ASA-Backups/asa-lab-YYYYMMDDTHHMMSSZ-xxxxxxxx.tar.age`
по времени в имени. Она **проверяет расшифровку и каждый хеш манифеста, не
записывая расшифрованные данные**. Ключ остаётся на флешке и не публикуется.
Для автономного компьютера без приложения можно явно передать `--archive` и
`--age`/`--identity`.

Для **явного** извлечения в отдельную локальную приватную папку:

```powershell
py .\asa-lab\tools\bootstrap\prepare-age-backup.py --extract --output "$env:USERPROFILE\Downloads\ASA-Restore-Latest"
```

Архив `.age` — зашифрованный. Извлечённая папка с `private.env` и PostgreSQL
**не должна синхронизироваться назад в Яндекс Диск**, попадать на GitHub,
становиться доступной гостевым учётным записям или через веб-сервер.
Передавайте её на выбранный Linux только через доверенный SSH/SFTP с
ограничением прав (0700 каталог, 0600 файлы), затем проверяйте:

```bash
python3 tools/asa_manager.py verify-backup --backup /secure/ASA-Restore-Latest/<snapshot>
python3 tools/asa_manager.py restore-check --profile staging \
    --backup /secure/ASA-Restore-Latest/<snapshot> \
    --database asalab_snapshot_test
```

**Проверяемая доставка через SSH без сохранения plaintext на Windows:** при заранее
настроенном входе на сервер по SSH-ключу и закреплённом ключе сервера
в `known_hosts` можно использовать:

```powershell
py .\asa-lab\tools\bootstrap\transfer-backup-ssh.py --host 192.168.1.115 `
  --user admins --expected-hostname admins-MS-7D22 `
  --ssh-key "$env:USERPROFILE\.ssh\asa-test-key" `
  --remote-dir /srv/asa-test-restore
```

На Ubuntu должен заранее существовать закрытый каталог назначения `0700`
текущего пользователя. Скрипт проверяет последний архив Яндекс Диска,
передаёт расшифрованный tar **потоком только по SSH**, проверяет SHA-256 и
не перемещает ключ `age` с флешки. Он **не восстанавливает рабочую БД**:
полученный tar нужно безопасно извлечь, затем выполнить
`verify-backup` и `restore-check` перед отдельным cutover.
Никаких исключений `StrictHostKeyChecking=no` нет.

Путь `<snapshot>` замените фактической папкой внутри архивного комплекта.
**Это строго проверочное восстановление** в новую базу `*_test`. Менеджер
преднамеренно не заменяет активную БД. Перенос живых школьных данных на
дубликат требует *отдельного контролируемого cutover* с совместимыми версиями
PostgreSQL, существующими ключами, MinIO-объектами, новой копией текущего
стенда и поэтапной миграцией схемы. Дата последнего архива должна
подтверждаться заново на момент восстановления: более новый архив может
появиться позже. **Двусторонняя синхронизация двух живых PostgreSQL запрещена.**

После восстановления в дубль нужно проверить под тестовой учётной записью
вход/выход, классы, электронику, Scratch, открытие и сохранение работ, файлы
MinIO, права доступа и нагрузку; HTTP 200 и `healthy` недостаточны.

## Облачные копии для независимых серверов

Цель — развёртывание ASA Lab на любом совместимом Ubuntu без зависимости
от локального Windows-пути конкретного владельца и с независимым
резервированием каждой копии системы.

**Состояние реализации:** выбор и проверка полного архива в
синхронизированном Яндекс Диске на Windows уже реализованы.
Контракт новой установки `production --require-restore` требует
проверенный снимок, его целостность и минимальную численность.
**Прямое подключение нового Ubuntu к личному Яндекс Диску через OAuth
ещё не настроено и не проходило боевой тест.** Для этого этапа понадобится
отдельная авторизация провайдера; не записывайте токены в GitHub.

Рекомендованные независимые каталоги одного хранилища:

~~~text
ASA-Backups/
  asa-lab-YYYYMMDDTHHMMSSZ-id.tar.age   # существующие снимки школы (только импорт)
  servers/
    server-a/
      asa-lab-YYYYMMDDTHHMMSSZ-id.tar.age
    server-b/
      asa-lab-YYYYMMDDTHHMMSSZ-id.tar.age
~~~

Снимки каждого сервера неизменяемые. Они создаются **из согласованного
PostgreSQL + MinIO backup**, затем шифруются `age` с публичным
получателем; в облако передаются **только ciphertext и контрольные суммы**.
Каждый сервер имеет свой namespace. Не разрешается `sync`, `bisync`
или монтирование `/var/lib/postgresql/data` и Docker volumes
прямо в облачную синхронизируемую папку.

Для переносимого доступа к Яндекс Диску в Linux/Windows используйте
`rclone` с типом удалённого хранилища `yandex` (официальная поддержка
OAuth, включая настройку на сервере без браузера).
WebDAV с июня 2026 требует тариф Яндекс 360, поэтому для бесплатного
сценария не делайте его единственной опорой.
Авторизацию проходит владелец, OAuth-конфиг root-only / secret volume.
Обычному контейнеру ASA Lab не выдавайте ни токен облака,
ни пароль/ключ восстановления, ни доступ к Docker socket.

Отдельный агент резервирования (на хосте или в изолированном контейнере)
может ежедневно формировать и отправлять новые зашифрованные снимки
в папку `servers/<server-id>/`. Отдельный установщик скачивает последний
**завершённый** архив, сверяет возраст и SHA256, расшифровывает только
при наличии предоставленного приватного `age` identity, проверяет
манифест и мигрирует PostgreSQL, переключает MinIO/крипто-ключи
только после консистентной проверки и rollback checkpoint.
Для полностью безоператорского восстановления потребуется отдельное
безопасное хранение ключа; отсутствие доступа к ключу не должно
заменяться пустой БД.

**Проблема фактического прогона:** 17 октября 2026 после
`CHECKPOINT CONFIG_KEYS_SWITCHED` Docker поднял контейнеры,
но мгновенный `readiness()` получил временный
`ConnectionResetError` и инициировал откат. Откат на уровне
PostgreSQL/MinIO/ключей фактически возвратил пустое состояние,
но второй мгновенный `readiness()` вызвал ложный
`MANUAL_ROLLBACK_REQUIRED`. Исходные 89 аккаунтов,
418 ученических мест и 327 активных учеников сохранились
в отдельной БД `asalab_failed_20261017t212814z`
и в неизменном проверенном архиве Яндекс Диска.
Исправленный восстановитель использует штатное
`Installation.wait_ready(revision,schema)` (до пяти минут)
на обоих этапах и отдельную фиксацию возврата данных.
21/21 регрессионный тест PASS, включая симуляцию двух
`ConnectionResetError`. **Повторное успешное переключение
на рабочий снапшот ещё не подтверждено**, не считать его
выполненным до `RESTORE_LIVE_PASS` и проверки пользовательских данных.

## Зафиксированные проблемы из испытания 17 октября 2026

| Диагностика | Причина и правильное решение |
| --- | --- |
| CDN 1Panel застревал на нескольких килобайтах | Явный тайм-аут, официальный архив по HTTPS с другого компьютера, обязательная проверка SHA-256; не запускать `curl\|bash` без проверки |
| 1Panel после рестарта сам открывал 22/19192/80/443 | Панель хранит разрешённые порты в `FirewallPortWhiteList` внутри `agent.db`. Создавать backup SQLite, ограничивать оба служебных порта выбранным CIDR, удалять старые широкие правила, проверять **после рестарта**; не редактировать системный UFW в обход панели без обновления её состояния |
| Интерфейс сначала был английским | Переключить на русский при входе; в профиле сохраняется `ru` |
| В наличии Docker Engine 29.6.x | `PANEL_INSTALL_DOCKER=n`, `PANEL_CONFIGURE_ACCELERATOR=n`, `PANEL_REPLACE_DAEMON_JSON=n`; не переустанавливать демон |
| Web не открывался из LAN | Это ожидаемая привязка к `127.0.0.1:4610`, используйте SSH-туннель или отдельный HTTPS ingress; не публикуйте API/PostgreSQL |
| Отменённые повторные CI на SHA | Отменённые прогоны не доказывают успешный релиз; штатный менеджер проверяет требуемый workflow и publication; обходить проверку нельзя |
| Tailscale ещё не авторизован | Приложение устанавливается отдельно, требуется подтверждение устройства в своём tailnet; не открывайте административный порт в интернет |
| Исторический PostgreSQL dump без MinIO | Не является полным backup; требуется подтверждённый PostgreSQL + objects + private.env + manifest |

**Нормативные ограничения:** [Portable Self-Hosted Deployment Standard](../architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md),
[контракт deployment](../agent/contracts/deployment.yaml),
[операционный менеджер](PORTABLE_OPERATIONS.md).

### Статус фактической репетиции

На **отдельном** Ubuntu 24.04.4, `admins-MS-7D22`, пройдены чистая
установка опубликованного ASA Lab, проверка 5/5 контейнеров,
`doctor`, Chrome-smoke, 120/120 HTTP, создание полного backup,
`verify-backup` и `restore-check` в отдельной базе. Отдельный скрипт
`install-ubuntu-1panel.py` полностью на пустой машине пока не проходил
end-to-end; его локальные проверки покрываются `test_bootstrap.py`.

Это **не** доказательство готовности для 300 одновременных учеников, публичного
HTTPS или переноса их живых данных. Рабочий сервер Selectel и школьная
установка не участвуют в этой репетиции.