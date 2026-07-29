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

const PROJECT_TITLE_MAX_LENGTH = 160;

function AsaLabMark(): JSX.Element {
  return (
    <svg
      className="workbench-brand-mark"
      viewBox="0 0 44 44"
      role="img"
      aria-label="ASA Lab"
    >
      <path
        d="M14 6h16M19 6v8L9.5 33.2A3.2 3.2 0 0 0 12.4 38h19.2a3.2 3.2 0 0 0 2.9-4.8L25 14V6"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path d="M15 29h14l3.2 6.5H11.8L15 29Z" fill="#0aa4c8" opacity=".24" />
      <path d="M17 29 22 18l5 11" fill="none" stroke="#087fa4" strokeWidth="2.4" />
      <circle cx="15" cy="29" r="2.2" fill="#f2a51a" />
      <circle cx="22" cy="18" r="2.2" fill="#0aa4c8" />
      <circle cx="29" cy="29" r="2.2" fill="#188353" />
    </svg>
  );
}

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
      aria-pressed={active || undefined}
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
  const structureLocked = c.simulationRunning || c.busy;
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
            <AsaLabMark />
          </button>
          <input
            className="workbench-title-input"
            value={c.projectTitle}
            aria-label="Название проекта"
            minLength={1}
            maxLength={PROJECT_TITLE_MAX_LENGTH}
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
        <span className={`workbench-save-state ${c.saveStatus}`} role="status" aria-live="polite">
          {c.saveStatus === 'saved' ? <CheckIcon /> : null}
          {c.saveCopy[c.saveStatus]}
        </span>
        <div className="workbench-mode-buttons" aria-label="Представления проекта">
          <button className="active" type="button" title="Макет" aria-pressed="true">
            <CircuitIcon />
          </button>
          <button type="button" disabled title="Схематическое представление ещё не реализовано">
            <SchematicIcon />
          </button>
          <button type="button" disabled title="Список компонентов ещё не реализован">
            <ListIcon />
          </button>
          <span className="workbench-avatar" title={user.displayName} aria-label={user.displayName}>
            {initials(user.displayName)}
          </span>
        </div>
      </header>
      <div className="workbench-toolbar" role="toolbar" aria-label="Инструменты редактора">
        <div className="workbench-toolbar-group">
          <ToolButton
            label="Дублировать"
            onClick={c.duplicateSelected}
            disabled={structureLocked || c.selection?.kind !== 'component'}
          >
            <DuplicateIcon />
          </ToolButton>
          <ToolButton
            label="Удалить"
            onClick={c.removeSelection}
            disabled={structureLocked || !c.selection}
            danger
          >
            <DeleteIcon />
          </ToolButton>
          <ToolButton label="Отменить" onClick={c.undo} disabled={structureLocked || !c.canUndo}>
            <UndoIcon />
          </ToolButton>
          <ToolButton label="Повторить" onClick={c.redo} disabled={structureLocked || !c.canRedo}>
            <RedoIcon />
          </ToolButton>
          <ToolButton label="Комментарии появятся в учебном review-контексте" disabled>
            <CommentIcon />
          </ToolButton>
          <ToolButton label="Параметры выделения" active={Boolean(c.selection)}>
            <InspectIcon />
          </ToolButton>
          <span className="workbench-toolbar-divider" />
          <div
            className={`workbench-wire-color${structureLocked ? ' disabled' : ''}`}
            title={structureLocked ? 'Остановите моделирование' : 'Цвет провода'}
          >
            <span style={{ background: c.activeWireColor }} />
            <select
              value={c.activeWireColor}
              disabled={structureLocked}
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
            label="Изменить изгиб провода"
            onClick={c.toggleWireRoute}
            disabled={structureLocked || c.selection?.kind !== 'wire'}
          >
            <WireIcon />
          </ToolButton>
          <ToolButton
            label="Повернуть компонент (R)"
            onClick={c.rotateSelected}
            disabled={structureLocked || c.selection?.kind !== 'component'}
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
            title="Редактор кода появится вместе с проверенной моделью Arduino"
          >
            <CodeIcon /> Код
          </button>
          <button
            type="button"
            className={`workbench-pill simulate${c.simulationRunning ? ' running' : ''}`}
            onClick={() => void c.toggleSimulation()}
            disabled={c.busy}
            aria-pressed={c.simulationRunning}
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
