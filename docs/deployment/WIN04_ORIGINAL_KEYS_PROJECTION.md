# WIN-04B2A — безопасная проекция исходной приватной конфигурации

Этап необходим для переноса ASA Lab без потери ключей, пользовательских
сессий, Student Code и доступов PostgreSQL/MinIO.

**Режим строго read-only:** содержимое исходного `private.env` остаётся
в памяти, новой конфигурации на диске не создаётся. При первой ошибке
проверка прекращается, реальные контейнеры и тома не изменяются.

## Команда

Из доверенного исходника ASA Lab, используя полный проверенный архив:

```powershell
python tools/asa_manager.py import-private-plan --backup "D:\ASA-Archive\complete-backup" --install-project asa-lab-new-transfer --install-web-port 28780 --install-blocks-port 28783
```

Пути, проект и порты являются примером. Команда никогда не выводит
содержимое исходных ключей, пароли PostgreSQL/S3, строки соединения,
ключи Student Code или подписания Scratch. В консоли — только
`IMPORT_PRIVATE_PLAN` со статусом `PRIVATE_ENV_PROJECTION_ONLY`,
счётчиками полей, новым именем проекта и номерами портов.

## Гарантии

- Сначала выполняется WIN-04A: проверка полного исходного SHA-256
  инвентаря PostgreSQL/MinIO/config/secret и режима production/staging.
- Дополнительно проверяется тот же `private.env` по сырым байтам и
  значению SHA-256 из манифеста — после контрольной проверки архива.
- Подтверждаются исходная PostgreSQL БД, пользователи, пароль и
  фактические `MIGRATION_DATABASE_URL`, `APP_DATABASE_URL`,
  `MIGRATION_EXPECT_DATABASE`, `MIGRATION_CONFIRM`.
- Подтверждаются исходные, согласованные Web/API/Scratch порты и три
  локальных origin. Непредусмотренные ссылки на старый origin блокируют.
- Проверяются отсутствие повторных имён в `private.env` и валидность
  JSON ключей Student Code посредством WIN-04A.
- **Все** исходные секреты и connection strings остаются неизменными.
  В памяти меняются только 7 транспортных параметров:
  `COMPOSE_PROJECT_NAME`, `ASA_WEB_PORT`, `ASA_API_PORT`,
  `ASA_BLOCKS_PORT`, `ASA_BLOCKS_PARENT_ORIGIN`,
  `ASA_BLOCKS_RUNTIME_ORIGIN`, `ASA_UPDATE_ENTRY_ORIGIN`.
- Не создаются новые `ASA_SETTINGS_ENCRYPTION_KEY`,
  `ASA_BLOCKS_RUNTIME_SIGNING_KEY`,
  `ASA_OBJECT_STORAGE_ACCESS_KEY/SECRET_KEY` или ключи Student Code.
- Отчёт обязательно содержит `secretsWritten=false`,
  `targetProvisioned=false`, `databaseRestored=false`,
  `minioRestored=false`, `publisherSignatureVerified=false`
  и `writesPerformed=false`.

## Необходимые следующие этапы

WIN-04B2B может записать приватную конфигурацию в новый проект **только**
после повторной проверки официального target Git checkout, Docker names,
volume IDs, портов, источника и подтверждения владельца. Не следует
автоматически удалять другие тома, переписывать существующий `.env`
или выполнять генерацию ключей поверх исходных.

WIN-04B2C отдельно восстанавливает PostgreSQL и MinIO в новые тома,
подтверждает ACL/RLS, роли, данные, Student Code, объекты через S3,
сохранённые проекты Scratch/3D и стабильность всех соседних проектов.

Подписанный манифест издателя исходного архива пока отсутствует.
Внутренний SHA-256 архивного инвентаря нельзя считать доказательством
независимой идентичности издателя.

## Тестирование

`test_import_env_projection.py` содержит только вымышленные пароли и ключи
и использует `tempfile.TemporaryDirectory`; не обращается к реальному
`private.env` D2R2. В отдельной изолированной Python-песочнице проверен
первоначальный алгоритм на синтетических данных. Это **не** заменяет CI
текущей точной версии модуля или пользовательскую приёмку.
