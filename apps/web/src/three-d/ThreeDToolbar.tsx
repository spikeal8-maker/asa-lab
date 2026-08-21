import { useState, type ReactNode } from 'react';
import {
  ArrowLeftIcon,
  CircuitIcon,
  DeleteIcon,
  DuplicateIcon,
  MirrorIcon,
  PasteIcon,
  RedoIcon,
  UndoIcon,
  ViewIcon,
} from '../electronics/workbench-icons';
import { AlignIcon, GridIcon, GroupIcon, RulerIcon, UngroupIcon } from './three-d-icons';

interface ToolbarButtonProps {
  readonly command: string;
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly className?: string;
  readonly onClick: () => void;
  readonly children: ReactNode;
}

function ToolbarButton({
  command,
  label,
  active = false,
  disabled = false,
  className = '',
  onClick,
  children,
}: ToolbarButtonProps): JSX.Element {
  return (
    <button
      type="button"
      className={`asa3d-tool${active ? ' active' : ''}${className ? ` ${className}` : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      data-command={command}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export interface ThreeDToolbarProps {
  readonly selectedCount: number;
  readonly editableSelectedCount: number;
  readonly hasClipboard: boolean;
  readonly hasHiddenNodes: boolean;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly canBundle: boolean;
  readonly canUngroup: boolean;
  readonly canAlign: boolean;
  readonly canCruise: boolean;
  readonly alignmentActive: boolean;
  readonly mirrorActive: boolean;
  readonly cruiseActive: boolean;
  readonly rulerActive: boolean;
  readonly workplaneActive: boolean;
  readonly onCopy: () => void;
  readonly onPaste: () => void;
  readonly onDuplicate: () => void;
  readonly onDelete: () => void;
  readonly onUndo: () => void;
  readonly onRedo: () => void;
  readonly onHideSelected: () => void;
  readonly onShowAll: () => void;
  readonly onBundle: () => void;
  readonly onGroup: () => void;
  readonly onUngroup: () => void;
  readonly onToggleAlign: () => void;
  readonly onToggleMirror: () => void;
  readonly onMirror: (axis: 'x' | 'y' | 'z') => void;
  readonly onToggleCruise: () => void;
  readonly onToggleRuler: () => void;
  readonly onToggleWorkplane: () => void;
  readonly onDrop: () => void;
  readonly onImport: () => void;
  readonly onExportStl: () => void;
  readonly onExportJson: () => void;
  readonly sendControl: ReactNode;
}

export function ThreeDToolbar({
  selectedCount,
  editableSelectedCount,
  hasClipboard,
  hasHiddenNodes,
  canUndo,
  canRedo,
  canBundle,
  canUngroup,
  canAlign,
  canCruise,
  alignmentActive,
  mirrorActive,
  cruiseActive,
  rulerActive,
  workplaneActive,
  onCopy,
  onPaste,
  onDuplicate,
  onDelete,
  onUndo,
  onRedo,
  onHideSelected,
  onShowAll,
  onBundle,
  onGroup,
  onUngroup,
  onToggleAlign,
  onToggleMirror,
  onMirror,
  onToggleCruise,
  onToggleRuler,
  onToggleWorkplane,
  onDrop,
  onImport,
  onExportStl,
  onExportJson,
  sendControl,
}: ThreeDToolbarProps): JSX.Element {
  const [visibilityOpen, setVisibilityOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const hasSelection = selectedCount > 0;
  const hasEditableSelection = editableSelectedCount > 0;

  return (
    <div className="asa3d-toolbar" role="toolbar" aria-label="Инструменты редактора">
      <div className="asa3d-toolbar-group asa3d-toolbar-edit" aria-label="Правка">
        <ToolbarButton
          command="copy"
          label="Копировать (Ctrl+C)"
          onClick={onCopy}
          disabled={!hasSelection}
        >
          <DuplicateIcon />
        </ToolbarButton>
        <ToolbarButton
          command="paste"
          label="Вставить (Ctrl+V)"
          onClick={onPaste}
          disabled={!hasClipboard}
        >
          <PasteIcon />
        </ToolbarButton>
        <ToolbarButton
          command="duplicate"
          label="Дублировать и повторить (Ctrl+D)"
          onClick={onDuplicate}
          disabled={!hasSelection}
          className="asa3d-duplicate-tool"
        >
          <DuplicateIcon />
          <span aria-hidden="true">✦</span>
        </ToolbarButton>
        <ToolbarButton
          command="delete"
          label="Удалить (Delete)"
          onClick={onDelete}
          disabled={!hasEditableSelection}
        >
          <DeleteIcon />
        </ToolbarButton>
        <span className="asa3d-toolbar-divider" aria-hidden="true" />
        <ToolbarButton
          command="undo"
          label="Отменить (Ctrl+Z)"
          onClick={onUndo}
          disabled={!canUndo}
        >
          <UndoIcon />
        </ToolbarButton>
        <ToolbarButton
          command="redo"
          label="Повторить (Ctrl+Y)"
          onClick={onRedo}
          disabled={!canRedo}
        >
          <RedoIcon />
        </ToolbarButton>
      </div>

      <span className="asa3d-toolbar-spacer" aria-hidden="true" />

      <div className="asa3d-toolbar-group asa3d-toolbar-model" aria-label="Операции над формами">
        <div className="asa3d-split-tool asa3d-visibility-tool">
          <ToolbarButton
            command="visibility"
            label={hasSelection ? 'Скрыть выбранное (Ctrl+H)' : 'Показать все скрытые объекты'}
            onClick={hasSelection ? onHideSelected : onShowAll}
            disabled={!hasSelection && !hasHiddenNodes}
          >
            <ViewIcon />
          </ToolbarButton>
          <button
            type="button"
            className="asa3d-tool-chevron"
            aria-label="Меню видимости"
            aria-expanded={visibilityOpen}
            onClick={() => setVisibilityOpen((open) => !open)}
          >
            ▾
          </button>
          {visibilityOpen && (
            <div className="asa3d-toolbar-menu asa3d-visibility-menu">
              <button
                type="button"
                disabled={!hasSelection}
                onClick={() => {
                  onHideSelected();
                  setVisibilityOpen(false);
                }}
              >
                Скрыть выбранное <kbd>Ctrl+H</kbd>
              </button>
              <button
                type="button"
                disabled={!hasHiddenNodes}
                onClick={() => {
                  onShowAll();
                  setVisibilityOpen(false);
                }}
              >
                Показать всё <kbd>Ctrl+Shift+H</kbd>
              </button>
            </div>
          )}
        </div>
        <ToolbarButton
          command="bundle"
          label="Быстрая группа без слияния (Ctrl+B)"
          onClick={onBundle}
          disabled={!canBundle}
          className="asa3d-bundle-tool"
        >
          <DuplicateIcon />
        </ToolbarButton>
        <ToolbarButton
          command="group"
          label="Булево объединение (Ctrl+G); пересечение — Ctrl+I"
          onClick={onGroup}
          disabled={!canBundle}
        >
          <GroupIcon />
        </ToolbarButton>
        <ToolbarButton
          command="ungroup"
          label="Разгруппировать (Ctrl+Shift+G)"
          onClick={onUngroup}
          disabled={!canUngroup}
        >
          <UngroupIcon />
        </ToolbarButton>
        <ToolbarButton
          command="align"
          label="Выровнять (L)"
          active={alignmentActive}
          onClick={onToggleAlign}
          disabled={!canAlign}
        >
          <AlignIcon />
        </ToolbarButton>
        <div className="asa3d-mirror-tool">
          <ToolbarButton
            command="mirror"
            label="Отразить (M)"
            active={mirrorActive}
            onClick={onToggleMirror}
            disabled={!hasEditableSelection}
          >
            <MirrorIcon />
          </ToolbarButton>
          {mirrorActive && (
            <div className="asa3d-toolbar-menu asa3d-mirror-menu" aria-label="Ось отражения">
              {(['x', 'y', 'z'] as const).map((axis) => (
                <button
                  key={axis}
                  type="button"
                  onClick={() => {
                    onMirror(axis);
                    onToggleMirror();
                  }}
                >
                  Ось {axis.toUpperCase()}
                </button>
              ))}
            </div>
          )}
        </div>
        <ToolbarButton
          command="cruise"
          label="Cruise: поставить на поверхность (C)"
          active={cruiseActive}
          onClick={onToggleCruise}
          disabled={!canCruise}
        >
          <CircuitIcon />
        </ToolbarButton>
        <ToolbarButton
          command="ruler"
          label="Линейка (R)"
          active={rulerActive}
          onClick={onToggleRuler}
        >
          <RulerIcon />
        </ToolbarButton>
        <ToolbarButton
          command="workplane"
          label="Плоскость выбранной формы (E)"
          active={workplaneActive}
          onClick={onToggleWorkplane}
          disabled={!hasSelection && !workplaneActive}
        >
          <GridIcon />
        </ToolbarButton>
        <ToolbarButton
          command="drop"
          label="Опустить на рабочую плоскость (D)"
          onClick={onDrop}
          disabled={!hasEditableSelection}
          className="asa3d-drop-tool"
        >
          <ArrowLeftIcon />
        </ToolbarButton>
      </div>

      <div className="asa3d-actions" aria-label="Файлы и публикация">
        <button type="button" className="asa3d-text-action" onClick={onImport}>
          Импорт
        </button>
        <div className="asa3d-export-wrap">
          <button
            type="button"
            className="asa3d-text-action"
            onClick={() => setExportOpen((open) => !open)}
            aria-expanded={exportOpen}
          >
            Экспорт
          </button>
          {exportOpen && (
            <div className="asa3d-export-menu">
              <button
                type="button"
                onClick={() => {
                  onExportStl();
                  setExportOpen(false);
                }}
              >
                STL для 3D-печати
              </button>
              <button
                type="button"
                onClick={() => {
                  onExportJson();
                  setExportOpen(false);
                }}
              >
                ASA 3D JSON
              </button>
            </div>
          )}
        </div>
        {sendControl}
      </div>
    </div>
  );
}
