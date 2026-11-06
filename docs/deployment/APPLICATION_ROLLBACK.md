# Возврат приложения P0 с сохранением новых данных

Статус: реализация для независимого review и последующей native-квалификации.
Наличие этого документа или зелёных unit tests не означает выполненный Docker
прогон, принятие Windows Desktop или разрешение обновить production.

## Граница совместимости

Команда `rollback` возвращает только предыдущую версию **последней связанной
операции**, заранее подготовленной через `update --require-application-rollback`.
Пользовательский SHA для возврата не принимается. Обычные `check`, `update` и
`selected_source` сохраняют проверку направления ancestry; попытка обычного
обновления `d0bf7cbe → 98d7fbb4` продолжает отклоняться.

В версии v3 декларация совместимости ограничена следующей парой:

| Свойство                            | Допустимое значение                        |
| ----------------------------------- | ------------------------------------------ |
| Предыдущий официальный release      | `98d7fbb42ae9e53113cb45ada4b4301334de9c27` |
| Продуктовая база следующего release | `d0bf7cbeb129ff991272f006fc379ee004cb00f8` |
| Исходная база delivery-расширения   | `76d0610285831a99b7801478e03418ff5800bf73` |
| Схема обеих версий                  | `304`                                      |
| OCI platform                        | `linux/amd64`                              |
| Идентификатор декларации            | `asa-p0-98d7-d0bf-application-return-v3`   |

Для точных `98d7` и `d0bf` в коде закреплены все пять официальных digest images.
Каждый другой допустимый target обязан быть официальным потомком базы `76d0610`
**и** принятого collector commit
`a8c8ff139340032f4d69cb577847b6ae47667011`. Его полный diff от продуктовой базы
может содержать только семь перечисленных в `QUALIFIED_CHANGES` delivery-файлов,
три **неизменённых относительно `76d0610`** документа базы, следующие три
collector-файла с точными Git identities и необязательный полный принятый набор
lazy work-context, описанный ниже:

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `tools/collect_logs.py` | `100644 blob` | `59746e5e8d889ab819535a1ac04f40d61e1c0bb6` |
| `tools/test_collect_logs.py` | `100644 blob` | `1445bd987fc6d43dd51c5f87e5364a521e50481f` |
| `docs/deployment/ADMIN_LOGS.md` | `100644 blob` | `836bae5a70a21eafa5cbc15d7846f36b8e991dc9` |

Эти пути не являются свободным расширением allowlist: нужны все три точных
blob, обычный неизменённый mode/type и accepted commit в ancestry. Копирование
тех же байтов без принятой истории, частичный перенос, удаление, executable-bit,
symlink или дальнейшая правка любого из трёх файлов отклоняются. Delivery-only
потомок без этого collector также не является combined target v3. Точный
закреплённый `d0bf` сохраняет отдельный исходный путь проверки.

Если final diff от `d0bf` затрагивает любой из четырёх lazy work-context путей,
target дополнительно обязан содержать принятый commit
`7329144f71ede36182bf8da965c3c6090637a17f` в ancestry и все четыре точных файла:

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `apps/api/src/learning-work-context.controller.ts` | `100644 blob` | `5c23acd238b58dc4fc282fe0d1632bc33dd8bf31` |
| `apps/api/src/learning-work-context.ts` | `100644 blob` | `88cd4f62c96ea161fbbce61e6e606ef87d42423e` |
| `apps/api/src/learning-work-context.controller.spec.ts` | `100644 blob` | `2975a4ed53f399d1b016e4eeea1866b995b468ac` |
| `apps/api/src/learning-work-context.spec.ts` | `100644 blob` | `6ffe21f328342286ee372a33a2ac228de6ae3954` |

Копирование полного набора без принятой lazy ancestry, частичный перенос,
частичный возврат к прежним bytes, удаление, смена mode/type или последующая
правка любого из четырёх файлов отклоняются. Принятая lazy ancestry не заменяет
обязательные collector ancestry и pins. Наличие только schema `304` также
не разрешает такой target.

Если **все четыре** API-файла полностью возвращены к исходным bytes `d0bf`
(они совпадают с `76d0610`), lazy diff отсутствует. Даже при сохранённой
lazy ancestry это остаётся прежним допустимым collector-only final tree;
требования к collector, baseline documents, остальным product paths и native
квалификации сохраняются. Такая версия не содержит lazy исправление, и её
нельзя выдавать за его применение или capacity evidence. Один возвращённый
файл при остальных трёх новых попадает под проверку полного набора и запрещён.

Список изменённых путей читается с отключённым rename/copy detection через
`--name-status -z`: перед каждым именем стоит непустой status, после имени — NUL.
Это сохраняет начальные и конечные пробельные символы имени при служебной
обрезке внешнего command output. Парсер не обрезает и не нормализует сами имена;
принимаются только полные пары `A`/`D`/`M`/`T` и непустой путь. Неизвестный status,
rename/copy record или повреждённое NUL-разделение блокируют проверку. Пустой
список допустим только при пустом output. Перенос product source в разрешённый
delivery-путь не может скрыть удалённый исходный путь. Копирование в чужой product path, изменение типа,
режима и удаление также остаются видимыми. Изменение любого другого файла,
включая продукт, lockfile, Dockerfile, миграцию или Compose, отклоняется.
Это закрытая декларация; будущие product, lazy-context или collector changes требуют
отдельного review и новой квалификации.

Принятый collector исправляет проверку отсутствующего descriptor и запрещает
создавать новую доверенную квитанцию из неподтверждённого cold-gap содержимого.
Он не меняет схему diagnostic history, ключ, retention или бюджеты. Source pin
не доказывает восстановление действующей истории: согласованный защищённый
снимок, native Windows evidence и полный успешный audit остаются отдельными
операционными условиями.

Принятый lazy work-context меняет только момент необязательного чтения полной
canonical projection. Для personal/not-learning и immutable origin общий
supplier не вызывается; no-origin modern и historical Course/Direct сохраняют
одно обязательное canonical чтение после viewer-scoped provenance proof.
Все десять SQL literals двух runtime-файлов, `submit`, типы ответа и работа с
сохранёнными проектами остаются прежними. Новых data writes, migrations или
persisted formats этот diff не вводит; canonical resolver и его SQL не меняются.
Default action clock после обязательного lazy чтения обновляется, explicit
`asOf` и подготовленная Map сохраняют свою семантику. Это узкая read-path
совместимость, подтверждённая source review, а не доказательство отсутствия
перегрузки pool: native old-reader/new-data proof и повторный N30 остаются
отдельными проверками.

Квалификация привязана к **точному tools SHA и точному selected deployment
digest**. Результат прежних tools или прогона закреплённого `d0bf` не
квалифицирует новый combined release. Capsule с policy v1 или v2 не переопределяется
как v3 и отклоняется до переключения; для уже начатой операции сохраняется
именно тот утверждённый внешний tools checkout, который её подготовил.

При сравнении исходных `98d7 → d0bf` API-изменения затрагивают дополнительные
поля агрегатов клиентской диагностики; код бизнес-сохранения проектов,
миграции, зависимости, Compose и MinIO Dockerfile не менялись. Данные
диагностики остаются в исходных volumes. Старый интерфейс может не отображать
добавленные диагностические поля. Равенство одной версии схемы не является
доказательством совместимости произвольной пары релизов.

Исходная граница проверяется по
[canonical compare `98d7…d0bf`](https://github.com/spikeal8-maker/asa-lab/compare/98d7fbb42ae9e53113cb45ada4b4301334de9c27...d0bf7cbeb129ff991272f006fc379ee004cb00f8).

## Что проверяется до остановки приложения

| Проверка                 | Защита                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release и CI             | Оба manifests проходят штатный `assert_ci`: точные publication run/attempt, General SHA и реально завершившиеся обязательные jobs.                                                  |
| Product/source           | Только объявленная пара, canonical origin, clean Git, допустимая main ancestry, одинаковые migration tree, migration runner, MinIO Dockerfile и используемые tracked Compose files. |
| Actual images            | Полный immutable reference, Docker image ID, Linux amd64 и revision label каждого приложения; фиксированные образы предыдущей версии.                                               |
| Object runtime           | Реальные SHA-256 `/usr/local/bin/minio` и `/usr/local/bin/mc` отдельно из обоих закреплённых images. Вспомогательный процесс без сети, mounts, credentials и privileges.            |
| Private configuration    | SHA-256 точных `.env` и Compose/overlay bytes, semantic fingerprint installation settings и resolved Compose. Различаться могут только объявленные image/revision substitutions.    |
| State access             | Native owner/ACL или POSIX mode attestation. Public source допускает чужое чтение, но не запись; `.asa` и capsule требуют private access.                                           |
| Persistent identity      | Тот же PostgreSQL container ID, reference и actual image ID; те же имена и Docker metadata всех volumes, включая application diagnostics.                                           |
| Migration history        | Полная версия/checksum history из текущей БД и штатный `tools/migrate.mjs --plan` в read-only transaction. При возврате migration container не запускается.                         |
| Backup                   | Новый канонический полный backup, повторная проверка inventory/hashes, runtime/instance configuration/images lineage, возраст не больше шести часов в момент подготовки switch.     |
| Tooling                  | Clean canonical checkout отдельно от installation, точный Git SHA и fingerprint полного manager/deployment tooling, host и Python family.                                           |
| Production qualification | Успешный exact-tools-SHA native workflow с тем же selected deployment digest, Windows/Linux contracts и фактически выполненным Linux native job.                                    |
| Updates                  | `automaticUpdates` уже строго `false`; возврат не включает расписание.                                                                                                              |

Фиксированные бинарные identities MinIO:

| Бинарный файл | SHA-256                                                            |
| ------------- | ------------------------------------------------------------------ |
| `minio`       | `fa42dfb43019e71731c10d70cc24057f6af63f22d76c4722614056514739fc97` |
| `mc`          | `9a9e7d32c175f2804d6880d5ad3623097ea439f0e0304aa6039874d0f0c493d8` |

Это hashes из существующего pinned Dockerfile; перед допуском операции они
обязательно сверяются с **фактическими байтами обоих OCI images**. Один текст
Dockerfile проверку не заменяет. Повторная проверка возврата использует уже
скачанные immutable images, сохранённые CI identities и локальную source history.
Доступность GitHub в момент аварийного возврата не требуется.

Проверка с `--require-application-rollback` может скачать отсутствующие image
layers и выполнить изолированные binary/readonly-plan probes. Она не сохраняет
разрешение на будущий switch. Перед реальным switch identity проверяется снова,
создаётся свежий полный backup и durable capsule. Изменение настроек коллектора
или private environment между проверками приводит к отказу до switch.

Live Compose bytes сравниваются строго. Только сравнение текстовой recovery-копии
в каноническом backup допускает замену CRLF на LF: существующий Windows backup
writer использует native newline. Любое иное изменение текста отклоняется,
а raw hashes всего backup inventory остаются обязательными.

### Права source и приватность capsule

На Windows `mkdir(mode=0700)` и `mkstemp` сами по себе не доказывают приватный
DACL. Guard читает owner и все inherited/explicit ACE через native `Get-Acl`
с SID, без зависимости от языка Windows, и ничего в существующей установке
не меняет.

- Canonical root, `.git`, `.env`, используемые Compose/overlays, внешний tools
  checkout и его manager/deployment inputs: owner — текущий operator, SYSTEM
  либо Administrators. Чужой Read/ReadExecute допустим; Allow Write/Modify,
  Delete/DeleteChild, изменение DACL или owner запрещены. Проверка существующих
  linked metadata/lock files также запрещает чужую запись.
- `.asa` и `application-rollback.json`: Allow access только текущему operator,
  SYSTEM (`S-1-5-18`) и Administrators (`S-1-5-32-544`). `CREATOR_OWNER` допустим
  только как inherit-only правило, не предоставляющее доступ постороннему
  пользователю. Широкие inherited ReadExecute для capsule также отклоняются.
- POSIX: доверенный owner, отсутствие group/other write для source и inputs;
  `.asa` имеет `0700`, capsule — `0600`. При уже привилегированном запуске
  подтверждённый `SUDO_USER` учитывается как исходный operator.

Практическая подготовка Windows — убрать у других локальных пользователей write
доступ к canonical source/inputs и обеспечить private inheritable DACL `.asa`
и capsule. Существующие explicit ACE тоже проверяются. Если F: передаёт
`Authenticated Users: Modify`, операция блокируется до отдельной операторской
подготовки. Защита backup directory не заменяет эту защиту state. Manager не
выполняет `Set-Acl`, `icacls`, `chmod` или `chown` существующего root.
Проверенный backup directory и его `private.env` также должны иметь private
access; это проверяется отдельно от content hashes.

Native qualification driver защищает только свой **новый** disposable root до
появления `.env`/`.asa`: current operator, SYSTEM и Administrators FullControl
с наследованием. Внешний существующий tools checkout он не перенастраивает.
Native Windows path proof проверяет фактический DACL этой новой test directory,
atomic replacement и передачу path with spaces в отдельный Python process.

## Штатный внешний tools bootstrap

Используется уже существующий контракт `PORTABLE_OPERATIONS.md`: code/imports
принадлежат отдельно утверждённому tools checkout, а `--root` указывает ровно
одну существующую установку. Оба каталога должны быть физически независимы,
без вложения друг в друга. Внешний checkout остаётся на квалифицированном SHA
после того, как source установки возвращается на старую версию без новой CLI.

Для production/staging tools SHA должен иметь успешный General CI, а workflow
`ASA P0 Application Return` должен быть вручную запущен на этом принятом main
SHA с нужным `selected_deployment_digest` и завершиться успешно. Заголовок run
`P0 return sha256:…` связывает evidence с выбранным digest. Более поздний
неуспешный запуск той же пары не заменяется старым успешным evidence.

Сам native workflow создаёт отдельный **dev fixture** и проверяет General,
официальные releases и все runtime/data guards. Для этого fixture не требуется
успех того же ещё выполняющегося native run. Production/staging всегда требуют
его завершённый результат. Флагов отключения production-проверки нет; выбор
другого profile существующей установки отклоняют её Compose identity guards.

Из корня утверждённого внешнего tools checkout на Windows:

```powershell
$installationRoot = (Read-Host 'Полный путь существующей canonical ASA установки').Trim()
$managerPath = Join-Path (Get-Location) 'tools\asa_manager.py'
$deploymentDigest = 'sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68'
py -3.11 $managerPath check --root $installationRoot --profile production --deployment-digest $deploymentDigest --require-application-rollback
if ($LASTEXITCODE -ne 0) { throw 'P0 return preflight blocked' }
py -3.11 $managerPath update --root $installationRoot --profile production --deployment-digest $deploymentDigest --require-application-rollback
if ($LASTEXITCODE -ne 0) { throw 'Inspect the reported stage; preserve the pinned external tools and all state' }
```

`RETRY_NEW_MANAGER` сохраняет прежнее поведение штатного source switch: повторяется
та же команда внешнего tools checkout с тем же digest. До создания capsule
контейнеры продолжают прежний runtime. Не переключайте внешний tools checkout
вместе с каталогом установки и не копируйте отдельный Python-файл в старую версию.

Явный возврат после успешного update либо после прерванного switch:

```powershell
$installationRoot = (Read-Host 'Полный путь той же canonical ASA установки').Trim()
$managerPath = Join-Path (Get-Location) 'tools\asa_manager.py'
py -3.11 $managerPath rollback-plan --root $installationRoot --profile production
if ($LASTEXITCODE -ne 0) { throw 'Return eligibility blocked; preserve markers and data' }
py -3.11 $managerPath rollback --root $installationRoot --profile production
if ($LASTEXITCODE -ne 0) { throw 'Return incomplete; inspect the named phase and repeat only after resolving its cause' }
```

Linux/macOS используют тот же Python entry point и те же аргументы. Для запуска
нужны уже существующие полномочия Docker operator; manager не выполняет sudo,
не меняет host services и не регистрирует новый diagnostic runner в данном режиме.

## Транзакция и восстановление после остановки процесса

После канонического backup перед первой остановкой приложения записывается
`.asa/application-rollback.json`. Immutable eligibility fingerprint и UUID
связывают capsule с `maintenance.json`, `failed-switch.json` и последней
operation receipt. Capsule содержит обе exact releases, data/config/tooling/CI
identities и backup reference. Последовательность durable phases имеет hash chain.
Пока новый outcome не завершён, прежняя корректная operation receipt сохраняется
побайтно: её штатный operational reader не получает неизвестный pending status.
Прерванный switch связывается через собственный maintenance marker, capsule и
точный `previousReceiptSha256`; чужая или более новая receipt не принимается.
Записи публикуются через private temporary file, file fsync и atomic replace;
POSIX дополнительно синхронизирует каталог.

| Этап                                  | Действие                                                                                                              |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `prepared`                            | Проверены identity и backup; durable capsule создан до service switch.                                                |
| `forward_stop/support/api/web/verify` | Только объявленные приложения; исходный PostgreSQL сохраняется. API должен стать ready до запуска Web.                |
| `forward_accepted`                    | Выбранный runtime и HTTP entry проверены; receipt связана с capsule.                                                  |
| `rollback_stop/source`                | Остановлены writers, source возвращён строго к сохранённой предыдущей версии. Внешний executable продолжает работать. |
| `rollback_support/api/web/verify`     | Старые pinned MinIO/search/Scratch, затем ready API, затем Web; те же volumes, env и DB.                              |
| `rolled_back`                         | Прежний manifest и успешная return receipt сохранены; только собственные связанные markers перенесены в history.      |

Каждое действие имеет предварительно сохранённую фазу. После прерывания `rollback`
заново проверяет допустимую смесь предыдущих/выбранных images, immutable identity
и связанную последнюю операцию; затем повторяет идемпотентные application steps.
Отсутствующий во время recreation app container допустим, исходный работающий
PostgreSQL обязателен. Непредвиденные image, volume, config, history, tooling,
receipt или foreign marker блокируют дальнейшее действие.
Для `rolled_back` действует более строгая terminal postcondition: exact previous
HEAD, installed manifest и все пять running image references/IDs. Чистый Git
checkout другой стороны пары или одиночный MinIO drift не считаются выполненным
возвратом; повторная команда блокируется без ложного `ALREADY_COMPLETE`.

Узкое окно между записью `prepared` и записью maintenance marker ещё не содержит
service mutation. Если процесс завершился в этом окне, повторный `update` может
повторно проверить и подготовить операцию; несвязанная capsule сама по себе не
разрешает `rollback`. После появления linked switch state новые update и
`acknowledge` не могут отбросить незавершённую транзакцию.

Возврат не выполняет `pg_restore`, SQL rollback, database rename, migration apply,
object restore, volume deletion, image build или выбор `stable`. Поддерживающие
образы запускаются с `--no-deps --no-build --pull never`; PostgreSQL и init jobs
не пересоздаются. Новые пользовательские записи после update остаются в текущей
БД и object store. Backup — проверенный recovery asset, он не накатывается поверх
новых записей. Старые capsules и связанные markers сохраняются в
`.asa/application-rollback-history`.

`rollback-plan` выполняет только чтение installation state и изолированные image
probes. Сам `rollback` использует штатный exclusive `operation_lock`. Обычный
`repair-plan` может честно отказать на новой специальной фазе; для неё существует
`rollback-plan`, а ручное удаление markers не является восстановлением.

## Native-квалификация Linux и Windows

`ci_application_rollback.py` принимает только **отсутствующий абсолютный** каталог
fixture. Он создаёт уникальный project `asa-p0-return-*`, использует текущий
проверенный Python manager, прежние официальные images и отдельные loopback
ports. Fresh fixture bootstrap переиспользует существующие helpers
`first_environment`, `save_settings` и канонический Compose. Только создание
этой пустой тестовой БД выполняет migrations/seeding.

Прогон проверяет:

1. Реальный login, acknowledged Electronics draft и S3 object на прежней версии.
2. Штатный `check` и `update --require-application-rollback` на официальный target.
3. Новый проект и новый S3 object, записанные **после** update.
4. Полный backup и `restore-check` в новую, ранее отсутствующую `*_test` БД.
5. Возврат и чтение обоих проектов/objects прежним API и MinIO с точными revision/content hashes.
6. Реальное завершение process tree во время `forward_api` после наблюдения нового API, затем завершение во время `rollback_api` после наблюдения старых source/API.
7. Повторный внешний CLI, чтение всех новых записей, тот же PostgreSQL container, unchanged env и `automaticUpdates=false`.

В продукте нет fault hook или переменной окружения, обходящей проверку. Driver
наблюдает реальную durable phase и actual container identity; пропущенное окно
interruption означает failed proof. При observer failure или timeout он сначала
останавливает только своё process tree, чтобы не оставить manager одновременно
с cleanup. Docker cleanup касается только созданного этим прогоном synthetic
project и проверяет owner nonce/root/project/env перед `down --volumes`.

Windows file/argument proof без Docker:

```powershell
py -3.11 tools/deployment/ci_application_rollback.py --path-proof
```

Actual Windows Docker Desktop proof после review и проверки ресурсов.
Следующая команда явно проверяет исходный закреплённый `d0bf` digest; она не
является доказательством для будущего combined release. Для combined target
требуется отдельный прогон с его фактическим digest из официального manifest:

```powershell
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('asa-p0-return-' + [guid]::NewGuid().ToString('N'))
$evidenceRoot = Join-Path ([IO.Path]::GetTempPath()) ('asa-p0-return-evidence-' + [guid]::NewGuid().ToString('N'))
py -3.11 tools/deployment/ci_application_rollback.py --work-directory $fixtureRoot --output $evidenceRoot --selected-deployment-digest sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68
if ($LASTEXITCODE -ne 0) { throw 'Windows Docker return qualification failed; production remains unchanged' }
Get-Content (Join-Path $evidenceRoot 'qualification.json')
```

Linux native job вызывается только вручную на принятом main после successful
General CI. PR/push jobs проверяют unit contracts на Linux и Windows, но не
объявляют Docker proof. Windows hosted unit runner не заменяет Windows Docker
Desktop. Ожидаемая длительность actual proof — примерно 15–35 минут с cached
images; pull, backup и startup могут увеличить её. Workflow имеет предел
75 минут; каждый manager command — 30 минут. Оценка длительности не является
результатом проведённого прогона.

В `qualification.json` сохраняются точные source/release/image/binary/tooling/CI
identities, обе interrupted phases, API/S3 readbacks и backup linkage. Выгрузка
содержит только synthetic evidence; `.env`, backup archive, credentials и
пользовательские данные в artifact не включаются. Browser acceptance владельца,
Windows power-loss и полная совместимость всех UI sessions этим прогоном не
заявляются. Старый браузерный tab после смены release может требовать reload.
