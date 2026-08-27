import { lazy, Suspense, useEffect, useState, type CSSProperties } from 'react';
import type { PublicUser } from '../api';
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
const SchematicView = lazy(() =>
  import('../electronics/AlternateWorkbenchViews').then((module) => ({
    default: module.SchematicView,
  })),
);
const BomView = lazy(() =>
  import('../electronics/AlternateWorkbenchViews').then((module) => ({
    default: module.BomView,
  })),
);

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
    const release = registerProjectSnapshotSource(
      projectId,
      () => {
        const stage = controller.stageRef.current;
        if (!stage) return null;
        return rasteriseSvgStage(stage, SNAPSHOT_WIDTH, {
          contentSelector: '[data-testid="schematic-component"],[data-testid="wire-segment"]',
        });
      },
      // A dirty SVG is newer than serverRevision, so wait until that document
      // has been confirmed before publishing its card image.
      () => (controller.saveStatus === 'saved' ? controller.serverRevision : null),
    );
    const stop = startProjectSnapshots(projectId);
    return () => {
      stop();
      release();
    };
  }, [controller.saveStatus, controller.serverRevision, controller.stageRef, projectId]);
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
        ) : (
          <Suspense fallback={null}>
            {view === 'schematic' ? (
              <SchematicView document={controller.document} controller={controller} />
            ) : (
              <BomView document={controller.document} />
            )}
          </Suspense>
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
