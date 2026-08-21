import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
  type CSSProperties,
  type ReactNode,
} from 'react';
import * as ScratchBlocks from 'scratch-blocks';
import scratchSpritesUrl from '../../node_modules/scratch-blocks/media/sprites.png?url';
import scratchZoomInUrl from '../../node_modules/scratch-blocks/media/zoom-in.svg?url';
import scratchZoomOutUrl from '../../node_modules/scratch-blocks/media/zoom-out.svg?url';
import scratchZoomResetUrl from '../../node_modules/scratch-blocks/media/zoom-reset.svg?url';
import type { ProductionStateValue, SchematicComponent } from '../api';
import {
  createDefaultArduinoBlocks,
  generateArduinoCode,
  readArduinoProgramState,
  registerArduinoBlocks,
  toolboxForCategory,
  type ArduinoBlockCategory,
  type ArduinoCodeMode,
  type ArduinoProgramState,
} from './arduino-blocks';
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

const ARDUINO_FLYOUT_MIN_WIDTH = 330;
const ARDUINO_FLYOUT_MAX_WIDTH = 520;
const ARDUINO_WORKSPACE_MIN_WIDTH = 360;

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

function LibraryIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16v14H4zM7 3h10l2 3H5zM8 10h8m-8 4h8" />
    </svg>
  );
}

function TextSizeIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 19l4.2-14h2.1l4.2 14M5.5 14h7M15 10h6m-3-3v12" />
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
  onChange,
}: {
  initialWorkspace: string;
  category: ArduinoBlockCategory;
  flyoutWidth: number;
  onChange: (workspaceJson: string, source: string) => void;
}): JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<ScratchBlocks.WorkspaceSvg | null>(null);
  const changeRef = useRef(onChange);
  const flyoutWidthRef = useRef(flyoutWidth);
  const timerRef = useRef<number | null>(null);
  changeRef.current = onChange;
  flyoutWidthRef.current = flyoutWidth;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    registerArduinoBlocks();
    const workspace = ScratchBlocks.inject(host, {
      toolbox: toolboxForCategory(category),
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
      (ScratchBlocks.VerticalFlyout & { getWidth: () => number; reflow: () => void }) | null;
    if (flyout) {
      Object.defineProperty(flyout, 'getWidth', {
        configurable: true,
        value: () => flyoutWidthRef.current,
      });
      flyout.reflow();
    }
    workspaceRef.current = workspace;
    let loaded = false;
    if (initialWorkspace) {
      try {
        ScratchBlocks.serialization.workspaces.load(JSON.parse(initialWorkspace), workspace);
        loaded = workspace.getAllBlocks(false).length > 0;
      } catch {
        loaded = false;
      }
    }
    if (!loaded) createDefaultArduinoBlocks(workspace);
    keepWorkspaceClearOfFlyout(workspace, flyoutWidthRef.current);

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
      workspace.removeChangeListener(listener);
      workspace.dispose();
      workspaceRef.current = null;
    };
    // A board switch remounts this component by key. Loading a new serialised
    // workspace into a live one would otherwise become an editable undo step.
  }, []);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.updateToolbox(toolboxForCategory(category));
    workspace.getFlyout()?.reflow();
    ScratchBlocks.svgResize(workspace);
  }, [category]);

  useEffect(() => {
    const workspace = workspaceRef.current;
    if (!workspace) return;
    workspace.getFlyout()?.reflow();
    ScratchBlocks.svgResize(workspace);
  }, [flyoutWidth]);

  return (
    <div className="arduino-scratch-host" ref={hostRef} data-testid="arduino-block-workspace" />
  );
}

function highlightedLine(line: string, lineIndex: number): ReactNode {
  const commentStart = line.indexOf('//');
  const code = commentStart >= 0 ? line.slice(0, commentStart) : line;
  const comment = commentStart >= 0 ? line.slice(commentStart) : '';
  const parts = code.split(
    /(\b(?:void|int|float|long|bool|char|if|else|for|while|return|true|false|HIGH|LOW|OUTPUT|INPUT)\b|\b\d+(?:\.\d+)?\b|"(?:[^"\\]|\\.)*")/g,
  );
  return (
    <span className="arduino-code-line" key={lineIndex}>
      {parts.map((part, index) => {
        if (/^(void|int|float|long|bool|char|if|else|for|while|return|true|false)$/.test(part)) {
          return (
            <span className="token-keyword" key={index}>
              {part}
            </span>
          );
        }
        if (/^(HIGH|LOW|OUTPUT|INPUT)$/.test(part)) {
          return (
            <span className="token-constant" key={index}>
              {part}
            </span>
          );
        }
        if (/^\d/.test(part)) {
          return (
            <span className="token-number" key={index}>
              {part}
            </span>
          );
        }
        if (part.startsWith('"')) {
          return (
            <span className="token-string" key={index}>
              {part}
            </span>
          );
        }
        return part;
      })}
      {comment ? <span className="token-comment">{comment}</span> : null}
      {'\n'}
    </span>
  );
}

function ArduinoSourceEditor({
  source,
  readOnly,
  fontSize,
  onChange,
}: {
  source: string;
  readOnly: boolean;
  fontSize: number;
  onChange: (source: string) => void;
}): JSX.Element {
  const highlightRef = useRef<HTMLPreElement>(null);
  const gutterRef = useRef<HTMLDivElement>(null);
  const lines = source.split('\n');
  function syncScroll(target: HTMLTextAreaElement): void {
    if (highlightRef.current) {
      highlightRef.current.scrollTop = target.scrollTop;
      highlightRef.current.scrollLeft = target.scrollLeft;
    }
    if (gutterRef.current) gutterRef.current.scrollTop = target.scrollTop;
  }
  return (
    <div
      className={`arduino-source-editor${readOnly ? ' read-only' : ''}`}
      style={{ '--arduino-code-size': `${fontSize}px` } as React.CSSProperties}
    >
      <div className="arduino-code-gutter" ref={gutterRef} aria-hidden="true">
        {lines.map((_, index) => (
          <span key={index}>{index + 1}</span>
        ))}
      </div>
      <pre className="arduino-code-highlight" ref={highlightRef} aria-hidden="true">
        {lines.map(highlightedLine)}
      </pre>
      <textarea
        value={source}
        readOnly={readOnly}
        spellCheck={false}
        aria-label={readOnly ? 'Сгенерированный код Arduino' : 'Код Arduino C++'}
        onChange={(event) => onChange(event.target.value)}
        onScroll={(event) => syncScroll(event.currentTarget)}
      />
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
  drawerWidth,
  onDrawerWidthChange,
}: {
  controller: ElectronicsWorkbenchController;
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
  const flyoutWidth = Math.min(
    ARDUINO_FLYOUT_MAX_WIDTH,
    Math.max(ARDUINO_FLYOUT_MIN_WIDTH, drawerWidth - ARDUINO_WORKSPACE_MIN_WIDTH),
  );
  const [program, setProgram] = useState<ArduinoProgramState>(() =>
    readArduinoProgramState(selectedBoard?.stateProperties),
  );
  const [category, setCategory] = useState<ArduinoBlockCategory>('output');
  const [fontSize, setFontSize] = useState(13);
  const [pendingMode, setPendingMode] = useState<ArduinoCodeMode | null>(null);
  const modeMenuRef = useRef<HTMLDetailsElement>(null);
  const persistTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!selectedBoard && boards[0]) setBoardId(boards[0].id);
  }, [boards, selectedBoard]);

  useEffect(() => {
    setProgram(readArduinoProgramState(selectedBoard?.stateProperties));
    setPendingMode(null);
  }, [selectedBoard?.id]);

  useEffect(
    () => () => {
      if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    },
    [],
  );

  function persist(next: ArduinoProgramState): void {
    if (!selectedBoard) return;
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(() => {
      const properties: Readonly<Record<string, ProductionStateValue>> = {
        arduinoCodeMode: next.mode,
        arduinoWorkspace: next.workspaceJson,
        arduinoSource: next.source,
        arduinoSerialOpen: next.serialOpen,
        arduinoBaudRate: next.baudRate,
      };
      c.updateArduinoProgram(selectedBoard.id, properties);
    }, 260);
  }

  function updateProgram(patch: Partial<ArduinoProgramState>): void {
    setProgram((current) => {
      const next = { ...current, ...patch };
      persist(next);
      return next;
    });
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

  if (!selectedBoard) {
    return (
      <section className="arduino-code-panel empty" aria-label="Редактор кода Arduino">
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
      className="arduino-code-panel"
      aria-label="Редактор кода Arduino"
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
          className="arduino-square-button"
          onClick={downloadSource}
          title="Скачать .ino"
        >
          <DownloadIcon />
        </button>
        {program.mode === 'text' ? (
          <button type="button" className="arduino-square-button" title="Библиотеки Arduino">
            <LibraryIcon />
          </button>
        ) : null}
        {program.mode !== 'blocks' ? (
          <button
            type="button"
            className="arduino-square-button"
            title="Размер текста"
            onClick={() => setFontSize((size) => (size >= 17 ? 12 : size + 1))}
          >
            <TextSizeIcon />
            <ChevronDown />
          </button>
        ) : null}
        <span className="arduino-code-toolbar-spacer" />
        <select
          className="arduino-board-select"
          value={selectedBoard.id}
          aria-label="Программируемая плата"
          onChange={(event) => setBoardId(event.target.value)}
        >
          {boards.map((board, index) => (
            <option key={board.id} value={board.id}>
              {index + 1} ({board.name?.trim() || 'Arduino Uno R3'})
            </option>
          ))}
        </select>
      </header>
      <div className={`arduino-code-body mode-${program.mode}`}>
        {program.mode !== 'text' ? (
          <div className="arduino-block-editor">
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
            <ScratchWorkspace
              key={selectedBoard.id}
              initialWorkspace={program.workspaceJson}
              category={category}
              flyoutWidth={flyoutWidth}
              onChange={(workspaceJson, source) => updateProgram({ workspaceJson, source })}
            />
          </div>
        ) : null}
        {program.mode !== 'blocks' ? (
          <ArduinoSourceEditor
            source={program.source}
            readOnly={program.mode === 'blocks-text'}
            fontSize={fontSize}
            onChange={(source) => updateProgram({ source })}
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
