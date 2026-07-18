# Административный и коммерческий контур ASA Lab

**Статус:** нормативный проект интерфейсов и полномочий.  
**Принцип:** административная система управляет платформой, tenant, школой и классом, но не обходит серверную авторизацию и не получает неограниченный доступ к детскому содержимому.

## 1. Уровни администрирования

```text
Platform
└── Tenant / Organization
    └── School
        └── Classroom
            └── Module configuration
```

Один пользователь может иметь несколько ролей. Активный scope всегда видим в верхней панели; смена scope не происходит скрыто.

## 2. Роли

| Роль | Scope | Основная ответственность |
|---|---|---|
| Platform Owner | platform | стратегические настройки, назначение platform admins |
| Platform Admin | platform | tenants, placements, modules, release rings, operations |
| Security Admin | platform/tenant | политики, инциденты, privileged access, audit |
| Support Engineer | ticket-bound tenant | диагностика только по временному grant |
| Billing Operator | platform | планы, подписки, provider references, сверка |
| Tenant Owner | tenant | организация, школы, tenant admins, договор и тариф |
| Tenant Admin | tenant | школы, общие политики, SSO, модули, usage |
| School Admin | school | сотрудники, периоды, классы, политики, интеграции |
| Methodist | school/tenant | библиотека активностей, рубрики, доступность модулей |
| Teacher | classroom | участники, StudentSeat, задания, сдачи, проверка |
| Auditor | selected scope | read-only audit и отчёты без изменения данных |

Роль не равна разрешению. Итоговое решение строится из role, scope, grant, состояния объекта, Safe Mode, entitlement и support-access context.

## 3. Отдельное приложение `apps/admin`

```text
apps/admin
├── platform
├── tenants
├── schools
├── classrooms
├── modules
├── billing
├── safety
├── support
├── operations
└── audit
```

Причины отдельного bundle:

- administrative code не попадает в ученический frontend;
- отдельные CSP, маршруты и telemetry allowlist;
- независимые release rings;
- более строгая MFA/session policy;
- возможность закрыть admin ingress отдельной сетью в on-premise установке.

Backend остаётся единым Control Plane и проверяет права независимо от UI.

## 4. Platform Console

### Обзор

Показывает только агрегаты:

- активные tenants, школы и классы;
- MAU/CCU и lesson-window bursts;
- SLO/error budget;
- очередь задач и oldest job age;
- состояние PostgreSQL, object storage, outbox и worker pools;
- backup age и последний restore test;
- активные инциденты;
- рост storage и compute cost;
- версии Core и модулей;
- tenants в degraded/suspended состоянии.

Детский контент на обзорном экране отсутствует.

### Tenants

Операции:

- создать tenant вручную;
- одобрить self-service tenant;
- назначить Tenant Owner;
- выбрать release ring;
- просмотреть школы, usage, subscription и placement;
- начать controlled placement migration;
- временно ограничить опасную capability;
- приостановить новые входы или compute, не удаляя проекты;
- экспортировать tenant metadata;
- инициировать offboarding по регламенту.

Опасные операции используют двухэтапное подтверждение, reason, impact preview и AuditEvent.

### Tenant Placement

Экран показывает:

- `SHARED`, `DEDICATED_DATABASE`, `DEDICATED_DEPLOYMENT` или `ON_PREMISE`;
- регион данных;
- deployment/database/object namespace keys;
- routing version;
- migration state;
- checksum и delta replay status;
- rollback window.

UI не отображает database credentials и secret values.

### Module Registry

- module packages и владельцы;
- SBOM и license inventory;
- schema/API compatibility;
- подписанный manifest;
- capabilities allowlist;
- admission-test results;
- release ring;
- usage и failure rate;
- остановка новой активации версии;
- migration status старых проектов.

Модуль нельзя сделать общедоступным только загрузкой frontend-файла.

### Operations

- deployments и версии;
- health/readiness;
- queue depth по типам;
- worker capacity;
- dead-letter jobs;
- outbox lag;
- rate-limit pressure;
- object-scan failures;
- backup/restore;
- feature flags;
- maintenance windows;
- incident timeline.

Повтор задачи разрешён только с исходным idempotency context; кнопка «повторить всё» без фильтра запрещена.

## 5. Tenant Console

### Организация

- карточка организации;
- владельцы и tenant admins;
- школы и филиалы;
- общие Safe Mode policies;
- data-retention profile;
- region и placement summary;
- договорные и billing contacts;
- module allowlist;
- usage и quota forecast;
- SSO domains и Identity Providers;
- audit export.

### Создание школы

Мастер:

1. реквизиты и локаль;
2. учебный календарь;
3. School Admin;
4. authentication/SSO;
5. доступные модули;
6. Safe Mode;
7. retention и export policy;
8. лимиты;
9. preview;
10. создание и AuditEvent.

### SSO

- OIDC/SAML configuration хранится зашифрованно;
- secrets вводятся повторно, но не читаются из UI;
- discovery/metadata validation;
- test login до активации;
- claims mapping preview на синтетических данных;
- domain matching;
- fallback admin account;
- emergency disable;
- история версий настройки.

StudentSeat остаётся независимым от взрослого SSO.

## 6. School Console

Навигация:

```text
Обзор
Сотрудники и роли
Учебные периоды
Классы
Модули
Библиотека
Политики безопасности
Интеграции
Использование ресурсов
Экспорт и хранение
Аудит
```

### Сотрудники

- приглашение взрослого по email или существующему аккаунту;
- роль и scope до отправки;
- срок действия приглашения;
- массовый импорт только после preview;
- MFA для привилегированных ролей;
- отзыв всех сессий;
- временная блокировка;
- передача владения классами перед удалением роли.

### Учебные периоды

- год, четверть, семестр или кружковый период;
- default period;
- перенос классов;
- клонирование структуры без StudentSeat secrets;
- архивирование;
- retention preview.

### Классы

Таблица показывает owner/co-teachers, количество учеников, StudentSeat, включённые модули, review backlog, storage/compute usage, Safe Mode, status и period.

School Admin не получает автоматическое право редактировать проект ученика. Такое право задаётся отдельной policy и аудитируется.

### Модули

Для каждого модуля:

- разрешённые версии;
- configuration schema;
- возрастные ограничения;
- resource policy;
- Safe Mode overrides;
- entitlement и quotas;
- canary class/group;
- дата включения;
- migration readiness;
- rollback policy.

## 7. Classroom Administration

Педагогическое управление остаётся в основном `apps/web`:

- участники и группы;
- StudentSeat и печатные карточки;
- соучителя и granular grants;
- активности и задания;
- сдачи и reviews;
- Safe Mode;
- модерация;
- аналитика класса;
- экспорт;
- архивирование.

School Console может открыть classroom summary, но не подменяет ежедневный teacher UX.

## 8. Self-service педагог

Возможный P1-сценарий:

```text
Регистрация взрослого
→ подтверждение контакта
→ создание PERSONAL tenant
→ создание первой школы/workspace
→ бесплатный PlanVersion
→ роли Tenant Owner + School Admin + Teacher
→ первый класс
→ StudentSeat
```

При присоединении к существующей школе personal tenant не сливается автоматически. Выполняется controlled transfer проектов и ролей с подтверждением обеих сторон.

Для первого школьного пилота рекомендуется приглашение педагогов администратором. Self-service включается feature flag после готовности abuse prevention, поддержки и правовых документов.

## 9. Billing & Entitlements Console

### Модель

```text
Plan
→ immutable PlanVersion
→ PlanEntitlement
→ Subscription
→ effective EntitlementSet
→ Quota/Usage policy
```

Дополнительный grant или ограничение задаётся `TenantEntitlementOverride` с причиной и сроком.

### Meter keys

- active_teacher_month;
- active_student_month;
- project_storage_gb_month;
- compile_seconds;
- server_simulation_seconds;
- autograder_runs;
- 3d_render_minutes;
- export_jobs;
- premium_module_seats.

Usage не ухудшает основной save path: записи идемпотентны и агрегируются асинхронно.

### Окончание тарифа

- вход и экспорт не блокируются внезапно;
- ученические данные не удаляются;
- новые premium jobs могут быть остановлены;
- проекты открываются read-only или с базовыми возможностями по policy;
- действует grace period;
- школа видит причину и дату;
- решение entitlement доступно в audit/debug view.

### Платёжный провайдер

Adapter отвечает только за customer reference, checkout/payment link, webhook normalization, invoice/payment references и reconciliation. Доступ к функциям вычисляет внутренний EntitlementService.

## 10. Support Access

Support Engineer не имеет постоянного доступа к tenant data.

Процесс:

1. создаётся ticket;
2. выбирается tenant и минимальный scope;
3. указывается purpose;
4. уполномоченное лицо одобряет grant;
5. grant получает время начала и жёсткий expiry;
6. каждый запрос содержит `supportAccessId`;
7. школа видит активный доступ;
8. просмотр и действия пишутся в audit;
9. grant автоматически истекает;
10. secrets, открытые StudentSeat codes и payment data недоступны.

Break-glass применяется только при инциденте, требует усиленной аутентификации и post-incident review.

## 11. Опасные операции

Для delete, suspension, placement migration, entitlement override, mass-role change и module disable обязательны:

- re-authentication;
- reason;
- affected-object count;
- dependency preview;
- asynchronous operation ID;
- idempotency key;
- dry run, где возможно;
- typed confirmation для high impact;
- AuditEvent до/после;
- notification ответственным;
- rollback/forward-fix path.

## 12. Нефункциональные требования

- admin routes требуют MFA для platform/security/billing ролей;
- idle timeout строже ученического;
- privileged actions защищены от CSRF/replay;
- P95 обычного списка ≤ 700 ms при pagination;
- все большие таблицы server-side paginated;
- export выполняется job, а не долгим HTTP request;
- отсутствие доступа возвращает 403 и AuditEvent, а не пустой 200;
- персональные данные маскируются по умолчанию;
- production data не копируется в test environments.

## 13. Порядок реализации

1. School Admin: сотрудники, периоды, классы, модули, audit.
2. Platform read-only operations dashboard.
3. Tenant roles и SSO.
4. Support grants и incident workflow.
5. Feature flags и release rings.
6. Entitlement read model и бесплатный plan.
7. Usage ledger и quotas.
8. Billing provider adapter.
9. TenantPlacement operations.
10. Региональные и on-premise workflows.

Этот порядок даёт полезность школьному пилоту и не заставляет реализовывать коммерческий UI раньше появления реальной бизнес-модели.
