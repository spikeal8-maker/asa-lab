# Администрирование: навигация и читаемый обзор

Один выбранный владельцем срез, исходный SHA `523552a1`. Работающий сайт,
backend, RLS, данные пользователей, IP-инфраструктура и CRM не изменялись.

## Изменение

Переход между административными разделами по-прежнему проверяет `/admin/v1/me`,
но не уничтожает уже проверенную оболочку на время фонового запроса. Grant
привязан к canonical Account/User, workspace, capabilities и verification;
profile accountId/activeWorkspaceId проверяются по текущей сессии. Контекстный
epoch и request generation исключают поздние ответы и возврат старого grant
после A→B→A. При 401/403 административное содержимое немедленно снимается.

Ручное обновление обзора сохраняет смонтированные графики только для того же
scope/range, явно сообщает обновление и показывает ошибку со статусом прежних
данных. Смена области или периода сразу убирает старые данные; поздние ответы
отбрасываются. Успешный ответ с другим range не выдаётся за выбранный период.

Временная ось содержит до 12 существующих точек, минимум 10 при наличии 10+
серверных точек; новые точки и события не выдумываются. Целочисленные Y ticks
не дублируют 0/1 при малых значениях, X grid совпадает с подписями. Учебные
инструменты (электроника, 3D, Scratch) и игры (шахматы, шашки) разделены в
графиках запусков и активного времени. Все пять цветов заданы явно. KPI
различают аккаунты и ученические места, не складывая их в уникальных людей.

Графики занимают полную ширину desktop; на узком экране прокручивается только
plot с читаемыми подписями и клавиатурным focus. Заголовок и legend имеют разные
строки. Скрыта только графика scrollbar в административной sidebar/nav;
overflow/scrolling и доступ ко всем пунктам меню сохранены.

## Impact radius и evidence

- App access snapshot относится ко всем admin routes; representative overview
  и users проверяются задержанным recheck, 401/403 и сменой identity.
- `.admin-dashboard-grid`, chart header/legend/canvas/axis используются только
  восемью графиками AdminDashboard. Остальные admin страницы эти классы не
  используют. Переключение range/scope и состояния refresh/error/empty/retry
  включены в browser fixture.
- `.portal-admin-context` добавляется только на административном маршруте.
  Обычные PortalHeader/Account/Classroom не совпадают с новым CSS selector.
  Существующие Account R3 и classroom mobile header browser checks сохранены
  в том же workflow как соседние shell consumers.

Первый направленный запуск:

```text
vitest run apps/web/src/admin/testing/admin-dashboard.spec.ts apps/web/src/admin/testing/admin-shell.spec.ts apps/web/src/admin/testing/admin-page.spec.ts apps/web/src/admin/testing/admin-navigation.spec.ts --silent
```

4 suites / 12 tests PASS, 12.38 s; семь новых проверок axes, refresh lifecycle,
scope/range isolation, 401/403 и identity binding. Повторных unit прогонов нет.
Направленный ESLint — без ошибок; Nx boundary rule пропущена из-за отсутствия
cached ProjectGraph. Control-plane validation и formatter/diff checks — PASS.
Компактная admin surface и исполнимые test IDs зарегистрированы без изменения
`current.yaml`.

Полный локальный web tsc — **не PASS**: среда не содержит react-markdown,
remark/rehype, three и собранные workspace module exports; получены missing
module и cascading implicit-any diagnostics. Установка/сборка соседних модулей
не запускалась. Отдельная read-only TypeScript syntax/semantic inspection
только пяти изменённых web paths дала 0 diagnostics, 4.17 s; это не полный gate.
Authoritative полный web:typecheck остаётся в GitHub.

Playwright discovery обнаружил **9 cases** без запуска браузера: populated
1440/1024/390/320 с page-overflow assertions, local keyboard scroll, всеми
цветами и long labels; refresh/error/empty/loading/retry; navigation shell
continuity и 401/403; поздний old-account grant; поздний old-scope dashboard.

Точный CI маршрут: Account Confirmation Focused → `browser` →
`pnpm e2e:settings-ui e2e/admin-dashboard-ui.spec.ts`. Это существующий built-SPA
route-intercept workflow без локального сервера/БД. Добавлены path trigger,
testMatch и явные unit/browser steps; старые проверки не заменены.
Снимки 1440/390 сохранятся в `reports/playwright/admin-dashboard/overview-*.png`
и попадут в существующий artifact `auth-confirmation-ui-<SHA>-<attempt>` через
`reports/playwright`. Exact build identity также сохраняется существующим job.

**Browser execution, screenshots и визуальный review ещё не выполнены.** Этот
авторский кандидат не объявляется VISUAL_ACCEPTANCE/OWNER_ACCEPTED до exact-SHA
GitHub evidence и просмотра снимков контроллером. Локальные browser/server/
Docker и live account mutations не запускались. Автор формирует commit и STOP;
независимый source review, публикация и ожидание CI остаются контроллеру.

## Ограниченное исправление собственного CSS overflow после CI

На source-reviewed main `0c22a332` workflow `40188668358`, browser job
`121154766622`, новые browser cases дали 5 PASS / 4 FAIL. Desktop 1440 и
auth/lifecycle проверки прошли; 1024/390/320 и mobile refresh обнаружили настоящий
page-level overflow прежним assertion. Web typecheck, policy PG и installation
проверки прошли; существующие auth/settings browser checks также прошли.

Readonly разбор скачанного 390 trace подтвердил viewport 390, SVG min-width 960
и расширение ready layout вместе с KPI/toolbar. Причина: `.admin-dashboard`
имел неявную auto grid column, а ready wrapper с `aria-busy` — automatic
min-content width. Intrinsic ширина локального plot/KPI проходила через этот
ancestor раньше, чем canvas мог ограничить собственную прокрутку.

Исправлены только shrinkable layout boundaries: явный minmax(0,1fr),
min-width:0 у dashboard/direct children и width/max-width:100% у canvas.
Широкий SVG остаётся внутри overflow-x:auto; body clipping и исключений из
исходного page-overflow assertion нет. Assertion дополнен диагностическими
размерами элементов. После проверки keyboard scroll plot теряет focus перед
normal screenshot; focus outline и клавиатурная доступность не отключены.

Formatter и diff checks — PASS. Неизменные unit12 и typecheck повторно не
запускались. Реальная проверка CSS repair и mobile screenshot требуют нового
GitHub browser run. Desktop 1440 просмотрен контроллером: читаемые подписи и
группы без visual blocker. Mobile 390 PNG в первом run не создан из-за честного
раннего assertion; визуальная приёмка mobile ещё не получена. Сайт не обновлялся.
