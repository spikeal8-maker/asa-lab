import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import type { PublicUser } from '../api';
import { downloadThreeDJson, downloadThreeDStl } from './exporters';
import { ShapeInspector } from './ShapeInspector';
import { ShapeLibrary } from './ShapeLibrary';
import { useThreeDProject } from './use-three-d-project';
import { ThreeViewport, type ThreeViewportHandle } from './viewport/ThreeViewport';
import type { TransformMode } from './viewport/SceneRuntime';
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

export function ThreeDEditor({ projectId, onBack, user }: ThreeDEditorProps): JSX.Element {
  const controller = useThreeDProject(projectId);
  const viewportRef = useRef<ThreeViewportHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [transformMode, setTransformMode] = useState<TransformMode>('translate');
  const [exportOpen, setExportOpen] = useState(false);

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
      } else if (modifier && event.key.toLowerCase() === 'd') {
        event.preventDefault();
        controller.duplicateSelected();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controller.removeSelected();
      } else if (event.key.toLowerCase() === 'm') {
        setTransformMode('translate');
      } else if (event.key.toLowerCase() === 'r') {
        setTransformMode('rotate');
      } else if (event.key.toLowerCase() === 's') {
        setTransformMode('scale');
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
  return (
    <main className="asa3d-shell">
      <header className="asa3d-topbar">
        <div className="asa3d-identity">
          <button type="button" className="asa3d-back" onClick={onBack} aria-label="К проектам">
            ‹
          </button>
          <div className="asa3d-mark" aria-hidden="true">
            <span>ASA</span>
            <strong>3D</strong>
          </div>
          <div className="asa3d-project-name">
            <strong>{controller.title}</strong>
            <small className={`save-${controller.saveState}`}>
              {SAVE_LABELS[controller.saveState]}
            </small>
          </div>
        </div>

        <nav className="asa3d-toolbar" aria-label="Редактирование">
          <button
            type="button"
            onClick={controller.undo}
            disabled={controller.history.past.length === 0}
            title="Отменить (Ctrl+Z)"
          >
            ↶
          </button>
          <button
            type="button"
            onClick={controller.redo}
            disabled={controller.history.future.length === 0}
            title="Повторить (Ctrl+Y)"
          >
            ↷
          </button>
          <span className="asa3d-toolbar-divider" />
          <button
            type="button"
            onClick={controller.duplicateSelected}
            disabled={!controller.selectedNode}
            title="Дублировать (Ctrl+D)"
          >
            ⧉
          </button>
          <button
            type="button"
            onClick={controller.removeSelected}
            disabled={!controller.selectedNode || controller.selectedNode.locked}
            title="Удалить (Delete)"
          >
            ⌫
          </button>
          <span className="asa3d-toolbar-divider" />
          {(
            [
              ['translate', '↔', 'Перемещение (M)'],
              ['rotate', '↻', 'Поворот (R)'],
              ['scale', '⤢', 'Масштаб (S)'],
            ] as const
          ).map(([mode, icon, label]) => (
            <button
              type="button"
              key={mode}
              className={transformMode === mode ? 'active' : ''}
              onClick={() => setTransformMode(mode)}
              title={label}
            >
              {icon}
            </button>
          ))}
        </nav>

        <div className="asa3d-actions">
          <input
            ref={importRef}
            type="file"
            accept=".json,.asa3d.json"
            hidden
            onChange={importJson}
          />
          <button type="button" onClick={() => importRef.current?.click()}>
            Импорт
          </button>
          <div className="asa3d-export-wrap">
            <button
              type="button"
              onClick={() => setExportOpen((open) => !open)}
              aria-expanded={exportOpen}
            >
              Экспорт⌄
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
          <span className="asa3d-user" title={user.displayName}>
            {user.displayName.slice(0, 1).toUpperCase()}
          </span>
        </div>
      </header>

      <section className="asa3d-workspace">
        <div className="asa3d-stage">
          <ThreeViewport
            ref={viewportRef}
            document={document}
            selectedId={controller.selectedId}
            transformMode={transformMode}
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
              <button type="button" onClick={() => viewportRef.current?.setView('right')}>
                СПРАВА
              </button>
            </div>
          </div>

          <nav className="asa3d-view-tools" aria-label="Управление камерой">
            <button
              type="button"
              onClick={() => viewportRef.current?.setView('home')}
              title="Домой"
            >
              ⌂
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(1)} title="Приблизить">
              +
            </button>
            <button type="button" onClick={() => viewportRef.current?.zoom(-1)} title="Отдалить">
              −
            </button>
          </nav>

          {controller.selectedNode && (
            <ShapeInspector
              node={controller.selectedNode}
              execute={controller.execute}
              onClose={() => controller.setSelectedId(null)}
            />
          )}
          <div className="asa3d-statusbar">
            <span>{document.nodes.length} объектов</span>
            <label>
              Шаг сетки
              <select
                value={document.grid.snap}
                onChange={(event) => {
                  const snap = Number(event.currentTarget.value);
                  controller.execute({
                    type: 'replace-grid',
                    value: { ...document.grid, snap },
                  });
                }}
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
        <ShapeLibrary onAdd={controller.addPrimitive} />
      </section>

      {controller.notice && (
        <button type="button" className="asa3d-toast" onClick={controller.clearNotice}>
          {controller.notice}
        </button>
      )}
    </main>
  );
}
