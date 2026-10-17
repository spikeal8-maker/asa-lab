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

## Доступ к тестовой ASA Lab по LAN (необязательный HTTP-preview)

Стандартная установка публикует Web только на `127.0.0.1:4610`, поэтому адрес
`http://192.168.1.115:4610/` **сам по себе не должен работать**. Не меняйте
Docker `ports` на `0.0.0.0` и не публикуйте API/MinIO/PostgreSQL. Для
**локального ознакомления без рабочих паролей** предусмотрен отдельный
ограниченный сетевой ingress: штатный `systemd-socket-proxyd` слушает
**только выбранный LAN IPv4** и пересылает TCP на `127.0.0.1:4610`.

После установки менеджер закрепляет Git checkout на SHA выпуска; если
`tools/bootstrap/lan-preview-ubuntu.py` отсутствует в закреплённом checkout,
получите его отдельно из GitHub (просмотрите файл перед запуском):

```bash
curl -fsSL --max-time 30 \
  https://raw.githubusercontent.com/spikeal8-maker/asa-lab/main/tools/bootstrap/lan-preview-ubuntu.py \
  -o /tmp/asa-lan-preview-ubuntu.py
sudo python3 /tmp/asa-lan-preview-ubuntu.py install \
  --root /srv/asa-lab-test \
  --lan-ip 192.168.1.115 --cidr 192.168.1.0/24 --interface eno1
sudo python3 /tmp/asa-lan-preview-ubuntu.py check \
  --root /srv/asa-lab-test \
  --lan-ip 192.168.1.115 --cidr 192.168.1.0/24 --interface eno1
```

Замените `--root`, `--lan-ip`, `--cidr`, `--interface` на **собственные**
значения. Это явный выбор оператора, а не автоугадывание IP. На МТС
сначала закрепите адрес сервера по MAC в DHCP. Инструмент блокирует
публичные IP, чрезмерно широкие CIDR, VPN/Docker-интерфейсы,
production-профиль, неработающий локальный Web, отключённый UFW и чужие
systemd unit-файлы. Повторный `install` не пересоздаёт Docker и тома.

**Это строго HTTP-preview, а не безопасный сайт для работы учеников.**
`runtime-config.js` и встроенный Scratch в текущем опубликованном
выпуске сохраняют исходный `http://127.0.0.1:4610`, и браузер,
входящий по LAN IP, видит несовпадение origin. Заголовки безопасности,
проверки capability, CSRF и origin отключать нельзя; HTTP-страница
не служит доказательством сохранения Scratch-проекта. Для полной работы
с настоящими школьными аккаунтами нужен собственный HTTPS ingress
с точным единым browser origin, совпадающим с конфигурацией
публикуемого выпуска и принятым в API/Scratch, и отдельный браузерный тест.

Контрольный реальный прогон (17.10.2026): Chrome `192.168.1.115:4610`
HTTP 200, `/health/ready` ready, `/internal/blocks/healthz` 200,
пять контейнеров healthy, после рестарта `1panel-agent` и
`asa-lab-lan-4610.socket` ограниченное UFW-правило сохраняется.
Это **не** подтверждение пользовательских сценариев или публичного HTTPS.

## Актуальная копия ASA Lab из Яндекс Диска

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