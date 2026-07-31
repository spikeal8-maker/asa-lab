# ASA Lab — спецификация school и platform administration

**Статус:** нормативный кандидат R0.  
**Маршруты и screenshot IDs:** [`ASA_PRODUCT_SURFACE_CATALOG.yaml`](ASA_PRODUCT_SURFACE_CATALOG.yaml).  
**Целевой релиз:** преимущественно R10, moderation foundation — R8.

## 1. Назначение

Админка нужна, но она не является центром продукта и не заменяет Teacher Portal.

```text
Teacher Portal     обучение, классы, проекты, проверка
School Admin       scoped управление школой/организацией
Platform Admin     эксплуатация всей платформы
Support Operator   ограниченная аудируемая помощь
Moderator          разбор публикационных и safety cases
```

Каждый интерфейс появляется только из server-issued grants. Клиент не выбирает себе административную роль.

## 2. Основные принципы

1. `school_admin` действует только внутри конкретного Organization Workspace.
2. `platform_admin` — отдельная глобальная capability, не выводимая из school role.
3. SupportSession не является скрытым impersonation.
4. Никакая страница не показывает plaintext password, session token, class-code token или StudentSeat credential.
5. Любое чувствительное изменение имеет reason, actor, scope, request ID и AuditEvent.
6. Destructive bulk action всегда имеет dry-run/preview и отдельное подтверждение.
7. Админка не обходит RLS незаметно; elevated paths изолированы и аудируются.
8. Health/metrics не показывают fake success.
9. Детские данные редактируются и экспортируются только по policy и scope.
10. Прямое изменение immutable ProjectVersion запрещено даже администратору.

## 3. Administration shell

```text
┌────────────────────────────────────────────────────────────────┐
│ ASA Lab Admin | Scope switcher | Alerts | Account             │
├──────────────────┬─────────────────────────────────────────────┤
│ Dashboard        │ Page header / scope / primary action        │
│ Schools          │ Search / filters / saved view               │
│ Staff            │ Table/dashboard                            │
│ Classes          │ Detail drawer                              │
│ Learners         │ Confirmation / impact preview              │
│ Modules          │ Audit reason / request ID                  │
│ Policies         │                                             │
│ Moderation       │                                             │
│ Audit            │                                             │
│ Reports          │                                             │
└──────────────────┴─────────────────────────────────────────────┘
```

Обязательные состояния:

```text
loading
empty
populated
validation_error
authorization_denied
server_error
success_feedback
partial_data_warning
```

## 4. School/Organization Admin

### 4.1. Dashboard

Показывает только разрешённые aggregate данные:

- schools/buildings;
- active periods;
- staff/memberships;
- classes;
- active learners/StudentSeats;
- enabled modules;
- Safe Mode/policy versions;
- unresolved moderation cases;
- retention/export jobs;
- recent admin AuditEvent.

Не показывает:

- plaintext credentials;
- project content previews без отдельного authorized action;
- cross-workspace totals;
- platform-wide user search.

### 4.2. Schools and academic structure

Routes:

```text
/workspaces/:workspaceId/admin/schools
/workspaces/:workspaceId/admin/periods
```

Actions:

- create/edit school metadata;
- buildings/campuses optional;
- create academic period;
- activate/close/archive period;
- assign class to period;
- retention impact preview.

### 4.3. Staff and scoped roles

```text
owner
school_admin
educator
moderator
billing_admin
member
```

Page displays:

- account/profile summary;
- membership state;
- school scopes;
- classroom grants;
- invite source;
- last admin action;
- MFA/assurance summary where policy permits.

Actions:

- invite;
- edit scoped membership;
- suspend/revoke;
- transfer school ownership through high-assurance flow;
- review effective permissions.

School admin cannot grant `platform_admin`.

### 4.4. Classes

Search/filter:

- school;
- period;
- owner/co-teacher;
- active/archived;
- Safe Mode;
- last activity;
- module usage.

Actions:

- open class in Teacher Portal context;
- transfer owner with preview/audit;
- archive/restore;
- revoke join code;
- apply policy update;
- request retention deletion.

Admin does not silently edit learner projects.

### 4.5. Learners and StudentSeats

The admin surface can inspect:

- principal type;
- display label;
- class memberships;
- status;
- last active;
- Safe Mode;
- badge count;
- credential version only;
- reset/revocation history.

It cannot reveal an old StudentSeat credential. Reset produces a new one-time credential.

### 4.6. Module availability

The page manages:

- ModuleDefinition/ModuleVersion;
- enabled/disabled by workspace/school/age band;
- required entitlement;
- Safe Mode support;
- rollout channel;
- compatibility warning;
- data/export implications.

A disabled module does not delete existing projects. It becomes read-only/hidden according to policy with explicit restoration path.

### 4.7. Policies

Versioned policy envelopes:

```text
Safe Mode defaults
public profile policy
unlisted/public publication
public comments/interactions
class-code expiry/rotation
StudentSeat retention
assignment retention
project export
moderation escalation
module age availability
```

Flow:

```text
edit draft
→ validate
→ preview affected schools/classes/principals
→ require reason
→ publish version
→ AuditEvent
→ optional rollback to previous version
```

### 4.8. Moderation

Organization cases may include:

- class project restriction;
- public publication report;
- public comment/profile report;
- unsafe personal data;
- inappropriate content;
- teacher escalation.

Actions:

```text
no_action
restrict_in_workspace
unpublish
restore
request_information
escalate_to_platform
```

The moderator sees only necessary evidence and redacted child data.

### 4.9. Audit explorer

Filters:

- date range;
- actor Principal;
- support/admin session;
- action;
- entity type/id fingerprint;
- class/school;
- success/denied/failure;
- request ID.

Audit is append-only. UI supports authorized export, not delete/edit.

### 4.10. Reports and exports

Required report families:

- class/activity participation;
- module usage;
- StudentSeat lifecycle;
- badges/skills;
- storage summary;
- moderation summary;
- policy coverage;
- retention jobs.

Rules:

- report generation is asynchronous/idempotent;
- output has scope/watermark/generatedAt;
- sensitive fields omitted by default;
- download URL short-lived;
- export access audited.

## 5. Platform Admin

### 5.1. Operations dashboard

Shows:

- API/Web health;
- PostgreSQL readiness;
- storage/queue/job state;
- error/latency signals;
- active incident;
- failed migrations/jobs;
- moderation backlog;
- security alerts;
- capacity evidence.

A dependency failure must appear as degraded/not-ready, not green.

### 5.2. Accounts and Principals

Search keys must be policy-controlled:

- account ID;
- normalized email exact match;
- username;
- Principal ID;
- workspace membership;
- support case reference.

Actions:

- suspend/restore Account;
- revoke sessions;
- review verification/capability state;
- start audited SupportSession;
- view deletion/export request.

Forbidden:

- reveal password hash;
- set arbitrary password without recovery flow;
- merge accounts automatically;
- convert StudentSeat to Account silently;
- grant educator/platform admin without policy/audit.

### 5.3. Workspaces and placement

Displays:

- workspace kind/status;
- tenant ID fingerprint;
- placement mode;
- region;
- quotas;
- module entitlements;
- storage/usage;
- owner/membership summary;
- policy versions.

Placement change requires migration plan, dry-run, backup and owner-approved operational gate.

### 5.4. Module Registry operations

Lifecycle:

```text
registered
→ validating
→ staged
→ enabled_for_cohort
→ enabled
→ deprecated
→ disabled
```

Controls:

- manifest validation;
- schema compatibility;
- preview/viewer/editor availability;
- Safe Mode declaration;
- data migration provider;
- rollout percentage/cohort;
- rollback;
- kill switch.

No Core subject switch is introduced from admin UI.

### 5.5. Global policies

Platform policies include:

- minimum ages;
- educator verification;
- guardian consent;
- public publication eligibility;
- moderation SLA;
- retention/deletion;
- security assurance;
- feature rollout;
- rate limits.

Every activation is versioned and auditable.

### 5.6. Global moderation queue

Case detail shows:

- report category;
- immutable evidence references;
- affected publication/profile/comment;
- policy version;
- previous decisions;
- workspace/school scope;
- child-safety redaction;
- decision controls;
- appeal/review state.

### 5.7. Audited SupportSession

Flow:

```text
support operator enters ticket + reason
→ policy verifies entitlement
→ optional second approval
→ time-limited SupportSessionPrincipal
→ persistent visible banner
→ every read/mutation audited
→ automatic expiry
→ end summary
```

Support session never uses the user's cookie/token and never hides the support actor.

### 5.8. Feature flags and rollout

Flag fields:

```text
key
owner
purpose
risk
createdAt
expiresAt
cohorts/workspaces
percentage
fallback
metrics
rollback condition
```

Expired flag cannot remain silently active.

### 5.9. Jobs and queues

Page supports:

- queue/filter;
- pending/running/retry/dead-letter/completed;
- idempotency key;
- attempt history;
- last error;
- safe retry/cancel rules;
- payload redaction.

No arbitrary JSON editing/replay from UI.

### 5.10. Health and capacity

Required charts/tables:

- request count/latency/error;
- DB pool/queries/locks;
- queue depth/age;
- object storage;
- simulation jobs;
- active sessions;
- measured classroom concurrency;
- capacity test evidence.

Targets are not declared from estimates alone. R10 closes only with measured results.

### 5.11. Storage, retention and deletion

Displays:

- storage classes;
- project versions/previews/assets;
- export/deletion jobs;
- legal/retention hold;
- orphan scan;
- object verification;
- backup/recovery evidence.

Immutable educational history is deleted only by approved retention policy, never through an unscoped quick action.

### 5.12. Incidents and maintenance

Incident record:

```text
severity
status
affected capabilities
startedAt
detectedAt
owner
updates
actions
recovery evidence
resolvedAt
postmortem link
```

Status communication never exposes private infrastructure or student data.

## 6. Permission model

Every admin API checks:

```text
Principal
→ active session assurance
→ global capability or WorkspaceMembership
→ scope/resource lineage
→ policy
→ reason if required
→ operation
→ AuditEvent
```

UI-hidden action is not authorization.

## 7. Bulk actions

Any action affecting more than one principal/class/project requires:

1. filter snapshot;
2. exact count;
3. sample preview;
4. excluded/denied rows;
5. reason;
6. optional second approval;
7. idempotency key;
8. progress job;
9. per-row result;
10. rollback/compensation where possible;
11. audit summary.

## 8. Error and denial behavior

```text
400 invalid request
401 no session
403 known action denied without extra sensitive detail
404 resource hidden/not found when existence must not leak
409 state/version conflict
422 policy or lifecycle violation
429 rate limited
503 dependency not ready
```

Admin error pages show request ID and safe recovery action, never stack traces or credentials.

## 9. Screenshot acceptance

Minimum:

```text
school-admin-dashboard
school-admin-staff
school-admin-classes
school-admin-learners
school-admin-modules
school-admin-policies
school-admin-moderation
school-admin-audit
school-admin-reports
platform-admin-dashboard
platform-admin-accounts
platform-admin-workspaces
platform-admin-module-registry
platform-admin-policies
platform-admin-moderation
platform-admin-audit
support-session-banner
platform-admin-features
platform-admin-jobs
platform-admin-health
platform-admin-storage
platform-admin-incidents
```

Screenshots use synthetic data only.

## 10. Definition of Done

Админка считается готовой только когда:

- every surface has route/grants/states/actions/tests;
- school admin cannot reach another workspace;
- school admin cannot grant platform admin;
- support session is visible, time-limited and audited;
- secrets/credentials are never returned;
- bulk actions have preview/idempotency/per-row results;
- audit is append-only;
- health is honest;
- retention/export/deletion are policy-driven;
- owner can complete live school-admin and platform-admin flows;
- accessibility and responsive desktop/tablet layouts pass.
