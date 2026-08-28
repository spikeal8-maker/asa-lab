import { useEffect, useRef, useState } from 'react';
import type { PublicUser } from '../api';
import { EditorAvatar, useEditorAvatar } from '../components/editor-chrome/EditorAvatar';
import {
  CheckIcon,
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
} from './workbench-icons';
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

const SAVE_ERROR_VISIBILITY_MS = 4_500;

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
  codeOpen,
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
  codeOpen: boolean;
  onToggleNotes: () => void;
  onToggleCode: () => void;
  onOpenShare: () => void;
  onExportView: (view: Exclude<WorkbenchView, 'breadboard'>) => void;
}): JSX.Element {
  const hasComponentSelection = c.selection?.kind === 'component';
  const wireColorMenuRef = useRef<HTMLDetailsElement>(null);
  const [simulationElapsedSeconds, setSimulationElapsedSeconds] = useState(0);
  const [saveErrorVisible, setSaveErrorVisible] = useState(false);
  const avatar = useEditorAvatar(user);

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

  useEffect(() => {
    if (c.saveStatus !== 'error') {
      setSaveErrorVisible(false);
      return;
    }
    setSaveErrorVisible(true);
    const timer = window.setTimeout(() => setSaveErrorVisible(false), SAVE_ERROR_VISIBILITY_MS);
    return () => window.clearTimeout(timer);
  }, [c.saveError, c.saveStatus]);

  return (
    <>
      <header className="workbench-header">
        <div className="workbench-brand-zone">
          <button type="button" className="workbench-brand" onClick={onBack} aria-label="ASA Lab">
            {/* The project's own mark — the flask that is also the favicon — and its
                name beside it. What stood here was a four-cell grid of letters
                imitating another product's logo, in the one place where this
                editor should not resemble anything but itself. */}
            <img
              className="workbench-brand-mark"
              src="/asa-lab-mark.svg"
              alt=""
              aria-hidden="true"
            />
            <span className="workbench-brand-name">ASA Lab</span>
          </button>
          <input
            className="workbench-title-input"
            value={c.projectTitle}
            aria-label="Название проекта"
            maxLength={255}
            onChange={(event) => c.setProjectTitle(event.target.value)}
            onBlur={() => void c.renameProject()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') {
                c.setProjectTitle(c.project?.title ?? '');
                event.currentTarget.blur();
              }
            }}
          />
        </div>
        {/* Save failures remain recoverable in the local draft, so the header
            reports that user fact briefly instead of exposing a protocol/CAS
            explanation across the whole toolbar. */}
        <span
          className={`workbench-save-state ${c.saveStatus}${
            c.saveStatus === 'error' && !saveErrorVisible ? ' quiet' : ''
          }`}
          title={c.saveStatus === 'error' ? 'Последние изменения сохранены в браузере.' : undefined}
          role="status"
          aria-live="polite"
        >
          {c.saveStatus === 'saved' ? <CheckIcon /> : null}
          {c.saveCopy[c.saveStatus]}
        </span>
        {/* Named tabs rather than bare icons. Three unlabelled squares gave no way
            to tell the breadboard from the schematic without clicking one. */}
        <nav className="workbench-mode-buttons" aria-label="Представления проекта">
          {(
            [
              { id: 'breadboard', label: 'Цепи', icon: <CircuitIcon /> },
              { id: 'schematic', label: 'Схемы', icon: <SchematicIcon /> },
              { id: 'bom', label: 'Компоненты', icon: <ListIcon /> },
            ] as const
          ).map((tab) => (
            <button
              key={tab.id}
              className={view === tab.id ? 'active' : ''}
              type="button"
              title={tab.label}
              aria-label={tab.label}
              aria-pressed={view === tab.id}
              onClick={() => onViewChange(tab.id)}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
          <EditorAvatar className="workbench-avatar" avatar={avatar} />
        </nav>
      </header>
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
              label="Повернуть на 45° (R)"
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
                  label="Повернуть на 45° (R)"
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
            className={`workbench-pill code${codeOpen ? ' active' : ''}`}
            title={codeOpen ? 'Закрыть редактор кода' : 'Открыть редактор кода'}
            aria-label={codeOpen ? 'Закрыть редактор кода' : 'Открыть редактор кода'}
            aria-pressed={codeOpen}
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
