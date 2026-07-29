# R0 — решение владельца перед дальнейшей разработкой

Этот документ не требует технических знаний. Он фиксирует пять решений, без которых coding-агенты снова начнут строить несовместимые варианты ASA Lab.

## Что уже существует

- `main` — работающий Teacher Portal foundation;
- PR №34 — Electronics/Project foundation candidate;
- PR №43 — целевая продуктовая и архитектурная модель;
- PR №45/№47 — transfer-only Project Hub и Visual System candidates;
- PR №59/№60 — две конкурирующие реализации R1 identity.

До принятия R0 новая продуктовая ветка не создаётся.

---

## Решение 1. Один Account, несколько контекстов

### Предлагается

```text
Account       глобальная учётная запись человека
Principal     субъект, от имени которого действует сессия
Workspace     personal или organization рабочее пространство
Capability    creator / educator / registered_student / guardian / platform_admin
Membership    scoped-доступ внутри Workspace
```

Педагог не является отдельным типом аккаунта. Это взрослый Account с capability `educator`. Он сохраняет личные проекты и дополнительно получает Classes.

### Почему

Иначе один человек получит разные несвязанные аккаунты для личных проектов, преподавания и администрирования.

### Owner decision

- [ ] Принять
- [ ] Отклонить и описать альтернативу

---

## Решение 2. Tenant/RLS сохраняются

### Предлагается

`Workspace` становится продуктовой abstraction, но текущий `tenant_id`, composite lineage и PostgreSQL RLS сохраняются как security/storage boundary.

```text
Personal Workspace      1:1 backed by Tenant в первой версии
Organization Workspace  backed by Tenant
```

### Почему

Это сохраняет существующую изоляцию, классы, проекты и миграции; не требуется опасное переписывание базы.

### Owner decision

- [ ] Принять
- [ ] Отклонить и описать альтернативу

---

## Решение 3. Личный проект не требует класса

### Предлагается

Любой creator может создавать private personal projects. Classroom — отдельный образовательный контур, а не обязательный родитель каждого проекта.

```text
Personal Project
Classroom Project
Assignment Work
Team Project
```

### Почему

Это соответствует целевой Creator Home/My Projects модели и позволяет Electronics, 3D, Blocks, Chess и другие редакторы использовать вне урока.

### Owner decision

- [ ] Принять
- [ ] Отклонить и описать альтернативу

---

## Решение 4. Account session и StudentSeat session различаются

### Предлагается

- Account session — глобальный Account/Principal с Workspace context;
- StudentSeat session — ребёнок без обязательного email, scoped к выданному месту/классу и Safe Mode.

Они используют общую session infrastructure, но не один undifferentiated тип доступа.

### Почему

StudentSeat имеет другие credential, privacy, publication и recovery rules. Смешивание создаёт опасные обходы Safe Mode и ролей.

### Owner decision

- [ ] Принять
- [ ] Отклонить и описать альтернативу

---

## Решение 5. Очередь R0–R10

### Предлагается

```text
R0  Contract and one accepted baseline
R1  Account / Profile / Personal Workspace / Sessions / Educator Grant
R2  Creator Home and Portal shell
R3  Module Registry / Project Hub / Editor Host
R4  Electronics parity
R5  Classroom / class code / StudentSeat / Safe Mode
R6  Learner portfolio / teacher Project Viewer
R7  Sharing / publication / Remix
R8  Profiles / Explore / moderation
R9  Assignments / submissions / review / grades / badges
R10 Multi-module proof and measured operations scale
```

Каждый release имеет отдельный owner stop. Следующий не начинается автоматически.

### Почему

Identity и ownership должны быть определены до новых Portal/Project функций. Публикация должна ссылаться на immutable version. Classroom/StudentSeat должны использовать уже универсальные проекты, а не отдельную предметную систему.

### Owner decision

- [ ] Принять
- [ ] Отклонить и описать альтернативу

---

## Решение по текущим веткам

После принятия пяти решений:

```text
1. Принять или отклонить PR №34 как ограниченный Electronics/Project foundation
2. Rebase и merge PR №43
3. Создать один P1 integration PR из проверенной integration branch
4. Закрыть transfer-only PR №35/№45/№47 после переноса
5. Выбрать PR №59 ИЛИ PR №60 как единственную R1 identity-линию
6. Вторую identity-линию закрыть как superseded
```

- [ ] Порядок конвергенции принят
- [ ] Требуются изменения: ______________________________

## Что означает принятие

После проставления решений владелец пишет в PR №43:

```text
OWNER DECISION: APPROVED
Decisions 1–5: accepted
Convergence order: accepted
```

Только после этого локальный исполнитель запускает validators, rebase и merge PR №43. В той же сессии product coding не начинается.
