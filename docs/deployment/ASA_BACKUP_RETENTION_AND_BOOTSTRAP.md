# ASA Lab — резервное копирование, локальная очистка и установка с нуля

**Область:** существующий **тестовый** Linux/1Panel/Docker-сервер
(test.asa-lab.ru). Удаление школьных/production данных, Docker volumes,
PostgreSQL databases, Yandex remote snapshots и чужих файлов **не выполняется**.

Инструмент: [tools/asa_backup_retention.py](../../tools/asa_backup_retention.py).
Применять после успешного развёртывания и создания **новой полной проверенной**
копии действующей версии.

## 1. Почему нельзя просто удалить все backups

Пока source-update / restore / migration работает, предыдущие копии могут
оставаться единственным корректным recovery set. Ошибка в исходниках, UID
MinIO, healthcheck или переключении PostgreSQL может потребовать восстановления.

Минимальный безопасный остаток: **один** полный проверенный актуальный
snapshot PostgreSQL + MinIO + private.env + manifest на локальном диске и
желательно независимый **зашифрованный** off-site архив на Яндекс Диске.
Остальные распознанные старые локальные полные экспорты можно удалить
после предъявления и проверки списка.

### Что именно удаляет скрипт

Только завершённые папки с именем формата YYYYMMDDTHHMMSSZ-xxxxxxxx в
каноническом пути /srv/asa-lab/backups. Их manifest обязан иметь
format=asa-backup-v1, complete=true, совпадающий project/profile.
Самый новый полный snapshot *текущих* Git SHA и PostgreSQL schema сохраняется.

**Не удаляет:** Docker volumes PostgreSQL/MinIO и откатов, отдельные SQL
databases, приватные receipts и test-refresh job dumps, Git worktrees,
Docker images, архивы Яндекс Диска и локальный incoming, папки incomplete,
symlink/mountpoint и чужие каталоги. Для этих источников дискового расхода
нужны отдельные inventory и политики. Массовый Docker volume prune запрещён.

## 2. Подготовка перед удалением

1. Убедиться, что 1Panel MCP operation имеет terminal SUCCESS. При
   running/BUSY повторные операции запрещены.
2. Проверить установленный source SHA, Docker image IDs и schemas, основные
   HTTP/HTTPS и пользовательские сценарии, отдельно отмечая NOT_RUN.
3. Создать **новый** согласованный полный snapshot и проверить его:

~~~bash
cd /srv/asa-lab
sudo python3 tools/asa_manager.py backup --root /srv/asa-lab --profile production
sudo python3 tools/asa_manager.py verify-backup \
  --root /srv/asa-lab --profile production \
  --backup /srv/asa-lab/backups/SNAPSHOT
~~~

Если опубликованный release manager возвращает IDENTITY_FILES после
source-only сборки, **остановить очистку**. Не обходить проверку
копированием живого PostgreSQL volume и не объявлять невалидный экспорт
полным backup. Нужна reconciliation процедуры/backup adapter.
4. Сверить manifest.runtime.revision/schema с текущими значениями в .env
   ASA_BUILD_REVISION / ASA_EXPECTED_SCHEMA_VERSION.
5. Желательно подтвердить наличие зашифрованной off-site копии отдельно.
   Скрипт не подключается к облаку.

## 3. Ручной запуск на Linux

Предварительный просмотр, **без удаления**:

~~~bash
sudo python3 tools/asa_backup_retention.py plan \
  --root /srv/asa-lab --origin https://test.asa-lab.ru
~~~

План возвращает retain, candidates, ignored,
estimated_reclaim_bytes и plan_sha256.

После изучения списка подставить точное имя RETAIN_SNAPSHOT и значение
PLAN_SHA256 **из последнего плана**:

~~~bash
sudo python3 tools/asa_backup_retention.py prune \
  --root /srv/asa-lab --origin https://test.asa-lab.ru \
  --retain RETAIN_SNAPSHOT --plan-sha256 PLAN_SHA256 --ack-prune
~~~

Перед удалением заново проверяются:
- отсутствие активного source-update (тот же flock удерживается **всё
  время удаления**) и markers maintenance/failed-switch;
- полнота и SHA256 каждого файла retained backup через canonical
  verify_backup, совпадение проекта, ревизии и схемы;
- идентичность preview digest и текущего состава/размера кандидатов;
- отсутствие symlinks, mountpoints, нестандартных имен или special files;
- совпадение точного тестового origin и его существующей конфигурации.

До первого удаления создаётся закрытый audit receipt в .asa/backup-prune.
После каждого удаления обновляется список конкретных имён и освобождённого
размера. При частичном завершении нужен новый план и сверка receipt;
повторять удаление вслепую нельзя.

## 4. Управление через MCP 1Panel

Тот же CLI запускается через asa_admin_execute с уникальным
idempotency_key, а выполнение отслеживается через неизменный operation_id
и asa_operation_get. MCP не должен создавать отдельную копию логики очистки.

Если другой server worker владеет установкой и MCP возвращает BUSY,
**не запускать обходное удаление**. Read-only progress/log-tail должен
работать независимо от root writer lock (отдельная доработка MCP).

## 5. Новая установка с чистого сервера — существующий маршрут

В ASA Lab уже имеется один portable installer:
[tools/asa_manager.py](../../tools/asa_manager.py).
Не создавать второй Compose project рядом с установленным ASA Lab.

Для поддерживаемого Linux amd64 с Docker Engine, Compose v2, Git,
Python 3.11+ и зафиксированным ingress:

~~~bash
git clone https://github.com/spikeal8-maker/asa-lab.git
cd asa-lab
python3 tools/asa_manager.py install --profile production
~~~

Установка использует уже опубликованный проверенный pinned OCI release,
создаёт новый приватный .env **однократно**. Не переносить его на уже
существующую установку и не поворачивать ключи при обновлении.

Обычное использование после fresh install:

~~~bash
python3 tools/asa_manager.py doctor --profile production
python3 tools/asa_manager.py check --profile production
python3 tools/asa_manager.py update --profile production
~~~

Для настоящего восстановления полного архива Яндекс Диска **на новый пустой
сервер** требуется отдельная initial restore операция: canonical
asa_manager.py сейчас поддерживает только restore-check в новой базе *_test,
но не универсальную замену данных на живой системе.

Initial restore (отдельный ограниченный PR) должен:
- проверить зашифрованный .age архив, age identity и манифест;
- зафиксировать совместимые версии PostgreSQL/MinIO и целевой deployment SHA;
- восстановить original private.env и encryption keyrings, а не заменить
  их новыми ключами пустой установки;
- восстановить согласованные SQL, ACL/RLS и MinIO объекты в изоляции;
- проверить миграции и соответствие файлов PostgreSQL;
- провести TLS, auth, classroom, сохранение/повторное открытие проектов;
- только после этого переключить public ingress на новую установку.

Это **не** разрешение стирать текущие PostgreSQL/MinIO тестового сервера.

## 6. GitHub и политика места

GitHub workflow_dispatch в текущей модели тестирует код скрипта **offline**.
Он не выполняет произвольные root команды на тестовом сервере.
Для кнопок «Deploy test», «Restore from Yandex» и «Prune old backups»
требуются защищённый runner/Environment, авторизация, auditable operation
ID, MFA/роль администратора и явное предупреждение о замене данных.

Сначала отдельно измерить snapshots, rollback volumes, PostgreSQL staging
databases, Docker image cache, Git worktrees и Yandex incoming.
Каждый тип чистится собственной проверяемой политикой — не по одному
общему rm -rf или docker system prune --volumes.

**Удаление старых архивов на самом Яндекс Диске не поддерживается текущим
1Panel MCP:** asa_cloud_transfer поддерживает list/download/upload, но
не delete. Для remote retention нужен отдельный разрешённый DELETE API,
проверка off-site recovery и защита последней внешней копии.

Связанные документы:
[Portable operations](PORTABLE_OPERATIONS.md),
[Portable Standard](../architecture/PORTABLE_SELF_HOSTED_DEPLOYMENT_STANDARD.md),
[Test source-update operator](ASA_TEST_REFRESH_OPERATOR.md),
[PR #772](https://github.com/spikeal8-maker/asa-lab/pull/772).
