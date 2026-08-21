import { lazy, Suspense, useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { PublicUser, SchematicComponent, SchematicDocument } from '../api';
import { catalogEntry } from '../electronics/component-catalog';
import { WorkbenchHeader } from '../electronics/WorkbenchHeader';
import { WorkbenchSidebars } from '../electronics/WorkbenchSidebars';
import { WorkbenchStage } from '../electronics/WorkbenchStage';
import type { WorkbenchView } from '../electronics/workbench-model';
import {
  CloseIcon,
  CodeIcon,
  CommentIcon,
  SaveIcon,
  ShareIcon,
} from '../electronics/workbench-icons';
import {
  useElectronicsWorkbench,
  type ElectronicsWorkbenchController,
} from '../electronics/use-electronics-workbench';
import '../electronics/workbench.css';
import {
  registerProjectSnapshotSource,
  startProjectSnapshots,
  SNAPSHOT_WIDTH,
} from '../modules/project-snapshot';
import { rasteriseSvgStage } from '../modules/svg-snapshot';

const loadArduinoCodePanel = () =>
  import('../electronics/ArduinoCodePanel').then((module) => ({
    default: module.ArduinoCodePanel,
  }));
const ArduinoCodePanel = lazy(loadArduinoCodePanel);

const ARDUINO_DRAWER_STORAGE_KEY = 'asa-lab:electronics:arduino-drawer-width';
const ARDUINO_DRAWER_MIN_WIDTH = 620;
const ARDUINO_CIRCUIT_MIN_WIDTH = 420;

function clampArduinoDrawerWidth(width: number, viewportWidth = window.innerWidth): number {
  const maximum = Math.max(460, viewportWidth - ARDUINO_CIRCUIT_MIN_WIDTH);
  const minimum = Math.min(ARDUINO_DRAWER_MIN_WIDTH, maximum);
  return Math.round(Math.min(maximum, Math.max(minimum, width)));
}

function initialArduinoDrawerWidth(): number {
  const stored = Number(localStorage.getItem(ARDUINO_DRAWER_STORAGE_KEY));
  const preferred =
    Number.isFinite(stored) && stored > 0 ? stored : Math.min(1040, innerWidth * 0.58);
  return clampArduinoDrawerWidth(preferred);
}

function SchematicSymbol({ component }: { component: SchematicComponent }): JSX.Element {
  const commonLabel = (
    <>
      <text x="0" y="82" textAnchor="middle">
        {component.name ?? component.kind}
      </text>
      {component.value ? (
        <text x="0" y="98" textAnchor="middle" className="value">
          {component.value}
        </text>
      ) : null}
    </>
  );
  if (component.kind === 'resistor') {
    return (
      <>
        <line x1="-105" y1="35" x2="-66" y2="35" />
        <path d="M-66 35l12-18 18 36 18-36 18 36 18-36 18 36 12-18" />
        <line x1="66" y1="35" x2="105" y2="35" />
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'source') {
    return (
      <>
        <line x1="-105" y1="35" x2="-26" y2="35" />
        <line x1="-26" y1="10" x2="-26" y2="60" />
        <line x1="-9" y1="20" x2="-9" y2="50" />
        <line x1="9" y1="10" x2="9" y2="60" />
        <line x1="26" y1="20" x2="26" y2="50" />
        <line x1="26" y1="35" x2="105" y2="35" />
        <text x="-28" y="5">
          +
        </text>
        <text x="20" y="5">
          −
        </text>
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'led' || component.kind === 'diode') {
    return (
      <>
        <line x1="-105" y1="35" x2="-32" y2="35" />
        <path className="symbol-body" d="M-32 12v46l52-23z" />
        <line x1="20" y1="10" x2="20" y2="60" />
        <line x1="20" y1="35" x2="105" y2="35" />
        {component.kind === 'led' ? (
          <g className="schematic-light-rays">
            <path d="M35 8l17-13" />
            <path d="M45 20l18-13" />
          </g>
        ) : null}
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'switch' || component.kind === 'button') {
    return (
      <>
        <line x1="-105" y1="35" x2="-45" y2="35" />
        <circle cx="-38" cy="35" r="6" />
        <circle cx="38" cy="35" r="6" />
        <line x1="45" y1="35" x2="105" y2="35" />
        <line x1="-32" y1="31" x2="31" y2={component.state ? '35' : '10'} />
        {component.kind === 'button' ? <line x1="0" y1="-8" x2="0" y2="12" /> : null}
        {commonLabel}
      </>
    );
  }
  if (component.kind === 'potentiometer') {
    return (
      <>
        <line x1="-105" y1="35" x2="-66" y2="35" />
        <path d="M-66 35l12-18 18 36 18-36 18 36 18-36 18 36 12-18" />
        <line x1="66" y1="35" x2="105" y2="35" />
        <path d="M0-2v27m0 0l-7-10m7 10l7-10" />
        {commonLabel}
      </>
    );
  }
  return (
    <>
      <line x1="-105" y1="35" x2="-85" y2="35" />
      <rect x="-85" y="0" width="170" height="70" rx="5" />
      <line x1="85" y1="35" x2="105" y2="35" />
      {commonLabel}
    </>
  );
}

function SchematicView({
  document,
  controller,
}: {
  document: SchematicDocument;
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const components = document.components.filter(
    (component) => component.kind !== 'wire' && component.kind !== 'breadboard',
  );
  const positions = new Map(
    components.map((component, index) => [
      component.id,
      { x: 180 + (index % 4) * 280, y: 180 + Math.floor(index / 4) * 180 },
    ]),
  );
  return (
    <section className="workbench-alternate-view workbench-schematic-view" aria-label="Схема">
      <svg viewBox="0 0 1400 850" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="schematic-grid" width="20" height="20" patternUnits="userSpaceOnUse">
            <path d="M20 0H0V20" fill="none" stroke="#e7eaed" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="1400" height="850" fill="url(#schematic-grid)" />
        {document.connections.map((wire) => {
          const from = positions.get(wire.from.componentId);
          const to = positions.get(wire.to.componentId);
          if (!from || !to) return null;
          return (
            <path
              key={wire.id}
              d={`M${from.x + 85} ${from.y + 35}H${(from.x + to.x) / 2}V${to.y + 35}H${to.x - 85}`}
              className="workbench-schematic-wire"
              style={{ stroke: wire.color ?? '#e3212b' }}
            />
          );
        })}
        {components.map((component) => {
          const position = positions.get(component.id)!;
          const entry = catalogEntry(component);
          const selected =
            controller.selection?.kind === 'component' &&
            controller.selection.ids.includes(component.id);
          return (
            <g
              key={component.id}
              className={`workbench-schematic-symbol${selected ? ' selected' : ''}`}
              transform={`translate(${position.x} ${position.y})`}
              role="button"
              tabIndex={0}
              onClick={() => controller.selectComponent(component.id, false)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  controller.selectComponent(component.id, false);
                }
              }}
            >
              <SchematicSymbol
                component={{
                  ...component,
                  name: component.name ?? entry?.label ?? component.kind,
                }}
              />
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function BomView({ document }: { document: SchematicDocument }): JSX.Element {
  const rows = useMemo(() => {
    const grouped = new Map<string, { names: string[]; component: string; count: number }>();
    for (const component of document.components.filter((item) => item.kind !== 'wire')) {
      const entry = catalogEntry(component);
      const key = `${entry?.key ?? component.kind}:${component.variantId ?? ''}:${component.value}`;
      const row = grouped.get(key);
      const name = component.name ?? entry?.label ?? component.kind;
      if (row) {
        row.count += 1;
        row.names.push(name);
      } else {
        const value = component.value ? `${component.value} ${entry?.unit ?? ''}`.trim() : '';
        grouped.set(key, {
          names: [name],
          component: [value, entry?.label ?? component.kind].filter(Boolean).join(' '),
          count: 1,
        });
      }
    }
    return [...grouped.values()].sort((left, right) =>
      left.component.localeCompare(right.component, 'ru'),
    );
  }, [document]);
  return (
    <section
      className="workbench-alternate-view workbench-bom-view"
      aria-label="Список компонентов"
    >
      <div className="workbench-bom-card">
        <h2>Список компонентов</h2>
        <p>{rows.reduce((sum, row) => sum + row.count, 0)} компонентов в проекте</p>
        <table>
          <thead>
            <tr>
              <th>Имя</th>
              <th>Количество</th>
              <th>Компонент</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.component}:${row.names.join(':')}`}>
                <td>
                  {row.names.map((name) => (
                    <div key={name}>{name}</div>
                  ))}
                </td>
                <td>{row.count}</td>
                <td>{row.component}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SidePanel({
  kind,
  title,
  onClose,
  notes,
  onNotesChange,
}: {
  kind: 'notes' | 'code';
  title: string;
  onClose: () => void;
  notes?: string;
  onNotesChange?: (value: string) => void;
}): JSX.Element {
  return (
    <aside className={`workbench-utility-panel ${kind}`} aria-label={title}>
      <header>
        <span>{kind === 'notes' ? <CommentIcon /> : <CodeIcon />}</span>
        <strong>{title}</strong>
        <button type="button" onClick={onClose} aria-label="Закрыть">
          <CloseIcon />
        </button>
      </header>
      {kind === 'notes' ? (
        <textarea
          aria-label="Заметки проекта"
          placeholder="Добавьте заметку к проекту…"
          value={notes ?? ''}
          onChange={(event) => onNotesChange?.(event.target.value)}
        />
      ) : (
        <div className="workbench-code-empty">
          <CodeIcon />
          <strong>Нет программируемых компонентов</strong>
          <p>Добавьте совместимую плату, чтобы открыть редактор кода.</p>
        </div>
      )}
    </aside>
  );
}

function ShareDialog({
  controller: c,
  onClose,
}: {
  controller: ElectronicsWorkbenchController;
  onClose: () => void;
}): JSX.Element {
  const [copied, setCopied] = useState(false);
  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="workbench-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="workbench-share-dialog"
        role="dialog"
        aria-modal="true"
        aria-label="Отправить проект"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header>
          <ShareIcon />
          <strong>Отправить проект</strong>
          <button type="button" onClick={onClose} aria-label="Закрыть">
            <CloseIcon />
          </button>
        </header>
        <label>
          <span>Ссылка на проект</span>
          <input
            readOnly
            value={window.location.href}
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
        <div className="workbench-share-actions">
          <button type="button" onClick={() => void copyLink()}>
            <ShareIcon /> {copied ? 'Ссылка скопирована' : 'Копировать ссылку'}
          </button>
          <button type="button" onClick={() => void c.saveNow()} disabled={c.busy}>
            <SaveIcon /> Сохранить сейчас
          </button>
          <button type="button" onClick={() => void c.checkpoint()} disabled={c.busy}>
            <ShareIcon /> Создать версию
          </button>
        </div>
      </section>
    </div>
  );
}

export function SchematicEditor({
  projectId,
  onBack,
  user,
}: {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
}): JSX.Element {
  const controller = useElectronicsWorkbench(projectId);
  const [view, setView] = useState<WorkbenchView>('breadboard');
  const [showGrid] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codePanelMounted, setCodePanelMounted] = useState(false);
  const [codePanelWidth, setCodePanelWidth] = useState(initialArduinoDrawerWidth);
  const [shareOpen, setShareOpen] = useState(false);
  const notesStorageKey = `asa-lab:electronics-notes:${projectId}`;
  const [notes, setNotes] = useState(() => localStorage.getItem(notesStorageKey) ?? '');

  useEffect(() => {
    const clampToViewport = (): void => {
      setCodePanelWidth((current) => clampArduinoDrawerWidth(current));
    };
    window.addEventListener('resize', clampToViewport);
    return () => window.removeEventListener('resize', clampToViewport);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const warmup = window.setTimeout(() => {
      void loadArduinoCodePanel().then(() => {
        if (!cancelled) setCodePanelMounted(true);
      });
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(warmup);
    };
  }, []);

  function updateCodePanelWidth(width: number): void {
    const next = clampArduinoDrawerWidth(width);
    setCodePanelWidth(next);
    localStorage.setItem(ARDUINO_DRAWER_STORAGE_KEY, String(next));
  }

  function toggleCodePanel(): void {
    if (!codeOpen) setCodePanelMounted(true);
    setCodeOpen((value) => !value);
  }

  // The card picture is the stage as the learner sees it, rasterised from the
  // live SVG. Project Core owns the size, the format and the schedule.
  useEffect(() => {
    const release = registerProjectSnapshotSource(projectId, () => {
      const stage = controller.stageRef.current;
      if (!stage) return null;
      return rasteriseSvgStage(stage, SNAPSHOT_WIDTH, {
        contentSelector: '[data-testid="schematic-component"],[data-testid="wire-segment"]',
      });
    });
    const stop = startProjectSnapshots(projectId);
    return () => {
      stop();
      release();
    };
  }, [controller.stageRef, projectId]);
  function updateNotes(value: string): void {
    setNotes(value);
    localStorage.setItem(notesStorageKey, value);
  }
  function exportCurrentView(target: Exclude<WorkbenchView, 'breadboard'>): void {
    if (target === 'schematic') {
      window.print();
      return;
    }
    if (!controller.document) return;
    const rows = controller.document.components
      .filter((item) => item.kind !== 'wire')
      .map((component) => {
        const entry = catalogEntry(component);
        return [
          component.name ?? entry?.label ?? component.kind,
          entry?.label ?? component.kind,
          component.variantId ?? component.componentTypeId ?? '—',
          String(component.value ?? ''),
        ];
      });
    const csv = [['Имя', 'Компонент', 'Вариант', 'Значение'], ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
      .join('\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${controller.projectTitle || 'electronics'}-components.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }
  if (controller.status === 'loading')
    return (
      <div className="workbench-loading" role="status">
        Загрузка проекта…
      </div>
    );
  if (controller.status === 'error' || !controller.document)
    return (
      <main className="workbench-loading">
        <p>Не удалось открыть проект.</p>
        <button className="btn-secondary" onClick={onBack}>
          К проектам
        </button>
      </main>
    );
  return (
    <div
      className={`workbench-shell${controller.libraryOpen ? '' : ' library-collapsed'}${
        codeOpen ? ' code-open' : ''
      }`}
      style={{ '--arduino-code-panel-width': `${codePanelWidth}px` } as CSSProperties}
    >
      <WorkbenchHeader
        controller={controller}
        onBack={onBack}
        user={user}
        view={view}
        onViewChange={setView}
        notesOpen={notesOpen}
        codeOpen={codeOpen}
        onToggleNotes={() => setNotesOpen((value) => !value)}
        onToggleCode={toggleCodePanel}
        onOpenShare={() => setShareOpen(true)}
        onExportView={exportCurrentView}
      />
      <div className="workbench-main">
        {view === 'breadboard' ? (
          <WorkbenchStage controller={controller} showGrid={showGrid} />
        ) : view === 'schematic' ? (
          <SchematicView document={controller.document} controller={controller} />
        ) : (
          <BomView document={controller.document} />
        )}
        <WorkbenchSidebars controller={controller} />
        {notesOpen ? (
          <SidePanel
            kind="notes"
            title="Заметки"
            notes={notes}
            onNotesChange={updateNotes}
            onClose={() => setNotesOpen(false)}
          />
        ) : null}
        {codePanelMounted ? (
          <Suspense
            fallback={
              <section
                className={`arduino-code-panel empty ${codeOpen ? 'open' : 'closed'}`}
                aria-label="Редактор кода Arduino"
              >
                <div className="arduino-code-empty-state">
                  <strong>Открываем редактор кода…</strong>
                </div>
              </section>
            }
          >
            <ArduinoCodePanel
              controller={controller}
              open={codeOpen}
              drawerWidth={codePanelWidth}
              onDrawerWidthChange={updateCodePanelWidth}
            />
          </Suspense>
        ) : null}
      </div>
      {shareOpen ? (
        <ShareDialog controller={controller} onClose={() => setShareOpen(false)} />
      ) : null}
    </div>
  );
}
