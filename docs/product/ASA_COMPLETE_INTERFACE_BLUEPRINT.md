# ASA Lab — полный интерфейсный blueprint

**Статус:** нормативный кандидат R0.  
**Машиночитаемый каталог:** [`ASA_PRODUCT_SURFACE_CATALOG.yaml`](ASA_PRODUCT_SURFACE_CATALOG.yaml).  
**Полный functional-parity scope:** [`ASA_TINKERCAD_100_PERCENT_SCOPE.yaml`](ASA_TINKERCAD_100_PERCENT_SCOPE.yaml).

## 1. Честный ответ о текущем состоянии

До этого документа в репозитории были:

- сильная общая parity-спецификация;
- подробный Classroom/StudentSeat контракт;
- visual contract Portal и Electronics;
- целевой route blueprint;
- release-план R0–R10.

Но не было единого полного перечня всех страниц с ролями, маршрутами, состояниями, действиями и screenshot-gates. Не были исчерпывающе описаны:

1. school/platform admin interfaces;
2. полный learner portal;
3. все модальные и служебные поверхности Project lifecycle;
4. все инструменты Electronics simulator;
5. 3D, Codeblocks, Sim Lab, mobile/AR и интеграционные возможности;
6. точное правило, когда разрешено заявить «100% parity».

Теперь эти пробелы вынесены в отдельные нормативные контракты. Это ещё не означает, что страницы реализованы в runtime.

## 2. Что означает «100% копия»

ASA Lab не копирует:

- исходный код;
- товарные знаки;
- логотипы;
- закрытые тексты;
- Autodesk-owned assets;
- пиксель-в-пиксель внешний вид.

Цель — **100% функциональное соответствие согласованному reference scope**:

```text
тот же пользовательский результат
+ полный набор подтверждённых инструментов
+ эквивалентные состояния и ошибки
+ безопасная образовательная модель
+ собственный бренд и независимая реализация
```

Заявление `100% functional parity` запрещено, пока хотя бы один required capability:

```text
absent
partial
in_review
evidence_required
```

или пока owner visual flow не принят.

## 3. Основные shell-шаблоны

### 3.1. Public shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab                         Войти   Создать   Код класса │
├──────────────────────────────────────────────────────────────┤
│ Заголовок / контекст                                          │
│ Основная форма, каталог или public viewer                     │
│ Ошибка / помощь / privacy notice                              │
├──────────────────────────────────────────────────────────────┤
│ Безопасность · Конфиденциальность · Помощь                    │
└──────────────────────────────────────────────────────────────┘
```

### 3.2. Creator Portal

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab | Главная | Проекты | Классы* | Learn | Explore     │
│                                    Создать  🔔  Workspace  👤 │
├──────────────────────────────────────────────────────────────┤
│ Название страницы                              Primary action │
│ Поиск / фильтры / сортировка                                  │
│                                                              │
│ Карточки / таблица / empty state / error state                │
└──────────────────────────────────────────────────────────────┘
* Классы видны только при server-issued educator/class grant.
```

### 3.3. Classroom shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab | Классы > 8К2          Код  Safe Mode  Соучителя    │
├──────────────────────────────────────────────────────────────┤
│ Обзор Ученики Активности Проекты Модерация Проверка Оценки   │
├──────────────────────────────────────────────────────────────┤
│ Class context / filters / primary action                      │
│ Class-scoped content                                          │
│ Audit/help context                                            │
└──────────────────────────────────────────────────────────────┘
```

### 3.4. Learner shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab | Мой класс | Задания | Проекты | Значки       Выйти │
│ Safe Mode: включён                                           │
├──────────────────────────────────────────────────────────────┤
│ Что нужно сделать                                            │
│ Срок / статус / обратная связь                               │
│ Продолжить работу / открыть проект                            │
└──────────────────────────────────────────────────────────────┘
```

StudentSeat никогда не видит:

- список чужих учеников;
- public publishing controls;
- platform/community actions, запрещённые Safe Mode;
- account administration;
- plaintext credential после момента выдачи.

### 3.5. Shared Editor Host

```text
┌──────────────────────────────────────────────────────────────┐
│ ← контекст | Название | Сохранено | Версии | Copy | Share*   │
├──────────────────────────────────────────────────────────────┤
│ Module toolbar                                                │
├───────────────┬──────────────────────────────┬───────────────┤
│ Library       │ Stage / workplane / canvas   │ Inspector     │
│ Search/filter │                              │ Properties    │
│ Components    │                              │ Diagnostics   │
├───────────────┴──────────────────────────────┴───────────────┤
│ Simulation / runtime / code / measurement status             │
└──────────────────────────────────────────────────────────────┘
* Только если grants/policy позволяют.
```

### 3.6. Administration shell

```text
┌──────────────────────────────────────────────────────────────┐
│ ASA Lab Admin | Scope: Школа / Workspace / Platform          │
├───────────────────┬──────────────────────────────────────────┤
│ Navigation        │ Dashboard / filters / data table         │
│ Schools           │ Detail drawer                            │
│ Staff             │ Mutation confirmation                    │
│ Classes           │ Audit reason / request ID                │
│ Policies          │                                          │
│ Audit             │                                          │
└───────────────────┴──────────────────────────────────────────┘
```

Админка не является обычной вкладкой Teacher Portal. Она появляется только по server grants.

## 4. Полный набор пользовательских контуров

### 4.1. Anonymous/public

- public landing;
- sign-in intention router;
- Account login;
- Account registration;
- class-code entry;
- StudentSeat handle login;
- Account recovery;
- public ProjectVersion page;
- help/safety center.

### 4.2. Creator

- Creator Home;
- My Projects;
- module chooser;
- version journal;
- share/publication controls;
- Remix confirmation;
- Collections;
- Explore;
- Learning center;
- Challenges;
- Profile/portfolio;
- Notifications;
- Account settings;
- session management;
- Workspace switcher.

### 4.3. Educator/Classroom

- educator onboarding;
- class list/create;
- class overview;
- roster;
- individual/bulk StudentSeat issuance;
- class-code share/rotation;
- activities;
- activity builder;
- progress monitor;
- learner project gallery;
- learner portfolio;
- teacher Project Viewer;
- assistance editor;
- class activity feed;
- review queue/detail;
- gradebook;
- badges;
- moderation;
- co-teachers;
- class settings.

### 4.4. Learner

- learner home;
- classes;
- assignments;
- assignment detail;
- AssignmentWork editor;
- submission confirmation;
- feedback/revision;
- learner projects;
- badges;
- profile/privacy/Safe Mode;
- notifications.

### 4.5. Administration

School/Organization:

- dashboard;
- schools/buildings/periods;
- staff and scoped roles;
- organization classes;
- learners/StudentSeats;
- module availability;
- Safe Mode/publication policies;
- moderation;
- audit;
- reports/exports.

Platform:

- operations dashboard;
- Accounts/Principals;
- Workspaces/placement;
- Module Registry rollout;
- global policy versions;
- moderation queue;
- global audit explorer;
- audited support sessions;
- feature flags;
- jobs/queues;
- health/capacity;
- storage/retention/deletion;
- incidents/maintenance.

## 5. Обязательные состояния каждой страницы

Страница считается описанной только при наличии применимых состояний:

```text
loading
empty
populated
validation_error
authorization_denied
server_error
offline_or_reconnecting
success_feedback
```

Запрещено проектировать только happy path.

Любая mutation-страница обязана иметь:

- подтверждение scope/actor;
- field-level validation;
- pending state;
- idempotency или duplicate protection;
- success feedback;
- server error с request ID;
- audit event, если действие чувствительное;
- authorization denial без утечки существования чужого объекта.

## 6. Визуальная приёмка

Каждая поверхность в YAML-каталоге имеет `screenshot_ids`. Перед `parity_pass` требуются:

- desktop screenshot;
- mobile screenshot, если поверхность доступна на телефоне;
- empty и populated state;
- error/denied state для критических flows;
- live URL;
- console errors = 0;
- unexpected failed requests = 0;
- реальные student credentials/data отсутствуют.

## 7. Электроника

Полный Electronics contract вынесен в:

```text
docs/product/ASA_ELECTRONICS_WORKBENCH_COMPLETE_SPEC.md
docs/product/ASA_ELECTRONICS_TOOL_CATALOG.yaml
```

Кратко он охватывает:

- shared project chrome;
- stage/grid/pan/zoom/fit;
- select/multi-select/move/rotate/duplicate/delete/undo/redo;
- component library/search/categories/previews;
- terminals and realistic connectivity;
- wire creation/reconnect/bends/route/colour/delete;
- properties and measured values;
- deterministic simulation and honest diagnostics;
- instruments;
- Arduino/micro:bit;
- code modes and serial monitor;
- save/reload/version/preview;
- assignment and teacher viewer contexts;
- keyboard/accessibility;
- reference-evidence status for tools not yet independently confirmed.

## 8. Админка

Полный admin contract вынесен в:

```text
docs/product/ASA_ADMIN_CONSOLE_SPEC.md
```

Основные запреты:

- admin UI не выдаёт себе grants;
- school admin не становится platform admin;
- support session не является скрытым impersonation;
- plaintext passwords/tokens/student credentials не показываются;
- destructive bulk action требует preview, reason, scope and audit;
- health dashboard не показывает fake success;
- child data export ограничен policy и scope.

## 9. Интерфейс ученика

Полный learner contract вынесен в:

```text
docs/product/ASA_STUDENT_EXPERIENCE_SPEC.md
```

StudentSeat и зарегистрированный ученик используют похожий visual shell, но остаются разными Principal/session types.

## 10. Что реализовано, а что только описано

```text
Teacher login/class list/create        partial
Project/Draft/Version                  partial
Electronics basic editor/simulation    in_review
Complete Creator Home                  absent
Complete StudentSeat flow              absent
Complete learner portal                absent
Assignments/review/grade/badge         absent
School admin console                   absent
Platform admin console                 absent
3D Design                              absent
Codeblocks                              absent
Sim Lab                                absent
Public/Explore/Remix                    absent
```

Документация теперь определяет конечный результат. Она не должна использоваться как доказательство runtime parity.

## 11. Coding-agent rule

Перед созданием любой страницы агент обязан указать:

1. `surface_id` из `ASA_PRODUCT_SURFACE_CATALOG.yaml`;
2. actor и server grant;
3. route;
4. layout template;
5. все применимые states;
6. required actions;
7. data/API contracts;
8. test IDs;
9. screenshot IDs;
10. какой capability из `ASA_TINKERCAD_100_PERCENT_SCOPE.yaml` закрывается.

Страница без этих десяти пунктов не начинается.
