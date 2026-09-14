# PROJ-R7-02 — Public Project Page

**Статус:** PREPARED / NOT ACTIVATED  
**Релиз:** R7  
**Depends on:** accepted `PROJ-R7-01`  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**UI contract:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`  
**Decisions:** `docs/product/projects/DECISION_LEDGER.md`

---

## 0. Activation gate

Coding разрешён только после:

1. `PROJ-R7-01` accepted;
2. `docs/execution/current.yaml` явно выбирает этот slice;
3. `pnpm control-plane:check` PASS;
4. current `main` сравнен с последним Public Projects audit baseline;
5. `DEC-PROJ-101` canonical public URL принят;
6. relevant architecture delta не делает task card stale.

Task card не разрешает автоматически переходить к R7-03.

---

## 1. Пользовательский результат

Пользователь получает полноценную отдельную публичную страницу конкретной immutable публикации с stable URL.

Первый экран отвечает:

- что это за проект;
- кто автор;
- какой модуль/тип;
- что можно открыть/запустить сейчас;
- можно ли сохранить;
- можно ли сделать свою версию;
- можно ли поделиться.

До interactive viewers используется честный static preview/fallback.

---

## 2. Scope

Входит:

- canonical public route + legacy `/gallery/:id` compatibility/redirect;
- page layout desktop/mobile;
- static preview;
- safe author projection;
- title/summary/description/tags/license;
- provenance;
- Collections save;
- share stable URL;
- copy/remix через R7-01 exact published ProjectVersion;
- owner-safe controls, которые уже существуют и не требуют publication editor;
- unavailable/revoked/not-found states;
- loading/error/offline-safe fallback;
- accessibility.

Не входит:

- 3D/Electronics/Blocks/Game interactive viewer;
- upload media;
- publication draft/revision editor;
- comments;
- discovery catalog redesign;
- studios/coauthor collaboration.

---

## 3. REUSE / MODIFY / BUILD

### REUSE

- ASA Lab shell/header/navigation;
- R7-01 sanitized publication DTO;
- existing snapshot/preview;
- Collections + `CollectPicker`;
- existing copy/provenance flow after R7-01 convergence;
- existing share dialog pattern where suitable;
- GalleryWork regression behavior that remains valid.

### MODIFY

- `GalleryWorkPage.tsx` → compatibility wrapper or gradual migration;
- routing in `App.tsx`/portal router;
- public API client models;
- owner unpublish/revoke UX to match non-destructive R7 state.

### BUILD

- isolated `PublicProjectPage` surface/components if existing page cannot satisfy contract cleanly;
- type-specific primary CTA mapping;
- canonical unavailable states.

### DO-NOT-TOUCH

- Working Draft/editor internals;
- module authoring tools;
- Collections storage;
- classroom Projects page;
- My Projects semantics.

---

## 4. Layout contract

Desktop:

- viewer/preview 65–70%;
- details/actions 30–35%;
- content max-width; no giant marketing hero.

Mobile:

- preview 100% width;
- title/author/actions below;
- touch target >=44×44;
- no hover dependency;
- CTA order remains obvious at 320–430 CSS px.

Visual priority:

`project visual → title → author → primary/secondary actions → social/service metadata`.

---

## 5. Actions

Primary CTA is module-specific where capability exists:

- `Открыть 3D`;
- `Запустить симуляцию`;
- `Играть`;
- `Открыть программу`;
- fallback `Открыть проект`.

Until R7-04 viewer exists, unsupported interactive action must not pretend to work. Use static preview + appropriate copy/open-editor action for owner where canonical.

Secondary primary action:

**Сделать свою версию**.

Additional actions:

- сохранить;
- поделиться;
- реакция, если current policy разрешает;
- скачать только при proven server contract;
- report/comments не включать раньше своих slices.

---

## 6. Security/privacy

- page reads only sanitized immutable publication projection;
- no `project_drafts.document_json`;
- no tenant/class/school identifiers;
- no private profile/email data;
- revoked/private/ineligible state fails closed;
- unlisted requires valid ShareLink authorization;
- owner-only actions authorized server-side.

---

## 7. Required tests

API/integration:

- eligible public metadata accessible anonymous;
- revoked/private denied;
- unlisted token flow respects R7-01;
- public DTO contains no mutable raw document/private identifiers.

E2E:

1. direct public URL opens after reload;
2. legacy Gallery URL remains compatible;
3. static preview visible;
4. author/title/license/provenance render correctly;
5. save uses Collections;
6. copy creates independent private Project + provenance;
7. share returns stable public URL;
8. mobile 360/390/430 has no horizontal overflow;
9. keyboard/focus path works;
10. My Projects/Classroom Projects regressions remain green.

---

## 8. Acceptance Criteria

- **R7-02-AC01** stable canonical public URL exists.
- **R7-02-AC02** legacy link compatibility preserved.
- **R7-02-AC03** page uses immutable sanitized publication state.
- **R7-02-AC04** static preview is a complete fallback.
- **R7-02-AC05** save uses Collections.
- **R7-02-AC06** copy/remix uses exact published source and provenance.
- **R7-02-AC07** responsive/mobile contract passes.
- **R7-02-AC08** accessibility critical path passes.
- **R7-02-AC09** owner/public actions obey server authz.
- **R7-02-AC10** no R7-03/R8 work starts automatically.

---

## 9. Hygiene / evidence

Apply repository hygiene policy. This is a standard Projects slice unless it introduces heavy viewer/runtime code.

Evidence includes:

- baseline/final SHA;
- route/API diff;
- screenshots at key viewports;
- regression commands/results;
- public DTO privacy evidence;
- updated hygiene counter;
- explicit `STOP` after acceptance.

---

## 10. STOP conditions

STOP if canonical route is unresolved, R7-01 is not accepted, safe publication DTO is insufficient, implementation would require exposing mutable draft, or scope expands into viewer/media/comments/discovery.