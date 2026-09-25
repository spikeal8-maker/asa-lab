# ASA Lab — Account Security, Password, MAX and Settings Master Plan

**Назначение:** управляющий execution-contract для последовательного доведения Account security, password lifecycle, MAX и пользовательских настроек до production-ready состояния.

**Статус документа:** план и критерии. Этот файл не является источником live-state, не выбирает текущую задачу, не разрешает deployment и не заменяет `docs/execution/current.yaml`.

**Live state authority:** `docs/execution/current.yaml`.

**Связанные нормативные источники:**
- `docs/product/ASA_USERS_ACCESS_AND_SETTINGS_SPEC.md`;
- `docs/product/ASA_AUTH_ENTRY_UX_SPEC.md`;
- `docs/product/ASA_ADMIN_CONSOLE_SPEC.md`;
- `docs/product/ASA_VISUAL_PRODUCT_SYSTEM.md`;
- `docs/execution/ADMIN_AUTH_MAX_EXECUTION_PLAN.md`;
- `docs/delivery/AGENT_CHANGE_WORKFLOW.md`;
- `AGENTS.md`;
- `START_HERE_FOR_AI.md`.

---

## 1. Цель программы

Довести до законченного состояния четыре связанных пользовательских результата:

1. **Password self-service.** Пользователь Account может безопасно сменить свой пароль из настроек.
2. **Canonical authentication.** Старый organization-login не создаёт вторую модель пароля и сессий.
3. **MAX.** MAX имеет отдельные и понятные login/link/register/recovery flows и реально принимается в production.
4. **Account Settings.** Настройки Account становятся простыми, адресуемыми, responsive и не зависят от загрузки несвязанных подсистем.

Программа считается законченной только тогда, когда security invariants доказаны на:
- application/unit level;
- реальной PostgreSQL;
- реальном API;
- реальном браузере без mock критического auth API;
- production exact revision для MAX rollout.

---

## 2. Почему эту работу нельзя выполнять одним большим PR

Область пересекает:
- `contexts/identity/**`;
- `apps/api/src/auth.controller.ts`;
- `apps/api/src/account-c1.controller.ts`;
- MAX runtime;
- миграции;
- refresh/session lifecycle;
- `apps/web/src/pages/AccountPage.tsx`;
- `apps/web/src/pages/LoginPage.tsx`;
- OpenAPI;
- PostgreSQL tests;
- Playwright.

Один большой PR создаёт сразу четыре риска:

1. невозможно понять, сломал ли auth redesign password, MAX или UI;
2. трудно проверить rollback;
3. бот начинает делать соседние улучшения вместо выбранного результата;
4. параллельные Learning/Electronics/Projects изменения быстрее делают ветку устаревшей.

Поэтому программа выполняется **короткими bounded slices от свежего main**.

Один запуск исполнителя = один slice = один STOP.

Не использовать долгоживущую product-ветку на всю программу.

---

# 3. Критический аудит CURRENT

Этот раздел фиксирует обнаруженные архитектурные проблемы и нужен для выбора порядка работ. Это source-code analysis, а не утверждение о конкретном production deployment.

## P0-01 — два password authority

Историческая teacher identity хранит пароль в:

`users.password_hash`.

Позднее Account model добавила:

`accounts.password_hash`.

Migration `0010_account_identity_sessions_v2.sql` при backfill скопировала существующий teacher hash из `users` в `accounts`.

После этого эти значения стали двумя физическими копиями одного credential.

Текущий password change через `auth_account_password_set(...)` обновляет:

`accounts.password_hash`

и не обновляет:

`users.password_hash`.

Legacy organization-login продолжает получать credential через:

`auth_find_active_teacher(...)`

и проверяет `users.password_hash`.

### Риск

После успешной смены Account password старый пароль потенциально остаётся действующим через compatibility organization-login.

Это security P0.

### Целевое решение

У Account должен быть один password authority:

`accounts.password_hash`.

Legacy `users.password_hash` не должен участвовать в новых authentication decisions.

---

## P0-02 — две Account session models

В репозитории одновременно существуют:

- legacy `sessions`;
- canonical `sessions_v2` + refresh family/token lifecycle.

`ActiveContextUseCase` умеет принимать обе модели для совместимости.

Это полезно для миграции, но dangerous для security commands, если команда обслуживает только одну половину.

---

## P0-03 — organization-login создаёт legacy session

Обычный Account password login создаёт canonical session.

Compatibility organization-login идёт через старый `LoginUseCase` и legacy session store.

Из-за этого пользователь может быть корректно authenticated для общего ActiveContext, но не иметь canonical session, необходимой новым Account security endpoints.

---

## P0-04 — password management принимает только canonical session

`auth_account_password_context(...)` работает через `sessions_v2`.

Следовательно возможен сценарий:

```text
organization login
→ ActiveContext существует
→ Profile / Projects работают
→ GET /api/account/password
→ canonical session не найдена
→ 401
→ Settings показывает "Состояние пароля временно недоступно"
```

Это согласуется с пользовательским симптомом и является архитектурно доказанным несовпадением двух auth paths.

---

## P0-05 — password change не отзывает legacy sessions

При successful password change текущая DB function отзывает:
- другие `sessions_v2`;
- refresh families;
- refresh tokens.

Но исторические записи `sessions` того же Account в этот lifecycle не входят.

Пока legacy sessions разрешены как ActiveContext, security statement:

> после смены пароля остальные входы завершены

не является универсально истинным.

---

## P0-06 — session management не показывает полный Account state

Account session UI работает через canonical session list.

Историческая legacy session может быть:
- действующей;
- не отображаться пользователю;
- не участвовать в "Завершить остальные".

Пока compatibility sessions поддерживаются, Account-wide revoke обязан учитывать обе модели.

---

## P0-07 — MAX unlink допускает self-lockout

MAX provider-only Account создаётся с:

`password_configured = false`.

Self-service unlink MAX в текущем DB boundary проверяет принадлежность identity Account, но не гарантирует наличие другого usable login/recovery method.

В UI linked MAX получает действие "Отключить MAX".

В результате потенциально возможен:

```text
MAX-only Account
passwordConfigured=false
MAX = last usable credential
→ unlink MAX
→ MAX sessions revoked
→ usable login methods = 0
```

Это нарушает нормативный принцип:

> нельзя потерять последний usable login/recovery method.

Server-side guard обязателен. UI disable недостаточен.

---

## P1-01 — MAX login и MAX registration семантически смешаны

Для неизвестного MAX subject текущий service может автоматически создать Account.

Одновременно существует явный MAX registration flow в `RegisterPage`.

Получаются две конкурирующие модели:

```text
MAX login → unknown subject → silent account creation
```

и

```text
MAX → explicit registration form → account creation
```

Целевая модель должна различать:
- LOGIN;
- LINK;
- REGISTER.

Unknown provider identity во время LOGIN не должна сама создавать Account.

---

## P1-02 — silent MAX Account получает synthetic policy facts

Auto-created provider-only Account использует технические значения, включая synthetic email и server-generated demographic defaults.

Особенно опасно использовать фактическую текущую дату как `birth_date`: downstream age-policy может трактовать такой Account как несовершеннолетний.

Age/region facts нельзя выдумывать ради завершения provider login.

---

## P1-03 — MAX session source используется как бессрочный step-up

Password logic допускает password set/change без current password, если authentication source = MAX.

Но refresh session может жить значительно дольше fresh provider proof.

Нужно разделить:
- "эта session была создана через MAX";
- "пользователь только что заново подтвердил MAX для sensitive action".

Sensitive operations требуют **fresh assurance**, а не исторический provider label.

---

## P1-04 — password recovery незавершён

Login UI имеет "Не помню пароль", но полноценного recovery lifecycle нет.

Сегодня фактический обход:
- если MAX уже связан — войти через MAX;
- после входа создать/сменить пароль.

Нет законченного recovery для Account без связанного MAX.

Email recovery нельзя обещать до появления реального mail provider.

---

## P1-05 — auth evidence drift

Обнаружены ссылки execution/test configuration на отсутствующие файлы, а OpenAPI не описывает часть реально существующих Account/MAX endpoints.

Следовательно общий green CI нельзя автоматически считать доказательством полного password/MAX lifecycle.

Перед окончательной приёмкой evidence map должна соответствовать реально исполняемым тестам.

---

## P2-01 — Account Settings frontend слишком связан

`AccountPage.tsx` объединяет:
- profile;
- avatar;
- password;
- MAX;
- sessions;
- timezone;
- capabilities;
- workspaces/schools;
- notifications;
- privacy;
- requests.

Один экран отвечает слишком за много независимых use cases.

---

## P2-02 — hidden sections влияют на текущую страницу

При открытии Account settings frontend заранее запрашивает несколько независимых ресурсов.

Ошибка MAX/password/sessions может появиться глобальным banner даже тогда, когда пользователь редактирует только Profile.

Panel-local failure должен оставаться panel-local.

---

## P2-03 — настройки имеют локальный визуальный слой

`account.css` содержит большой самостоятельный набор конкретных размеров, цветов, карточек и responsive rules.

Цель redesign — не "нарисовать ещё красивее", а вернуть Settings в общую ASA Lab visual system и уменьшить локальные исключения.

---

## P2-04 — текущая information architecture переобещает продукт

Некоторые отдельные sections содержат очень мало реального функционала или сообщения "пока недоступно".

Нереализованная возможность не должна занимать полноценную навигационную область только ради заглушки.

---

# 4. Root cause

Наблюдаемые проблемы не являются четырьмя независимыми багами.

Основной корень:

```text
legacy teacher auth
        │
        ├── users.password_hash
        └── sessions
                 │
                 ├── compatibility ActiveContext
                 │
                 └── не участвует полностью
                     в новых Account security commands

canonical Account auth
        │
        ├── accounts.password_hash
        └── sessions_v2 + refresh families
                 │
                 └── password/MAX/settings построены вокруг него
```

Поэтому первый архитектурный приоритет:

```text
ONE ACCOUNT
ONE PASSWORD AUTHORITY
ONE CANONICAL SESSION CREATION PATH
```

После этого MAX и Settings можно стабилизировать без сохранения двойной auth semantics.

---

# 5. Target invariants

## AUTH-INV-01 — один password authority

Для Account password verification authority:

`accounts.password_hash`.

Ни один новый login decision не должен проверять `users.password_hash`.

---

## AUTH-INV-02 — organization code выбирает context, а не password store

Compatibility organization login:

```text
workspace code
+ account identifier/email
+ password
→ resolve organization context
→ resolve linked Account
→ verify canonical Account password
→ verify active membership/context
→ create sessions_v2
```

Organization login остаётся compatibility UX, но не отдельной identity system.

---

## AUTH-INV-03 — новые Account sessions только canonical

После convergence:
- Account password login → `sessions_v2`;
- organization compatibility login → `sessions_v2`;
- MAX login → `sessions_v2`.

Legacy `sessions` может временно читаться для rollback/migration compatibility, но новый login туда не пишет.

---

## AUTH-INV-04 — password change уничтожает старый credential globally

После SUCCESS:

```text
OLD password
→ normal login FAIL
→ organization login FAIL
```

Никакой совместимый entry point не должен принимать OLD.

---

## AUTH-INV-05 — password change отзывает Account sessions globally

После SUCCESS:
- current canonical session остаётся;
- другие `sessions_v2` revoked;
- их refresh token/family revoked;
- оставшиеся legacy Account sessions revoked.

---

## AUTH-INV-06 — provider unlink не может удалить последний usable method

Любой unlink/login-method removal проверяется server-side.

После операции должно оставаться хотя бы одно допустимое средство:
- configured password;
- другой active provider;
- отдельно утверждённый recovery mechanism.

---

## AUTH-INV-07 — fresh provider proof и provider-origin session различны

Session source не равен fresh step-up.

Fresh MAX assurance получает ограниченный TTL и single-purpose semantics.

---

## AUTH-INV-08 — sensitive state не выводится из technical email

Frontend не должен делать auth/provider conclusions из:
- email suffix;
- username pattern;
- synthetic profile values.

Security facts приходят сервером явно.

---

# 6. Целевой password lifecycle

## 6.1 Ordinary Account

```text
register with password A
→ canonical session
→ Settings / Security
→ current A + new B + repeat B
→ server verifies A
→ server persists B
→ other sessions revoked
→ current session remains
→ logout
→ A rejected
→ B accepted
```

---

## 6.2 Migrated teacher / organization compatibility

```text
historic teacher
→ organization login using Account password A
→ canonical sessions_v2
→ Settings / Security
→ change A to B
→ current session remains
→ old legacy sessions revoked
→ normal login A FAIL
→ organization login A FAIL
→ normal login B PASS
→ organization login B PASS
```

Этот journey является обязательным regression proof найденного P0.

---

## 6.3 Provider-only Account

```text
MAX-linked Account
passwordConfigured=false
→ fresh MAX assurance
→ Create password B
→ passwordConfigured=true
→ password login B works
```

Наличие старой long-lived MAX session само по себе не заменяет fresh assurance.

---

# 7. Password policy

На convergence этапе не смешивать password architecture с новым password-strength проектом.

Сохранить действующий совместимый baseline длины, если security review не выявит отдельный blocker.

Не добавлять без отдельного решения:
- обязательную uppercase;
- обязательные digits;
- обязательные special chars;
- регулярную принудительную ротацию.

Цель первых slices — correctness и единственный credential authority.

---

# 8. Password storage

Существующий versioned scrypt path сохраняется, если отдельный security review не выявит проблему.

Обязательные свойства:
- random salt;
- version marker;
- async hashing;
- bounded hashing concurrency;
- timing-safe verify;
- decoy verify для неизвестного identifier;
- отсутствие password/hash/salt в API, analytics и audit.

Новый hashing algorithm не должен быть условием первого исправления password lifecycle.

---

# 9. Целевая MAX модель

## MAX LOGIN

Условие:
- fresh provider assertion;
- MAX identity уже linked к active Account.

Результат:
- canonical Account session.

Unknown MAX subject:

`LOGIN != REGISTER`.

Ответ должен вести в явный decision flow, а не создавать Account молча.

---

## MAX REGISTER

Только явный пользовательский flow.

Обязательные реальные policy inputs определяются действующим Auth/age contract.

Нельзя выдумывать:
- birth date;
- country;
- verified contact status.

MAX может быть credential, поэтому initial password может отсутствовать.

После регистрации:
- ровно один Account;
- ровно один Personal Workspace;
- MAX linked;
- canonical session.

---

## MAX LINK

Условие:
- authenticated existing Account;
- fresh MAX assertion;
- subject не занят другим Account.

Результат:
- provider identity связывается с текущим Account.

Нельзя автоматически merge Accounts по:
- email;
- display name;
- username;
- IP/device.

---

# 10. MAX step-up

Для sensitive actions вводится отдельная fresh assurance semantics.

Минимальные операции:
- set password без current password;
- MAX unlink;
- recovery completion;
- будущие high-risk identity operations.

Freshness не продлевается обычным refresh token rotation.

TTL задаётся server-side и покрывается time-travel tests.

---

# 11. MAX self-lockout protection

Server read model должен уметь ответить:

```json
{
  "password": {
    "configured": true
  },
  "max": {
    "linked": true,
    "canUnlink": true
  },
  "recovery": {
    "methods": ["max"]
  }
}
```

Если MAX является последним usable credential:

```text
unlink
→ rejected by server
→ identity remains linked
→ sessions remain consistent
```

UI объясняет причину и предлагает сначала создать пароль.

---

# 12. Recovery

## Recovery v1

Первый реальный recovery method:

```text
linked MAX
→ fresh provider proof
→ short-lived one-time recovery authorization
→ set new password
→ consume recovery authorization
→ revoke other sessions
→ audit
```

Нельзя раскрывать существование unrelated Account по anonymous recovery response.

## Email recovery

Отдельный future slice после подключения реального mail provider.

UI не должен обещать отправку письма до фактической поддержки.

---

# 13. Target Account Settings IA

Целевые разделы:

1. **Профиль**
   - avatar;
   - username;
   - display name;
   - bio.

2. **Вход и безопасность**
   - password;
   - MAX;
   - recovery;
   - sessions/devices.

3. **Предпочтения**
   - timezone;
   - interface preferences;
   - notification preferences.

4. **Доступ и возможности**
   - content authoring;
   - educator capability;
   - personal/organization workspaces;
   - доступные scoped capabilities.

5. **Данные и приватность**
   - private Account facts;
   - contact data/state;
   - export/delete только когда реально поддерживаются.

"Приглашения и запросы" не должны существовать как пустая Settings-панель, если это фактически inbox/navigation use case.

---

# 14. Target Settings URLs

Настройки должны быть адресуемыми:

```text
/#/account/profile
/#/account/security
/#/account/preferences
/#/account/access
/#/account/privacy
```

Требования:
- reload сохраняет section;
- browser back/forward работает;
- old `/#/account` безопасно ведёт на default section;
- deep link не обходит authorization.

---

# 15. Frontend decomposition

Не выполнять redesign внутри одного 1300+ line component.

Разделить минимум:
- settings shell/navigation;
- Profile;
- Security;
- Preferences;
- Access;
- Privacy.

Security дополнительно разделить по ответственности:
- password;
- login methods / MAX;
- sessions.

Конкретные имена файлов не являются контрактом.

Контракт — отсутствие единого компонента, который одновременно управляет всеми Account resources.

---

# 16. Data loading contract

Текущая панель не должна зависеть от скрытых панелей.

Target:

```text
Profile
→ profile/avatar only

Security
→ security/login methods/sessions only

Preferences
→ relevant preferences only

Access
→ capabilities/workspaces only
```

MAX outage не показывает ошибку на Profile.

Session list failure не мешает сохранить bio.

Avatar upload failure не стирает unsaved profile draft.

---

# 17. Security read model

Предпочтительно предоставить frontend один server-owned security summary, например:

`GET /api/account/security`.

Это не жёсткое имя endpoint; важен контракт данных.

Минимальные факты:

```text
password.configured
password.requiresCurrentPassword
password.canSetWithFreshStepUp

max.available
max.linked
max.verifiedAt
max.canUnlink
max.unlinkBlockReason

recovery.supportedMethods
```

Frontend не должен реконструировать эти состояния по косвенным признакам.

---

# 18. Settings visual contract

Следовать `ASA_VISUAL_PRODUCT_SYSTEM.md`.

Требования:
- общие design tokens;
- единая typography hierarchy;
- единые controls;
- WCAG AA;
- минимум локальных hard-coded цветов;
- restrained card usage;
- компактный desktop;
- нормальная vertical mobile layout;
- нет horizontal overflow;
- нет декоративного "dashboard" там, где пользователь решает одну простую задачу.

Password UI должен быть обычной понятной формой, а не набором status-cards.

---

# 19. Password UX contract

## Configured password

Поля:
- current password;
- new password;
- repeat new password.

Для каждого secret field:
- show/hide;
- правильный autocomplete;
- keyboard accessible label.

Success:
- secret inputs очищены;
- UI сообщает только подтверждённый server outcome.

## Passwordless Account

Показывается "Создать пароль".

Current password скрывается только если server разрешил sensitive action по fresh assurance.

Frontend не принимает это решение самостоятельно.

---

# 20. Sessions UX contract

Session row:
- device/browser summary;
- platform;
- created time;
- last seen;
- current marker;
- authentication source, если это server-confirmed fact.

Actions:
- revoke non-current session;
- revoke all others;
- current session завершается обычным logout.

Пока legacy sessions поддерживаются backend, Account-wide security operation обязана учитывать их даже если UI не может красиво визуализировать legacy metadata.

---

# 21. API and OpenAPI contract

Все реально поддерживаемые Account/Auth endpoints должны быть представлены в OpenAPI.

Особое внимание:
- password status/change;
- security summary;
- sessions list/revoke/revoke-other;
- MAX status;
- MAX pairing;
- MAX register;
- MAX link;
- MAX unlink;
- recovery.

OpenAPI update входит в тот slice, который меняет соответствующий public API, а не откладывается "на потом".

---

# 22. Test strategy

## Layer A — use case

Проверяет:
- password validation;
- current password verification;
- fresh assurance;
- negative cases;
- no secret return.

## Layer B — PostgreSQL

Проверяет настоящие functions/migrations и session rows.

## Layer C — API integration

Реальный Nest app + real test PostgreSQL.

## Layer D — Playwright

Real built web + real API + isolated real test PostgreSQL.

Не mock `/api/account/password` в acceptance journey.

## Layer E — production acceptance

Только для MAX rollout и explicit deployment task.

---

# 23. Mandatory password regressions

## REG-PWD-01 — new Account

```text
register A
create second session with A
change A → B
current session alive
second session revoked
logout
login A FAIL
login B PASS
```

## REG-PWD-02 — migrated teacher

```text
organization login A
Security available
change A → B
logout
normal login A FAIL
organization login A FAIL
normal login B PASS
organization login B PASS
```

## REG-PWD-03 — pre-existing legacy session

```text
legacy session exists before password change
change password
legacy session no longer authorizes Account
```

## REG-PWD-04 — audit secrecy

Audit/log/error body contains no:
- current password;
- new password;
- password hash;
- raw session token;
- refresh token.

---

# 24. Mandatory MAX regressions

## REG-MAX-01

Known linked subject:
- login PASS;
- canonical session created.

## REG-MAX-02

Unknown subject during LOGIN:
- no Account silently created;
- explicit registration/link outcome.

## REG-MAX-03

MAX registration:
- actual policy data required;
- no synthetic birth date/country;
- one Account;
- one Personal Workspace;
- password initially optional.

## REG-MAX-04

MAX-only unlink:
- blocked.

## REG-MAX-05

MAX-only → create password → unlink:
- fresh assurance required;
- password created;
- unlink allowed;
- password login PASS.

## REG-MAX-06

Replay:
- reused assertion rejected;
- consumed pairing rejected;
- expired pairing rejected.

## REG-MAX-07

Stale source:
- old MAX-origin session alone cannot perform fresh-step-up-only operation.

---

# 25. Execution sequence

Следующие slices имеют **порядок**, но каждый стартует только после отдельного owner-selected task.

## AS-00 — Baseline proof and scope lock

Цель:
доказать реальные P0 на свежем main до изменения production code.

Сделать:
- focused regression setup для modern + organization login;
- доказать current behavior;
- классифицировать PASS/FAIL.

Правило:
не публиковать merge-кандидат, содержащий намеренно красный обязательный gate.

Обычно regression и repair фиксируются в одном bounded code slice, но "до" должно быть явно воспроизведено evidence.

STOP после evidence и выбранного repair scope.

---

## AS-01 — Canonical organization authentication

**Первый production-code slice.**

Цель:

```text
organization login
→ canonical Account password
→ canonical sessions_v2
```

Не делать:
- Settings redesign;
- MAX changes;
- recovery;
- admin redesign.

Acceptance:
- organization login принимает canonical current Account password;
- новый organization login больше не создаёт legacy session;
- ActiveContext открывает выбранный organization workspace;
- normal login regressions green;
- negative membership/workspace cases green.

STOP.

---

## AS-02 — Global password change revocation

Цель:
сделать password change Account-wide security event.

Сделать:
- current session preserved;
- other v2 sessions revoked;
- refresh revoked;
- historical legacy Account sessions revoked;
- OLD rejected everywhere;
- B accepted normal + organization paths.

Не удалять legacy tables в этом slice.

STOP.

---

## AS-03 — Password browser acceptance

Цель:
реальный пользовательский путь из браузера.

```text
register
→ login
→ Settings/Security
→ change
→ logout
→ old fail
→ new pass
```

Дополнительно migrated teacher browser journey.

Никакого redesign кроме минимального defect repair, необходимого для работоспособности.

STOP.

---

## AS-04 — Auth contract/evidence convergence

Цель:
синхронизировать доказательства с runtime.

Проверить/исправить только:
- OpenAPI auth/account endpoints;
- действительные package scripts;
- test catalog;
- execution references на реально существующие tests.

Не менять auth product behavior.

STOP.

---

## AS-05 — Account Settings structural decomposition

Цель:
разделить frontend без визуального redesign.

Поведение пользователя должно сохраниться.

Сделать:
- shell;
- panel components;
- panel-local loading/error;
- сохранить dirty profile semantics;
- focused UI regressions.

Не менять password/MAX semantics.

STOP.

---

## AS-06 — Account Settings UX redesign

Цель:
новая information architecture и responsive presentation.

Сделать:
- 5 целевых sections;
- addressable routes;
- show/hide password;
- visual tokens;
- desktop/tablet/mobile evidence;
- no horizontal overflow;
- accessibility.

Не менять auth architecture в этом slice.

STOP.

---

## AS-07 — MAX semantic convergence

Цель:
разделить LOGIN / LINK / REGISTER.

Сделать:
- unknown LOGIN не auto-register;
- explicit MAX registration;
- no synthetic policy facts;
- linking existing Account preserved;
- replay protection preserved.

Не включать production автоматически.

STOP.

---

## AS-08 — MAX safety and recovery

Цель:
sensitive lifecycle.

Сделать:
- fresh assurance;
- last-login-method guard;
- safe unlink;
- MAX-based password recovery/reset;
- session revocation;
- audit.

Email recovery не входит без реального mail provider.

STOP.

---

## AS-09 — MAX production acceptance

Это эксплуатационный slice, а не обычный coding slice.

Preconditions:
- exact candidate;
- relevant CI green;
- DB migration plan verified;
- backup/rollback ready;
- secret storage ready;
- новый нераскрытый MAX bot token;
- старый раскрытый token revoked;
- public HTTPS endpoint;
- TLS/CA verified.

Journey:
- enable configuration safely;
- real existing Account link;
- real MAX login;
- explicit MAX registration;
- create password for provider-only Account;
- logout/login combinations;
- restart API;
- repeat login;
- desktop/mobile;
- external network acceptance;
- audit/secret checks.

Issue/task closure только после owner acceptance.

STOP.

---

# 26. Migration policy

Любая новая migration:
- additive;
- получает номер выше каждого уже существующего applied version;
- старые migration files не переписываются;
- проходит isolated PostgreSQL smoke;
- имеет upgrade regression для существующих Accounts;
- не удаляет legacy structures в том же release, где новая canonical path впервые становится authority.

Legacy cleanup = отдельный future slice после rollback window и evidence отсутствия active dependency.

---

# 27. Deployment policy

AS-01 .. AS-08 не означают deployment permission.

Push/merge != deployment.

Production mutation выполняется только по отдельному прямому owner instruction.

Особенно запрещено автоматически:
- менять рабочую БД;
- применять migration в production;
- переключать MAX flag;
- обновлять token;
- restart production;
- менять FRP/VPN/DNS/Windows networking.

---

# 28. Bot task template

Каждая задача исполнителю должна содержать:

```text
repository
fresh base requirement
one selected slice
allowed paths
explicit non-scope
required preflight
current defect to reproduce
exact user outcome
focused tests
negative tests
CI/gate
evidence
STOP
```

Запрещён текст:

```text
"почини пароли, MAX и настройки"
```

Разрешён формат:

```text
AS-01 only:
organization login must authenticate canonical Account password
and create sessions_v2.
No UI redesign. No MAX. No recovery. STOP.
```

---

# 29. Review rules

Security-sensitive slices AS-01, AS-02, AS-07, AS-08 требуют bounded self-review минимум по:

- authentication source;
- session creation;
- revocation;
- cross-account isolation;
- replay;
- audit secrecy;
- error enumeration;
- rollback compatibility.

Reviewer не расширяет slice в общий identity refactor.

Найденный независимый дефект оформляется отдельно и не чинится "заодно", если он не блокирует selected invariant.

---

# 30. Branch strategy

Master plan может жить отдельно для review.

Product implementation:
- каждая code branch создаётся от fresh main;
- одна branch = один bounded slice;
- branch не переносит owner acceptance другого SHA;
- не строить AS-02 поверх незамёрженного AS-01, если владелец отдельно не разрешил stacked work;
- после merge следующая branch создаётся заново от fresh main.

Это снижает риск конфликтов с параллельными продуктовым lanes.

---

# 31. Program exit criteria

Программа закрыта только когда одновременно истинно:

```text
PASSWORD
- пользователь реально меняет пароль;
- OLD больше нигде не принимается;
- migrated organization path использует canonical password.

SESSIONS
- новые Account logins создают canonical sessions;
- password security event отзывает все остальные Account sessions;
- session list/revoke contract честен.

MAX
- LOGIN/LINK/REGISTER различны;
- unknown login не создаёт Account молча;
- policy facts не выдумываются;
- last method нельзя отключить;
- fresh assurance используется для sensitive actions;
- recovery через MAX реально работает.

SETTINGS
- разделы декомпозированы;
- panel errors независимы;
- routes адресуемы;
- desktop/tablet/mobile приняты;
- UI использует общую ASA visual system.

CONTRACTS
- OpenAPI соответствует runtime;
- test catalog соответствует существующим tests;
- critical acceptance не основан на mocked password API.

PRODUCTION
- MAX принят на реальном client/exact revision;
- секреты не раскрыты;
- rollback проверяем;
- owner acceptance зафиксирован.
```

---

# 32. Первый рекомендуемый coding slice

Начинать с **AS-01 — Canonical organization authentication**.

Причина:

простая форма смены пароля уже существует в canonical Account path, но compatibility organization-login способен оставить пользователя в legacy session/password model.

Пока этот фундамент не исправлен:
- password status может быть недоступен;
- old credential может жить отдельно;
- revoke не охватывает весь Account;
- Settings redesign маскирует, а не устраняет defect.

Поэтому первый реальный engineering result:

```text
старый teacher/organization entry
→ тот же Account
→ тот же canonical password authority
→ sessions_v2
→ Security page становится обычной Account security page
```

После этого AS-02 завершает password lifecycle Account-wide.

---

## Короткий принцип программы

```text
Сначала убрать двойную authentication truth.
Потом доказать смену пароля.
Потом привести evidence/контракты.
Потом декомпозировать и перерисовать Settings.
Потом довести MAX semantics/security.
И только потом включать MAX в production.
```
