# PROJ-R7-04D — Games Public Viewer / Runner

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-03`; конкретный game module должен иметь стабильный runnable/read-only contract.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`  
**Game hygiene:** `docs/product/ASA_GAME_ENGINEERING_HYGIENE_TZ.md`

---

## 0. Activation gate

Каждая игра подключается как отдельный bounded sub-slice. Старт только если этот exact game/viewer slice выбран в control-plane и соответствующий game engine/runtime проверен на актуальном `main`.

---

## 1. Пользовательский результат

На публичной странице опубликованной игры пользователь может:

- запустить игру;
- увидеть управление;
- играть в безопасном sandboxed runtime;
- перезапустить;
- открыть fullscreen;
- вернуться на project page без потери стабильности страницы;
- получить static preview fallback при невозможности запуска.

Публичный запуск не является game editor и не меняет source Project.

---

## 2. Scope

Входит:

- game-specific Public Artifact adapter;
- runnable packaged/public state;
- lightweight public runner;
- controls help;
- restart/fullscreen;
- sandbox/runtime limits;
- resource cleanup;
- lazy loading;
- mobile input where game supports it;
- fallback/error handling;
- game-specific regression tests.

Не входит:

- редактирование игры;
- leaderboard/rating/matchmaking, если они не являются частью опубликованного проекта;
- перенос engine внутрь Public Projects;
- отдельная копия rules engine;
- multiplayer publication semantics без отдельного approved slice;
- произвольный network/file access.

---

## 3. Canonical engine rule

```text
PublicationRevision
→ Game Public Artifact
→ existing canonical game runtime/engine boundary
→ public runner
```

Public Projects не создаёт `public-game-rules.ts`, `copy-engine.ts` и аналогичные параллельные rules implementations.

Если server/client engine различаются, compatibility должна уже быть доказана game-module tests/fixtures.

---

## 4. Runtime / security

Обязательно:

- exact immutable source;
- no Project mutation;
- no editor/admin capability;
- bounded CPU/time/memory/event behavior where controllable;
- sandbox external IO;
- cleanup audio/timers/workers/listeners/canvas/WebGL;
- safe fullscreen/focus return;
- unsupported game/version produces controlled fallback.

---

## 5. Required tests

Для каждого подключаемого game module:

- eligible artifact launches;
- private/revoked denied;
- controls/restart/fullscreen work;
- original Project remains unchanged;
- game rules come from canonical engine;
- runner cleanup occurs on unmount/navigation;
- static fallback works;
- unsupported artifact version fails cleanly;
- mobile input tested if game declares mobile support;
- unrelated routes do not eagerly load game runtime;
- canonical game module regression suite remains green.

---

## 6. Acceptance Criteria

- **R7-04D-AC01** each game uses R7-03 artifact and its canonical engine/runtime.
- **R7-04D-AC02** no game authoring surface is exposed.
- **R7-04D-AC03** no duplicate rules engine exists.
- **R7-04D-AC04** runtime is lazy, bounded and cleaned up.
- **R7-04D-AC05** controls/help/fullscreen/fallback work.
- **R7-04D-AC06** game-specific regression evidence exists on exact final SHA.

---

## 7. Hygiene

Game viewer follows `ASA_GAME_ENGINEERING_HYGIENE_TZ.md`:

- L0 every change;
- L1 every finished game slice;
- L2 after every 2 accepted game/high-risk iterations or earlier at milestone/trigger;
- L3 before release/owner acceptance.

Evidence includes route chunk, large files/assets, duplicated rules check and cleanup.

---

## 8. STOP conditions

STOP if launch requires copying game rules, weakening sandbox/authz, broad game-engine rewrite, or adding multiplayer/social scope not selected by control-plane.