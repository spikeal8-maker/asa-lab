import { useMemo, useState } from 'react';
import type { PublicUser, SchematicDocument } from '../api';
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

function SchematicView({
  document,
  controller,
}: {
  document: SchematicDocument;
  controller: ElectronicsWorkbenchController;
}): JSX.Element {
  const components = document.components.filter((component) => component.kind !== 'wire');
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
              <line x1="-105" y1="35" x2="-85" y2="35" />
              <rect x="-85" y="0" width="170" height="70" rx="5" />
              <line x1="85" y1="35" x2="105" y2="35" />
              <text x="0" y="29" textAnchor="middle">
                {component.name ?? entry?.label ?? component.kind}
              </text>
              <text x="0" y="50" textAnchor="middle" className="value">
                {component.value || ''} {entry?.unit ?? ''}
              </text>
            </g>
          );
        })}
      </svg>
    </section>
  );
}

function BomView({ document }: { document: SchematicDocument }): JSX.Element {
  const rows = useMemo(() => {
    const grouped = new Map<
      string,
      { name: string; variant: string; value: string; count: number }
    >();
    for (const component of document.components.filter((item) => item.kind !== 'wire')) {
      const entry = catalogEntry(component);
      const key = `${entry?.key ?? component.kind}:${component.variantId ?? ''}:${component.value}`;
      const row = grouped.get(key);
      if (row) row.count += 1;
      else
        grouped.set(key, {
          name: entry?.label ?? component.kind,
          variant: component.variantId ?? entry?.key ?? '—',
          value: component.value ? `${component.value} ${entry?.unit ?? ''}`.trim() : '—',
          count: 1,
        });
    }
    return [...grouped.values()].sort((left, right) => left.name.localeCompare(right.name, 'ru'));
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
              <th>Количество</th>
              <th>Компонент</th>
              <th>Вариант</th>
              <th>Значение</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={`${row.name}:${row.variant}:${row.value}`}>
                <td>{row.count}</td>
                <td>{row.name}</td>
                <td>{row.variant}</td>
                <td>{row.value}</td>
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
  const [showGrid, setShowGrid] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const notesStorageKey = `asa-lab:electronics-notes:${projectId}`;
  const [notes, setNotes] = useState(() => localStorage.getItem(notesStorageKey) ?? '');
  function updateNotes(value: string): void {
    setNotes(value);
    localStorage.setItem(notesStorageKey, value);
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
    <div className={`workbench-shell${controller.libraryOpen ? '' : ' library-collapsed'}`}>
      <WorkbenchHeader
        controller={controller}
        onBack={onBack}
        user={user}
        view={view}
        onViewChange={setView}
        showGrid={showGrid}
        onToggleGrid={() => setShowGrid((value) => !value)}
        notesOpen={notesOpen}
        onToggleNotes={() => setNotesOpen((value) => !value)}
        codeOpen={codeOpen}
        onToggleCode={() => setCodeOpen((value) => !value)}
        onOpenShare={() => setShareOpen(true)}
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
        {codeOpen ? <SidePanel kind="code" title="Код" onClose={() => setCodeOpen(false)} /> : null}
      </div>
      {shareOpen ? (
        <ShareDialog controller={controller} onClose={() => setShareOpen(false)} />
      ) : null}
    </div>
  );
}
