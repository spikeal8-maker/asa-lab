# PROJ-R8-01 — Projects Discovery Catalog

**Статус:** PREPARED / BLOCKED BY R7  
**Depends on:** accepted R7 foundation/public-page contract and explicit owner transition to R8.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**UI contract:** `docs/product/ASA_PROJECTS_UI_UX_SPEC.md`

---

## 0. Activation gate

R8 does not start merely because catalog UI is designed.

Start only when:

1. required R7 acceptance gate is complete;
2. owner/control-plane selects PROJ-R8-01;
3. current `main` is delta-checked;
4. eligible anonymous/public publication contract is stable;
5. `pnpm control-plane:check` PASS.

---

## 1. Пользовательский результат

ASA Lab receives the public **«Проекты»** discovery surface:

- real published works from ASA Lab modules;
- search;
- category filters;
- sorting;
- optional compact featured project;
- responsive visual grid;
- stable URL/query state;
- direct opening of Public Project Page.

This is a visual project catalog, **not a vertical social-news feed**.

---

## 2. Page contract

Top-to-bottom:

1. H1 `Проекты`;
2. concise subtitle;
3. search;
4. category chips;
5. sort + filters;
6. optional featured project from real curated source;
7. project grid;
8. cursor continuation;
9. loading/empty/error states.

Categories:

`Все · 3D-моделирование · Электроника · Блочное программирование · Графика · Игры · ИИ`

A filter appears only when backend semantics really exist.

---

## 3. Responsive grid

Normative:

- 320–359 CSS px: 1 card;
- 360–899: 2 cards;
- 900–1199: 3 cards;
- >=1200: **4 cards**;
- ultrawide/2K/4K/8K: still max 4 in primary grid with max-width container.

5+ cards per row are rejected.

Card hierarchy:

`real visual → title → author → compact real metrics`.

Visual approximately 65–72% of card. No description in normal grid card. Max 2 badges.

---

## 4. Search / URL state

Search is server-backed, not local filtering of loaded cards.

Minimum searchable projection:

- title;
- public description/summary;
- tags;
- safe author label;
- module/category.

Requirements:

- debounce;
- q/filter/sort state in URL;
- reload restores state;
- Back/Forward restores state;
- cursor pagination;
- private/unlisted/revoked/ineligible absent.

Do not introduce Elasticsearch/OpenSearch/vector search without proven load need.

---

## 5. Sorting / featured

Initial sort modes only if backed by real data:

- `Новые`;
- `Популярные` only through documented existing/accepted real formula.

No fake likes/views/popularity.

Featured:

- use real editorial/curated source, preferably existing editor choice while compatible;
- one compact block;
- no duplicate of same project in first grid row;
- if no source exists, hide block.

---

## 6. REUSE / MODIFY / BUILD

### REUSE

- public Publication DTO/page from R7;
- ASA Lab shell;
- real preview assets;
- existing Gallery list/reactions as compatibility source where valid;
- editor choice if still canonical.

### MODIFY

- Gallery discovery page/API list contract;
- route/navigation to target discovery location;
- server search/filter/cursor parameters;
- legacy `/gallery` compatibility.

### BUILD

- isolated Public Projects discovery components if current GalleryPage cannot satisfy spec cleanly;
- URL-state/search/filter abstractions needed only for this surface.

### DO-NOT-TOUCH

- My Projects semantics;
- classroom Projects;
- module editors;
- Working Project domain.

---

## 7. Required tests

- anonymous eligible catalog opens;
- private/unlisted/revoked excluded;
- search returns server-backed results;
- category/filter/sort reflected in URL and restored after reload/Back;
- cursor continuation has no duplicate/lost entries;
- featured is real and not repeated in first row;
- exact 4/3/2/1 grid contract across QA viewports;
- no horizontal overflow at 360/390/430;
- keyboard/focus/labels pass;
- image loading produces no significant CLS;
- no WebGL/simulation runtime starts across every card;
- legacy Gallery links remain compatible;
- My Projects/Classroom Projects regressions remain green.

---

## 8. Acceptance Criteria

- **R8-01-AC01** discovery shows real eligible publications.
- **R8-01-AC02** search/filter/sort are server-backed and URL-restorable.
- **R8-01-AC03** desktop max 4 columns; mobile 360+ = 2.
- **R8-01-AC04** card is visual-dominant and module-aware.
- **R8-01-AC05** featured uses real source or is absent.
- **R8-01-AC06** no fake metrics/actions.
- **R8-01-AC07** performance/accessibility/mobile visual QA pass.
- **R8-01-AC08** legacy and private project surfaces do not regress.

---

## 9. Hygiene

Standard threshold = 3 accepted slices, but if interactive/heavy previews are introduced this becomes high-risk threshold 2.

Evidence records card/image payload, first batch size, route chunk, dependencies, generated screenshots and hygiene counter.

---

## 10. STOP conditions

STOP if R7 publication contract is incomplete, search would require exposing private mutable Project data, catalog requires rewriting My Projects, or proposed ranking depends on invented metrics.