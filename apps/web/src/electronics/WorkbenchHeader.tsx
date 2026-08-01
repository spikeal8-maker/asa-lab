import type { PublicUser } from '../api';
import {
  CheckIcon,
  ChevronIcon,
  CircuitIcon,
  CodeIcon,
  CommentIcon,
  DeleteIcon,
  DuplicateIcon,
  FitIcon,
  ListIcon,
  MirrorIcon,
  PasteIcon,
  PlayIcon,
  RedoIcon,
  RotateIcon,
  SchematicIcon,
  ShareIcon,
  StopIcon,
  UndoIcon,
  ViewIcon,
  WireIcon,
} from './workbench-icons';
import { WIRE_COLORS, initials, type ToolButtonProps, type WorkbenchView } from './workbench-model';
import type { ElectronicsWorkbenchController } from './use-electronics-workbench';

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

export function WorkbenchHeader({
  controller: c,
  onBack,
  user,
  view,
  onViewChange,
  showGrid,
  onToggleGrid,
  notesOpen,
  onToggleNotes,
  codeOpen,
  onToggleCode,
  onOpenShare,
}: {
  controller: ElectronicsWorkbenchController;
  onBack: () => void;
  user: PublicUser;
  view: WorkbenchView;
  onViewChange: (view: WorkbenchView) => void;
  showGrid: boolean;
  onToggleGrid: () => void;
  notesOpen: boolean;
  onToggleNotes: () => void;
  codeOpen: boolean;
  onToggleCode: () => void;
  onOpenShare: () => void;
}): JSX.Element {
  const hasComponentSelection = c.selection?.kind === 'component';
  return (
    <>
      <header className="workbench-header">
        <div className="workbench-brand-zone">
          <button type="button" className="workbench-brand" onClick={onBack} aria-label="ASA Lab">
            <span className="workbench-brand-grid" aria-hidden="true">
              <span>A</span>
              <span>S</span>
              <span>A</span>
              <span>LAB</span>
            </span>
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
        <span className={`workbench-save-state ${c.saveStatus}`}>
          {c.saveStatus === 'saved' ? <CheckIcon /> : null}
          {c.saveCopy[c.saveStatus]}
        </span>
        <nav className="workbench-mode-buttons" aria-label="Представления проекта">
          <button
            className={view === 'breadboard' ? 'active' : ''}
            type="button"
            title="Макет"
            aria-label="Макет"
            aria-pressed={view === 'breadboard'}
            onClick={() => onViewChange('breadboard')}
          >
            <CircuitIcon />
          </button>
          <button
            className={view === 'schematic' ? 'active' : ''}
            type="button"
            title="Схема"
            aria-label="Схема"
            aria-pressed={view === 'schematic'}
            onClick={() => onViewChange('schematic')}
          >
            <SchematicIcon />
          </button>
          <button
            className={view === 'bom' ? 'active' : ''}
            type="button"
            title="Список компонентов"
            aria-label="Список компонентов"
            aria-pressed={view === 'bom'}
            onClick={() => onViewChange('bom')}
          >
            <ListIcon />
          </button>
          <span className="workbench-avatar" title={user.displayName}>
            {initials(user.displayName)}
          </span>
        </nav>
      </header>
      <div className="workbench-toolbar" role="toolbar" aria-label="Инструменты редактора">
        <div className="workbench-toolbar-group">
          <ToolButton
            label="Копировать (Ctrl+C)"
            onClick={c.copySelected}
            disabled={!hasComponentSelection}
          >
            <DuplicateIcon />
          </ToolButton>
          <ToolButton label="Вставить (Ctrl+V)" onClick={c.pasteCopied} disabled={!c.hasClipboard}>
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
          <ToolButton label="Сетка рабочего поля" active={showGrid} onClick={onToggleGrid}>
            <ViewIcon />
          </ToolButton>
          <span className="workbench-toolbar-divider" />
          <div className="workbench-wire-color" title="Цвет провода">
            <span style={{ background: c.activeWireColor }} />
            <select
              value={c.activeWireColor}
              onChange={(event) => c.setWireColor(event.target.value)}
              aria-label="Цвет провода"
            >
              {WIRE_COLORS.map((color) => (
                <option key={color} value={color}>
                  {color}
                </option>
              ))}
            </select>
            <ChevronIcon />
          </div>
          <ToolButton
            label="Добавить или изменить изгиб провода"
            onClick={c.toggleWireRoute}
            disabled={c.selection?.kind !== 'wire'}
          >
            <WireIcon />
          </ToolButton>
          <span className="workbench-toolbar-divider" />
          <ToolButton
            label="Отразить по горизонтали"
            onClick={() => c.mirrorSelected('horizontal')}
            disabled={!hasComponentSelection}
          >
            <MirrorIcon />
          </ToolButton>
          <ToolButton
            label="Отразить по вертикали"
            onClick={() => c.mirrorSelected('vertical')}
            disabled={!hasComponentSelection}
          >
            <MirrorIcon className="workbench-icon-vertical" />
          </ToolButton>
          <ToolButton
            label="Повернуть (R)"
            onClick={c.rotateSelected}
            disabled={!hasComponentSelection}
          >
            <RotateIcon />
          </ToolButton>
          <ToolButton label="Подогнать под экран" onClick={c.fitScene}>
            <FitIcon />
          </ToolButton>
        </div>
        <div className="workbench-toolbar-spacer" />
        <div className="workbench-toolbar-group right">
          <button
            type="button"
            className={`workbench-pill${codeOpen ? ' active' : ''}`}
            title="Код"
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
          >
            {c.simulationRunning ? <StopIcon /> : <PlayIcon />}
            {c.simulationRunning ? 'Остановить моделирование' : 'Начать моделирование'}
          </button>
          <button type="button" className="workbench-pill" onClick={onOpenShare}>
            <ShareIcon /> Отправить
          </button>
        </div>
      </div>
    </>
  );
}
