import { lazy, Suspense, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { PublicUser } from '../api';
import { catalogEntry } from '../electronics/component-catalog';
import { WorkbenchHeader } from '../electronics/WorkbenchHeader';
import { WorkbenchStage } from '../electronics/WorkbenchStage';
import type { WorkbenchView } from '../electronics/workbench-model';
import { CloseIcon, CodeIcon, CommentIcon } from '../electronics/workbench-icons';
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
const WorkbenchSidebars = lazy(() =>
  import('../electronics/WorkbenchSidebars').then((module) => ({
    default: module.WorkbenchSidebars,
  })),
);
const ArduinoCodePanel = lazy(loadArduinoCodePanel);
const ShareDialog = lazy(() => {
  // This optional chunk must not trigger the global page reload: the live
  // electronics document may still contain unsaved changes.
  // WebKit may report a generic TypeError without the chunk's filename.
  // Suppress global recovery only while this optional Share import is pending.
  const keepEditorOpen = (event: Event) => event.preventDefault();
  window.addEventListener('asa-optional-preload-error', keepEditorOpen);
  return import('../electronics/WorkbenchShareDialog')
    .then((module) => ({ default: module.WorkbenchShareDialog }))
    .catch(() => ({ default: ShareLoadError }))
    .finally(() => window.removeEventListener('asa-optional-preload-error', keepEditorOpen));
});
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
  let stored = 0;
  try {
    stored = Number(localStorage.getItem(ARDUINO_DRAWER_STORAGE_KEY));
  } catch {
    // Storage denial must not prevent opening the document or obtaining a copy.
  }
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

type ShareDialogProps = {
  controller: ElectronicsWorkbenchController;
  onClose: () => void;
};

function ShareLoadError({ onClose }: ShareDialogProps): JSX.Element {
  return (
    <div className="workbench-modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="workbench-share-dialog"
        role="alert"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <p>Окно отправки не загрузилось. Сохраните проект и обновите страницу.</p>
        <button type="button" onClick={onClose}>
          Закрыть
        </button>
      </section>
    </div>
  );
}

export function SchematicEditor({
  projectId,
  onBack,
  user,
  seatLearner = false,
}: {
  projectId: string;
  onBack: () => void;
  user: PublicUser;
  seatLearner?: boolean;
}): JSX.Element {
  const controller = useElectronicsWorkbench(projectId, user.id, seatLearner);
  const [view, setView] = useState<WorkbenchView>('breadboard');
  const [showGrid] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [codeOpen, setCodeOpen] = useState(false);
  const [codePanelMounted, setCodePanelMounted] = useState(false);
  const [codePanelWidth, setCodePanelWidth] = useState(initialArduinoDrawerWidth);
  const [codeHeightPercent, setCodeHeightPercent] = useState(50);
  const shellRef = useRef<HTMLDivElement>(null);
  const [shareOpen, setShareOpen] = useState(false);
  // Student notes belong only to this browser session, not the shared device.
  // Existing Account-local notes are preserved; no historical notes are migrated.
  const notesStorageKey = seatLearner
    ? `asa-seat-notes:${user.id}:${projectId}`
    : `asa-lab:electronics-notes:${projectId}`;
  const notesStorage = () => (seatLearner ? sessionStorage : localStorage);
  const [notes, setNotes] = useState(() => {
    try {
      return notesStorage().getItem(notesStorageKey) ?? '';
    } catch {
      return '';
    }
  });

  useEffect(() => {
    const visible = window.visualViewport;
    const resize = () => {
      const shell = shellRef.current;
      if (!shell) return;
      const height = visible?.height ?? window.innerHeight;
      shell.style.setProperty('--wb-visible-height', height + 'px');
      shell.dataset['keyboardOpen'] = String(height < window.innerHeight * 0.72);
    };
    resize();
    visible?.addEventListener('resize', resize);
    window.addEventListener('resize', resize);
    return () => {
      visible?.removeEventListener('resize', resize);
      window.removeEventListener('resize', resize);
    };
  }, [controller.status]);

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
    try {
      localStorage.setItem(ARDUINO_DRAWER_STORAGE_KEY, String(next));
    } catch {
      // The current drawer width remains usable without storage.
    }
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
        if (!stage || stage.dataset['componentDragging'] || stage.dataset['wireDragging'])
          return null;
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
    try {
      notesStorage().setItem(notesStorageKey, value);
    } catch {
      /* Notes remain in the open editor. */
    }
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
      ref={shellRef}
      className={`workbench-shell${controller.libraryOpen ? '' : ' library-collapsed'}${
        codeOpen ? ' code-open' : ''
      }${codeOpen && codeHeightPercent >= 95 ? ' code-expanded' : ''}`}
      style={
        {
          '--arduino-code-panel-width': `${codePanelWidth}px`,
          '--wb-code-height': `${codeHeightPercent}%`,
        } as CSSProperties
      }
    >
      <WorkbenchHeader
        controller={controller}
        onBack={() => {
          void controller.saveBeforeLeave().then(onBack);
        }}
        user={user}
        view={view}
        onViewChange={setView}
        notesOpen={notesOpen}
        codeOpen={codeOpen}
        onToggleNotes={() => setNotesOpen((value) => !value)}
        onToggleCode={toggleCodePanel}
        onToggleLibrary={() => {
          setCodeOpen(false);
          controller.setLibraryOpen((value) => codeOpen || !value);
        }}
        onOpenShare={() => setShareOpen(true)}
        onExportView={exportCurrentView}
      />
      <div className="workbench-main" data-project-save-status={controller.saveStatus}>
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
        <Suspense fallback={<aside className="workbench-library" aria-hidden="true" />}>
          <WorkbenchSidebars controller={controller} />
        </Suspense>
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
              mobileHeightPercent={codeHeightPercent}
              onMobileHeightChange={setCodeHeightPercent}
              onClose={() => setCodeOpen(false)}
            />
          </Suspense>
        ) : null}
      </div>
      {shareOpen ? (
        <Suspense
          fallback={
            <div className="workbench-modal-backdrop" role="status">
              Открываем окно…
            </div>
          }
        >
          <ShareDialog controller={controller} onClose={() => setShareOpen(false)} />
        </Suspense>
      ) : null}
    </div>
  );
}
