# Learning/Courses: изолированный тестовый запуск

**ID:** PUBLIC-TEST-001

**Issue:** #374. **Подготовка:** PR #375, `release/learning-public-test-prep`.

**Граница:** только тестовый экземпляр; рабочий `asa-lab.ru` не обновляется.

## 1. Состав кандидата

Исходная подготовка: `c98d4a735c0dfbc615e6dc667450d1fed3056b6b`.
Принятый исходный main: `42ba99558ac552d81289115fefe8502974f0ba11`.
Обычный merge main в подготовку: `8ea84d69c1628ebc16765c4dd9e356ab4aed85c3`.
D5 (#361), оболочка прямого задания (#369) и карточка Electronics (#384)
уже входят в main; повторно собирать их старые HEAD не требуется.
PR #376 — исторический сборочный кандидат; его не запускать и не сливать.

Относительно принятого main разрешены только `compose.staging.yaml` и этот
документ. Продуктовый код, SQL, workflows, package.json и lockfile наследуются
из main без изменений. A1 и следующий продуктовый этап не начинаются.

Итоговый SHA фиксируется после коммита этих файлов командой `git rev-parse HEAD`.
Он записывается в приватный env как `ASA_BUILD_REVISION` и в `evidence/receipt.json`,
сопоставляется с HEAD #375, CI и тремя сервисами. Документ внутри коммита не может
содержать SHA самого себя: итоговое значение берётся из Git и квитанции запуска.
Новая правка требует нового SHA, CI и пересборки; старое evidence не переносится.

Сведения прежнего плана о сайте (`1ae93cbb...`, схема 142), локальном `78287af...`
и схеме 151 — исторические наблюдения, не текущая проверка сайта или его БД.
Рабочий публичный сервис здесь не исследуется и не изменяется.

## 2. Экземпляр и изоляция

Авторизованный компьютер: `Ali_Robs`.
Каталог: `C:\Users\spike\asa-lab-learning-test-374`, worktree — подкаталог `repo`.
Приватные файлы и evidence находятся рядом, за пределами Git/build context.
Compose project: `asa-lab-learning-374`.

Web: `http://127.0.0.1:14620`, только на Ali_Robs. Это не публичный URL.
Внешняя публикация, TLS, DNS, FRP, VPN и firewall в этой задаче не настраиваются.
Перед запуском повторно проверить свободу 14620 и диагностического 14623;
чужой занятый порт не освобождать.

Используются только `compose.yaml` + `compose.staging.yaml` из одного SHA.
Никаких dev/production/FRP overlays. Новая БД: `asa_learning_374_test`.
Только новые volumes `asa-lab-learning-374_postgres-data` и
`asa-lab-learning-374_blocks-object-data`; сети `application`, `database`,
`scratch-runtime` также имеют префикс project. Сеть БД internal.
PostgreSQL, API и MinIO не имеют опубликованных host-портов.
Не подключать external volumes, рабочие данные или общую БД.

`private/staging.env` содержит независимые случайные пароли БД, runtime-роли,
object storage и encryption/signing keys. `ASA_SEED_DEV=false`.
Публичные пароли по умолчанию запрещены. Env, cookies, sessions и данные входа
не выводить в логи и не коммитить. Rendered config с секретами хранить только
приватно; evidence содержит очищенный отчёт о конфигурации.

## 3. Scratch: единый вход ASA Lab

`docker/web/Caddyfile` проксирует `/internal/blocks/` в `scratch:8080`, удаляя
Cookie/Authorization и Set-Cookie на этой границе. Редактор встроен на том же
browser origin, что и портал. Отдельный публичный runtime hostname из старого
плана отменён; действуют текущие compose, Web config и Scratch runtime contract.

```dotenv
ASA_PUBLIC_WEB_ORIGINS=
ASA_BLOCKS_RUNTIME_ORIGIN=http://127.0.0.1:14620
ASA_BLOCKS_PARENT_ORIGIN=http://127.0.0.1:14620
ASA_WEB_PORT=14620
ASA_BLOCKS_PORT=14623
ASA_SEED_DEV=false
```

14623 — только loopback health/diagnostic endpoint основного compose-контракта,
не пользовательский вход и не публичный сайт. API/БД не входят в scratch-runtime.
Использовать штатный Dockerfile, upstream pin и патчи. Старый контейнер не
является новой сборкой, даже если отвечает healthy.

Локальный origin уже вычисляется API из `ASA_WEB_PORT`; его не записывают в
`ASA_PUBLIC_WEB_ORIGINS`. Этот параметр оставляется пустым для локального стенда
и принимает только дополнительные не-loopback HTTPS-origin при отдельно
разрешённой внешней публикации. Guard `origin-policy.ts` не меняется.
Первый проверочный кандидат выявил ошибку конфигурации: HTTP loopback в этом
списке закономерно блокировал API; исправление ограничено staging overlay.

## 4. Сборка, миграции и запуск

В PowerShell на Ali_Robs после фиксации кандидата и проверки чистого дерева:

```powershell
Set-Location 'C:\Users\spike\asa-lab-learning-test-374\repo'
$project = 'asa-lab-learning-374'
$envFile = 'C:\Users\spike\asa-lab-learning-test-374\private\staging.env'
$dc = @('compose', '--env-file', $envFile, '-p', $project,
  '-f', 'compose.yaml', '-f', 'compose.staging.yaml')
git rev-parse HEAD
git status --porcelain=v1
docker @dc config --quiet
docker @dc build api web scratch minio
docker @dc up -d --no-build postgres minio scratch
docker @dc run --rm --no-deps migration
docker @dc run --rm --no-deps migration
docker @dc up -d --no-build api web
```

Каждый ненулевой exit code — STOP. До первого up очищенный rendered config
должен подтвердить уникальные identity/volumes/networks, только loopback-порты,
отсутствие host networking/Docker socket и независимые credentials.
`ASA_BUILD_REVISION` и уникальные image tags соответствуют `git rev-parse HEAD`.

На совершенно пустой БД read-only `--plan` до первого bootstrap сообщает
`relation "schema_migrations" does not exist`: таблица учёта ещё не создана.
Сначала проверить чистоту новой БД и файловый план (`--check`), применить штатный
migration entrypoint, затем повторить `--plan`. Не создавать ledger ручным SQL.

План берётся из `tools/migrate.mjs`. Для исходного main последняя миграция —
`0160_course_participation_issued_seat.sql`. Проверить полный упорядоченный состав
и checksums против `schema_migrations` только новой тестовой БД. Повторный запуск
обязан сообщить 0 pending migrations. Ограниченную роль создаёт штатный migration
entrypoint; ручные SQL-изменения запрещены. API запускается после миграций,
`/health/ready` должен подтвердить synchronized и ожидаемую фактическую схему.

Сверить Git SHA, image IDs/OCI revision, Web `build-metadata.json`, API readiness
и Scratch `/internal/blocks/asa-commit.txt`. Записать container IDs и timestamps.
Существующие `asa-lab-dev` и другие проекты не останавливать и не пересоздавать.

До push: форматирование двух файлов, `git diff --check`, применимые штатные
preflight/governance/Compose validators. На итоговом SHA необходимы
`ASA Lab Governance and Code Gates` (четыре jobs SUCCESS),
`pnpm test:learning-e1` и `pnpm e2e:learning-e1`.
Learning workflow при необходимости запустить штатным workflow_dispatch на #375:
path filters могут не реагировать на deployment-only diff.
CI и демонстрация против собранных контейнеров — отдельные уровни evidence.

## 5. Демонстрация

Штатной регистрацией создать взрослый тестовый Account, подключить авторство и
преподавание. Через UI/API создать одну группу и два StudentSeat. Данные входа
хранить в `private/demo-credentials.json`, за пределами Git и публичных логов.
Не копировать настоящих учеников и не применять SQL INSERT/UPDATE для demo.

Через Course Builder опубликовать и назначить курс с одним уроком:
текст → Electronics Activity → callout → 3D Activity.
Отдельно выдать прямое задание для проверки панели #369.
Второго ученика оставить с нетронутыми назначениями для ручного прохода.

Обязательные browser-сценарии против контейнеров:

1. Преподаватель публикует и назначает курс; ученик видит исходный порядок блоков.
2. Electronics: Start → resistor → exact-project server save → reload → тот же
   resistor → повторное открытие прежнего projectId → submit.
3. 3D: другой projectId → объект → подтверждение save → reload; после свежего
   чтения курса Electronics остаётся submitted/«На проверке».
4. Прямое задание открывает лабораторию с биркой и открываемой панелью #369.
5. Обычный Scratch работает встроенно, сохраняет изменение на сервер и после
   reload восстанавливает тот же проект, без отдельного публичного origin.
6. Ученический экран 390 и 320 CSS px: доступность практик и отсутствие overflow.

Сохранить реальные снимки курса преподавателя, урока ученика с двумя практиками,
Electronics, 3D, бирки и открытой панели, Scratch и экранов 390/320. Manifest
содержит SHA, revisions, URL, viewport, browser/OS, assertions и projectId без
секретов. PASS означает выполненное утверждение, не наличие кнопки в DOM.

## 6. Известные ограничения

D5 поддерживает независимые практические блоки урока и inherited participation
для issued StudentSeat. Прямая/legacy выдача поддерживает панель #369.
Панель конкретного практического блока курса через Learning Work Context —
следующий этап A1, не требование этого запуска. Новый ученический центр, защита
учебных проектов, поточная проверка и полное медиа-задание также не требуются.
Наличие планов не означает, что эти функции реализованы или приняты.

Electronics R1–R4 из #378 не включаются и не объявляются принятыми. Изменение
ширины окна не заменяет проверку настоящего телефона. Воспроизводимые дефекты
фиксировать с SHA и шагами; не чинить продукт, SQL, validators или workflows
вне двух разрешённых файлов. Рабочую БД и публичный сервис не трогать.

## 7. Квитанция и остановка

`evidence/receipt.json`: исходный main, итоговый SHA, PR, компьютер, Compose,
URLs, образы/revisions, миграции, CI run IDs, результаты каждого сценария,
снимки и ограничения. Роли и секреты — отдельно в приватном локальном файле.
Не подставлять старый CI; FAIL/UNVERIFIED сообщать отдельно от PASS.
Не merge #375/#376 автоматически. Внешний доступ — отдельное поручение.

Остановка только этого стенда, с сохранением его volumes:

```powershell
docker compose --env-file 'C:\Users\spike\asa-lab-learning-test-374\private\staging.env' -p asa-lab-learning-374 -f 'C:\Users\spike\asa-lab-learning-test-374\repo\compose.yaml' -f 'C:\Users\spike\asa-lab-learning-test-374\repo\compose.staging.yaml' down
```

Не добавлять `-v`, не выполнять global prune, не трогать PR #378 и Issue #377,
другие сервисы и настройки ОС. После отчёта STOP.
