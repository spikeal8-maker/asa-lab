import { type ReactNode } from 'react';
import {
  DeleteIcon,
  DuplicateIcon,
  ListIcon,
  MirrorIcon,
  PasteIcon,
  RedoIcon,
  RotateIcon,
  UndoIcon,
  WireIcon,
  ViewIcon,
} from '../electronics/workbench-icons';
import { WIRE_COLORS } from '../electronics/workbench-model';
import type { ElectronicsWorkbenchController } from '../electronics/use-electronics-workbench';

function Action({
  label,
  title = label,
  disabled = false,
  pressed,
  onClick,
  children,
}: {
  label: string;
  title?: string;
  disabled?: boolean;
  pressed?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className="robotics-electronics-tool"
      aria-label={label}
      title={title}
      disabled={disabled}
      {...(pressed === undefined ? {} : { 'aria-pressed': pressed })}
      onClick={onClick}
    >
      {children}
      <span className="robotics-electronics-tool-label">{label}</span>
    </button>
  );
}

/** A compact presentation of the existing Electronics controller actions.
 * No new editor, solver, clipboard, undo stack or persistence owner is created. */
export function RoboticsElectronicsToolbar({
  controller: c,
  running,
}: {
  controller: ElectronicsWorkbenchController;
  running: boolean;
}): JSX.Element {
  const editingLocked = running || c.busy;
  const component = c.selection?.kind === 'component';
  const copyable = component || c.selection?.kind === 'annotation';

  return (
    <div className="robotics-electronics-tools" role="toolbar" aria-label="Инструменты электроники">
      <div className="robotics-electronics-tools-group">
        <Action
          label="Компоненты"
          title="Показать или скрыть каталог деталей"
          disabled={editingLocked}
          pressed={c.libraryOpen}
          onClick={() => c.setLibraryOpen((open) => !open)}
        >
          <ListIcon />
        </Action>
        <Action label="Вписать" title="Показать всю схему" onClick={c.fitScene}>
          <ViewIcon />
        </Action>
      </div>
      <div className="robotics-electronics-tools-group">
        <Action label="Копировать" disabled={editingLocked || !copyable} onClick={c.copySelected}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.9"
            aria-hidden="true"
          >
            <rect x="8" y="8" width="12" height="12" rx="2" />
            <path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3" />
          </svg>
        </Action>
        <Action
          label="Вставить"
          disabled={editingLocked || !c.hasClipboard}
          onClick={c.pasteCopied}
        >
          <PasteIcon />
        </Action>
        <Action
          label="Дублировать"
          disabled={editingLocked || !copyable}
          onClick={c.duplicateSelected}
        >
          <DuplicateIcon />
        </Action>
        <Action
          label="Повернуть"
          title="Повернуть на 45° (R)"
          disabled={editingLocked || !component}
          onClick={c.rotateSelected}
        >
          <RotateIcon />
        </Action>
        <Action
          label="Отразить"
          title="Отразить горизонтально"
          disabled={editingLocked || !component}
          onClick={() => c.mirrorSelected('horizontal')}
        >
          <MirrorIcon />
        </Action>
        <Action
          label="Удалить"
          disabled={editingLocked || !c.selection}
          onClick={c.removeSelection}
        >
          <DeleteIcon />
        </Action>
      </div>
      <div className="robotics-electronics-tools-group">
        <Action
          label="Отменить"
          title="Шаг назад — отменить изменение схемы"
          disabled={editingLocked || !c.canUndo}
          onClick={() => c.undo()}
        >
          <UndoIcon />
        </Action>
        <Action
          label="Повторить"
          title="Шаг вперёд — вернуть изменение схемы"
          disabled={editingLocked || !c.canRedo}
          onClick={() => c.redo()}
        >
          <RedoIcon />
        </Action>
      </div>
      <div className="robotics-electronics-tools-group">
        <Action
          label="Провод 90°"
          title="Переключить автоматическую прокладку проводов под 90°"
          disabled={editingLocked}
          pressed={c.orthogonalWireMode}
          onClick={c.toggleWireRoute}
        >
          <WireIcon />
        </Action>
        <div className="robotics-electronics-wire-colors" role="group" aria-label="Цвет провода">
          {WIRE_COLORS.map((color) => (
            <button
              key={color}
              type="button"
              className="robotics-electronics-wire-swatch"
              aria-label={'Цвет провода: ' + color}
              aria-pressed={c.activeWireColor === color}
              disabled={editingLocked}
              title={color}
              style={{ backgroundColor: color }}
              onClick={() => c.setWireColor(color)}
            />
          ))}
        </div>
        <Action
          label="Добавить текст"
          title="Добавить подпись на схему"
          disabled={editingLocked}
          onClick={c.addCanvasText}
        >
          <span aria-hidden="true" className="robotics-electronics-text-icon">
            T
          </span>
        </Action>
      </div>
    </div>
  );
}
