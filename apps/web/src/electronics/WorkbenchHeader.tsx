import type { PublicUser } from '../api';
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronIcon,
  CircuitIcon,
  CodeIcon,
  CommentIcon,
  DeleteIcon,
  DuplicateIcon,
  FitIcon,
  InspectIcon,
  ListIcon,
  PlayIcon,
  RedoIcon,
  RotateIcon,
  SaveIcon,
  SchematicIcon,
  ShareIcon,
  StopIcon,
  UndoIcon,
  WireIcon,
} from './workbench-icons';
import { WIRE_COLORS, initials, type ToolButtonProps } from './workbench-model';
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
}: {
  controller: ElectronicsWorkbenchController;
  onBack: () => void;
  user: PublicUser;
}): JSX.Element {
  return (
    <>
      <header className="workbench-header">
        <div className="workbench-brand-zone">
          <button
            type="button"
            className="workbench-back"
            onClick={onBack}
            aria-label="Вернуться к проектам"
            title="Вернуться к проектам"
          >
            <ArrowLeftIcon />
          </button>
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
            onChange={(e) => c.setProjectTitle(e.target.value)}
            onBlur={() => void c.renameProject()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                c.setProjectTitle(c.project?.title ?? '');
                e.currentTarget.blur();
              }
            }}
          />
        </div>
        <span className={`workbench-save-state ${c.saveStatus}`}>
          {c.saveStatus === 'saved' ? <CheckIcon /> : null}
          {c.saveCopy[c.saveStatus]}
        </span>
        <div className="workbench-mode-buttons" aria-label="Представления проекта">
          <button className="active" type="button" title="Макет">
            <CircuitIcon />
          </button>
          <button type="button" disabled title="Схема появится позже">
            <SchematicIcon />
          </button>
          <button type="button" disabled title="Список компонентов появится позже">
            <ListIcon />
          </button>
          <span className="workbench-avatar" title={user.displayName}>
            {initials(user.displayName)}
          </span>
        </div>
      </header>
      <div className="workbench-toolbar" role="toolbar" aria-label="Инструменты редактора">
        <div className="workbench-toolbar-group">
          <ToolButton
            label="Дублировать"
            onClick={c.duplicateSelected}
            disabled={c.selection?.kind !== 'component'}
          >
            <DuplicateIcon />
          </ToolButton>
          <ToolButton label="Удалить" onClick={c.removeSelection} disabled={!c.selection} danger>
            <DeleteIcon />
          </ToolButton>
          <ToolButton label="Отменить" onClick={c.undo} disabled={!c.canUndo}>
            <UndoIcon />
          </ToolButton>
          <ToolButton label="Повторить" onClick={c.redo} disabled={!c.canRedo}>
            <RedoIcon />
          </ToolButton>
          <ToolButton label="Комментарии — следующий этап" disabled>
            <CommentIcon />
          </ToolButton>
          <ToolButton label="Параметры выделения" active={Boolean(c.selection)}>
            <InspectIcon />
          </ToolButton>
          <span className="workbench-toolbar-divider" />
          <div className="workbench-wire-color" title="Цвет провода">
            <span style={{ background: c.activeWireColor }} />
            <select
              value={c.activeWireColor}
              onChange={(e) => c.setWireColor(e.target.value)}
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
            label="Изменить изгиб провода"
            onClick={c.toggleWireRoute}
            disabled={c.selection?.kind !== 'wire'}
          >
            <WireIcon />
          </ToolButton>
          <ToolButton
            label="Повернуть компонент (R)"
            onClick={c.rotateSelected}
            disabled={c.selection?.kind !== 'component'}
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
            className="workbench-pill"
            disabled
            title="Редактор кода появится с Arduino"
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
          <button
            type="button"
            className="workbench-pill"
            onClick={() => void c.checkpoint()}
            disabled={c.busy}
          >
            <ShareIcon /> Создать версию
          </button>
          <ToolButton label="Сохранить сейчас" onClick={() => void c.saveNow()} disabled={c.busy}>
            <SaveIcon />
          </ToolButton>
        </div>
      </div>
    </>
  );
}
