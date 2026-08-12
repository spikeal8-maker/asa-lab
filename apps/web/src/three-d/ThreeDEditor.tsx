import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import type { PublicUser } from '../api';
import { AsaLabMark } from '../brand/AsaLabBrand';
import {
  CheckIcon,
  DeleteIcon,
  DuplicateIcon,
  PasteIcon,
  RedoIcon,
  UndoIcon,
} from '../electronics/workbench-icons';
import { downloadThreeDJson, downloadThreeDStl } from './exporters';
import { ShapeInspector } from './ShapeInspector';
import { ShapeLibrary } from './ShapeLibrary';
import { CubeIcon, HomeIcon } from './three-d-icons';
import { useThreeDProject } from './use-three-d-project';
import { ThreeViewport, type ThreeViewportHandle } from './viewport/ThreeViewport';
import './three-d.css';

interface ThreeDEditorProps {
  readonly projectId: string;
  readonly onBack: () => void;
  readonly user: PublicUser;
}

const SAVE_LABELS = {
  saved: 'Все изменения сохранены',
  dirty: 'Есть несохранённые изменения',
  saving: 'Сохраняем…',
  error: 'Ошибка сохранения',
} as const;

function isTypingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

function objectCountLabel(count: number): string {
  const lastTwo = count % 100;
  const last = count % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return `${count} объектов`;
  if (last === 1) return `${count} объект`;
  if (last >= 2 && last <= 4) return `${count} объекта`;
  return `${count} объектов`;
}

function ToolbarButton({
  label,
  active = false,
  disabled = false,
  onClick,
  children,
}: {
  readonly label: string;
  readonly active?: boolean;
  readonly disabled?: boolean;
  readonly onClick: () => void;
  readonly children: ReactNode;
}): JSX.Element {
  return (
    <button
      type="button"
      className={`asa3d-tool${active ? ' active' : ''}`}
      title={label}
      aria-label={label}
      aria-pressed={active || undefined}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

export function ThreeDEditor({ projectId, onBack, user }: ThreeDEditorProps): JSX.Element {
  const controller = useThreeDProject(projectId);
  const viewportRef = useRef<ThreeViewportHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) controller.redo();
        else controller.undo();
      } else if (modifier && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        controller.redo();
      } else if (modifier && event.key.toLowerCase() === 'c') {
        event.preventDefault();
        controller.copySelected();
      } else if (modifier && event.key.toLowerCase() === 'v') {
        event.preventDefault();
        controller.pasteCopied();
      } else if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        controller.duplicateSelected();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controller.removeSelected();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [controller]);

  const importJson = (event: ChangeEvent<HTMLInputElement>): void => {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (!file) return;
    void file
      .text()
      .then((text) => controller.importDocument(JSON.parse(text)))
      .catch(() => controller.importDocument(null));
  };

  if (controller.loading) {
    return (
      <main className="asa3d-loading" role="status">
        <span className="asa3d-loader" />
        <strong>ASA 3D готовит рабочую плоскость…</strong>
      </main>
    );
  }
  if (controller.error || !controller.document || !controller.history) {
    return (
      <main className="page-center">
        <section className="login-card" role="alert">
          <h1>3D-проект не открыт</h1>
          <p>{controller.error ?? 'Документ проекта недоступен.'}</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }

  const document = controller.document;
  const replaceGrid = (value: Partial<typeof document.grid>): void => {
    controller.execute({ type: 'replace-grid', value: { ...document.grid, ...value } });
  };
  const updateGridDimension = (dimension: 'width' | 'depth', rawValue: string): void => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    replaceGrid({ [dimension]: Math.min(500, Math.max(20, value)) });
  };

  return (
    <main className="asa3d-shell">
      <header className="asa3d-header">
        <div className="asa3d-brand-zone">
          <button type="button" className="asa3d-brand" onClick={onBack} aria-label="ASA Lab">
            <AsaLabMark className="asa3d-brand-mark" />
            <span>ASA Lab</span>
          </button>
          <input
            className="asa3d-title-input"
            value={controller.title}
            aria-label="Название проекта"
            maxLength={255}
            onChange={(event) => controller.setTitle(event.currentTarget.value)}
            onBlur={() => void controller.renameProject()}
            onKeyDown={(event) => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') event.currentTarget.blur();
            }}
          />
        </div>
        <span className={`asa3d-save-state save-${controller.saveState}`}>
          {controller.saveState === 'saved' && <CheckIcon />}
          {SAVE_LABELS[controller.saveState]}
        </span>
        <nav className="asa3d-mode-buttons" aria-label="Среда проекта">
          <button type="button" className="active" aria-current="page">
            <CubeIcon />
            <span>3D</span>
          </button>
          <span className="asa3d-user" title={user.displayName}>
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
        </nav>
      </header>

      <div className="asa3d-toolbar" role="toolbar" aria-label="Инструменты редактора">
        <div className="asa3d-toolbar-group">
          <ToolbarButton
            label="Копировать (Ctrl+C)"
            onClick={controller.copySelected}
            disabled={!controller.selectedNode}
          >
            <DuplicateIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Вставить (Ctrl+V)"
            onClick={controller.pasteCopied}
            disabled={!controller.hasClipboard}
          >
            <PasteIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Удалить (Delete)"
            onClick={controller.removeSelected}
            disabled={!controller.selectedNode || controller.selectedNode.locked}
          >
            <DeleteIcon />
          </ToolbarButton>
          <span className="asa3d-toolbar-divider" />
          <ToolbarButton
            label="Отменить (Ctrl+Z)"
            onClick={controller.undo}
            disabled={controller.history.past.length === 0}
          >
            <UndoIcon />
          </ToolbarButton>
          <ToolbarButton
            label="Повторить (Ctrl+Y)"
            onClick={controller.redo}
            disabled={controller.history.future.length === 0}
          >
            <RedoIcon />
          </ToolbarButton>
        </div>

        <div className="asa3d-actions">
          <input
            ref={importRef}
            type="file"
            accept=".json,.asa3d.json"
            hidden
            onChange={importJson}
          />
          <button
            type="button"
            className="asa3d-text-action"
            onClick={() => importRef.current?.click()}
          >
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
                    downloadThreeDStl(document, controller.title);
                    setExportOpen(false);
                  }}
                >
                  STL для 3D-печати
                </button>
                <button
                  type="button"
                  onClick={() => {
                    downloadThreeDJson(document, controller.title);
                    setExportOpen(false);
                  }}
                >
                  ASA 3D JSON
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            className="asa3d-version-button"
            onClick={() => void controller.createCheckpoint()}
          >
            Версия{controller.versions.length > 0 ? ` · ${controller.versions.length}` : ''}
          </button>
        </div>
      </div>

      <section className="asa3d-workspace">
        <div className="asa3d-stage">
          <ThreeViewport
            ref={viewportRef}
            document={document}
            selectedId={controller.selectedId}
            onSelect={controller.setSelectedId}
            onTransformCommit={controller.commitTransform}
            onDropPrimitive={controller.addPrimitive}
          />

          <div className="asa3d-view-cube" aria-label="Стандартные виды">
            <button
              type="button"
              className="top"
              onClick={() => viewportRef.current?.setView('top')}
            >
              СВЕРХУ
            </button>
            <div>
              <button type="button" onClick={() => viewportRef.current?.setView('front')}>
                СПЕРЕДИ
              </button>
              <button
                type="button"
                aria-label="Справа"
                title="Справа"
                onClick={() => viewportRef.current?.setView('right')}
              >
                <span aria-hidden="true">›</span>
              </button>
            </div>
          </div>

          <nav className="asa3d-view-tools" aria-label="Управление камерой">
            <button
              type="button"
              onClick={() => viewportRef.current?.setView('home')}
              title="Домой"
            >
              <HomeIcon />
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(1)} title="Приблизить">
              +
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(-1)} title="Отдалить">
              −
            </button>
            <button type="button" onClick={() => viewportRef.current?.fit()} title="Показать всё">
              <CubeIcon />
            </button>
          </nav>

          {controller.selectedNode && (
            <ShapeInspector
              node={controller.selectedNode}
              execute={controller.execute}
              onClose={() => controller.setSelectedId(null)}
            />
          )}

          {gridSettingsOpen && (
            <section className="asa3d-grid-panel" aria-label="Параметры рабочей плоскости">
              <header>
                <strong>Параметры сетки</strong>
                <button
                  type="button"
                  aria-label="Закрыть параметры"
                  onClick={() => setGridSettingsOpen(false)}
                >
                  ×
                </button>
              </header>
              <label className="asa3d-grid-unit">
                <span>Единицы</span>
                <output>Миллиметры (мм)</output>
              </label>
              <div className="asa3d-grid-size-fields">
                <label>
                  <span>Ширина, мм</span>
                  <input
                    type="number"
                    min="20"
                    max="500"
                    step="10"
                    value={document.grid.width}
                    onChange={(event) => updateGridDimension('width', event.currentTarget.value)}
                  />
                </label>
                <label>
                  <span>Глубина, мм</span>
                  <input
                    type="number"
                    min="20"
                    max="500"
                    step="10"
                    value={document.grid.depth}
                    onChange={(event) => updateGridDimension('depth', event.currentTarget.value)}
                  />
                </label>
              </div>
              <label className="asa3d-grid-visible">
                <input
                  type="checkbox"
                  checked={document.grid.visible}
                  onChange={(event) => replaceGrid({ visible: event.currentTarget.checked })}
                />
                Показывать рабочую плоскость
              </label>
              <small>Точная привязка действует при перемещении и добавлении форм.</small>
            </section>
          )}

          <span className="asa3d-object-count">{objectCountLabel(document.nodes.length)}</span>
          <div className="asa3d-grid-controls">
            <button
              type="button"
              className="asa3d-grid-parameters"
              aria-expanded={gridSettingsOpen}
              onClick={() => setGridSettingsOpen((open) => !open)}
            >
              Параметры
            </button>
            <label>
              <span>Сетка шаговой привязки</span>
              <select
                aria-label="Сетка шаговой привязки"
                value={document.grid.snap}
                onChange={(event) => replaceGrid({ snap: Number(event.currentTarget.value) })}
              >
                <option value="0.1">0,1 мм</option>
                <option value="0.25">0,25 мм</option>
                <option value="0.5">0,5 мм</option>
                <option value="1">1,0 мм</option>
                <option value="5">5,0 мм</option>
              </select>
            </label>
          </div>
        </div>
        <ShapeLibrary
          onAdd={controller.addPrimitive}
          gridVisible={document.grid.visible}
          onToggleGrid={() => replaceGrid({ visible: !document.grid.visible })}
          onOpenGridSettings={() => setGridSettingsOpen(true)}
        />
      </section>

      {controller.notice && (
        <button type="button" className="asa3d-toast" onClick={controller.clearNotice}>
          {controller.notice}
        </button>
      )}
    </main>
  );
}
