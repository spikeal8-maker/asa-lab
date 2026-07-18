# Данные, мультитенантность и защита детей ASA Lab

## 1. Стратегия данных

P0/P1 использует PostgreSQL shared schema с обязательным `tenant_id`. Это снижает операционную сложность и сохраняет путь к dedicated database через `TenantPlacement`.

Tenant context формируется после аутентификации:

```text
tenantId
schoolIds
actorId
actorType
sessionId
roles
grants
supportAccessId
requestId
```

Клиент не может выбрать произвольный `tenantId` в body. Для platform admin смена tenant является отдельной audited operation.

## 2. Tenant-owned tables

Типовой набор полей:

```text
id UUID/ULID
tenant_id UUID NOT NULL
created_at TIMESTAMPTZ NOT NULL
created_by UUID/technical actor
updated_at TIMESTAMPTZ NOT NULL
updated_by UUID/technical actor
row_version BIGINT NOT NULL
```

Immutable tables не обязаны иметь `updated_at`, но имеют digest, автора и время создания.

Обязательные ограничения:

- repository query всегда содержит tenant predicate;
- дочерний объект ссылается на parent через composite `(tenant_id, parent_id)` FK;
- уникальность задаётся внутри tenant scope;
- runtime role не владеет таблицами и не имеет `BYPASSRLS`;
- cross-tenant read/write покрыты negative tests.

## 3. PostgreSQL RLS

RLS — второй рубеж, а не замена application authorization.

Он применяется минимум к:

- classrooms и memberships;
- projects и project-version metadata;
- assignments, submissions и reviews;
- comments;
- billing accounts;
- support grants;
- audit-access views.

Требования:

- `ENABLE ROW LEVEL SECURITY`;
- `FORCE ROW LEVEL SECURITY` для критических таблиц;
- tenant setting задаётся только проверенным middleware;
- session/transaction context очищается перед возвратом connection в pool;
- отдельная matrix suite выполняется под runtime database role.

## 4. Индексы и partitioning

Hot query сначала документируется и измеряется. Типовые индексы начинаются с `tenant_id`:

```sql
CREATE INDEX ON projects (tenant_id, owner_id, updated_at DESC);
CREATE INDEX ON class_memberships (tenant_id, classroom_id, status);
CREATE INDEX ON assignments (tenant_id, classroom_id, status, due_at);
CREATE INDEX ON submissions (tenant_id, assignment_id, status, submitted_at);
```

Партиционирование включается только для таблиц с доказанным объёмом и временным lifecycle:

- `audit_events` — RANGE по месяцу;
- `analytics_events` — RANGE по дате;
- `outbox_events` — RANGE по дате с коротким retention после delivery;
- `job_attempts` — RANGE по дате;
- `project_operations` — RANGE по дате или tenant bucket при большом потоке;
- `notification_deliveries` — RANGE по дате.

Partition per tenant запрещён как default: число tenants может стать слишком большим.

## 5. Project storage

Metadata хранится в PostgreSQL:

```text
project_id
version_id
module_key
module_version
schema_version
payload_hash
payload_size
storage_key
inline_payload optional
asset_manifest_hash
created_by
created_at
parent_version_id
```

Маленький payload допускается inline до измеренного лимита. Большой payload хранится в S3-compatible object storage. Domain API не зависит от физического способа хранения.

Object key:

```text
<placement>/<tenantId>/<moduleKey>/<projectId>/<versionId>/<sha256>.json.zst
```

Физический key не является правом доступа и не раскрывается как постоянный URL.

## 6. Operation batches и checkpoints

```text
ProjectOperationBatch
├── batchId
├── projectId
├── baseVersionId
├── clientInstanceId
├── sequenceFrom / sequenceTo
├── operations
├── idempotencyKey
└── createdAt
```

Сервер:

1. проверяет tenant и право редактирования;
2. проверяет base version;
3. дедуплицирует batch;
4. валидирует operations по module schema;
5. сохраняет durable operation record;
6. по политике создаёт immutable checkpoint;
7. возвращает acknowledgement и authoritative sequence.

Перед Submission обязателен final sync и checkpoint.

## 7. Transactional outbox

Outbox row:

```text
event_id
schema_name
schema_version
aggregate_type
aggregate_id
aggregate_version
tenant_id
payload
occurred_at
available_at
attempt_count
published_at
```

Consumer хранит processed event IDs или использует идемпотентный upsert. Аналитика, notifications и usage aggregation не блокируют основную транзакцию.

## 8. Billing data

Usage ledger append-only:

```text
entry_id
tenant_id
meter_key
quantity
period_start
period_end
source_type
source_id
idempotency_key
recorded_at
```

Исправление выполняется correction entry, а не скрытым обновлением истории.

## 9. Классификация данных

| Класс | Примеры | Правила |
|---|---|---|
| C0 Public | публичная документация | CDN разрешён |
| C1 Internal | module manifest, feature config | authenticated access |
| C2 Personal | teacher profile, student mapping | encryption, tenant isolation |
| C3 Child-sensitive | identity, comments, projects | minimization, strict access, no content logs |
| C4 Secrets | passwords, seat codes, tokens | hashing/encryption, never exposed |
| C5 Financial | invoice/payment references | isolated access and audit |

## 10. Privacy by design

- StudentSeat не требует email.
- Реальное ФИО необязательно для subject runtime.
- Псевдоним виден детям; mapping доступен только уполномоченному взрослому.
- Детские проекты закрыты по умолчанию.
- Публичная публикация отсутствует в P0.
- Личные сообщения между детьми отсутствуют.
- Analytics принимает только allowlist полей.
- Логи не содержат project payload, child comments и исходный пользовательский код.
- Сбор данных ограничен конкретной образовательной целью.

## 11. StudentSeat security

- code генерируется CSPRNG;
- хранится только Argon2id hash;
- rate limiting по IP, class link и seat;
- exponential backoff и lockout;
- QR содержит короткоживущий или revocable token;
- logout очищает IndexedDB namespace сессии;
- перевыпуск кода отзывает старые sessions;
- открытый код не возвращается support engineer и не попадает в audit/logs.

## 12. Web и API security

Минимум:

- TLS;
- secure/httpOnly/sameSite cookies;
- CSRF protection;
- CSP;
- strict input schemas;
- output encoding;
- upload validation;
- anti-IDOR tests;
- rate limits;
- dependency, secret, SAST и DAST scans;
- security headers;
- запрет wildcard CORS с credentials.

Каждый endpoint имеет policy name, например `project.edit`, `assignment.publish`, `submission.create`, `student-seat.reset`, `module.enable`, `billing.manage`, `support.break-glass`.

Матрица тестирует свой/чужой tenant, свой/другой класс, teacher/co-teacher/student, active/archived/suspended, Safe Mode, expired entitlement и наличие support grant.

## 13. Недоверенный код

Web Worker/WASM изолирует UI, но не считается серверным security sandbox и не получает secrets или hidden tests.

Server compile/autograde выполняются в OCI sandbox или более сильной изоляции:

- no network;
- no host mounts;
- read-only image;
- non-root;
- seccomp/AppArmor/SELinux profile;
- CPU, memory, PIDs, time и output limits;
- malware/archive-bomb protections;
- image digest pinning;
- ephemeral credentials;
- no shared writable workspace between tenants.

## 14. Module supply chain

Каждый module release содержит:

- source revision;
- signed artifact;
- SBOM;
- license inventory;
- vulnerability scan;
- schema compatibility report;
- migration tests;
- worker image digest;
- capabilities allowlist;
- owner.

## 15. Retention и удаление

Retention зависит от data class, tenant policy и договора.

Обязательны:

- soft delete пользовательских объектов;
- delayed hard delete;
- legal hold;
- export before deletion;
- tombstone для dedup/integrity;
- подтверждение удаления из primary, replicas и object storage;
- отдельный backup lifecycle;
- отдельная политика для audit.

## 16. Backup и recovery

- PostgreSQL base backup + WAL/PITR;
- object versioning или immutable backup copies;
- encrypted backups;
- отдельные credentials;
- регулярный restore test;
- checksum verification;
- documented RPO/RTO;
- backup недоступен application runtime account.

## 17. TenantPlacement evolution

```text
SHARED_CLUSTER
DEDICATED_DATABASE
DEDICATED_DEPLOYMENT
ON_PREMISE
```

Миграция tenant:

1. freeze window или change capture;
2. snapshot;
3. checksum;
4. delta replay;
5. routing switch;
6. validation;
7. rollback window.

## 18. Российский primary data plane

Production-baseline предусматривает запись, систематизацию, накопление, хранение, уточнение и извлечение персональных данных граждан Российской Федерации с использованием баз данных на территории Российской Федерации.

Дополнительно:

- зарубежная база не является primary или обязательной частью урока;
- Data Inventory фиксирует цели, составы, сроки, обработчиков и места хранения;
- возможная трансграничная передача имеет отдельный правовой и технический workflow;
- внешние analytics, mail и CDN отключаются без остановки учебного процесса;
- поддерживаются local backups и on-premise profile.

Нормативные ссылки:

- Федеральный закон № 152-ФЗ, статья 18: https://www.consultant.ru/document/cons_doc_LAW_61801/cbf4e15b7c330f9372e876cdf2bc928bad7950ef/
- Федеральный закон № 152-ФЗ, статья 5: https://www.consultant.ru/document/cons_doc_LAW_61801/96fbc469f91f57235cc842a85e0516a99f23dc85/

Конкретные правовые основания, статус оператора, локальные акты, требования к ИСПДн и модель угроз определяются профильным российским юристом и специалистом по информационной безопасности. Этот документ является инженерной спецификацией, а не юридическим заключением.

## 19. Security release gate

Релиз запрещён при:

- exploitable critical/high vulnerability;
- обнаруженном cross-tenant read/write;
- открытых StudentSeat codes в логах или БД;
- worker network access без allowlist;
- неподтверждённом backup restore;
- незакрытом secret leak;
- отсутствии audit для admin actions;
- неизвестной лицензии зависимости или ассета;
- невозможности открыть старые immutable submissions после обновления.
