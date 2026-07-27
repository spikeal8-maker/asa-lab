import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import {
  api,
  type ComponentKind,
  type Project,
  type ProjectVersion,
  type SchematicComponent,
  type SchematicDocument,
  type SolveResult,
} from '../api';
import {
  ACTIVE_COMPONENTS,
  catalogEntry,
  renderedSize,
  terminalPosition,
} from '../electronics/component-catalog';

const PALETTE = Object.values(ACTIVE_COMPONENTS);
const CANVAS = { width: 900, height: 520 };

interface TerminalRef {
  componentId: string;
  terminal: 'a' | 'b';
}

interface DragState {
  componentId: string;
  offsetX: number;
  offsetY: number;
  pointerId: number;
}

export function SchematicEditor({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}): JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<SchematicDocument | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedWire, setSelectedWire] = useState<string | null>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalRef | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canvasRef = useRef<SVGSVGElement>(null);
  const dragRef = useRef<DragState | null>(null);
  const counter = useRef(0);

  const load = useCallback(async () => {
    setStatus('loading');
    const response = await api.openProject(projectId);
    if (!response.ok) {
      setStatus('error');
      return;
    }
    setProject(response.data.project);
    setDocument(response.data.draft.document);
    setResult(response.data.result);
    setVersions(response.data.versions);
    setStatus('ready');
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function nextId(prefix: string): string {
    counter.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter.current}`;
  }

  function addComponent(kind: Exclude<ComponentKind, 'wire'>): void {
    if (!document) return;
    const entry = ACTIVE_COMPONENTS[kind];
    const index = document.components.filter((item) => item.kind !== 'wire').length;
    const component: SchematicComponent = {
      id: nextId(kind),
      kind,
      position: { x: 60 + (index % 3) * 260, y: 50 + Math.floor(index / 3) * 210 },
      value: entry.defaultValue,
    };
    setDocument({ ...document, components: [...document.components, component] });
    setSelected(component.id);
    setNotice(`${entry.label} добавлен на поле. Соедините выводы, чтобы замкнуть цепь.`);
  }

  function removeComponent(componentId: string): void {
    if (!document) return;
    setDocument({
      ...document,
      components: document.components.filter((component) => component.id !== componentId),
      connections: document.connections.filter(
        (connection) =>
          connection.from.componentId !== componentId && connection.to.componentId !== componentId,
      ),
    });
    setSelected(null);
  }

  function updateValue(componentId: string, value: number): void {
    if (!document) return;
    setDocument({
      ...document,
      components: document.components.map((component) =>
        component.id === componentId ? { ...component, value } : component,
      ),
    });
  }

  /** Canvas coordinates for a pointer event, independent of CSS scaling. */
  function toCanvasPoint(event: PointerEvent): { x: number; y: number } {
    const svg = canvasRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CANVAS.width,
      y: ((event.clientY - rect.top) / rect.height) * CANVAS.height,
    };
  }

  function startDrag(event: PointerEvent, component: SchematicComponent): void {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    const point = toCanvasPoint(event);
    dragRef.current = {
      componentId: component.id,
      offsetX: point.x - component.position.x,
      offsetY: point.y - component.position.y,
      pointerId: event.pointerId,
    };
    setSelected(component.id);
    event.preventDefault();
  }

  function moveDrag(event: PointerEvent): void {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !document) return;
    const point = toCanvasPoint(event);
    const dragged = document.components.find((item) => item.id === drag.componentId);
    const entry = dragged ? catalogEntry(dragged.kind) : null;
    const size = entry ? renderedSize(entry) : { width: 0, height: 0 };
    // Keep the whole drawing (plus a small margin) inside the working area.
    const margin = 12;
    const x = Math.max(
      margin,
      Math.min(CANVAS.width - size.width - margin, point.x - drag.offsetX),
    );
    const y = Math.max(
      margin,
      Math.min(CANVAS.height - size.height - margin, point.y - drag.offsetY),
    );
    setDocument({
      ...document,
      components: document.components.map((component) =>
        component.id === drag.componentId ? { ...component, position: { x, y } } : component,
      ),
    });
  }

  function endDrag(event: PointerEvent): void {
    if (dragRef.current?.pointerId === event.pointerId) {
      dragRef.current = null;
      setNotice('Положение изменено. Сохраните, чтобы запомнить его.');
    }
  }

  /** Two terminal activations (mouse or keyboard) create a wire between them. */
  function clickTerminal(componentId: string, terminal: 'a' | 'b'): void {
    if (!document) return;
    if (!pendingTerminal) {
      setPendingTerminal({ componentId, terminal });
      setNotice('Выберите второй вывод, чтобы протянуть провод.');
      return;
    }
    if (pendingTerminal.componentId === componentId && pendingTerminal.terminal === terminal) {
      setPendingTerminal(null);
      setNotice('Выбор вывода отменён.');
      return;
    }
    const connection = {
      id: nextId('wire'),
      from: { ...pendingTerminal },
      to: { componentId, terminal },
    };
    setDocument({ ...document, connections: [...document.connections, connection] });
    setPendingTerminal(null);
    setNotice('Провод протянут.');
  }

  function removeConnection(connectionId: string): void {
    if (!document) return;
    setDocument({
      ...document,
      connections: document.connections.filter((connection) => connection.id !== connectionId),
    });
    setSelectedWire(null);
    setNotice('Провод удалён.');
  }

  async function save(): Promise<void> {
    if (!document) return;
    setBusy(true);
    const response = await api.saveDraft(projectId, document);
    setBusy(false);
    if (response.ok) {
      setResult(response.data.result);
      setNotice('Схема сохранена.');
    } else {
      setNotice(`Не удалось сохранить: ${response.error.message}`);
    }
  }

  async function checkpoint(): Promise<void> {
    if (!document) return;
    setBusy(true);
    const saved = await api.saveDraft(projectId, document);
    const response = saved.ok ? await api.createCheckpoint(projectId) : null;
    setBusy(false);
    if (response?.ok) {
      setVersions([response.data.version, ...versions]);
      if (saved.ok) setResult(saved.data.result);
      setNotice(`Создана версия №${response.data.version.versionNo}. Её больше нельзя изменить.`);
    } else {
      setNotice('Не удалось создать версию.');
    }
  }

  const resultByComponent = useMemo(() => {
    const map = new Map<string, { current: number; voltageDrop: number; lit?: boolean }>();
    for (const entry of result?.components ?? []) {
      map.set(entry.componentId, entry);
    }
    return map;
  }, [result]);

  if (status === 'loading') {
    return (
      <div className="content" role="status" aria-live="polite">
        Загрузка проекта…
      </div>
    );
  }
  if (status === 'error' || !document) {
    return (
      <div className="content">
        <p className="form-error" role="alert">
          Не удалось открыть проект.
        </p>
        <button type="button" className="btn-secondary" onClick={onBack}>
          К списку проектов
        </button>
      </div>
    );
  }

  const selectedComponent = document.components.find((component) => component.id === selected);
  const selectedEntry = selectedComponent ? catalogEntry(selectedComponent.kind) : null;
  const placed = document.components.filter((component) => component.kind !== 'wire');
  const leds = placed.filter((component) => component.kind === 'led');

  return (
    <main className="content editor">
      <div className="content-head">
        <div>
          <button type="button" className="btn-ghost" onClick={onBack}>
            ← Проекты
          </button>
          <h1>{project?.title ?? 'Проект'}</h1>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void save()}
            disabled={busy}
          >
            Сохранить
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void checkpoint()}
            disabled={busy}
          >
            Создать версию
          </button>
        </div>
      </div>

      {notice ? (
        <p className="notice-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="editor-layout">
        <section className="palette" aria-label="Элементы">
          <h2>Элементы</h2>
          {PALETTE.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className="btn-secondary palette-button"
              onClick={() => addComponent(entry.kind as Exclude<ComponentKind, 'wire'>)}
            >
              {entry.label}
            </button>
          ))}
          <p className="muted palette-hint">Провод появляется, когда вы соединяете два вывода.</p>
        </section>

        <section className="canvas-wrap" aria-label="Схема">
          <svg
            ref={canvasRef}
            className="schematic-canvas"
            data-testid="schematic-canvas"
            viewBox={`0 0 ${CANVAS.width} ${CANVAS.height}`}
            preserveAspectRatio="xMidYMid meet"
            aria-label="Рабочее поле схемы"
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
          >
            <rect className="canvas-grid" x="0" y="0" width={CANVAS.width} height={CANVAS.height} />

            {/* Wires sit under the parts so terminals stay clickable. */}
            <g data-testid="wire-layer">
              {document.connections.map((connection) => {
                const from = document.components.find(
                  (item) => item.id === connection.from.componentId,
                );
                const to = document.components.find(
                  (item) => item.id === connection.to.componentId,
                );
                if (!from || !to) return null;
                const start = terminalPosition(from.kind, from.position, connection.from.terminal);
                const end = terminalPosition(to.kind, to.position, connection.to.terminal);
                if (!start || !end) return null;
                const midX = (start.x + end.x) / 2;
                return (
                  <path
                    key={connection.id}
                    data-testid="schematic-wire"
                    className={`wire${selectedWire === connection.id ? ' wire-selected' : ''}`}
                    d={`M ${start.x} ${start.y} C ${midX} ${start.y}, ${midX} ${end.y}, ${end.x} ${end.y}`}
                    onClick={() => setSelectedWire(connection.id)}
                    aria-label="Провод: нажмите, чтобы выбрать"
                  />
                );
              })}
            </g>

            {placed.map((component) => {
              const entry = catalogEntry(component.kind);
              if (!entry || !entry.asset) return null;
              const size = renderedSize(entry);
              const scale = size.width / entry.viewBox.width;
              const measured = resultByComponent.get(component.id);
              const lit = component.kind === 'led' && measured?.lit === true;
              return (
                <g
                  key={component.id}
                  className={`placed${selected === component.id ? ' placed-selected' : ''}`}
                  data-testid="schematic-component"
                  data-kind={component.kind}
                  data-x={Math.round(component.position.x)}
                  data-y={Math.round(component.position.y)}
                  transform={`translate(${component.position.x} ${component.position.y})`}
                >
                  {lit ? (
                    <circle
                      className="led-glow"
                      data-testid="led-glow"
                      cx={((entry.terminals.a.x + entry.terminals.b.x) / 2) * scale}
                      cy={size.height * 0.34}
                      r={size.width * 0.42}
                    />
                  ) : null}
                  <image
                    href={entry.asset}
                    width={size.width}
                    height={size.height}
                    style={
                      component.kind === 'led'
                        ? ({ '--led-intensity': lit ? 1 : 0 } as Record<string, string | number>)
                        : undefined
                    }
                    onPointerDown={(event) => startDrag(event, component)}
                  >
                    <title>
                      {entry.label}
                      {entry.unit ? ` · ${component.value} ${entry.unit}` : ''}
                    </title>
                  </image>
                  {(['a', 'b'] as const).map((terminal) => {
                    const spec = entry.terminals[terminal];
                    const active =
                      pendingTerminal?.componentId === component.id &&
                      pendingTerminal.terminal === terminal;
                    return (
                      <circle
                        key={terminal}
                        className={`terminal-dot${active ? ' terminal-dot-active' : ''}`}
                        data-testid="terminal-dot"
                        cx={spec.x * scale}
                        cy={spec.y * scale}
                        r={12}
                        tabIndex={0}
                        role="button"
                        aria-label={`${entry.label}: вывод ${spec.label}`}
                        onClick={() => clickTerminal(component.id, terminal)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            clickTerminal(component.id, terminal);
                          }
                        }}
                      />
                    );
                  })}
                </g>
              );
            })}
          </svg>

          {placed.length === 0 ? (
            <p className="muted canvas-empty">
              Поле пустое. Добавьте источник, резистор и светодиод.
            </p>
          ) : null}

          {selectedWire ? (
            <div className="wire-actions">
              <span>Провод выбран.</span>
              <button
                type="button"
                className="btn-secondary"
                onClick={() => removeConnection(selectedWire)}
              >
                Удалить провод
              </button>
            </div>
          ) : null}
        </section>

        <section className="inspector" aria-label="Результат">
          <h2>Результат</h2>
          <p className="reading" data-testid="current-reading">
            Ток: {result?.solved ? `${(result.current * 1000).toFixed(1)} мА` : '—'}
          </p>
          {leds.length > 0 ? (
            <p className="led-state" data-testid="led-state">
              {leds.every((component) => resultByComponent.get(component.id)?.lit)
                ? 'Светодиод горит'
                : 'Светодиод не горит'}
            </p>
          ) : null}
          <ul className="diagnostics" data-testid="diagnostics">
            {(result?.diagnostics ?? []).map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${index}`}
                className={`diagnostic ${diagnostic.severity}`}
              >
                {diagnostic.message}
              </li>
            ))}
          </ul>

          {selectedComponent && selectedEntry ? (
            <div className="parameter">
              <label htmlFor="component-value">
                {selectedEntry.label} · значение ({selectedEntry.unit})
              </label>
              <input
                id="component-value"
                type="number"
                min={0}
                step="any"
                value={selectedComponent.value}
                onChange={(event) => updateValue(selectedComponent.id, Number(event.target.value))}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => removeComponent(selectedComponent.id)}
              >
                Удалить элемент
              </button>
            </div>
          ) : null}

          <h3>Версии</h3>
          {versions.length === 0 ? (
            <p className="muted">Версий пока нет.</p>
          ) : (
            <ul className="version-list" data-testid="version-list">
              {versions.map((version) => (
                <li key={version.id}>Версия №{version.versionNo}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
