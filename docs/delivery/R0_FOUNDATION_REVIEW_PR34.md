# R0 — owner review PR №34: Electronics/Project foundation

**PR:** №34  
**Роль:** ограниченный foundation candidate  
**Не является:** полной Tinkercad parity, R3 Project Hub или R4 final Electronics release.

Документ основан на опубликованном PR body и changed-file scope. Локальные `22 PASS` и demo claims должны быть повторно подтверждены исполнителем перед merge.

## 1. Что предлагается принять

### Project foundation

- personal project без обязательного Classroom;
- classroom project как отдельный scope;
- `Project`, mutable `ProjectDraft`, immutable `ProjectVersion`;
- rename;
- autosave/manual save;
- reload;
- checkpoint;
- tenant/RLS ownership;
- additive migration `0004_personal_teacher_projects.sql`.

### Electronics foundation

- fullscreen workbench;
- component library/search/categories;
- original ASA Lab vector components;
- component placement/drag;
- pan/zoom/fit;
- undo/redo/duplicate/delete/rotate;
- terminal/wire model, colour and route;
- property inspector;
- start/stop DC simulation;
- diagnostics;
- save/reload coordinates and state.

### Portal separation

```text
Мои проекты  personal creator surface
Классы       educational surface
```

Personal Electronics project не требует Classroom.

## 2. Что не принимается этим PR

- Account/Principal/Workspace transition;
- universal Module Registry/Editor Host contract;
- multiple subject modules;
- publication/unlisted/public page;
- Copy/Remix;
- Profile/Explore/community;
- StudentSeat/class code;
- learner portfolio/teacher Viewer;
- assignments/submissions/review/grades/badges;
- Arduino, transient simulation or worker infrastructure;
- claim of complete Tinkercad parity.

Эти возможности остаются в R1–R10.

## 3. Owner live checklist

Запустить опубликованный demo только на канонических портах и проверить:

1. после входа открывается `Мои проекты`;
2. личный Electronics project создаётся без класса;
3. `Классы` остаются отдельным разделом;
4. workbench использует экран без критического overflow;
5. battery/resistor/LED читаемы и являются original ASA Lab assets;
6. drag/pan/zoom/fit работают;
7. undo/redo/duplicate/delete/rotate работают;
8. wire привязывается к terminals, редактируется и сохраняется;
9. inspector не закрывает критическую часть circuit;
10. start/stop simulation даёт deterministic result или honest diagnostic;
11. autosave/reload сохраняют документ;
12. checkpoint создаёт immutable version;
13. существующие teacher/classes/projects не исчезли;
14. mobile/compact mode не имеет горизонтального overflow;
15. порт `5173` не используется и чужой процесс не завершается.

## 4. Technical recheck before merge

Исполнитель обязан повторно показать:

```text
commit SHA
base SHA
working tree clean
migration empty DB PASS
migration existing DB PASS
migration repeat PASS
RLS/authz negative tests PASS
project save/reload/version PASS
Electronics schema/netlist/simulation tests PASS
Playwright owner flow PASS
desktop/mobile screenshots
console errors = 0
unexpected failed requests = 0
```

Локальный прошлый claim `22 PASS` не считается автоматически принятым после изменения base или dependencies.

## 5. Accept decision

### ACCEPT FOUNDATION

Выбрать, если:

- пункты live checklist приняты;
- данные сохраняются;
- migration additive;
- PR не содержит R1/R5/R7/R9 scope;
- owner принимает visual foundation с перечисленными limitations.

Запись в PR №34:

```text
OWNER FOUNDATION DECISION: ACCEPTED
Scope: Project + Electronics foundation only
Parity completion: NOT CLAIMED
Known deferred releases: R1–R10
```

После merge PR №43 один раз rebased на новый `main`.

### REJECT / CHANGES REQUIRED

Использовать при:

- потере/переназначении существующих данных;
- неработающем save/reload;
- ложной simulation success;
- subject-specific data в Core;
- неприемлемом workbench layout;
- критических accessibility/security findings;
- scope creep.

Запись должна перечислить конкретные blockers. Новую competing Electronics branch не создавать.

## 6. После решения

- accepted → merge №34, затем rebase/validate PR №43;
- rejected → исправить только foundation blockers или закрыть №34;
- transfer-only PR №35/№45/№47 остаются frozen до merge PR №43;
- R1 не начинается.
