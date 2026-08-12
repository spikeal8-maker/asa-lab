# ASA editor-family header contract

**Status:** planned characterization and extraction contract
**Reference implementation:** Electronics `WorkbenchHeader`
**First new consumer:** ASA Chess

## 1. Decision

Electronics is the visual and behavioural characterization baseline, not a source-code
dependency. Chess must not import `WorkbenchHeader`, Electronics controllers or
Electronics CSS.

The first shared extraction is only `EditorHeader`. A broader `EditorChrome` wrapper is
deferred because changing the direct children of `.workbench-shell` can alter the
Electronics grid and height calculations.

Current gap:

- Electronics uses a fixed 48 px primary header and a separate 48 px toolbar;
- Chess Editor uses its own 64+ px five-column header;
- Chess Online, Review and Puzzles use additional independent headers.

## 2. Neutral component contract

```ts
type EditorSaveKind = 'saved' | 'dirty' | 'saving' | 'error';

type EditorHeaderTitle =
  | {
      kind: 'editable';
      value: string;
      ariaLabel: string;
      maxLength: number;
      onChange(value: string): void;
      onCommit(): void | Promise<void>;
      onCancel(): void;
    }
  | { kind: 'readonly'; text: string };

interface EditorHeaderItem {
  id: string;
  label: string;
  icon?: ReactNode;
  selected?: boolean;
  disabled?: boolean;
  emphasis?: 'neutral' | 'primary' | 'danger';
  visibility?: 'always' | 'wide';
  onActivate(): void;
}

interface EditorHeaderProps {
  moduleId: string;
  onExit(): void;
  exitLabel: string;
  title: EditorHeaderTitle;
  status?: {
    kind: EditorSaveKind;
    label: string;
    detail?: string;
    icon?: ReactNode;
  };
  navigation?: {
    ariaLabel: string;
    items: readonly EditorHeaderItem[];
  };
  actions?: readonly EditorHeaderItem[];
  avatar?: {
    label: string;
    text: string;
    title?: string;
  };
}
```

The component owns only:

- `/asa-lab-mark.svg` and the ASA Lab label;
- 48 px primary-row geometry;
- title, status, navigation, actions and avatar placement;
- Enter/Escape title semantics;
- `role="status"`, `aria-live`, `aria-pressed` and visible focus;
- responsive hiding of `visibility: wide` actions.

It imports no subject module, controller type or account API model.

## 3. Planned ownership

```text
apps/web/src/components/editor-chrome/EditorHeader.tsx
apps/web/src/components/editor-chrome/editor-header.css
apps/web/src/components/editor-chrome/testing/editor-header.contract.spec.ts
    neutral shared-shell owner

apps/web/src/chess/ChessEditorHeader.tsx
apps/web/src/chess/**
    Chess owner

apps/web/src/electronics/WorkbenchHeader.tsx
apps/web/src/electronics/workbench.css
    Electronics owner; unchanged in the first Chess PR

apps/web/src/three-d/**
    active 3D owner only
```

## 4. Electronics characterization before extraction

- desktop 1366×768: primary header exactly 48 px;
- toolbar begins at y=48 and is exactly 48 px;
- three columns never overlap;
- ASA mark 30×30, title control and avatar geometry remain stable;
- mode control height 38 px and active item has `aria-pressed=true`;
- ASA Lab label and `/asa-lab-mark.svg` are present;
- Enter commits title and Escape restores it;
- dirty/saving/error states remain visible and actionable;
- targeted header+toolbar screenshot;
- no horizontal overlap at 1366 and 1024 widths;
- keyboard traversal and Axe A/AA pass.

Visual checks use the final computed Electronics CSS. `workbench.css` overrides header
properties in later blocks, so copying its first declaration is not an acceptable
extraction method.

## 5. Shared contract tests

- editable and readonly titles;
- status detail is available as full accessible text/title;
- selected navigation and `aria-pressed`;
- disabled action behaviour;
- `wide` actions hide at narrow widths while the primary action remains;
- avatar is last in the primary row;
- no imports from Chess, Electronics, 3D or future Checkers;
- 48 px geometry at reference viewports.

## 6. Migration order

1. Add Electronics characterization tests without changing Electronics code.
2. Add neutral `EditorHeader` and tokens from final computed Electronics behaviour.
3. Move only `ChessEditor` to the shared header.
4. Move Chess Online, Review and Puzzles through the readonly variant.
5. Obtain owner acceptance for Chess desktop/tablet/mobile evidence.
6. In a separate PR, optionally migrate only the Electronics primary row.
7. Keep the Electronics toolbar subject-owned.
8. Remove legacy CSS only after zero meaningful screenshot/geometry difference.

This sequence lets Chess and the active 3D task proceed in separate worktrees without
touching the same source paths.
