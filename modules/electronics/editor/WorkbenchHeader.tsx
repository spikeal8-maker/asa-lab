import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '@asa-lab/web-api-client';
import { ProjectEditorHeader, type EditorHeaderTab } from '@asa-lab/editor-host';
import {
  ChevronIcon,
  CircuitIcon,
  CodeIcon,
  CommentIcon,
  DeleteIcon,
  DuplicateIcon,
  ListIcon,
  MirrorIcon,
  PasteIcon,
  PlayIcon,
  RedoIcon,
  RotateIcon,
  SchematicIcon,
  StopIcon,
  UndoIcon,
  ViewIcon,
  WireIcon,
} from '@asa-lab/ui-kit';
import { WIRE_COLORS, type ToolButtonProps, type WorkbenchView } from './workbench-model';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

const WIRE_COLOR_NAMES: Readonly<Record<string, string>> = {
  '#e3212b': 'Красный',
  '#2a3035': 'Чёрный',
  '#149447': 'Зелёный',
  '#2c62c9': 'Синий',
  '#e7a400': 'Жёлтый',
  '#8d45c7': 'Фиолетовый',
};

const WORKBENCH_VIEWS: readonly EditorHeaderTab<WorkbenchView>[] = [
  { id: 'breadboard', label: 'Цепи', icon: <CircuitIcon /> },
  { id: 'schematic', label: 'Схемы', icon: <SchematicIcon /> },
  { id: 'bom', label: 'Компоненты', icon: <ListIcon /> },
];

function ToolButton({
  label,
  disabled = false,
  active = false,
  danger = false,
  onClick,
  children,
}: ToolButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`workbench-tool${active ? ' active' : ''}${danger ? ' danger' : ''}`}
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function formatSimulationTime(totalSeconds: number): string {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':');
}

export function WorkbenchHeader({
  controller: c,
  onBack,
  user,
  view,
  onViewChange,
  notesOpen,
  onToggleNotes,
  onToggleCode,
  onOpenShare,
  onExportView,
}: {
  controller: ElectronicsWorkbenchController;
  onBack: () => void;
  user: PublicUser;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  onToggleCode: () => void;
  onOpenShare: () => void;
  onExportView: (view: Exclude<WorkbenchView, 'breadboard'>) => void;
}): JSX.Element {
  const hasComponentSelection = c.selection?.kind === 'component';
  const wireColorMenuRef = useRef<HTMLDetailsElement>(null);
  const [simulationElapsedSeconds, setSimulationElapsedSeconds] = useState(0);

  useEffect(() => {
    if (!c.simulationRunning) {
      setSimulationElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    const update = () => setSimulationElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
    update();
    const timer = window.setInterval(update, 250);
    return () => window.clearInterval(timer);
  }, [c.simulationRunning]);

  return (
    <>
      <ProjectEditorHeader
        activeView={view}
        displayName={user.displayName}
        onBack={onBack}
        onTitleCancel={() => c.setProjectTitle(c.project?.title ?? '')}
        onTitleChange={c.setProjectTitle}
        onTitleCommit={c.renameProject}
        onViewChange={onViewChange}
        projectTitle={c.projectTitle}
        saveError={c.saveError}
        saveStatus={c.saveStatus}
        saveText={
          c.saveStatus === 'error' && c.saveError
            ? `${c.saveCopy.error}: ${c.saveError}`
            : c.saveCopy[c.saveStatus]
        }
        tabs={WORKBENCH_VIEWS}
      />
      <div
        className={`workbench-toolbar ${view}`}
        role="toolbar"
        aria-label="Инструменты редактора"
      >
        {view === 'breadboard' ? (
          <div className="workbench-toolbar-group workbench-breadboard-tools">
            <ToolButton
              label="Копировать (Ctrl+C)"
              onClick={c.copySelected}
              disabled={!hasComponentSelection}
            >
              <DuplicateIcon />
            </ToolButton>
            <ToolButton
              label="Вставить (Ctrl+V)"
              onClick={c.pasteCopied}
              disabled={!c.hasClipboard}
            >
              <PasteIcon />
            </ToolButton>
            <ToolButton
              label="Удалить (Delete)"
              onClick={c.removeSelection}
              disabled={!c.selection}
              danger
            >
              <DeleteIcon />
            </ToolButton>
            <span className="workbench-toolbar-divider" />
            <ToolButton label="Отменить (Ctrl+Z)" onClick={c.undo} disabled={!c.canUndo}>
              <UndoIcon />
            </ToolButton>
            <ToolButton label="Повторить (Ctrl+Shift+Z)" onClick={c.redo} disabled={!c.canRedo}>
              <RedoIcon />
            </ToolButton>
            <span className="workbench-toolbar-divider" />
            <ToolButton label="Заметки" active={notesOpen} onClick={onToggleNotes}>
              <CommentIcon />
            </ToolButton>
            <ToolButton
              label="Показать или скрыть заметки"
              active={notesOpen}
              onClick={onToggleNotes}
            >
              <ViewIcon />
            </ToolButton>
            <span className="workbench-toolbar-gap small" />
            <details className="workbench-wire-color" ref={wireColorMenuRef}>
              <summary aria-label="Цвет провода" title="Цвет провода">
                <span style={{ background: c.activeWireColor }} />
                <ChevronIcon />
              </summary>
              <div className="workbench-wire-color-menu" role="menu" aria-label="Цвет провода">
                {WIRE_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    role="menuitemradio"
                    aria-checked={c.activeWireColor === color}
                    className={c.activeWireColor === color ? 'active' : ''}
                    onClick={() => {
                      c.setWireColor(color);
                      wireColorMenuRef.current?.removeAttribute('open');
                    }}
                  >
                    <span style={{ background: color }} />
                    {WIRE_COLOR_NAMES[color]}
                  </button>
                ))}
              </div>
            </details>
            <span className="workbench-toolbar-gap small" />
            <button
              type="button"
              className={`workbench-wire-style${c.orthogonalWireMode ? ' active' : ''}`}
              aria-label="Автоматическая прокладка провода под 90 градусов"
              aria-pressed={c.orthogonalWireMode}
              title={
                c.orthogonalWireMode ? 'Фиксация под 90° включена' : 'Включить фиксацию под 90°'
              }
              onClick={c.toggleWireRoute}
              style={{ color: c.activeWireColor }}
            >
              <WireIcon />
              <ChevronIcon />
            </button>
            <span className="workbench-toolbar-gap rotate" />
            <ToolButton
              label="Повернуть (R)"
              onClick={c.rotateSelected}
              disabled={!hasComponentSelection}
            >
              <RotateIcon />
            </ToolButton>
            <ToolButton
              label="Отразить"
              onClick={() => c.mirrorSelected('horizontal')}
              disabled={!hasComponentSelection}
            >
              <MirrorIcon />
            </ToolButton>
          </div>
        ) : (
          <div className="workbench-toolbar-group workbench-view-tools">
            <strong>{view === 'schematic' ? 'Схема' : 'Список компонентов'}</strong>
            {view === 'schematic' ? (
              <>
                <ToolButton
                  label="Повернуть (R)"
                  onClick={c.rotateSelected}
                  disabled={!hasComponentSelection}
                >
                  <RotateIcon />
                </ToolButton>
                <ToolButton
                  label="Отразить"
                  onClick={() => c.mirrorSelected('horizontal')}
                  disabled={!hasComponentSelection}
                >
                  <MirrorIcon />
                </ToolButton>
              </>
            ) : null}
            <button
              type="button"
              className="workbench-export-button"
              onClick={() => onExportView(view)}
            >
              {view === 'schematic' ? 'Скачать PDF' : 'Скачать CSV'}
            </button>
          </div>
        )}
        {c.simulationRunning ? (
          <span className="workbench-simulation-time" aria-label="Время моделирования">
            Время моделирования: {formatSimulationTime(simulationElapsedSeconds)}
          </span>
        ) : null}
        <div className="workbench-toolbar-spacer" />
        <div className="workbench-toolbar-group right">
          <button
            type="button"
            className="workbench-pill"
            title="Редактор кода пока недоступен в локальной версии"
            aria-label="Код — пока недоступен"
            aria-disabled="true"
            disabled
            onClick={onToggleCode}
          >
            <CodeIcon /> Код
          </button>
          <button
            type="button"
            className={`workbench-pill simulate${c.simulationRunning ? ' running' : ''}`}
            onClick={() => void c.toggleSimulation()}
            disabled={c.busy}
            data-simulation-status={c.simulationStatus}
            aria-label={c.simulationRunning ? 'Остановить моделирование' : 'Начать моделирование'}
          >
            {c.simulationRunning ? <StopIcon /> : <PlayIcon />}
            {c.simulationRunning ? 'Остановить моделирование' : 'Начать моделирование'}
          </button>
          <button
            type="button"
            className="workbench-pill"
            title="Публикация и совместный доступ пока недоступны в локальной версии"
            aria-label="Отправить — пока недоступно"
            aria-disabled="true"
            disabled
            onClick={onOpenShare}
          >
            Отправить
          </button>
        </div>
      </div>
    </>
  );
}
