# ASA Lab — оператор обновления тестового Docker-сервера

Один и тот же Python CLI запускается человеком в терминале и ботом через MCP 1Panel:
[tools/asa_test_refresh.py](../../tools/asa_test_refresh.py).

**Область:** существующий Linux/Docker Compose стенд ASA Lab с отдельным тестовым
HTTPS origin (test.*), PostgreSQL и MinIO. Это **не** команда для школьного и
production-сервера; на Windows остаётся штатный PowerShell portable updater.
Разделение согласуется с [Portable Deployment Standard](../architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md).

## 1. Модель, гарантии, ограничения

- GitHub main — источник исходников; перед сборкой фиксируется **точный SHA из
  40 символов**. Не преследовать постоянно меняющийся main.
- GitHub push ≠ Docker deployment. Доказательство обновления — метки **запущенных**
  API/Web/Scratch, версия PostgreSQL, единый порт и HTTPS 200.
- Для проверенных опубликованных релизов используйте существующие
  asa_update_plan / asa_update_start / tools/asa_manager.py update.
  Этот оператор применяет **явно авторизованный тестовый source-update**
  без приписывания ему статуса published/stable CI.
- Рабочая PostgreSQL и MinIO не удаляются. Предыдущая БД переименовывается,
  dump сохраняется, MinIO копируется в отдельный retained Docker-том;
  запрет на удаление постоянных томов, массовый сброс Git и отключение защиты.
- Из Яндекс Диска восстанавливается только **целый** согласованный архив:
  database.dump, objects/, private.env и manifest.json.
  Восстановить SQL без его MinIO файлов нельзя.
- Сохранить прежние значения секретов, не печатать их и не публиковать в CI.
  Для ученических кодов объединять keyrings с совпадением ключевых ID;
  конфликт и отсутствие ключа — STOP.
- Уровни приёмки различаются: build → technical healthy → real browser journeys
  → owner acceptance. HTTP 200 и healthchecks **не доказывают** сохранение проекта.

## 2. Предварительные условия

На существующем тестовом сервере установлены Python 3.11+, Git, Docker Engine,
Docker Compose v2, rsync и age. Root нужен для файлов постоянных Docker-томов.
Git всегда запускается от владельца рабочей папки (например, admins), а не
от root, чтобы Git pack/refs не становились недоступными пользователю.

Существуют корень /srv/asa-lab, приватный .env, файл
.asa/installation.json, compose.yaml, compose.production.yaml и живые
контейнеры postgres, minio, api, scratch, web. Допустим только реально
настроенный тестовый HTTPS origin. Нельзя менять порты, прокси или создавать
вторую систему как обход ошибки.

Проверить текущее состояние:

~~~bash
cd /srv/asa-lab
sudo python3 tools/asa_test_refresh.py status --root /srv/asa-lab
~~~

При незавершённой операции сначала прочитать сохранённый статус и
восстановительные копии. **Не** запускать слепой повтор или новую попытку
с отличающимся MCP idempotency key.

## 3. Обновить код и сохранить текущие данные

~~~bash
cd /srv/asa-lab
sudo -u admins git fetch --no-tags origin main
sudo -u admins git rev-parse origin/main
~~~

Подставить полный 40-символьный SHA вместо SHA40:

~~~bash
sudo python3 tools/asa_test_refresh.py plan \
  --root /srv/asa-lab --sha SHA40 --mode preserve \
  --origin https://test.asa-lab.ru

sudo python3 tools/asa_test_refresh.py apply \
  --root /srv/asa-lab --sha SHA40 --mode preserve \
  --origin https://test.asa-lab.ru --ack-test-only
~~~

План не меняет контейнеры и данные. Выполнение: exact SHA и Git worktree с
umask 022 → отдельная Docker-сборка → резервная копия PostgreSQL и MinIO при
остановленных писателях → восстановление снимка в новый изолированный
PostgreSQL → миграции с повторным read-only plan → сохранение прежней БД и
тома → переключение Docker → health/HTTP/label проверки → сохранение .env,
Git HEAD и приватного receipt.

Если локально уже имеются все корректные образы точного SHA, оператор может
получить --reuse-images. Он **обязательно** сверяет их метки и права конфигурации.

## 4. Восстановить новую копию Яндекс Диска

1. Через 1Panel MCP вызвать asa_cloud_transfer(action=list, project=asa-lab).
2. Выбрать самый свежий подходящий **полный** snapshot.
3. Вызвать asa_cloud_transfer(action=download, project=asa-lab,
   filename=archive.tar.age) и дождаться завершения через asa_operation_get.
4. Получить локальный путь и SHA256 зашифрованного файла. Не передавать
   OAuth токены, пароли или содержимое age-ключа в чат или команды.
5. На тестовом сервере должен существовать приватный age identity FILE.

Предварительная проверка:

~~~bash
sudo python3 tools/asa_test_refresh.py plan \
  --root /srv/asa-lab --sha SHA40 --mode restore \
  --origin https://test.asa-lab.ru \
  --archive /srv/asa-cloud-storage/data/asa-lab/incoming/ARCHIVE.tar.age \
  --archive-sha256 ENCRYPTED_SHA256
~~~

Запуск с явным согласием **заменить** тестовые данные:

~~~bash
sudo python3 tools/asa_test_refresh.py apply \
  --root /srv/asa-lab --sha SHA40 --mode restore \
  --origin https://test.asa-lab.ru \
  --archive /srv/asa-cloud-storage/data/asa-lab/incoming/ARCHIVE.tar.age \
  --archive-sha256 ENCRYPTED_SHA256 \
  --identity /path/to/private-age-identity \
  --ack-test-only --confirm-replace-data
~~~

Оператор проверяет SHA256, безопасность tar-путей, manifest-хэши, права
доступа, проект и secret identity, keyrings, переносимость схемы и полное
совпадение файлов в отдельном MinIO-томе. Изолированная восстановленная БД
получает forward-migrations перед переключением рабочей базы. Количество
учётных записей, классов и проектов отображается в отчёте.

**Restore не объединяет записи.** Новый архив может содержать другой набор
идентификаторов, даже если строк стало больше. Прежняя БД и MinIO остаются
для отката; в школьной системе подобная замена требует отдельного процесса.

## 5. Запуск ботом через MCP 1Panel

Через asa_admin_execute вызывается **та же самая** команда CLI, а не
другой сгенерированный на лету shell-сценарий:

~~~text
asa_admin_execute(
    installation_id="asa-test",
    command="cd /srv/asa-lab && python3 tools/asa_test_refresh.py apply ...",
    idempotency_key="<stable-operation-key>"
)
→ operation_id
→ asa_operation_get(operation_id)
→ inspect final exit_code, receipt and independently verified runtime
~~~

Root shell уже включён владельцем, но долгосрочно следует заменить общую
административную возможность на отдельный allowlisted MCP-инструмент:
разрешённый каталог, набор CLI параметров, только тестовая установка,
ограничения доступа по ролям, idempotency, audit trail.

## 6. Результаты и журналы

Оператор пишет безопасные JSON-события в stdout. Приватные файлы сохраняются
в /srv/asa-lab/.asa/test-refresh/JOB_ID/ :

- status.json — этап, SHA, путь к предыдущему dump и retained volume;
- build.log — Docker build;
- restore.log — pg_restore staging;
- migration.log — миграции;
- switch.log — запуск Docker;
- rollback.log — попытка отката.

Основные этапы: preflight, decrypt_and_verify, image_build,
isolated_restore, freeze_and_full_backup, switching, starting_new,
persisting, complete. Неудача после остановки писателей запускает откат
БД, файлов, приватной конфигурации, Git checkout и контейнеров.
Если откат сам не завершился, статус manual_recovery_required: инженер
проверяет state и сохранённые данные. Скрипт не уничтожает recovery-артефакты.

Успех: все постоянные сервисы Compose healthy, включая новые (например, Search), точный runtime SHA,
схема PostgreSQL соответствует исходному GitHub, HTTPS 200, локальный
HTTP 200, backup и receipt присутствуют. Сквозной вход, открытие, сохранение,
перезагрузка и повторное открытие проектов — отдельный обязательный E2E-gate.

## 7. Реальные проблемы, причины и профилактика

| Проблема | Фактическая причина | Новое правило |
|---|---|---|
| Git dubious ownership / bad object | root создал недоступные Git pack и refs | fetch/worktree/switch только от владельца checkout |
| Scratch index.html: Permission denied | строгая umask 077 в worktree скопировала режим 0600 | umask 022 + тест режима внутри финального image |
| Web Caddyfile: permission denied | неправильные права COPY в runtime image | проверка файла /etc/caddy/Caddyfile до запуска |
| PostgreSQL выводил заголовки | не был указан машинный формат | только psql -XAt -v ON_ERROR_STOP=1 |
| Python Path.chown AttributeError | использовался несуществующий метод | os.chown и регрессионные тесты |
| Менеджер IDENTITY_FILES | live source-deploy не совпал с published stable manifest | отдельный режим source-test, запрет подделывать релиз |
| Отличающиеся student encryption/lookup keys | snapshot создан раньше текущего стенда | объединение набора ключей, отказ при ID-конфликте |
| Разное число классов и проектов | restore заменяет данные, а не объединяет | staged database + counts + retained previous DB/MinIO |
| Внутренняя .minio.sys менялась | фоновая housekeeping MinIO | хэшировать объекты snapshot до promote |
| Повторные тяжёлые сборки | Scratch/npm/web в Docker | BuildKit cache и проверенный --reuse-images |
| Новый сервис Search не был собран | оператор использовал жёсткий список только из четырёх сервисов | динамическая инвентаризация buildable-сервисов из Docker Compose + проверка image SHA и health каждого запущенного сервиса |
| Новый Search не смог бы запуститься без ASA_SEARCH_SECRET | в старой .env отсутствовал отдельный 64-символьный ключ | ключ генерируется один раз в закрытом серверном файле, включается лишь в кандидат, не показывается в логах и не меняется на повторных попытках |
| MinIO стал unhealthy после корректного SQL-перехода | `rsync -a` сохранил owner=root:root, а каталоги из архива были `0700`; MinIO работает как `1000:1000` | автоматически считывать uid:gid из работающего контейнера, менять владельца **только изолированного staging-тома**, проверять owner до проверки SHA256 и переключения |
| Новый Search остался запущенным после rollback | старая версия Compose не знала новый сервис | вычислять разницу runtime service names между old/new Compose, останавливать и удалять **только новые** контейнеры без удаления томов |
| Неатомарный swap имён БД | возможен отказ между успешной PostgreSQL командой и записью phase в Python | откат определяется **фактическими именами БД**, а не только внутренней переменной; при двусмысленности fail closed |
| Частичный `rsync` при сбое | копирование в live volume могло завершиться посередине | флаг изменения выставлять **до** операции; восстановление из отдельной копии вне live volume |

| CI cancelled/failed на moving main | старые SHA и независимые проблемы | пин SHA, тестовый source-mode, отдельная release acceptance |
| MCP timeout / lost response | long-running operation не обязана прерваться | idempotency key, operation_id, статус вместо второго запуска |

## 8. Проверки качества

~~~bash
python3 -m unittest tools.test_asa_test_refresh -v
python3 -m py_compile tools/asa_test_refresh.py
git diff --check
~~~

Сопутствующий focused workflow проверяет Python unit и безопасность archive/
configuration. Полный допуск к школьному и production deployment
**не** выдан. Для этого отдельно нужны интеграционные fault-injection
сценарии: падение миграции, ошибка partial rsync, недоступный origin,
fail-healthcheck, crash в каждой фазе database swap, невозможность отката,
смещение GitHub main и повтор одной MCP операции, а также Playwright
login → open project → edit → save → F5 → reopen.

См. также [portable operations](PORTABLE_OPERATIONS.md) и
[программу #396](https://github.com/spikeal8-maker/asa-lab/issues/396).


## 9. Инциденты реального запуска, 26 октября 2026 года

Реальные попытки ASA Test Refresh с архивом от 25 октября показали,
что **offline unit PASS не является готовностью переключения**.

- Попытка `1c094529513c`: не собран новый Compose service Search.
  `docker compose up --no-build` завершился ошибкой `No such image:
  asa-lab-search:git-ef1e9d3e24a0`. Введено динамическое обнаружение сборок.
- Попытка `eb174e9fd26b`: Search уже собран и имел приватный ключ, но
  `minio unhealthy` из-за root-owned staged MinIO data. До начала новой
  попытки эти данные были проверены по SHA256, **но не по uid/gid**.
  Добавлены исправление владельца staged volume и проверка после copy.
- После обеих ошибок автоматический rollback вернул исходный
  `6b1bd8a7…`, PostgreSQL schema 253 и counts 92/31/1707; сайт HTTP 200.
  Search из второй попытки был отдельно остановлен; cleanup перенесён в
  программу rollback.
- Исходный архив `asa-lab-20261025T231505Z-15a27bd0.tar.age` проверен:
  snapshot schema 253, 2120 файлов MinIO, 94 Accounts, 31 Classes, 1712
  Projects. После изолированной миграции schema 255; источник остаётся
  неизменным. Различие количеств записей в restore — ожидаемое и явно
  фиксируется в логах, прежняя БД остаётся отдельно.

**Правило:** при новом отказе не повторять произвольный shell-сценарий,
а сначала изучить состояние операции, `switch.log`, `rollback.log` и
фактические volumes. Не использовать старое содержимое .env как новый
источник истины, если откат не был завершён.

## 10. Успешная контрольная точка после ремонта

26 октября 2026 года на тестовом сервере **реально выполнен** полный запуск
оператора из [PR #772](https://github.com/spikeal8-maker/asa-lab/pull/772):

| Свидетельство | Значение |
|---|---|
| Зафиксированный source SHA приложения | `ef1e9d3e24a0f77fe3f98ec9d692d02b9b8a3704` |
| Исходный архив Яндекс Диска | `asa-lab-20261025T231505Z-15a27bd0.tar.age` |
| Источник БД | snapshot schema 253, изолированно мигрирован до 255 |
| Проверка файлов | 2120 MinIO файлов по snapshot SHA до switch; 2101 пользовательский объект — SHA256 PASS после запуска |
| Идентификатор операции оператора | `7efdfe2d1fd5` |
| MCP operation_id | `d885e532145b40298258d58183fe590d` |
| Результат Python CLI | exit code 0, фаза `complete` |
| Docker | API, Web, Scratch, Search, MinIO, PostgreSQL — все healthy |
| Итоговая база | 94 аккаунта / 31 класс / 1712 проектов / schema `0255` |
| Предыдущая база для отката | `asa_previous_7efdfe2d1fd5`, 92/31/1707/schema 0253 |
| Предыдущий том MinIO | `asa-refresh-7efdfe2d1fd5-previous` |
| HTTPS и API | публичный портал, API health и пять статических JS — HTTP 200 |
| Git checkout | совпадает с версией запущенных контейнеров; рабочее дерево чистое |
| Браузерная проверка teacher/student + save/F5 | **NOT_RUN**, не заявлять user acceptance |

Старые данные не удалены. При последующих проверках отсутствие пользовательских
объектов MinIO не обнаружено. После старта внутренние служебные файлы
`.minio.sys` могут изменяться и не являются пользовательским контентом.

Focused CI оператора на SHA `8ea3618541ea43a16531f0ed74b8061c817e20c2` —
**SUCCESS**: [Actions run 40312659359](https://github.com/spikeal8-maker/asa-lab/actions/runs/40312659359).

Общий CI этого PR —
**FAILURE**: [Actions run 40312659352](https://github.com/spikeal8-maker/asa-lab/actions/runs/40312659352).
Точное место — `Governance contracts → validate_control_plane.py --require-github`:
закрытый/объединённый PR #704 продолжает фигурировать в
`docs/execution/current.yaml` как открытый PR задачи
`TASK-PROJ-R8-03C-PINNED-CATALOG-001`. Это независимое рассогласование
контрольной плоскости, **не** ошибка нашего Python-оператора. Исправлять
чужой task registry без отдельного scope нельзя. PR #772 остаётся Draft.

### Важная разница: GitHub CI и реальная кнопка развёртывания

Пока PR #772 **не интегрирован в main**, команда
`/srv/asa-lab/tools/asa_test_refresh.py` в основной установке может
отсутствовать. До публикации оператора используйте его из отдельного
проверенного Git worktree с SHA PR, например:

~~~bash
cd /srv/asa-lab-source-build/operator-candidate-20261026
sudo python3 tools/asa_test_refresh.py status --root /srv/asa-lab
~~~

После приёмки и интеграции в `main` стандартные команды из разделов 2–4
станут доступны непосредственно в `/srv/asa-lab`.

Кнопка `workflow_dispatch` в GitHub Actions сейчас запускает **только
проверку безопасности скрипта**, а не обновляет сервер. Для кнопки
«Deploy test» потребуется отдельный защищённый GitHub Environment, надёжный
серверный исполнитель и разграничение прав, чтобы CI не получал
неограниченный root-доступ к базе/MinIO. GitHub не должен автоматически
перезатирать тестовую базу при каждом push.

**Проверено:** полный автоматизированный source-update и restore на тестовом
стенде. **Ещё требуется:** fault-injection на изолированном runtime,
автоматические browser E2E сценарии и независимый review перед снятием Draft.

## 11. Инцидент повторного обновления 26.10.2026 (режим preserve)

Запрошено обновление **существующего** тестового стенда с `ef1e9d3e…`
до зафиксированного SHA `452cec488fc0a566c2b6482931b386cb12bdcc07`:
103 новых коммита, новая схема PostgreSQL 0260 вместо 0255. Нового
архива Яндекс Диска после 25.10 не было, поэтому **режим preserve**,
без повторного восстановления старых данных.

Первая попытка через MCP 1Panel:

- operation_id: `4e85fd5214f34cf082a3a6620dd963f3`,
  receipt `f62cdca01c7c`;
- Docker-образы API/Web/Scratch/Search/MinIO собраны и проверены по
  точному SHA;
- перед обновлением созданы PostgreSQL dump и резервный MinIO-том;
- миграция проверочной PostgreSQL-копии завершилась PASS;
- **BLOCKED** на нормализации MinIO stage:
  `Cannot attest the existing MinIO runtime user`.
- Причина: для безопасного снимка оператор остановил MinIO, а затем
  запросил `docker compose ps -q minio`. Без `-a` команда не
  возвращает остановленный контейнер, хотя его `Config.User=1000:1000`
  сохраняется и пригоден для проверки.
- **Исправление:** запрашивать `docker compose ps -a -q minio` с тем же
  существующим Compose root; затем `docker inspect` для UID/GID. Это
  работает и для работающего, и для остановленного MinIO.
- **Тест:** регрессия проверяет именно аргументы `ps -a -q minio`,
  дополнительно сохраняются остальные 25 safety/rollback тестов.
- Автоматический rollback: `failed_rolled_back`, проверка вернула
  6 healthy services, HTTPS 200, Git исходного SHA и данные
  94 аккаунта / 31 класс / 1712 проектов / PostgreSQL 0255.
- Пять новых Docker-образов уже собраны; для повторной попытки разрешён
  `--reuse-images` после обязательной проверки exact SHA.

**Процессное улучшение:** unit tests должны моделировать порядок
`freeze writers → inspect stopped containers → stage data → migrate →
switch`, а не тестировать каждую функцию только с работающим Docker.

После повторной попытки заполнить exact-SHA, receipt, время,
миграции, object SHA256, web/API health и пользовательскую приёмку.
