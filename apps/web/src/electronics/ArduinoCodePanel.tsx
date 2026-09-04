import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type DragEvent,
  type KeyboardEvent,
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import * as ScratchBlocks from 'scratch-blocks';
import {
  analyseArduinoSourceSupport,
  type ArduinoSourceSupportDiagnostic,
} from '@asa-lab/electronics';
import scratchSpritesUrl from '../../node_modules/scratch-blocks/media/sprites.png?url';
import scratchZoomInUrl from '../../node_modules/scratch-blocks/media/zoom-in.svg?url';
import scratchZoomOutUrl from '../../node_modules/scratch-blocks/media/zoom-out.svg?url';
import scratchZoomResetUrl from '../../node_modules/scratch-blocks/media/zoom-reset.svg?url';
import type { ProductionStateValue, SchematicComponent } from '../api';
import {
  ARDUINO_CREATE_VARIABLE_CALLBACK,
  applyArduinoBlockDefaults,
  arduinoDeleteVariableCallback,
  arduinoRenameVariableCallback,
  createDefaultArduinoBlocks,
  generateArduinoCode,
  migrateLegacyArduinoWorkspaceState,
  readArduinoProgramState,
  registerArduinoBlocks,
  toolboxForCategory,
  type ArduinoBlockCategory,
  type ArduinoCodeMode,
  type ArduinoProgramState,
  type ArduinoVariableChoice,
} from './arduino-blocks';
import {
  arduinoCompletionsAt,
  insertArduinoCompletion,
  tokenizeArduinoSource,
  type ArduinoCompletion,
  type ArduinoSourceToken,
} from './arduino-source-language';
import { ArduinoCommandReference } from './ArduinoCommandReference';
import {
  ARDUINO_SNIPPET_MIME,
  arduinoSnippetDropTarget,
  insertArduinoSnippet,
  type ArduinoSnippetDropTarget,
} from './arduino-command-reference';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

const CATEGORY_ITEMS: readonly {
  id: ArduinoBlockCategory;
  label: string;
  colour: string;
}[] = [
  { id: 'output', label: 'Выход', colour: '#4c97ff' },
  { id: 'control', label: 'Управление', colour: '#ffab19' },
  { id: 'input', label: 'Вход', colour: '#9966ff' },
  { id: 'data', label: 'Мат. данные', colour: '#40bf4a' },
  { id: 'comment', label: 'Замечание', colour: '#8e8e8e' },
  { id: 'variables', label: 'Переменные', colour: '#cf63cf' },
];

const ARDUINO_FLYOUT_MIN_WIDTH = 220;
const ARDUINO_FLYOUT_MAX_WIDTH = 520;
const ARDUINO_FLYOUT_DEFAULT_WIDTH = 290;
const ARDUINO_WORKSPACE_MIN_WIDTH = 300;
const ARDUINO_FLYOUT_STORAGE_KEY = 'asa-lab:electronics:arduino-palette-width-v2';
const ARDUINO_PALETTE_SCALE_STORAGE_KEY = 'asa-lab:electronics:arduino-palette-scale-v2';
const ARDUINO_FONT_SIZE_STORAGE_KEY = 'asa-lab:electronics:arduino-font-size-v1';
const ARDUINO_AUTOCOMPLETE_STORAGE_KEY = 'asa-lab:electronics:arduino-autocomplete-v1';
const ARDUINO_PALETTE_SCALE_MIN = 0.75;
const ARDUINO_PALETTE_SCALE_MAX = 1.25;
const ARDUINO_PALETTE_SCALE_STEP = 0.1;
const ARDUINO_PALETTE_VISUAL_BASELINE = 1.25;
const ARDUINO_FONT_SIZES = [12, 13, 14, 15, 16, 18, 20] as const;

function clampArduinoFlyoutWidth(width: number, drawerWidth: number): number {
  const maximum = Math.max(
    ARDUINO_FLYOUT_MIN_WIDTH,
    Math.min(ARDUINO_FLYOUT_MAX_WIDTH, drawerWidth - ARDUINO_WORKSPACE_MIN_WIDTH),
  );
  return Math.round(Math.min(maximum, Math.max(ARDUINO_FLYOUT_MIN_WIDTH, width)));
}

function initialArduinoFlyoutWidth(): number {
  const stored = Number(localStorage.getItem(ARDUINO_FLYOUT_STORAGE_KEY));
  return Number.isFinite(stored) && stored > 0 ? stored : ARDUINO_FLYOUT_DEFAULT_WIDTH;
}

function initialArduinoPaletteScale(): number {
  const stored = Number(localStorage.getItem(ARDUINO_PALETTE_SCALE_STORAGE_KEY));
  return Number.isFinite(stored) && stored >= ARDUINO_PALETTE_SCALE_MIN
    ? Math.min(ARDUINO_PALETTE_SCALE_MAX, stored)
    : 1;
}

function initialArduinoFontSize(): number {
  const stored = Number(localStorage.getItem(ARDUINO_FONT_SIZE_STORAGE_KEY));
  return ARDUINO_FONT_SIZES.includes(stored as (typeof ARDUINO_FONT_SIZES)[number]) ? stored : 13;
}

function initialArduinoAutocomplete(): boolean {
  return localStorage.getItem(ARDUINO_AUTOCOMPLETE_STORAGE_KEY) !== 'false';
}

function responsiveFlyoutScale(flyoutWidth: number, userScale: number): number {
  const fittedBase = Math.min(0.75, Math.max(0.45, (0.675 * flyoutWidth) / 330));
  return Math.min(1.18, Math.max(0.42, fittedBase * ARDUINO_PALETTE_VISUAL_BASELINE * userScale));
}

type ArduinoBlockContextMenu = {
  readonly blockId: string;
  readonly x: number;
  readonly y: number;
  readonly blockCount: number;
};

type ArduinoVariablePrompt = {
  readonly title: string;
  readonly message: string;
  readonly value: string;
  readonly submitLabel: string;
};

type ArduinoVariablePromptCallback = (
  variableName: string,
  additionalVariables: string[],
  options?: { scope?: string; isCloud?: boolean },
) => void;

function arduinoVariableChoices(
  workspace: ScratchBlocks.Workspace,
): readonly ArduinoVariableChoice[] {
  return workspace
    .getVariablesOfType(ScratchBlocks.SCALAR_VARIABLE_TYPE)
    .map((variable) => ({ id: variable.getId(), name: variable.getName() }))
    .sort((left, right) =>
      left.name === right.name ? 0 : left.name.toLowerCase() < right.name.toLowerCase() ? -1 : 1,
    );
}

function blockStackCount(block: ScratchBlocks.Block): number {
  return block.getDescendants(false).filter((descendant) => !descendant.isShadow()).length;
}

const ARDUINO_SCRATCH_THEME = ScratchBlocks.Theme.defineTheme('asa-arduino', {
  name: 'asa-arduino',
  base: ScratchBlocks.Themes.Zelos,
  blockStyles: {
    motion: {
      colourPrimary: '#4C97FF',
      colourSecondary: '#4280D7',
      colourTertiary: '#3373CC',
    },
    sensing: {
      colourPrimary: '#9966FF',
      colourSecondary: '#855CD6',
      colourTertiary: '#774DCB',
    },
    more: {
      colourPrimary: '#8E8E8E',
      colourSecondary: '#7A7A7A',
      colourTertiary: '#666666',
    },
    control: {
      colourPrimary: '#FFAB19',
      colourSecondary: '#EC9C13',
      colourTertiary: '#CF8B17',
    },
    operators: {
      colourPrimary: '#40BF4A',
      colourSecondary: '#35A941',
      colourTertiary: '#2D9238',
    },
    data: {
      colourPrimary: '#CF63CF',
      colourSecondary: '#C94FC9',
      colourTertiary: '#BD42BD',
    },
    textField: {
      colourPrimary: '#FFFFFF',
      colourSecondary: '#FFFFFF',
      colourTertiary: '#D5D5D5',
    },
  },
  componentStyles: {
    workspaceBackgroundColour: '#FFFFFF',
    toolboxBackgroundColour: '#F7F7F7',
    toolboxForegroundColour: '#43536A',
    flyoutBackgroundColour: '#F7F7F7',
    flyoutForegroundColour: '#43536A',
    flyoutOpacity: 1,
    scrollbarColour: '#C5CBD3',
    scrollbarOpacity: 0.75,
  },
  fontStyle: {
    family: 'Arial, sans-serif',
    weight: '600',
    size: 12,
  },
});

function applyScratchMediaAssets(host: HTMLElement): void {
  const setImage = (selector: string, url: string): void => {
    for (const image of host.querySelectorAll<SVGImageElement>(selector)) {
      image.setAttribute('href', url);
      image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
    }
  };
  setImage('.blocklyZoomIn image', scratchZoomInUrl);
  setImage('.blocklyZoomOut image', scratchZoomOutUrl);
  setImage('.blocklyZoomReset image', scratchZoomResetUrl);
  setImage('.blocklyTrash image', scratchSpritesUrl);
}

function keepWorkspaceClearOfFlyout(
  workspace: ScratchBlocks.WorkspaceSvg,
  flyoutWidth: number,
): void {
  const blocks = workspace.getTopBlocks(false);
  if (blocks.length === 0) return;
  const left = Math.min(...blocks.map((block) => block.getRelativeToSurfaceXY().x));
  const target = flyoutWidth / workspace.scale + 42;
  if (left >= target) return;
  const shift = target - left;
  for (const block of blocks) block.moveBy(shift, 0);
}

function centerArduinoProgram(workspace: ScratchBlocks.WorkspaceSvg): void {
  workspace.markFocused();
  workspace.beginCanvasTransition();
  workspace.setScale(workspace.options.zoomOptions.startScale);

  const blocks = workspace.getTopBlocks(false);
  if (blocks.length === 0) {
    workspace.scrollCenter();
  } else {
    const bounds = workspace.getBlocksBoundingBox();
    const metrics = workspace.getMetrics();
    const flyoutWidth = workspace.getFlyout()?.getWidth() ?? 0;
    const centreX = ((bounds.left + bounds.right) / 2) * workspace.scale;
    const centreY = ((bounds.top + bounds.bottom) / 2) * workspace.scale;
    workspace.scroll(
      -(centreX - metrics.viewWidth / 2) + flyoutWidth / 2,
      -(centreY - metrics.viewHeight / 2),
    );
  }

  window.setTimeout(() => workspace.endCanvasTransition(), 500);
}

function DrawerResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}): JSX.Element {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  function stopResize(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    document.documentElement.classList.remove('arduino-drawer-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 48 : 16;
    onWidthChange(width + (event.key === 'ArrowLeft' ? step : -step));
  }

  return (
    <div
      className="arduino-drawer-resize-handle"
      role="separator"
      aria-label="Изменить ширину редактора кода"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('arduino-drawer-resizing');
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onWidthChange(drag.startWidth + drag.startX - event.clientX);
      }}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      onLostPointerCapture={() => {
        dragRef.current = null;
        document.documentElement.classList.remove('arduino-drawer-resizing');
      }}
    />
  );
}

function PaletteResizeHandle({
  width,
  onWidthChange,
}: {
  width: number;
  onWidthChange: (width: number) => void;
}): JSX.Element {
  const dragRef = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);

  function stopResize(event: PointerEvent<HTMLDivElement>): void {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    document.documentElement.classList.remove('arduino-palette-resizing');
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = event.shiftKey ? 40 : 12;
    onWidthChange(width + (event.key === 'ArrowRight' ? step : -step));
  }

  return (
    <div
      className="arduino-palette-resize-handle"
      role="separator"
      aria-label="Изменить ширину палитры блоков"
      aria-orientation="vertical"
      aria-valuenow={Math.round(width)}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth: width,
        };
        event.currentTarget.setPointerCapture(event.pointerId);
        document.documentElement.classList.add('arduino-palette-resizing');
        event.preventDefault();
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        onWidthChange(drag.startWidth + event.clientX - drag.startX);
      }}
      onPointerUp={stopResize}
      onPointerCancel={stopResize}
      onLostPointerCapture={() => {
        dragRef.current = null;
        document.documentElement.classList.remove('arduino-palette-resizing');
      }}
    />
  );
}

const MODE_LABELS: Record<ArduinoCodeMode, string> = {
  blocks: 'Блоки',
  'blocks-text': 'Блоки с текстом',
  text: 'Текст',
};

function isArduino(component: SchematicComponent): boolean {
  return component.componentTypeId === 'arduino-uno' || component.variantId === 'arduino-uno';
}

function DownloadIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3v12m0 0l-4-4m4 4l4-4M5 19h14" />
    </svg>
  );
}

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="m4 12 5 5L20 6" />
    </svg>
  );
}

function CommandsIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function AutocompleteIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M5 6h5M5 11h8M5 16h5M15 7l2 2 3-4M15 16h5M17.5 13.5v5" />
    </svg>
  );
}

function ChevronDown(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" />
    </svg>
  );
}

function ScratchWorkspace({
  initialWorkspace,
  category,
  flyoutWidth,
  paletteScale,
  onChange,
}: {
  initialWorkspace: string;
  category: ArduinoBlockCategory;
  flyoutWidth: number;
  paletteScale: number;
  onChange: (workspaceJson: string, source: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<ScratchBlocks.WorkspaceSvg | null>(null);
  const changeRef = useRef(onChange);
  const flyoutWidthRef = useRef(flyoutWidth);
  const paletteScaleRef = useRef(paletteScale);
  const categoryRef = useRef(category);
  const refreshToolboxRef = useRef<(() => void) | null>(null);
  const timerRef = useRef<number | null>(null);
  const variablePromptCallbackRef = useRef<ArduinoVariablePromptCallback | null>(null);
  const [blockContextMenu, setBlockContextMenu] = useState<ArduinoBlockContextMenu | null>(null);
  const [variablePrompt, setVariablePrompt] = useState<ArduinoVariablePrompt | null>(null);
  changeRef.current = onChange;
  flyoutWidthRef.current = flyoutWidth;
  paletteScaleRef.current = paletteScale;
  categoryRef.current = category;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    registerArduinoBlocks();
    const workspace = ScratchBlocks.inject(host, {
      toolbox: toolboxForCategory(category, [], paletteScale),
      scratchTheme: ScratchBlocks.ScratchBlocksTheme.CLASSIC,
      theme: ARDUINO_SCRATCH_THEME,
      trashcan: true,
      sounds: false,
      scrollbars: true,
      zoom: {
        controls: true,
        wheel: true,
        startScale: 0.86,
        maxScale: 1.5,
        minScale: 0.45,
        scaleSpeed: 1.1,
      },
      move: { scrollbars: true, drag: true, wheel: true },
    });
    const flyout = workspace.getFlyout() as
      | (ScratchBlocks.VerticalFlyout & {
          getWidth: () => number;
          getFlyoutScale: () => number;
          reflow: () => void;
        })
      | null;
    if (flyout) {
      Object.defineProperty(flyout, 'getWidth', {
        configurable: true,
        value: () => flyoutWidthRef.current,
      });
      Object.defineProperty(flyout, 'getFlyoutScale', {
        configurable: true,
        value: () => paletteScaleRef.current,
      });
      flyout.getWorkspace().setScale(paletteScaleRef.current);
      flyout.reflow();
    }
    workspaceRef.current = workspace;
    document.documentElement.classList.add('arduino-block-editor-active');

    const refreshToolbox = (): void => {
      const variables = arduinoVariableChoices(workspace);
      for (const variable of variables) {
        workspace.registerButtonCallback(arduinoRenameVariableCallback(variable.id), () => {
          const current = workspace.getVariableMap().getVariableById(variable.id);
          if (current) {
            ScratchBlocks.ScratchVariables.renameVariable(
              workspace,
              current as Parameters<typeof ScratchBlocks.ScratchVariables.renameVariable>[1],
            );
          }
        });
        workspace.registerButtonCallback(arduinoDeleteVariableCallback(variable.id), () => {
          const current = workspace.getVariableMap().getVariableById(variable.id);
          if (current) ScratchBlocks.Variables.deleteVariable(workspace, current);
        });
      }
      workspace.updateToolbox(
        toolboxForCategory(categoryRef.current, variables, paletteScaleRef.current),
      );
      workspace.getFlyout()?.reflow();
      ScratchBlocks.svgResize(workspace);
    };
    refreshToolboxRef.current = refreshToolbox;

    ScratchBlocks.ScratchVariables.setPromptHandler((message, defaultValue, callback, title) => {
      variablePromptCallbackRef.current = callback;
      setVariablePrompt({
        title: title || 'Переменная',
        message,
        value: defaultValue,
        submitLabel: defaultValue.trim() ? 'Сохранить' : 'Создать',
      });
    });
    workspace.registerButtonCallback(ARDUINO_CREATE_VARIABLE_CALLBACK, (button) => {
      window.requestAnimationFrame(() => {
        window.setTimeout(() => {
          ScratchBlocks.ScratchVariables.createVariable(
            button.getTargetWorkspace(),
            undefined,
            ScratchBlocks.SCALAR_VARIABLE_TYPE,
          );
        }, 0);
      });
    });

    let loaded = false;
    if (initialWorkspace) {
      try {
        ScratchBlocks.serialization.workspaces.load(
          migrateLegacyArduinoWorkspaceState(JSON.parse(initialWorkspace)),
          workspace,
        );
        loaded = workspace.getAllBlocks(false).length > 0;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) createDefaultArduinoBlocks(workspace);
    applyArduinoBlockDefaults(workspace);
    refreshToolbox();
    keepWorkspaceClearOfFlyout(workspace, flyoutWidthRef.current);

    const handleZoomReset = (event: Event): void => {
      if (!(event.target instanceof Element) || !event.target.closest('.blocklyZoomReset')) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
      centerArduinoProgram(workspace);
    };
    host.addEventListener('pointerdown', handleZoomReset, true);

    const openBlockContextMenu = (event: globalThis.PointerEvent | MouseEvent): boolean => {
      const target = event.target instanceof Element ? event.target : null;
      const blockElement = target?.closest<SVGGElement>('.blocklyDraggable[data-id]');
      if (!blockElement || blockElement.closest('.blocklyFlyout')) return false;
      const blockId = blockElement.dataset['id'];
      const block = blockId ? workspace.getBlockById(blockId) : null;
      if (!block || block.isInFlyout || !block.isDeletable()) return false;
      workspace.cancelCurrentGesture();
      ScratchBlocks.hideChaff();
      setBlockContextMenu({
        blockId: block.id,
        x: Math.max(8, Math.min(window.innerWidth - 230, event.clientX)),
        y: Math.max(8, Math.min(window.innerHeight - 116, event.clientY)),
        blockCount: blockStackCount(block),
      });
      return true;
    };

    const handleRightPointerDown = (event: globalThis.PointerEvent): void => {
      if (event.button !== 2 || !openBlockContextMenu(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const handleContextMenu = (event: MouseEvent): void => {
      if (!openBlockContextMenu(event)) return;
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();
    };
    const closeFloatingUi = (event: globalThis.PointerEvent): void => {
      const target = event.target instanceof Element ? event.target : null;
      if (target?.closest('.arduino-block-context-menu, .arduino-variable-dialog')) return;
      setBlockContextMenu(null);
    };
    const closeWithEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setBlockContextMenu(null);
      if (variablePromptCallbackRef.current) {
        variablePromptCallbackRef.current('', []);
        variablePromptCallbackRef.current = null;
        setVariablePrompt(null);
      }
    };
    host.addEventListener('pointerdown', handleRightPointerDown, true);
    host.addEventListener('contextmenu', handleContextMenu, true);
    window.addEventListener('pointerdown', closeFloatingUi, true);
    window.addEventListener('keydown', closeWithEscape, true);

    const assetFrame = window.requestAnimationFrame(() => {
      applyScratchMediaAssets(host);
      ScratchBlocks.svgResize(workspace);
    });

    const publish = (): void => {
      const state = ScratchBlocks.serialization.workspaces.save(workspace);
      changeRef.current(JSON.stringify(state), generateArduinoCode(workspace));
    };
    publish();
    const listener = (event: ScratchBlocks.Events.Abstract): void => {
      if ((event as ScratchBlocks.Events.Abstract & { isUiEvent?: boolean }).isUiEvent) return;
      if (
        event.type === ScratchBlocks.Events.VAR_CREATE ||
        event.type === ScratchBlocks.Events.VAR_DELETE ||
        event.type === ScratchBlocks.Events.VAR_RENAME
      ) {
        window.requestAnimationFrame(refreshToolbox);
      }
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(publish, 180);
    };
    workspace.addChangeListener(listener);
    const resizeObserver = new ResizeObserver(() => ScratchBlocks.svgResize(workspace));
    resizeObserver.observe(host);
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
      window.cancelAnimationFrame(assetFrame);
      resizeObserver.disconnect();
      host.removeEventListener('pointerdown', handleZoomReset, true);
      host.removeEventListener('pointerdown', handleRightPointerDown, true);
      host.removeEventListener('contextmenu', handleContextMenu, true);
      window.removeEventListener('pointerdown', closeFloatingUi, true);
      window.removeEventListener('keydown', closeWithEscape, true);
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
      refreshToolboxRef.current = null;
      document.documentElement.classList.remove('arduino-block-editor-active');
      variablePromptCallbackRef.current = null;
    };
    // A board switch remounts this component by key. Loading a new serialised
    // workspace into a live one would otherwise become an editable undo step.
  }, []);

  useEffect(() => {
    refreshToolboxRef.current?.();
  }, [category]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.getFlyout()?.reflow();
    ScratchBlocks.svgResize(workspace);
  }, [flyoutWidth]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    const flyout = workspace?.getFlyout();
    if (!workspace || !flyout) return;
    flyout.getWorkspace().setScale(paletteScale);
    refreshToolboxRef.current?.();
  }, [paletteScale]);

  function closeVariablePrompt(value: string): void {
    const callback = variablePromptCallbackRef.current;
    variablePromptCallbackRef.current = null;
    setVariablePrompt(null);
    callback?.(value.trim(), []);
  }

  function duplicateBlockStack(): void {
    const workspace = workspaceRef.current;
    const block = blockContextMenu && workspace?.getBlockById(blockContextMenu.blockId);
    setBlockContextMenu(null);
    if (!workspace || !block) return;
    workspace.cancelCurrentGesture();
    const data = block.toCopyData(true);
    if (!data) return;
    ScratchBlocks.Events.setGroup(true);
    try {
      ScratchBlocks.clipboard.paste(data, workspace);
    } finally {
      ScratchBlocks.Events.setGroup(false);
    }
  }

  function deleteBlockStack(): void {
    const workspace = workspaceRef.current;
    const block = blockContextMenu && workspace?.getBlockById(blockContextMenu.blockId);
    setBlockContextMenu(null);
    if (!workspace || !block) return;
    workspace.cancelCurrentGesture();
    ScratchBlocks.Events.setGroup(true);
    try {
      block.dispose(false, true);
    } finally {
      ScratchBlocks.Events.setGroup(false);
    }
  }

  return (
    <>
      <div className="arduino-scratch-host" ref={hostRef} data-testid="arduino-block-workspace" />
      {blockContextMenu
        ? createPortal(
            <div
              className="arduino-block-context-menu"
              role="menu"
              aria-label="Действия с блоками"
              style={{ left: blockContextMenu.x, top: blockContextMenu.y }}
            >
              <button type="button" role="menuitem" onClick={duplicateBlockStack}>
                {blockContextMenu.blockCount === 1
                  ? 'Копировать блок'
                  : `Копировать ${blockContextMenu.blockCount} блоков`}
              </button>
              <button type="button" role="menuitem" className="danger" onClick={deleteBlockStack}>
                {blockContextMenu.blockCount === 1
                  ? 'Удалить блок'
                  : `Удалить ${blockContextMenu.blockCount} блоков`}
              </button>
            </div>,
            document.body,
          )
        : null}
      {variablePrompt
        ? createPortal(
            <div className="arduino-variable-dialog-backdrop" role="presentation">
              <form
                className="arduino-variable-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="arduino-variable-dialog-title"
                onSubmit={(event) => {
                  event.preventDefault();
                  closeVariablePrompt(variablePrompt.value);
                }}
              >
                <strong id="arduino-variable-dialog-title">{variablePrompt.title}</strong>
                <label>
                  <span>{variablePrompt.message}</span>
                  <input
                    autoFocus
                    value={variablePrompt.value}
                    onChange={(event) =>
                      setVariablePrompt((current) =>
                        current ? { ...current, value: event.target.value } : current,
                      )
                    }
                  />
                </label>
                <div>
                  <button type="button" onClick={() => closeVariablePrompt('')}>
                    Отмена
                  </button>
                  <button type="submit" disabled={!variablePrompt.value.trim()}>
                    {variablePrompt.submitLabel}
                  </button>
                </div>
              </form>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

function highlightedLine(tokens: readonly ArduinoSourceToken[], lineIndex: number): ReactNode {
  return (
    <span className="arduino-code-line" key={lineIndex}>
      {tokens.map((token, index) =>
        token.kind === 'plain' ? (
          token.text
        ) : (
          <span className={`token-${token.kind}`} key={index}>
            {token.text}
          </span>
        ),
      )}
      {'\n'}
    </span>
  );
}

function ArduinoSourceEditor({
  source,
  readOnly,
  fontSize,
  completionEnabled,
  diagnosticsOpen,
  onChange,
  onCursorChange,
  onDiagnosticsOpenChange,
}: {
  source: string;
  readOnly: boolean;
  fontSize: number;
  completionEnabled: boolean;
  diagnosticsOpen: boolean;
  onChange: (source: string) => void;
  onCursorChange: (position: number) => void;
  onDiagnosticsOpenChange: (open: boolean) => void;
}): JSX.Element {
  const editorRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = source.split('\n');
  const highlightedLines = useMemo(() => tokenizeArduinoSource(source), [source]);
  const supportDiagnostics = useMemo(() => analyseArduinoSourceSupport(source), [source]);
  const unsupportedCount = supportDiagnostics.filter(
    (diagnostic) => diagnostic.status === 'unsupported',
  ).length;
  const limitedCount = supportDiagnostics.length - unsupportedCount;
  const previousUnsupportedCountRef = useRef(unsupportedCount);
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState({ left: 0, top: 0 });
  const [completionIndex, setCompletionIndex] = useState(0);
  const [completionDismissed, setCompletionDismissed] = useState(false);
  const [snippetDropTarget, setSnippetDropTarget] = useState<ArduinoSnippetDropTarget | null>(null);

  useEffect(() => {
    const previousCount = previousUnsupportedCountRef.current;
    previousUnsupportedCountRef.current = unsupportedCount;
    if (unsupportedCount > previousCount) onDiagnosticsOpenChange(true);
  }, [onDiagnosticsOpenChange, unsupportedCount]);
  const completion = useMemo(
    () =>
      readOnly || !completionEnabled || completionDismissed
        ? null
        : arduinoCompletionsAt(source, cursor),
    [completionDismissed, completionEnabled, cursor, readOnly, source],
  );
  const beforeCursor = source.slice(0, cursor);
  const cursorLine = beforeCursor.split('\n').length - 1;
  const cursorColumn = beforeCursor.length - (beforeCursor.lastIndexOf('\n') + 1);
  const editorWidth = editorRef.current?.clientWidth ?? 600;
  const editorHeight = editorRef.current?.clientHeight ?? 400;
  const suggestionPosition = {
    left: Math.max(
      52,
      Math.min(editorWidth - 340, 56 + cursorColumn * fontSize * 0.61 - scroll.left),
    ),
    top: Math.max(
      8,
      Math.min(editorHeight - 275, 10 + (cursorLine + 1) * fontSize * 1.45 - scroll.top),
    ),
  };

  useEffect(() => setCompletionIndex(0), [completion?.from, completion?.items]);

  useEffect(() => setCompletionDismissed(false), [completionEnabled]);

  function updateCursor(position: number): void {
    setCursor(position);
    onCursorChange(position);
  }

  function syncScroll(target: HTMLTextAreaElement): void {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop;
    setScroll({ left: target.scrollLeft, top: target.scrollTop });
  }

  function applyCompletion(item: ArduinoCompletion, key: 'Enter' | 'Tab'): void {
    if (!completion) return;
    const insertion = insertArduinoCompletion(source, completion.from, cursor, item, key);
    setCompletionDismissed(true);
    onChange(insertion.source);
    updateCursor(insertion.cursor);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  function applySnippet(snippet: string, position: number): void {
    const insertion = insertArduinoSnippet(source, snippet, position);
    onChange(insertion.source);
    updateCursor(insertion.cursor);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(insertion.cursor, insertion.cursor);
    });
  }

  function acceptsArduinoSnippet(event: DragEvent<HTMLTextAreaElement>): boolean {
    return !readOnly && Array.from(event.dataTransfer.types).includes(ARDUINO_SNIPPET_MIME);
  }

  function dropTargetFor(event: DragEvent<HTMLTextAreaElement>): ArduinoSnippetDropTarget {
    const bounds = event.currentTarget.getBoundingClientRect();
    return arduinoSnippetDropTarget(
      source,
      event.clientY - bounds.top,
      event.currentTarget.scrollTop,
      fontSize,
    );
  }

  function revealDiagnostic(diagnostic: ArduinoSourceSupportDiagnostic): void {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.focus();
    textarea.setSelectionRange(diagnostic.start, diagnostic.start + diagnostic.length);
    updateCursor(diagnostic.start);
    const lineHeight = fontSize * 1.45;
    textarea.scrollTop = Math.max(0, (diagnostic.line - 2) * lineHeight);
    syncScroll(textarea);
  }

  function handleEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!completion) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setCompletionDismissed(true);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setCompletionIndex(
        (current) => (current + direction + completion.items.length) % completion.items.length,
      );
      return;
    }
    if (event.key === 'Tab' || event.key === 'Enter') {
      event.preventDefault();
      applyCompletion(
        completion.items[
          Math.min(completionIndex, completion.items.length - 1)
        ] as ArduinoCompletion,
        event.key,
      );
      return;
    }
  }
  return (
    <div
      className={`arduino-source-editor${readOnly ? ' read-only' : ''}${diagnosticsOpen ? ' diagnostics-open' : ''}`}
      style={{ '--arduino-code-size': `${fontSize}px` } as React.CSSProperties}
      ref={editorRef}
    >
      <div className="arduino-code-gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <pre className="arduino-code-highlight" ref={highlightRef} aria-hidden="true">
        {highlightedLines.map(highlightedLine)}
      </pre>
      <textarea
        ref={textareaRef}
        value={source}
        readOnly={readOnly}
        spellCheck={false}
        aria-invalid={unsupportedCount > 0}
        aria-label={readOnly ? 'Сгенерированный код Arduino' : 'Код Arduino C++'}
        aria-describedby="arduino-source-editor-status arduino-source-diagnostics"
        onChange={(event) => {
          setCompletionDismissed(false);
          onChange(event.target.value);
          updateCursor(event.currentTarget.selectionStart);
        }}
        onClick={(event) => {
          setCompletionDismissed(false);
          updateCursor(event.currentTarget.selectionStart);
        }}
        onKeyDown={handleEditorKeyDown}
        onKeyUp={(event) => updateCursor(event.currentTarget.selectionStart)}
        onSelect={(event) => updateCursor(event.currentTarget.selectionStart)}
        onScroll={(event) => syncScroll(event.currentTarget)}
        onDragEnter={(event) => {
          if (!acceptsArduinoSnippet(event)) return;
          event.preventDefault();
          setSnippetDropTarget(dropTargetFor(event));
        }}
        onDragOver={(event) => {
          if (!acceptsArduinoSnippet(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = 'copy';
          setSnippetDropTarget(dropTargetFor(event));
        }}
        onDragLeave={() => setSnippetDropTarget(null)}
        onDrop={(event) => {
          if (!acceptsArduinoSnippet(event)) return;
          event.preventDefault();
          const target = dropTargetFor(event);
          setSnippetDropTarget(null);
          const snippet = event.dataTransfer.getData(ARDUINO_SNIPPET_MIME);
          if (snippet) applySnippet(snippet, target.position);
        }}
      />
      {snippetDropTarget ? (
        <div
          className="arduino-snippet-drop-line"
          style={{ top: `${snippetDropTarget.top}px` }}
          aria-hidden="true"
        >
          <span>
            {snippetDropTarget.lineIndex < lines.length
              ? `Вставить перед строкой ${snippetDropTarget.lineIndex + 1}`
              : `Добавить строку ${snippetDropTarget.lineIndex + 1}`}
          </span>
        </div>
      ) : null}
      {completion ? (
        <div
          className="arduino-code-suggestions"
          role="listbox"
          aria-label="Подсказки Arduino"
          style={suggestionPosition}
        >
          {completion.items.map((item, index) => (
            <button
              type="button"
              key={item.label}
              className={`${index === completionIndex ? 'active ' : ''}support-${item.support}`}
              role="option"
              aria-selected={index === completionIndex}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => applyCompletion(item, 'Tab')}
            >
              <code>{item.label}</code>
              <span className="arduino-code-suggestion-copy">
                <span>
                  {item.support === 'unsupported'
                    ? '⚠ Пока не работает · '
                    : item.support === 'limited'
                      ? '◐ Ограничено · '
                      : ''}
                  {item.detail}
                </span>
                <em>{item.example}</em>
              </span>
            </button>
          ))}
        </div>
      ) : null}
      <section
        className={`arduino-code-check${diagnosticsOpen ? ' open' : ''}${unsupportedCount > 0 ? ' has-blockers' : limitedCount > 0 ? ' has-limitations' : ''}`}
        id="arduino-source-diagnostics"
        aria-label="Проверка кода Arduino"
        aria-live="polite"
      >
        <button
          type="button"
          className="arduino-code-check-title"
          aria-expanded={diagnosticsOpen}
          aria-controls="arduino-code-check-body"
          onClick={() => onDiagnosticsOpenChange(!diagnosticsOpen)}
        >
          <span className="arduino-code-check-icon" aria-hidden="true">
            {unsupportedCount > 0 ? '!' : limitedCount > 0 ? '◐' : '✓'}
          </span>
          <strong>Проверка кода</strong>
          <span className={`arduino-code-check-count${unsupportedCount > 0 ? ' active' : ''}`}>
            Блокирующих: {unsupportedCount}
          </span>
          <span className={`arduino-code-check-count limited${limitedCount > 0 ? ' active' : ''}`}>
            Ограничений: {limitedCount}
          </span>
          <span className="arduino-code-check-summary" id="arduino-source-editor-status">
            {completion
              ? 'Enter — строка · Tab — вставить · Esc — закрыть'
              : unsupportedCount > 0
                ? 'Моделирование заблокировано'
                : limitedCount > 0
                  ? 'Код исполняется упрощённо'
                  : 'Ошибок не найдено'}
          </span>
          <ChevronDown />
        </button>
        {diagnosticsOpen ? (
          <div className="arduino-code-check-body" id="arduino-code-check-body">
            <p>
              {unsupportedCount > 0
                ? 'Найдены команды, которые симулятор пока не исполняет. Нажмите сообщение, чтобы перейти к строке.'
                : limitedCount > 0
                  ? 'Это не ошибки компиляции: программа исполняется, но перечисленные возможности моделируются упрощённо.'
                  : 'Поддерживаемая часть программы не содержит известных ошибок или ограничений.'}
            </p>
            <div className="arduino-code-check-messages">
              {supportDiagnostics.map((diagnostic) => (
                <button
                  type="button"
                  key={`${diagnostic.code}-${diagnostic.start}`}
                  className={diagnostic.status}
                  onClick={() => revealDiagnostic(diagnostic)}
                  title={`Перейти к строке ${diagnostic.line}`}
                >
                  <span>{diagnostic.status === 'unsupported' ? '!' : '◐'}</span>
                  <code>строка {diagnostic.line}</code>
                  <span>{diagnostic.message}</span>
                </button>
              ))}
              {supportDiagnostics.length === 0 ? <span>Сообщений нет.</span> : null}
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function SerialMonitor({
  open,
  baudRate,
  running,
  onOpenChange,
  onBaudRateChange,
}: {
  open: boolean;
  baudRate: number;
  running: boolean;
  onOpenChange: (open: boolean) => void;
  onBaudRateChange: (rate: number) => void;
}): JSX.Element {
  const [input, setInput] = useState('');
  const [lines, setLines] = useState<readonly string[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);
  function send(event: FormEvent): void {
    event.preventDefault();
    if (!input) return;
    setLines((current) => [...current, `> ${input}`].slice(-400));
    setInput('');
  }
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [lines]);
  return (
    <section className={`arduino-serial-monitor${open ? ' open' : ''}`}>
      <button
        type="button"
        className="arduino-serial-title"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="arduino-serial-icon" aria-hidden="true" />
        Монитор последовательного интерфейса
        <span className={`arduino-serial-status${running ? ' running' : ''}`}>
          {running ? 'Подключён' : 'Остановлен'}
        </span>
        <ChevronDown />
      </button>
      <div className="arduino-serial-body" aria-hidden={!open}>
        <div className="arduino-serial-output" ref={outputRef} aria-live="polite">
          {lines.map((line, index) => (
            <div key={`${index}:${line}`}>{line}</div>
          ))}
        </div>
        <form onSubmit={send}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Введите сообщение для Arduino"
            aria-label="Сообщение в последовательный порт"
          />
          <select
            aria-label="Скорость последовательного порта"
            value={baudRate}
            onChange={(event) => onBaudRateChange(Number(event.target.value))}
          >
            {[300, 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200].map((rate) => (
              <option key={rate} value={rate}>
                {rate} бод
              </option>
            ))}
          </select>
          <button type="submit">Отпр.</button>
          <button type="button" onClick={() => setLines([])}>
            Очист.
          </button>
        </form>
      </div>
    </section>
  );
}

export function ArduinoCodePanel({
  controller: c,
  open,
  drawerWidth,
  onDrawerWidthChange,
}: {
  controller: ElectronicsWorkbenchController;
  open: boolean;
  drawerWidth: number;
  onDrawerWidthChange: (width: number) => void;
}): JSX.Element {
  const boards = useMemo(
    () => c.document?.components.filter(isArduino) ?? [],
    [c.document?.components],
  );
  const preferredBoard =
    c.selection?.kind === 'component'
      ? boards.find(
          (board) => c.selection?.kind === 'component' && c.selection.ids.includes(board.id),
        )
      : undefined;
  const [boardId, setBoardId] = useState(() => preferredBoard?.id ?? boards[0]?.id ?? '');
  const selectedBoard = boards.find((board) => board.id === boardId) ?? boards[0];
  const [preferredFlyoutWidth, setPreferredFlyoutWidth] = useState(initialArduinoFlyoutWidth);
  const flyoutWidth = clampArduinoFlyoutWidth(preferredFlyoutWidth, drawerWidth);
  const [paletteScale, setPaletteScale] = useState(initialArduinoPaletteScale);
  const effectivePaletteScale = responsiveFlyoutScale(flyoutWidth, paletteScale);
  const [program, setProgram] = useState<ArduinoProgramState>(() =>
    readArduinoProgramState(selectedBoard?.stateProperties),
  );
  const programRef = useRef(program);
  const sourceCursorRef = useRef(program.source.length);
  const [category, setCategory] = useState<ArduinoBlockCategory>('output');
  const [fontSize, setFontSize] = useState(initialArduinoFontSize);
  const [autocompleteEnabled, setAutocompleteEnabled] = useState(initialArduinoAutocomplete);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(
    () => analyseArduinoSourceSupport(program.source).length > 0,
  );
  const [commandReferenceOpen, setCommandReferenceOpen] = useState(false);
  const [pendingMode, setPendingMode] = useState<ArduinoCodeMode | null>(null);
  const modeMenuRef = useRef<HTMLDetailsElement>(null);
  const persistTimersRef = useRef<Map<string, number>>(new Map());

  const activateBoard = useCallback((board: SchematicComponent): void => {
    const nextProgram = readArduinoProgramState(board.stateProperties);
    programRef.current = nextProgram;
    sourceCursorRef.current = nextProgram.source.length;
    setProgram(nextProgram);
    setBoardId(board.id);
    setPendingMode(null);
    setDiagnosticsOpen(analyseArduinoSourceSupport(nextProgram.source).length > 0);
  }, []);

  useEffect(() => {
    if (boards.length > 0 && !boards.some((board) => board.id === boardId)) {
      activateBoard(boards[0] as SchematicComponent);
    }
  }, [activateBoard, boardId, boards]);

  useEffect(() => {
    if (preferredBoard?.id && preferredBoard.id !== boardId) activateBoard(preferredBoard);
  }, [activateBoard, boardId, preferredBoard]);

  useEffect(
    () => () => {
      for (const timer of persistTimersRef.current.values()) window.clearTimeout(timer);
      persistTimersRef.current.clear();
    },
    [],
  );

  useEffect(() => {
    localStorage.setItem(ARDUINO_FLYOUT_STORAGE_KEY, String(preferredFlyoutWidth));
  }, [preferredFlyoutWidth]);

  useEffect(() => {
    localStorage.setItem(ARDUINO_PALETTE_SCALE_STORAGE_KEY, String(paletteScale));
  }, [paletteScale]);

  useEffect(() => {
    localStorage.setItem(ARDUINO_FONT_SIZE_STORAGE_KEY, String(fontSize));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem(ARDUINO_AUTOCOMPLETE_STORAGE_KEY, String(autocompleteEnabled));
  }, [autocompleteEnabled]);

  function persist(next: ArduinoProgramState): void {
    if (!selectedBoard) return;
    const selectedBoardId = selectedBoard.id;
    const currentTimer = persistTimersRef.current.get(selectedBoardId);
    if (currentTimer !== undefined) window.clearTimeout(currentTimer);
    const timer = window.setTimeout(() => {
      persistTimersRef.current.delete(selectedBoardId);
      const properties: Readonly<Record<string, ProductionStateValue>> = {
        arduinoCodeMode: next.mode,
        arduinoWorkspace: next.workspaceJson,
        arduinoSource: next.source,
        arduinoSerialOpen: next.serialOpen,
        arduinoBaudRate: next.baudRate,
      };
      c.updateArduinoProgram(selectedBoardId, properties);
    }, 260);
    persistTimersRef.current.set(selectedBoardId, timer);
  }

  function updateProgram(patch: Partial<ArduinoProgramState>): void {
    const next = { ...programRef.current, ...patch };
    programRef.current = next;
    setProgram(next);
    persist(next);
  }

  function chooseMode(mode: ArduinoCodeMode): void {
    modeMenuRef.current?.removeAttribute('open');
    if (mode === program.mode) return;
    if (mode === 'text' && program.mode !== 'text') {
      setPendingMode(mode);
      return;
    }
    if (mode !== 'text' && program.mode === 'text') {
      setPendingMode(mode);
      return;
    }
    updateProgram({ mode });
  }

  function confirmModeChange(): void {
    if (!pendingMode) return;
    updateProgram({ mode: pendingMode });
    setPendingMode(null);
  }

  function downloadSource(): void {
    const url = URL.createObjectURL(new Blob([program.source], { type: 'text/x-c++src' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${selectedBoard?.name?.trim() || 'arduino-uno'}.ino`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function checkProgram(): void {
    const diagnostics = analyseArduinoSourceSupport(program.source);
    setDiagnosticsOpen(true);
    const unsupported = diagnostics.filter((diagnostic) => diagnostic.status === 'unsupported');
    if (unsupported.length > 0) {
      c.setNotice(
        `Проверка Arduino: ${unsupported.length} команд пока не работают. Расчёт будет заблокирован.`,
      );
      return;
    }
    if (diagnostics.length > 0) {
      c.setNotice(
        `Проверка Arduino: код исполняется с ${diagnostics.length} ограничениями модели.`,
      );
      return;
    }
    c.setNotice('Проверка Arduino: все использованные команды поддерживаются.');
  }

  function appendCommandSnippet(snippet: string): void {
    const insertion = insertArduinoSnippet(
      programRef.current.source,
      snippet,
      sourceCursorRef.current,
    );
    sourceCursorRef.current = insertion.cursor;
    updateProgram({ source: insertion.source });
  }

  if (!selectedBoard) {
    return (
      <section
        className={`arduino-code-panel empty ${open ? 'open' : 'closed'}`}
        aria-label="Редактор кода Arduino"
        aria-hidden={!open}
      >
        <DrawerResizeHandle width={drawerWidth} onWidthChange={onDrawerWidthChange} />
        <div className="arduino-code-empty-state">
          <strong>Добавьте Arduino Uno R3</strong>
          <p>После добавления платы здесь появятся Scratch-блоки, C++ и монитор порта.</p>
        </div>
      </section>
    );
  }

  return (
    <section
      className={`arduino-code-panel ${open ? 'open' : 'closed'}`}
      aria-label="Редактор кода Arduino"
      aria-hidden={!open}
      style={{ '--arduino-flyout-width': `${flyoutWidth}px` } as CSSProperties}
    >
      <DrawerResizeHandle width={drawerWidth} onWidthChange={onDrawerWidthChange} />
      <header className="arduino-code-toolbar">
        <details className="arduino-mode-menu" ref={modeMenuRef}>
          <summary>
            <span>{MODE_LABELS[program.mode]}</span>
            <ChevronDown />
          </summary>
          <div className="arduino-mode-popover">
            <strong>РЕЖИМ РЕДАКТИРОВАНИЯ</strong>
            {(['blocks', 'blocks-text', 'text'] as const).map((mode) => (
              <button
                type="button"
                key={mode}
                className={program.mode === mode ? 'active' : ''}
                onClick={() => chooseMode(mode)}
              >
                {MODE_LABELS[mode]}
              </button>
            ))}
          </div>
        </details>
        <button
          type="button"
          className="arduino-toolbar-button arduino-check-button"
          onClick={checkProgram}
          title="Проверить поддержку команд"
        >
          <CheckIcon />
          <span>Проверить</span>
        </button>
        <button
          type="button"
          className="arduino-square-button arduino-download-button"
          onClick={downloadSource}
          title="Скачать .ino"
        >
          <DownloadIcon />
        </button>
        <button
          type="button"
          className={`arduino-toolbar-button arduino-commands-button${commandReferenceOpen ? ' active' : ''}`}
          title="Справочник команд Arduino"
          aria-expanded={commandReferenceOpen}
          onClick={() => setCommandReferenceOpen((current) => !current)}
        >
          <CommandsIcon />
          <span>Команды</span>
        </button>
        {program.mode === 'text' ? (
          <button
            type="button"
            className={`arduino-toolbar-button arduino-autocomplete-button${autocompleteEnabled ? ' active' : ''}`}
            title={autocompleteEnabled ? 'Отключить автодополнение' : 'Включить автодополнение'}
            aria-label={
              autocompleteEnabled ? 'Отключить автодополнение' : 'Включить автодополнение'
            }
            aria-pressed={autocompleteEnabled}
            onClick={() => setAutocompleteEnabled((current) => !current)}
          >
            <AutocompleteIcon />
            <span>Авто</span>
          </button>
        ) : null}
        {program.mode !== 'blocks' ? (
          <label className="arduino-font-size-select" title="Размер текста">
            <span aria-hidden="true">Aa</span>
            <select
              value={fontSize}
              onChange={(event) => setFontSize(Number(event.target.value))}
              aria-label="Размер текста Arduino"
            >
              {ARDUINO_FONT_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} px
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <span className="arduino-code-toolbar-spacer" />
        <select
          className="arduino-board-select"
          value={selectedBoard.id}
          aria-label="Программируемая плата"
          title={`Активная плата: ${selectedBoard.name?.trim() || 'Arduino Uno R3'}`}
          onChange={(event) => {
            const nextBoard = boards.find((board) => board.id === event.target.value);
            if (!nextBoard) return;
            activateBoard(nextBoard);
            c.selectComponent(nextBoard.id, false);
          }}
        >
          {boards.map((board, index) => (
            <option key={board.id} value={board.id}>
              {index + 1} ({board.name?.trim() || 'Arduino Uno R3'})
            </option>
          ))}
        </select>
      </header>
      <div
        className={`arduino-code-body mode-${program.mode}${commandReferenceOpen ? ' commands-open' : ''}`}
      >
        <ArduinoCommandReference
          open={commandReferenceOpen}
          canInsert={program.mode === 'text'}
          onClose={() => setCommandReferenceOpen(false)}
          onInsert={appendCommandSnippet}
        />
        {program.mode !== 'text' ? (
          <div className="arduino-block-editor">
            <PaletteResizeHandle
              width={flyoutWidth}
              onWidthChange={(width) =>
                setPreferredFlyoutWidth(
                  Math.min(ARDUINO_FLYOUT_MAX_WIDTH, Math.max(ARDUINO_FLYOUT_MIN_WIDTH, width)),
                )
              }
            />
            <ScratchWorkspace
              key={selectedBoard.id}
              initialWorkspace={program.workspaceJson}
              category={category}
              flyoutWidth={flyoutWidth}
              paletteScale={effectivePaletteScale}
              onChange={(workspaceJson, source) => updateProgram({ workspaceJson, source })}
            />
            <div className="arduino-block-categories" role="tablist" aria-label="Категории блоков">
              {CATEGORY_ITEMS.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={category === item.id}
                  className={category === item.id ? 'active' : ''}
                  onClick={() => setCategory(item.id)}
                >
                  <span style={{ background: item.colour }} />
                  {item.label}
                </button>
              ))}
            </div>
            <div
              className="arduino-palette-scale"
              role="group"
              aria-label="Размер блоков в палитре"
            >
              <button
                type="button"
                aria-label="Уменьшить блоки в палитре"
                disabled={paletteScale <= ARDUINO_PALETTE_SCALE_MIN}
                onClick={() =>
                  setPaletteScale((scale) =>
                    Math.max(ARDUINO_PALETTE_SCALE_MIN, scale - ARDUINO_PALETTE_SCALE_STEP),
                  )
                }
              >
                −
              </button>
              <output aria-label="Текущий размер блоков">{Math.round(paletteScale * 100)}%</output>
              <button
                type="button"
                aria-label="Увеличить блоки в палитре"
                disabled={paletteScale >= ARDUINO_PALETTE_SCALE_MAX}
                onClick={() =>
                  setPaletteScale((scale) =>
                    Math.min(ARDUINO_PALETTE_SCALE_MAX, scale + ARDUINO_PALETTE_SCALE_STEP),
                  )
                }
              >
                +
              </button>
            </div>
          </div>
        ) : null}
        {program.mode !== 'blocks' ? (
          <ArduinoSourceEditor
            key={selectedBoard.id}
            source={program.source}
            readOnly={program.mode === 'blocks-text'}
            fontSize={fontSize}
            completionEnabled={autocompleteEnabled}
            diagnosticsOpen={diagnosticsOpen}
            onChange={(source) => updateProgram({ source })}
            onCursorChange={(position) => {
              sourceCursorRef.current = position;
            }}
            onDiagnosticsOpenChange={setDiagnosticsOpen}
          />
        ) : null}
      </div>
      <SerialMonitor
        open={program.serialOpen}
        baudRate={program.baudRate}
        running={c.simulationRunning}
        onOpenChange={(serialOpen) => updateProgram({ serialOpen })}
        onBaudRateChange={(baudRate) => updateProgram({ baudRate })}
      />
      {pendingMode ? (
        <div className="arduino-confirm-backdrop" role="presentation">
          <section
            className="arduino-confirm-dialog"
            role="dialog"
            aria-modal="true"
            aria-label="Продолжить?"
          >
            <header>
              <strong>Продолжить?</strong>
              <button type="button" onClick={() => setPendingMode(null)} aria-label="Закрыть">
                ×
              </button>
            </header>
            <p>
              {pendingMode === 'text'
                ? 'Закрыть редактор блоков? Все блоки останутся сохранены, а код станет доступен для ручного редактирования.'
                : 'Вернуться к редактору блоков? Текстовый код останется сохранён, но в режиме блоков будет заменён кодом, созданным из блоков.'}
            </p>
            <footer>
              <button type="button" className="primary" onClick={confirmModeChange}>
                Продолжить
              </button>
              <button type="button" onClick={() => setPendingMode(null)}>
                Отмена
              </button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
