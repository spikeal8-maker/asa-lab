# Возврат приложения P0 с сохранением новых данных

## Отдельная квалификация школьной пары 307 → 308

Менеджер распознаёт одну школьную операцию с тремя опубликованными выпусками.
Её команды пока доступны только для изолированного Linux-проекта
`asa-lab-school308-native-<идентификатор>` с сохранённым профилем `dev`,
отключёнными автообновлениями и портами на loopback. Действующий контракт
возврата P0 для схемы 304 описан ниже.

| Назначение | Ревизия | Схема | Deployment OCI digest |
| --- | --- | --- | --- |
| Исходный | `3e8713476cafedda3e24a39665458e833efd7c22` | 307 | `sha256:7ce56323d2149ba12788b61af6d7f341ac2a8934a624074c0175be483252a4c5` |
| Целевой | `64176e85dece6a05e0ab8986fcb7fa0b1b33aa00` | 308 | `sha256:c3246502677bcda62133748d4603aa3f0e9e634536388a7b0db3f16cb065b341` |
| Резервный | `406ac609474bae731bd324e8e4fac6993bb9bc8b` | 308 | `sha256:551145bba910d7a59372ff99e927ee5c5c9536c8cdf6398a97469223a9d83854` |

Используйте принятую ревизию инструментов из отдельного Git checkout. Команды
ниже относятся к одноразовому стенду с исходным выпуском.

```sh
DIGEST=sha256:c3246502677bcda62133748d4603aa3f0e9e634536388a7b0db3f16cb065b341
python3 tools/asa_manager.py check --root "$FIXTURE" --profile dev \
  --deployment-digest "$DIGEST" --require-application-rollback
python3 tools/asa_manager.py update --root "$FIXTURE" --profile dev \
  --deployment-digest "$DIGEST" --require-application-rollback
python3 tools/asa_manager.py rollback-plan --root "$FIXTURE" --profile dev
python3 tools/asa_manager.py rollback --root "$FIXTURE" --profile dev
```

`check` сверяет манифесты и CI, загружает закреплённые образы и запускает
план миграции в режиме чтения. `update` проверяет резервную копию, записывает
приватный журнал, останавливает пишущие сервисы и выполняет одну миграцию
`0308`. Журнал появляется до смены checkout и запуска миграции. Контейнер
миграции создаётся под отдельным именем на проверенной сети PostgreSQL.
Штатный контейнер миграции остаётся на месте. Менеджер прерывает операцию,
если видит другой активный или неопознанный источник записи. Пока сохранён
журнал операции, старый менеджер отклоняет обычный update и acknowledge.

После прерывания используйте `rollback-plan`, затем `rollback`. Если контейнер
миграции ещё работает, возврат останавливается до его завершения. Менеджер
удаляет только остановленный одноразовый контейнер своей операции и повторно
считывает полный журнал PostgreSQL в транзакции только для чтения с advisory
lock мигратора. Точный журнал 307 допускает исходный
выпуск. Тот же журнал с точной записью `0308` допускает резервный выпуск 308.
Любое другое состояние блокирует возврат. Прежние PostgreSQL и тома сохраняются.
MinIO может получить новый контейнер из закреплённого образа с теми же
проверенными бинарниками и тем же томом. Снимок базы или объектов не применяется.

Для допуска школьного сервера нужны независимая проверка исходников, успешный
CI и отдельный native-прогон H03 с прерыванием и возвратом. Прогон должен
прочитать через API и S3 записи, созданные уже после перехода на 308.
Школьное обновление схемы остаётся заблокированным до принятия этих результатов
и подключения отдельной проверки допуска.

## Действующий контракт P0 для схемы 304

Статус: реализация для независимого review и последующей native-квалификации.
Наличие этого документа или зелёных unit tests не означает выполненный Docker
прогон, принятие Windows Desktop или разрешение обновить production.

## Граница совместимости

Команда `rollback` возвращает только предыдущую версию **последней связанной
операции**, заранее подготовленной через `update --require-application-rollback`.
Пользовательский SHA для возврата не принимается. Обычные `check`, `update` и
`selected_source` сохраняют проверку направления ancestry; попытка обычного
обновления `d0bf7cbe → 98d7fbb4` продолжает отклоняться.

В версии v5 декларация совместимости ограничена следующей парой:

| Свойство                            | Допустимое значение                        |
| ----------------------------------- | ------------------------------------------ |
| Предыдущий официальный release      | `98d7fbb42ae9e53113cb45ada4b4301334de9c27` |
| Продуктовая база следующего release | `d0bf7cbeb129ff991272f006fc379ee004cb00f8` |
| Исходная база delivery-расширения   | `76d0610285831a99b7801478e03418ff5800bf73` |
| Схема обеих версий                  | `304`                                      |
| OCI platform                        | `linux/amd64`                              |
| Идентификатор декларации            | `asa-p0-98d7-d0bf-application-return-v5`   |

Для точных `98d7` и `d0bf` в коде закреплены все пять официальных digest images.
Каждый другой допустимый target обязан быть официальным потомком базы `76d0610`
**и** принятого collector commit
`a8c8ff139340032f4d69cb577847b6ae47667011`. Его полный diff от продуктовой базы
может содержать только семь перечисленных в `QUALIFIED_CHANGES` delivery-файлов,
три **неизменённых относительно `76d0610`** документа базы, следующие три
collector-файла с точными Git identities и описанные ниже необязательные принятые
наборы: lazy work-context, historical SQL fixture, HTTP alerts и CI contract budget.

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `tools/collect_logs.py` | `100644 blob` | `59746e5e8d889ab819535a1ac04f40d61e1c0bb6` |
| `tools/test_collect_logs.py` | `100644 blob` | `1445bd987fc6d43dd51c5f87e5364a521e50481f` |
| `docs/deployment/ADMIN_LOGS.md` | `100644 blob` | `836bae5a70a21eafa5cbc15d7846f36b8e991dc9` |

Эти пути не являются свободным расширением allowlist: нужны все три точных
blob, обычный неизменённый mode/type и accepted commit в ancestry. Копирование
тех же байтов без принятой истории, частичный перенос, удаление, executable-bit,
symlink или дальнейшая правка любого из трёх файлов отклоняются. Delivery-only
потомок без этого collector также не является combined target v5. Точный
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

Если final diff от `d0bf` затрагивает `tools/test_database_progress.py`, target
дополнительно обязан содержать принятый fixture commit
`356cde9b68d409f8c16f7b00ff1f820057e3455b` в ancestry и следующую точную запись:

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `tools/test_database_progress.py` | `100644 blob` | `ee706f5b1ea361d12b0f2aadc081070da34a0f53` |

Это разрешение на одну принятую identity, а не на произвольные test-файлы.
Копирование тех же bytes без принятой ancestry, удаление, executable-bit,
symlink, gitlink, замена каталогом или дальнейшая правка отклоняются. Collector
и lazy pins проверяются независимо. Полный API revert сохраняет эту отдельную
проверку fixture, если её diff присутствует. При отсутствии fixture diff прежние
допустимые состояния остаются допустимыми; возврат файла к точным исходным bytes
не доказывает применение исправления или успешность actual SQL AFTER.

Закреплённая fixture выбирает девять исторических источников без признака
`operational` для создания тестовых SQL-строк, независимого identity oracle и
проверки завершённого history. Два оперативных AI-журнала остаются в отдельном
существующем тесте. Все двадцать assertions, SQL, timeout/retry/restart, ties,
лимиты 2 строки / 4096 байт, переход 81 → 82, immutable history и privacy
сохранены; фактически собранные events не фильтруются. Product collector,
database contract и CI workflow этот fixture diff не меняет. Source review
не заменяет actual SQL AFTER в существующем изолированном CI итогового SHA.

Если final diff от `d0bf` затрагивает любой из пяти HTTP alerts путей, target
дополнительно обязан содержать принятый commit
`5836109e95d1d48f0950ab0c7b027a6ec493a214` в ancestry и все пять точных записей:

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `apps/api/src/app.factory.spec.ts` | `100644 blob` | `16cc0bf18ade39b2e3367151076f7703c8e35529` |
| `apps/api/src/app.factory.ts` | `100644 blob` | `4239f8490c537e3a6404e2ae0b8fd4bc0931d74a` |
| `docs/deployment/HTTP_RUNTIME_ALERTS.md` | `100644 blob` | `7dca192cb142c58fe360c020d377d6d235493aef` |
| `packages/observability/src/runtime-metrics.spec.ts` | `100644 blob` | `16722814877d083ef199a992be7534bf01d8effb` |
| `packages/observability/src/runtime-metrics.ts` | `100644 blob` | `84d8db19f4554d992d6a42c9be563ccfd43fba11` |

Эти пять путей не входят в свободный `QUALIFIED_CHANGES`. Копирование точных
bytes без принятой ancestry, частичный перенос или revert, удаление, правка,
rename, executable-bit, symlink, gitlink и замена каталогом отклоняются.
Обязательные collector pins, условные lazy и SQL fixture pins, schema `304`,
неизменность Compose, migrations и зависимостей проверяются независимо.

Полный возврат **всех пяти** путей к исходному tree `d0bf`, включая отсутствие
добавленных файлов, убирает HTTP alerts diff и сохраняет прежнюю совместимость
без HTTP alerts. Это не принятие функции: итоговый release с HTTP alerts должен
отдельно подтверждать все пять точных blobs и ancestry `5836109`. Частичный
revert при сохранённом diff любого из пяти путей запрещён.

Проверка старого reader `98d7` на синтетических событиях не доказывает native
Docker update/return или восстановление мониторинга действующей установки.
Для итоговой пары по-прежнему нужны точные tools SHA, selected deployment
digest и все штатные CI/native gates; source pins их не заменяют.

Если final diff от `d0bf` затрагивает любой из двух CI contract budget путей,
target дополнительно обязан содержать commit
`0d27486879f4fcd767a239613005e5afc47ff2fc` в ancestry и обе точные записи:

| Путь | Git mode/type | Принятый Git blob |
| --- | --- | --- |
| `.github/workflows/portable-delivery.yml` | `100644 blob` | `fe21af3e7f8e21cf1b93fb1fd1aa2dbb4d9dedbc` |
| `.github/workflows/portable-restore.yml` | `100644 blob` | `fb8582c2789f334fe58797e2a98ef02d81408f9a` |

Этот отдельный пакет меняет только `contracts.timeout-minutes` с 10 на 15
в обоих workflows. Команда, полная матрица и все assertions сохраняются;
Job `postgres` в Portable Restore остаётся с прежним лимитом 10 минут. Разрешение условное:
оба файла вместе с принятой ancestry, без копирования, частичного переноса,
частичного revert, последующего drift или изменения mode/type/path. Они также
не добавлены в `QUALIFIED_CHANGES`; разрешения на другие workflow changes нет.
Полный возврат обоих файлов к `d0bf` сохраняет исходную совместимость без
увеличенного бюджета. Это не свидетельство успешного CI: timeout, cancellation,
skip и pending не заменяются на PASS, а source pin не отменяет обязательные jobs.

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
Это закрытая декларация; будущие product, lazy-context, collector, historical
SQL fixture, HTTP alerts или CI contract budget changes требуют отдельного review
и новой квалификации.

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
квалифицирует новый combined release. Capsule с policy v1, v2, v3 или v4 не переопределяется
как v5 и отклоняется до переключения; для уже начатой операции сохраняется
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
- Точный `OWNER_RIGHTS` (`S-1-3-4`) в ACE означает владельца именно этого объекта
  и оценивается как его SID только после проверки фактического owner. Это
  учитывает приватные Windows ACL дочерних каталогов и атомарных файлов;
  `S-1-3-4` не становится допустимым значением самого owner. Владелец каждого
  дочернего объекта проверяется отдельно, а остальные чужие Allow grants
  сохраняют прежние ограничения.
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
fixture. Он создаёт уникальный project `asa-lab-p0-return-<12 hex>`, соответствующий
контракту fresh install `asa-lab-*`, использует текущий
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
наблюдает реальную durable phase. Пока manager работает, observer выполняет
один `docker ps --no-trunc` с `status=running` и точными фильтрами project/API
service. Он читает только полный container ID, image, state и эти две метки.
В предварительном наблюдении участвуют только running API: штатное окно
пересоздания с прежним exited и новым created контейнером продолжает polling,
пока не появится ожидаемый running API. Прежний running image также продолжает
прежний polling в пределах 30 минут. Два running API, malformed records и
неизвестные Docker errors завершают proof ошибкой; общий `COMMAND` не превращается
в retry. Inspect контейнеров и чтение их private environment в этой фазе не
выполняются.

При появлении ожидаемого API driver повторно сравнивает operation ID, phase и
eligibility с наблюдавшимся журналом, затем завершает только собственный
`Popen` process tree. Уже завершившийся manager, нулевой exit или пропущенное
окно interruption означают failed proof. На POSIX дополнительно требуется
именно `returncode == -signal.SIGKILL`: успешная отправка сигнала при последующем
обычном exit или другом signal exit не доказывает прерывание. В Windows
сохраняются успешный `taskkill /PID /T /F`, ожидание процесса и ненулевой exit;
actual Windows native proof остаётся отдельной проверкой. После остановки создаётся свежий
`Installation`: полный штатный `application_rollback.inspect()` заново проверяет
journal/source/tooling, immutable images, PostgreSQL/schema, volumes, private
environment и backup binding; затем выполняется канонический `identity()`.
Полный API ID обязан совпасть с наблюдённым до остановки, image — с pinned
release, API должен работать, а PostgreSQL container — совпасть с original ID
из eligibility binding. Source должен совпасть с ожидаемым release SHA, журнал
не должен измениться. Исчезновение или замена API после остановки и любой drift
отклоняются без retry. Только после этих проверок сохраняются interruption
evidence, полный API ID и ненулевой manager exit code; private environment
остаётся внутри существующего валидатора и в evidence не попадает.

При observer failure или timeout `finally` останавливает только своё process
tree, чтобы не оставить manager одновременно с cleanup. При запуске без
`--keep-fixture` Docker cleanup касается только
созданного этим прогоном synthetic project и проверяет точный формат его имени,
owner nonce/root/project/env перед `down --volumes`. Имена production и прежний
несовместимый prefix `asa-p0-return-` не проходят проверку владения для cleanup.

Штатный Linux native workflow и приведённая ниже Windows-команда используют
`--keep-fixture`: driver сохраняет созданный stack и его volumes для проверки
и не вызывает `down --volumes`. Проверки владения и cleanup остаются покрыты
контрактными тестами. На GitHub-hosted runner сохранённый fixture доступен лишь
до завершения жизненного цикла runner; после job доступен только загруженный
artifact с synthetic evidence в пределах срока хранения workflow.

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
py -3.11 tools/deployment/ci_application_rollback.py --work-directory $fixtureRoot --output $evidenceRoot --selected-deployment-digest sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68 --keep-fixture
if ($LASTEXITCODE -ne 0) { throw 'Windows Docker return qualification failed; production remains unchanged' }
Get-Content (Join-Path $evidenceRoot 'qualification.json')
```

Если Windows Docker Desktop отказывает с `all predefined address pools have
been fully subnetted`, новый fixture может явно передать
`--install-network-cidrs`. Значение содержит ровно три CIDR через запятую в
порядке **database, application, scratch-runtime**. Без флага driver сохраняет
прежний путь с автоматическим выбором Docker subnets.

Driver вызывает штатный `provision_private_network_overlay` после успешного
`assert_clean_install_destination` и до `first_environment`. Helper проверяет
канонические private `10.x` IPv4 CIDR `/24`–`/28`, их взаимные пересечения,
текущие Docker subnets и Windows routes непосредственно в этой операции.
При отказе `.env` не создаётся и `compose up` не вызывается. Принятый overlay
`.asa/docker-networks.yaml` входит в обычную identity `Installation`.

Перед запуском заново проверь Docker networks и маршруты Windows, WSL и VPN.
Тройка ниже — наблюдавшийся свободный кандидат D2-R2 на 2026-11-07, а не
резервирование или универсальный default; повторная проверка helper обязательна.
Используй новый **отсутствующий абсолютный** каталог, сохрани прежний failed
fixture и передай `--keep-fixture`. Изменение Docker daemon/address pools,
Windows/VPN routes или удаление существующих сетей для этого не требуется.

```powershell
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('asa-p0-return-' + [guid]::NewGuid().ToString('N'))
$evidenceRoot = Join-Path ([IO.Path]::GetTempPath()) ('asa-p0-return-evidence-' + [guid]::NewGuid().ToString('N'))
$fixtureCidrs = '10.252.7.0/27,10.252.7.32/27,10.252.7.64/27'
py -3.11 tools/deployment/ci_application_rollback.py --work-directory $fixtureRoot --output $evidenceRoot --selected-deployment-digest sha256:87acd65905c3cb64c1052ea046926932b1a5e9f42dc52d8b36c05db9f449da68 --install-network-cidrs $fixtureCidrs --keep-fixture
if ($LASTEXITCODE -ne 0) { throw 'Windows Docker return qualification failed; retain both fixtures for inspection' }
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
