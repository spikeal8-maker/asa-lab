# Единый административный каталог: авторский срез

База `4cf71f8a`, один порученный владельцем пункт. Новый read-only
`GET /api/admin/v1/users` и migration 0245; старый `/accounts`, Account CRM и
разрешённые Account mutations сохранены. Сайт, рабочая БД, роли, RLS-модель,
email editing и полный Student CRM не менялись.

Каталог различает Account и StudentSeat по kind+UUID, не объединяет linked
записи и не создаёт identities. Principal берётся из canonical lookup, отсутствие
остаётся NULL. Platform видит оба типа; org — только прежние authorized Accounts
и явный studentCoverage unavailable: canonical class→organization workspace
mapping отсутствует. Tenant/name/teacher membership не заменяют эту authority.

**Credential boundary:** StudentCode исключён и из SQL projection, и из search;
student.login всегда NULL. Account public username сохранён. NULL email
external-only Account не подменяется адресом и не мешает name/username search.
Seat строки имеют только readonly class/status/activity/IP/device summary;
Account detail/actions вызываются только с настоящим Account id.

Фильтры search/kind/status, sort/direction и limit 1..100 применяются сервером
до pagination. Действующие Seat records: issued/active, Account: active; raw
status виден отдельно, это не online. Сортировка всего набора: name (C collation),
зафиксированная активность, 30-day event count, created time. NULL last и kind/id
ties детерминированы. `limit+1` даёт настоящее продолжение, клиент не сортирует
первую страницу. Смена criteria/scope сбрасывает cursor и старые ответы.

Cursor — bounded base64url JSON continuation, не authority: SHA-256 fingerprint
canonical actor/scope/filters/sort/direction, точные SQL microseconds, typed tuple
и cutoff не старше часа/не из будущего. SQL заново проверяет admin role/scope.
Cutoff отсекает позднюю persistence событий; это не MVCC snapshot mutable имён,
статусов или scopes. Heartbeat last_seen не является sort anchor: используются
immutable event facts и session.created_at, текущая связь показывается отдельно.
Чувствительные query values не дублируются в cursor fingerprint.

Каждый API read проверяет accounts.read, записывает audit и выполняет SELECT
в owned read-only transaction с SET LOCAL statement_timeout=8s. При rollback
failure только этот client уничтожается через release(true), исходная ошибка
сохраняется, release ровно один. Definer SQL имеет fixed search_path и не имеет
PUBLIC EXECUTE. Добавлены matching Seat/event/session и Account/scope indexes.

## Проверки и wiring

Первый focused run — **6 suites / 39 PASS**, 10.64 s:

```text
vitest run apps/api/src/admin-user-catalog.spec.ts apps/api/src/admin.controller.spec.ts apps/web/src/admin/testing/admin-user-catalog.spec.ts apps/web/src/admin/testing/admin-api.spec.ts apps/web/src/admin/testing/admin-page.spec.ts apps/web/src/admin/testing/admin-navigation.spec.ts --silent
```

После security/type/resource уточнений повторены только затронутые suites:
`admin-user-catalog.spec.ts` API + web — **10/10 PASS**, 1.23 s, включая новый
rollback discard/primary-error case и защиту UI от nonpublic Seat login.
Полный API tsc — PASS после собственного exactOptionalPropertyTypes исправления.
Read-only semantic/syntax inspection пяти изменённых web paths — 0 diagnostics;
полный локальный web typecheck не заявляется из-за неполных зависимостей.
Control-plane — PASS; formatter/diff checks — PASS.

Подготовлены **9 isolated PG cases**: >50 actors, четыре sorts × два directions,
ties/NULL, combinations, typed UUID collision/linked identities, unavailable org
students даже при совпадении tenant, denied scopes, raw microseconds, malformed/
cross-query/expired cursor, heartbeat between pages, late persistence/window,
NULL-email Account и отсутствие credential projection/search oracle, privileges.
Локальная БД не запускалась: SQL proof ещё требует GitHub.

Account Confirmation Focused server job теперь явно запускает новый API unit и
`tests/admin/admin-user-catalog.pg.spec.ts`; package admin gate тоже включает PG.
Browser job включает новый web unit. Built-SPA fixture сохраняет прежние 9 cases
и добавляет 4 каталожных viewport cases: 1440/1024/390/320, no page overflow,
long content, readonly Seat, Account CRM entry, server filters/page cursor и
org unavailable. Снимки users-1440/users-390 попадут в существующий artifact
через `reports/playwright/admin-dashboard`. Legacy UI mock consumers обновлены
на новую форму `/users`; старый API unit coverage сохранён.

Impact radius: новый `.admin-users-catalog` scoped layout и readonly four-slot
Seat row; на mobile все Seat summary поля доступны, основные имена переносятся.
Account row/detail controls переиспользованы; Overview/App grant logic и другие
admin sections не изменены. Shared admin CSS правила ограничены новым modifier.

Три forward migration consumers дополнены только 0245, прежние checksums
сохранены. SHA-256 0245:
`a632b0a9acdb797bd36d2761a41c382e89e40536ba47db139e569ff82a5acd3e`.
Normative section, compact surface и test catalog зарегистрированы без изменения
`current.yaml`. Независимый source review, GitHub PG/browser proof и визуальный
просмотр ещё ожидаются. VISUAL/OWNER acceptance и deployment не заявляются.
Автор формирует один commit и STOP; публикация и ожидание CI — контроллеру.
