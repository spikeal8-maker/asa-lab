# ASA Lab — неразрушающий переход к Account, Principal и Workspace

**Статус:** нормативный migration и compatibility plan.  
**Назначение:** перевести текущий tenant-scoped teacher login в глобальную identity/workspace-модель без потери существующих пользователей, классов, проектов, RLS и проверенных сценариев.  
**Связанные документы:** `ASA_TARGET_PLATFORM_BLUEPRINT.md`, `TINKERCAD_PARITY_SPEC.md`, `ARCHITECTURE_BASELINE.md`.

---

## 1. Текущий baseline

На момент перехода уже существуют и считаются данными, которые нельзя потерять:

```text
tenants
schools
academic_periods
users                    tenant-scoped teacher records
sessions                 current account-like teacher sessions
classrooms
classroom_memberships
projects
project_drafts
project_versions
audit_events
```

Существующий путь входа:

```text
workspace slug + email + password
→ tenant lookup
→ tenant-scoped user
→ session
```

Существующие RLS и repositories используют `tenant_id` из server session context.

---

## 2. Целевой baseline

```text
Global identity
├── accounts
├── profiles
├── principals
├── sessions_v2
├── capability_grants
└── email/age policy state

Scoped access
├── workspaces
├── workspace_memberships
├── classroom_memberships
└── classroom_grants

Existing tenant data plane
├── tenants
├── schools
├── classrooms
├── projects
└── RLS-protected tables
```

Ключевой принцип:

> `Workspace` — продуктовая и access-модель; `Tenant` остаётся security/storage boundary.

В первой версии `workspaces.tenant_id` уникален: один workspace соответствует одному tenant.

---

## 3. Запрещённые migration shortcuts

Запрещено:

1. `ALTER TABLE users RENAME TO accounts`;
2. удалить current `users` до полного backfill и compatibility gate;
3. отключить RLS для ускорения миграции;
4. перенести tenant из клиента в body/query;
5. добавить nullable `owner_account_id` и `owner_seat_id` без principal integrity;
6. использовать одинаковую session запись без различения Account и StudentSeat;
7. автоматически присвоить educator/admin всем существующим аккаунтам;
8. сбросить текущие пароли, классы или project IDs;
9. менять public URLs и project IDs без redirect/compatibility;
10. выполнять destructive cleanup в том же release, где появился новый read path.

---

## 4. Целевые таблицы

### 4.1. principals

```text
id uuid PK
kind account | student_seat | service | support_session
status active | suspended | revoked
created_at
```

Каждый `accounts.id` и `student_seats.id` имеет соответствующий principal.

### 4.2. accounts

```text
id uuid PK
principal_id uuid UNIQUE FK principals
email_normalized citext UNIQUE
password_hash
country_code
birth_date
age_policy_key
email_verification_state unverified | pending | verified | bounced
account_state active | pending_approval | safe_mode | suspended | deleted
created_at
updated_at
```

### 4.3. profiles

```text
account_id uuid PK FK accounts
username_normalized citext UNIQUE
username_display
public_display_name nullable
bio nullable
avatar_ref nullable
profile_visibility private | restricted | public
locale
time_zone
updated_at
```

### 4.4. workspaces

```text
id uuid PK
tenant_id uuid UNIQUE FK tenants
kind personal | organization
name
status active | suspended | archived
created_by_principal_id
created_at
```

### 4.5. workspace_memberships

```text
workspace_id
account_id
role owner | member | educator | school_admin | billing_admin | moderator
state active | invited | suspended | revoked
created_at
revoked_at
UNIQUE(workspace_id, account_id, role)
```

### 4.6. capability_grants

```text
account_id
capability creator | educator | registered_student | guardian | platform_admin
state provisional | verified | suspended | revoked
policy_version
source self_attestation | invitation | admin | guardian_approval | migration
reason
granted_by_principal_id nullable
granted_at
reviewed_at nullable
revoked_at nullable
```

### 4.7. sessions_v2

```text
id uuid PK
principal_id FK principals
active_workspace_id nullable FK workspaces
token_hash UNIQUE
assurance_level
created_at
expires_at
last_seen_at
revoked_at
client_metadata jsonb
```

### 4.8. legacy links

```text
legacy_user_account_links
- tenant_id
- user_id
- account_id
- principal_id
- migration_state
- migrated_at
UNIQUE(tenant_id, user_id)
```

Таблица нужна для dual-read/dual-write и обратимой миграции.

---

## 5. Migration stages

Номера SQL-миграций определяются фактическим последним номером в ветке. Используются семантические IDs ниже.

### MIG-ID-00 — freeze and evidence

До schema changes:

- backup dev/test DB;
- count fixtures для tenants/users/classrooms/projects/versions;
- записать текущие UUID и password hashes существующего педагога;
- зафиксировать regression E2E Teacher Portal и Electronics;
- проверить clean migration chain на пустой и существующей базе.

Exit gate:

```text
backup verified
baseline counts recorded
old login works
current projects/classes visible
```

### MIG-ID-01 — additive global identity

Создать:

- principals;
- accounts;
- profiles;
- capability_grants;
- legacy links.

Ничего не изменять в current users/sessions.

### MIG-ID-02 — additive workspace model

Создать:

- workspaces;
- workspace_memberships;
- workspace settings/policy envelope.

Добавить `tenants.kind`, если требуется, без изменения existing tenant IDs.

### MIG-ID-03 — backfill existing teacher

В одной idempotent transaction:

1. создать Account из existing teacher email/password hash;
2. создать Profile;
3. создать Account Principal;
4. создать Personal Workspace, backed by current tenant;
5. создать owner membership;
6. создать provisional/verified educator grant согласно migration policy;
7. создать legacy link;
8. добавить AuditEvent.

Backfill не должен создавать второй Account при повторном запуске.

### MIG-ID-04 — principal-aware sessions

Добавить `sessions_v2` и resolver:

```text
resolve v2 token
else resolve legacy token
→ map legacy user to account principal/workspace
```

Новый login выдаёт только v2 session. Старые sessions остаются валидны до controlled expiry/revocation.

### MIG-ID-05 — public registration behind feature flag

Добавить:

```text
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
GET  /api/workspaces
POST /api/session/context
```

Feature flag:

```text
identity.public_registration
```

Первый owner review проводится до включения по умолчанию.

### MIG-ID-06 — project/class principal ownership bridge

Additive columns:

```text
projects.owner_principal_id nullable initially
classrooms.created_by_principal_id nullable initially
audit_events.actor_principal_id nullable initially
```

Backfill из legacy user links. После полного backfill добавить `NOT NULL` только там, где все исторические записи имеют корректного principal.

Legacy created_by/teacher columns сохраняются минимум два release gates.

### MIG-ID-07 — compatibility cutover

После подтверждения C1:

- default login больше не требует workspace slug;
- workspace login остаётся hidden compatibility endpoint;
- UI использует workspaces from session;
- старый seeded teacher и новый account видят одни данные;
- monitoring показывает legacy resolver usage.

### MIG-ID-08 — legacy deprecation

Только после:

- двух стабильных release gates;
- zero legacy session resolution в установленном окне;
- verified backup restore;
- owner approval;
- ADR/destructive migration review.

В этом этапе можно начать удаление legacy columns/tables. Не раньше.

---

## 6. API transition contract

### 6.1. Новый основной API

```text
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
GET  /api/auth/me
GET  /api/workspaces
POST /api/session/context
POST /api/capabilities/educator/self-attest
GET  /api/account/profile
PATCH /api/account/profile
GET  /api/account/sessions
DELETE /api/account/sessions/:id
POST /api/account/sessions/revoke-all
```

### 6.2. Compatibility API

Текущий workspace login не удаляется сразу:

```text
POST /api/auth/login-legacy-workspace
```

Если фактически сохраняется старый URL, request shape должен version/feature-detect legacy mode. Новый public UI его не использует.

### 6.3. Context resolution

Request context создаётся только сервером:

```text
Session principal
→ active workspace membership
→ workspace tenant_id
→ SET LOCAL app.tenant_id
→ application use case
```

Клиентский `tenantId`, `workspaceId` или `role` не является источником полномочий.

---

## 7. RLS transition

### 7.1. Что сохраняется

Все tenant-owned tables продолжают использовать:

```text
tenant_id NOT NULL
composite FK
runtime role without BYPASSRLS
SET LOCAL app.tenant_id
```

### 7.2. Global identity tables

`accounts`, `profiles`, `principals` не tenant-owned. Их доступ запрещён runtime role напрямую; операции выполняются через узкие repositories/functions и application policy.

### 7.3. Workspace tables

`workspaces` связывает global identity с tenant boundary. Membership lookup выполняется до установки `app.tenant_id`.

### 7.4. Negative tests

Обязательны:

- account cannot activate unknown workspace;
- workspace member cannot activate suspended workspace;
- browser cannot submit tenant override;
- personal workspace data invisible from another account;
- organization admin role does not grant platform admin;
- legacy user cannot resolve to a different tenant/account;
- StudentSeat session cannot resolve account-only endpoints.

---

## 8. Compatibility with existing product work

### 8.1. Teacher Portal

Существующий Teacher Portal становится authenticated creator/educator portal после v2 session resolution. Его data APIs не должны менять tenant IDs.

### 8.2. Projects

Текущие project IDs, drafts and versions остаются. Добавляется owner principal bridge; payload и module contract не мигрируются из-за identity change.

### 8.3. Electronics

Electronics editor получает actor/context из shared Project Host. Solver и document schema не зависят от Account migration.

### 8.4. Classroom

Текущие classroom IDs сохраняются. GradeBand/topics/Safe Mode и StudentSeat добавляются позже additively.

### 8.5. Demo credentials

Seed credentials могут быть перевыпущены локально, но existing database user/password hash должен быть backfilled, а не потерян.

---

## 9. Rollback strategy

До destructive cleanup rollback означает:

1. выключить public registration feature flag;
2. вернуть UI на legacy workspace login;
3. продолжить legacy session resolver;
4. не удалять новые global tables;
5. сохранить AuditEvents и migration links;
6. исправить forward migration отдельным patch.

Rollback не должен откатывать уже созданные проекты/классы.

После начала destructive cleanup rollback требует restore plan и отдельного owner approval.

---

## 10. Observability and audit

Метрики:

```text
identity_registration_success_total
identity_registration_failure_total
identity_legacy_login_total
identity_v2_login_total
identity_workspace_switch_total
identity_workspace_switch_denied_total
identity_educator_attestation_total
identity_capability_escalation_denied_total
identity_session_revocation_total
identity_backfill_conflict_total
```

AuditEvents:

```text
account.backfilled
account.registered
workspace.personal_created
workspace.switched
capability.educator_attested
capability.granted
capability.denied
session.v2_created
session.revoked
legacy_login.used
```

Telemetry не содержит email, password, raw session token, class code или project payload.

---

## 11. Test plan

### Schema and migration

- empty DB migration;
- current dev DB migration;
- repeat/idempotency;
- backfill current teacher;
- current classroom/project counts preserved;
- legacy and v2 login coexist;
- rollback feature flag path.

### Identity

- adult registration;
- duplicate email;
- age policy 18+ educator attestation;
- underage denial;
- email verification state;
- session revoke-all;
- workspace list/switch;
- capability forgery denial.

### Security

- cross-account personal workspace isolation;
- cross-workspace RLS;
- client tenant/workspace override rejection;
- school_admin cannot call platform_admin operations;
- suspended grant/membership enforcement;
- legacy-link collision rejection.

### Regression

- existing seeded teacher login;
- existing classes list/create;
- existing personal projects;
- open/save/reload/version Electronics;
- ports and demo startup/shutdown;
- current E2E and a11y.

---

## 12. Owner review milestones

### C1.1 — Public entry

Visible:

```text
Создать аккаунт
Войти
Присоединиться к классу
```

### C1.2 — Registration

Visible:

- country;
- birth date;
- email;
- password;
- username;
- retained fields on error.

### C1.3 — Personal Workspace

Visible:

- Home;
- Projects;
- existing data preserved;
- workspace switcher.

### C1.4 — Educator grant

Visible:

- educator attestation;
- 18+ policy;
- provisional status;
- Classes becomes available;
- audit evidence.

### C1.5 — Account settings

Visible:

- profile;
- email state;
- workspaces;
- active sessions;
- revoke-all;
- logout.

Agent stops after each milestone. No C2/Classroom work before owner acceptance of all C1 milestones.

---

## 13. Exit gate for identity cutover

Cutover accepted only when:

1. current teacher, classes and projects are preserved;
2. new adult registers without workspace code;
3. Personal Workspace created exactly once;
4. old and new login paths work during migration;
5. no client can forge educator/admin/workspace;
6. 18+ educator policy enforced server-side;
7. v2 session and workspace context drive RLS;
8. account menu/session security works;
9. regression Electronics and Classroom tests pass;
10. owner approves live browser flow;
11. rollback feature flag is demonstrated;
12. no destructive migration has executed.
