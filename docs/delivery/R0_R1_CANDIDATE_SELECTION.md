# R0 — выбор единственной R1 identity-линии

**Кандидат A:** PR №59 — broad C1 identity  
**Кандидат B:** PR №60 — narrow Account vertical  
**Текущий статус:** оба frozen до завершения R0B foundation integration.

Этот документ основан на опубликованных PR bodies, changed-file lists и ключевых migration fragments. Он не заменяет локальный rebase/test/security review.

## 1. Требуемый R1 результат

```text
adult register / login without workspace code
→ Account + Profile + account Principal
→ exactly one Personal Workspace
→ sessions_v2 with server-derived active Workspace
→ creator capability
→ personal Project ownership by Principal
→ logout / username login / email login
→ existing teacher compatibility
→ audited educator capability milestone
```

R1 не включает class-code/StudentSeat, publication, Electronics feature expansion или destructive legacy cleanup.

## 2. Сравнение

| Критерий | PR №59 — Candidate A | PR №60 — Candidate B |
|---|---|---|
| Объём | 85 файлов / 6052 additions | 67 файлов / 3744 additions |
| Commits | 10 | 3 |
| Account/Profile/Principal/Workspace | да | да |
| sessions_v2 | нет | да |
| Реальная регистрация → session | намеренно выключена без sessions_v2 | реализована как vertical |
| Personal Workspace | backfill/structure | backfill + live account flow |
| Principal-owned personal Project | не завершён как live session flow | реализован |
| Existing teacher bridge | да | да |
| Educator capability | schema/backfill существующих teachers | schema/backfill; new Account creator only |
| Class-code/join intent | включён, хотя target относит к R5 | отсутствует |
| Public entry/sign-up routes | широкое покрытие | минимально для vertical |
| Additive migration discipline | сильный preflight и compatibility fields | additive, но меняет project author nullability + Principal ownership |
| Scope alignment R1 | частично; содержит R5 concern | ближе к R1 vertical |
| Заявленные tests | 213 Vitest / 20 Playwright / 27 task gate | 176 Vitest / 17 Playwright / 23 task gate |

Числа — claims PR bodies, а не независимый повторный прогон.

## 3. Архитектурная оценка

### Candidate A — сильные стороны

- подробный additive backfill;
- preflight вместо удаления orphan Principal;
- явная compatibility-модель;
- capability/workspace vocabulary близка target contract;
- безопасная граница class-code resolve/preview;
- богатый evidence package.

### Candidate A — blockers как единственной R1-линии

- нет `sessions_v2`;
- registration намеренно не создаёт рабочую session;
- Personal Workspace нельзя использовать как полноценный signed-in vertical;
- class-code/join intent относится к R5 и расширяет R1 scope;
- больше поверхность и риск merge/conflict.

### Candidate B — сильные стороны

- реализует главный R1 vertical от регистрации до повторного входа;
- `sessions_v2` принадлежит Principal и хранит active Workspace;
- personal project принадлежит Principal;
- creator без educator не получает Classroom API;
- меньше diff и меньше cross-release scope;
- существующий teacher compatibility сохраняется.

### Candidate B — риски

- требует особенно строгого review изменения nullability author columns;
- нужно подтвердить tenant/principal lineage для personal и legacy projects;
- educator grant/onboarding ещё не завершает весь R1;
- публичная entry/age/email-verification модель может потребовать перенос отдельных решений Candidate A;
- локальные PASS claims должны быть повторены после rebase на accepted baseline.

## 4. Рекомендация

**Рекомендуемый базовый кандидат: PR №60 / Candidate B.**

Причина: он единственный из двух реализует обязательный R1 user flow с `sessions_v2`, Personal Workspace и Principal-owned personal Project, при этом не затягивает в R1 class-code/StudentSeat concern.

PR №59 не выбрасывается. Он становится selective transfer source только для подтверждённых R1-совместимых частей:

- migration preflight/integrity patterns;
- baseline preservation tooling;
- age/email verification policy;
- public entry UX, если она не расширяет текущий milestone;
- explicit compatibility/deprecation metadata.

Не переносить из №59 в R1:

- join-class controllers/use cases;
- class-code secret/issue tools;
- Classroom join intent;
- R5 screens/routes;
- любые функции, не требуемые текущим R1 milestone.

## 5. Обязательный selection procedure

После R0B integration:

1. rebase both candidates read-only against accepted baseline or compute conflict report;
2. повторить migration tests на empty/existing/backup copy;
3. проверить сохранение teacher/classes/projects/Electronics;
4. проверить sessions_v2, token hashing, revocation and active Workspace;
5. проверить principal/tenant ownership and RLS;
6. проверить creator without educator cannot access Classes;
7. проверить no class-code/StudentSeat scope in selected R1 diff;
8. owner подтверждает visible Account vertical;
9. выбрать один candidate;
10. закрыть второй superseded после доказанного selective transfer.

## 6. Decision records

### Выбрать Candidate B — рекомендуемый вариант

```text
R1 CANDIDATE DECISION: PR #60 SELECTED
Reason: complete sessions_v2 + Personal Workspace + Principal-owned Project vertical
PR #59 role: selective R1-compatible transfer source only
Class-code/StudentSeat transfer: prohibited until R5
```

### Выбрать Candidate A

Допустимо только если перед выбором в нём реализованы и доказаны:

- sessions_v2;
- working registration/login Personal Workspace vertical;
- Principal-owned personal project;
- удаление R5 class-code scope из selected R1 diff;
- не больший migration/data risk, чем у Candidate B.

### Отклонить оба

Разрешено при доказанном blocker. Новая третья реализация не создаётся автоматически: сначала owner-approved consolidation plan из лучших проверенных частей обоих candidates.

## 7. Merge prohibition

Ни №59, ни №60 не merge до:

- owner approval PR №43;
- R0A activation;
- R0B single integration baseline;
- full selection procedure;
- update Issue №48 и exact R1 tests;
- one rebase on accepted baseline.
