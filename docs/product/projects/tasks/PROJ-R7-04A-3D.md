# PROJ-R7-04A — 3D Public Viewer

**Статус:** PREPARED / NOT ACTIVATED  
**Depends on:** accepted `PROJ-R7-03`; current 3D module contracts must be stable enough for read-only projection.  
**TARGET:** `docs/product/ASA_PROJECTS_IMPLEMENTATION_TZ.md`

---

## 0. Activation gate

Start only when this exact slice is selected in control-plane and current 3D/Public Projects baselines are delta-checked.

---

## 1. Пользовательский результат

На публичной странице 3D-проекта пользователь может безопасно исследовать опубликованную immutable модель без загрузки authoring editor и без права изменить source Project.

Минимум:

- rotate;
- zoom;
- reset view;
- fullscreen;
- touch gestures;
- static preview fallback.

Optional only if existing 3D contract supports it cleanly:

- predefined views;
- exploded view;
- basic file/format metadata.

---

## 2. Scope

Входит:

- 3D Public Artifact adapter/sanitizer;
- lightweight read-only viewer;
- lazy-loaded chunk;
- GPU/resource cleanup;
- loading/error/fallback states;
- reduced motion/touch/keyboard where applicable;
- mobile/fullscreen behavior;
- performance evidence.

Не входит:

- mesh editing;
- transform tools;
- scene authoring panels;
- CAD feature history editing;
- upload/download formats not already approved;
- redesign of 3D editor.

---

## 3. Architecture rule

Prefer reuse of renderer/runtime primitives, not reuse of the whole authoring editor shell.

Target:

```text
PublicationRevision
→ 3D Public Artifact
→ lazy 3D Viewer Runtime
```

Do not import editor-only panels, state managers or mutation services into Public Projects unless there is a proved minimal reusable runtime package.

---

## 4. Safety/performance

- artifact size/object/texture limits;
- no remote arbitrary fetch without approved policy;
- no write endpoint;
- viewer lazy loads only after project page/open action;
- GPU resources disposed on navigation/unmount;
- static preview shown before runtime ready on low-end mobile;
- `prefers-reduced-motion` respected for auto-rotation;
- no WebGL instances in every discovery card.

---

## 5. Required tests

- eligible 3D public artifact renders;
- private/revoked denied before runtime fetch;
- rotate/zoom/reset work;
- touch pinch/drag on representative mobile viewport;
- fullscreen open/close restores focus;
- unmount frees renderer/listeners/resources;
- corrupted/unsupported artifact falls back to static preview;
- no editor mutation API called;
- unrelated Home/Electronics/Blocks routes do not pull heavy 3D viewer chunk;
- My Projects 3D editor regression remains green.

---

## 6. Acceptance Criteria

- **R7-04A-AC01** read-only 3D viewer uses R7-03 artifact.
- **R7-04A-AC02** rotate/zoom/reset/fullscreen usable desktop/mobile.
- **R7-04A-AC03** authoring editor is not exposed as public mutation surface.
- **R7-04A-AC04** runtime is lazy and isolated.
- **R7-04A-AC05** resource cleanup is tested/evidenced.
- **R7-04A-AC06** fallback works when WebGL/artifact fails.
- **R7-04A-AC07** performance and accessibility checks pass.

---

## 7. Hygiene

High-risk viewer slice: threshold 2. Record route/chunk delta, new dependencies, largest changed files, assets, GPU cleanup evidence and hygiene counter.

`BLOCK` if Public Projects starts importing the full 3D authoring application only to rotate a model without an explicit approved architecture decision.

---

## 8. STOP conditions

STOP on required editor rewrite, unsafe remote asset loading, artifact contract insufficiency, uncontrolled bundle growth, or scope expansion into 3D authoring.