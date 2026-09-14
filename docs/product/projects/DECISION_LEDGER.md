# ASA Lab Public Projects — Decision Ledger

**Назначение:** убрать расплывчатые «открытые вопросы» из implementation docs и привязать каждое решение к конкретному bounded slice.  
**Статус:** PREPARED / normative routing document.  
**Главный принцип:** вопрос не должен блокировать весь Public Projects, если он нужен только позднему slice. Но вопрос, влияющий на data model, security или public eligibility, обязан быть закрыт до соответствующего slice.

---

## 1. Уже зафиксированные решения

### DEC-PROJ-001 — Public Projects не является вторым Project Core

**Статус:** RESOLVED.  
**Решение:** Working Project, Draft и ProjectVersion остаются в existing Project domain. Public Projects владеет publication/discovery/read-only public state.

### DEC-PROJ-002 — Public publication опирается на exact immutable ProjectVersion

**Статус:** RESOLVED.  
**Решение:** live PublicationRevision не читает текущий mutable Working Draft.

### DEC-PROJ-003 — Save использует Collections

**Статус:** RESOLVED.  
**Решение:** второй bookmarks/favorites backend запрещён.

### DEC-PROJ-004 — Remix создаёт независимый private Project

**Статус:** RESOLVED.  
**Решение:** source не мутируется, provenance сохраняется.

### DEC-PROJ-005 — Public Projects использует существующий ASA Lab shell

**Статус:** RESOLVED.  
**Решение:** верхние «Проекты / Знания», личная левая навигация, без второго header/shell.

### DEC-PROJ-006 — Catalog layout

**Статус:** RESOLVED.  
**Решение:** desktop maximum 4 cards, mobile 360+ = 2 cards, narrow 320–359 = 1.

### DEC-PROJ-007 — Comments только после moderation foundation

**Статус:** RESOLVED.  
**Решение:** R8-04 зависит от accepted R8-03.

### DEC-PROJ-008 — Eligible public read может быть anonymous

**Статус:** RESOLVED как TARGET.  
**Решение:** anonymous получает только sanitized immutable public projection. Mutations требуют authenticated principal. Current legacy Gallery endpoint не становится anonymous, пока отдаёт mutable document.

---

## 2. Решения, которые блокируют только конкретные slices

| ID | Вопрос | Когда должен быть решён | До решения |
|---|---|---|---|
| DEC-PROJ-101 | Canonical public URL и redirect policy | до route activation в PROJ-R7-02 | можно строить backend foundation без переименования legacy URLs |
| DEC-PROJ-102 | Public author projection для minor/StudentSeat | до завершения PROJ-R7-01 | публичный StudentSeat publish запрещён; использовать минимальную safe projection |
| DEC-PROJ-103 | Assignment/student work publication policy | до завершения PROJ-R7-01 | fail closed; assignment work не становится public |
| DEC-PROJ-104 | Retention existing reactions при legacy convergence/revoke | в PROJ-R7-01 | не удалять silently; migration обязана сохранить/явно перенести state |
| DEC-PROJ-105 | Можно ли полностью запретить remix/copy | до PROJ-R7-05 publication settings | R7-02 использует текущую безопасную copy semantics без нового toggle |
| DEC-PROJ-106 | Default license для новых publication | до PROJ-R7-05 | migrated/current license сохраняется; не придумывать новый default в UI |
| DEC-PROJ-107 | Download formats / 3D export policy | до включения download в viewer/detail | скрывать действие, если contract не доказан |
| DEC-PROJ-108 | Video limits/storage/processing | до video sub-slice PROJ-R7-05 | images-only media acceptable; video flag off |
| DEC-PROJ-109 | Видимость реакции `wow` | до PROJ-R8-02 | storage/backward compatibility сохранить, visual priority не расширять |
| DEC-PROJ-110 | Public profile depth / Studio ownership | до расширения PROJ-R8-02 | first release author projection minimal; studio collaboration не строить скрытно |
| DEC-PROJ-111 | Кто может комментировать | до PROJ-R8-04 | comments disabled |
| DEC-PROJ-112 | School-level premoderation | до расширения publication policy, если продукт её требует | не добавлять school moderation автоматически |
| DEC-PROJ-113 | Ranking formula «Популярные» | до PROJ-R8-05 | только existing real metrics; no fake/recommender |

---

## 3. DEC-PROJ-101 — canonical public URL

Target contract уже предполагает:

- `/projects` — личные «Мои проекты»;
- `/explore` — public discovery;
- отдельный stable URL публикации;
- `/gallery` и `/gallery/:id` сохраняются как compatibility/redirect на переходный период.

Перед PROJ-R7-02 нужно принять точную форму public URL, например `/projects/:publicSlug`, либо другой route, который **не отбирает `/projects` у My Projects**.

Решение оформляется routing ADR либо явным accepted task decision. До этого backend publication foundation не блокируется.

---

## 4. DEC-PROJ-102/103 — minors и учебная работа

Это security/product eligibility gate, а не cosmetic UX choice.

До отдельного расширения действуют fail-closed правила:

- StudentSeat не публикует публично напрямую;
- assignment/classroom work не становится public автоматически;
- class/school membership не раскрывается;
- anonymous projection не содержит PII;
- teacher role сам по себе не даёт право превратить чужую учебную работу в public content.

Если current Identity/Learning contracts дают более точную policy, PROJ-R7-01 обязан её переиспользовать и зафиксировать evidence.

---

## 5. DEC-PROJ-104 — existing reactions

Legacy `gallery_unpublish()` удаляет publication row и может каскадно удалить reaction state. Target R7 не должен повторить это как норму.

До migration необходимо выбрать additive strategy:

1. перенести reaction binding к сохраняемой publication identity; или
2. сохранить compatibility projection так, чтобы revoke не уничтожал исторические реакции.

Любой вариант требует migration test на непустой базе.

---

## 6. DEC-PROJ-105/106 — remix и license

R7-01/R7-02 не должны ждать сложный publication settings editor.

До PROJ-R7-05:

- copy/remix использует доказанную existing semantics;
- existing license сохраняется;
- новый toggle «запретить remix» не появляется без server contract;
- новый default license не придумывается только ради формы.

---

## 7. DEC-PROJ-108 — video

Video включается только при наличии:

- server upload/processing pipeline;
- MIME/size/duration limits;
- poster generation;
- safe storage/serving;
- moderation hooks;
- mobile upload behavior.

Если pipeline не готов, PROJ-R7-05 может быть принят с images/physical-result photos, а video остаётся feature-flagged OFF.

---

## 8. DEC-PROJ-111 — comments audience

До R8-04 должен быть явно определён минимум:

- anonymous comments: yes/no;
- Account comments;
- StudentSeat comments;
- owner moderation boundary;
- rate limits;
- thread depth;
- edit/delete semantics;
- report behavior.

Без этого comments slice не активируется.

---

## 9. Правило для coding-агента

Если task упирается в unresolved decision из этой таблицы:

1. проверить, действительно ли decision блокирует именно активный slice;
2. если нет — использовать documented safe fallback и не расширять scope;
3. если да — STOP и запросить owner/architecture decision;
4. не «решать» product/security вопрос скрытым кодом.

---

## 10. Definition of Ready для решения

Decision считается закрытым, когда есть:

- однозначная формулировка;
- scope, на который она действует;
- compatibility/migration consequence;
- security/privacy consequence при наличии;
- acceptance impact;
- ссылка из task card, которую решение разблокирует.

Список вопросов больше не должен жить как общий неопределённый хвост. Каждый вопрос имеет конкретный gate.