import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { selectionBounds, type PrimitiveKind, type ShapeOperation } from '@asa-lab/three-d';
import type { PublicUser } from '../api';
import { AsaLabMark } from '../brand/AsaLabBrand';
import { EditorAvatar, useEditorAvatar } from '../components/editor-chrome/EditorAvatar';
import { CheckIcon } from '../electronics/workbench-icons';
import { downloadThreeDJson, downloadThreeDStl } from './exporters';
import { ShapeInspector } from './ShapeInspector';
import { ShapeLibrary } from './ShapeLibrary';
import { SelectionTools } from './SelectionTools';
import { logicalSelectionCount } from './selection-model';
import { AlignIcon, CubeIcon, GroupIcon, HomeIcon } from './three-d-icons';
import { ThreeDToolbar } from './ThreeDToolbar';
import { useThreeDProject } from './use-three-d-project';
import { VersionHistory } from '../components/VersionHistory';
import { ThreeViewport, type ThreeViewportHandle } from './viewport/ThreeViewport';
import { ViewCube } from './viewport/ViewCube';
import type { CameraViewState } from './viewport/SceneRuntime';
import { registerProjectSnapshotSource, startProjectSnapshots } from '../modules/project-snapshot';
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

export function ThreeDEditor({ projectId, onBack, user }: ThreeDEditorProps): JSX.Element {
  const controller = useThreeDProject(projectId);
  const avatar = useEditorAvatar(user);
  const viewportRef = useRef<ThreeViewportHandle>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false);
  const [alignmentOpen, setAlignmentOpen] = useState(false);
  const [mirrorOpen, setMirrorOpen] = useState(false);
  const [cruiseActive, setCruiseActive] = useState(false);
  const [workplaneY, setWorkplaneY] = useState(0);
  const [cameraView, setCameraView] = useState<CameraViewState>({ yaw: 0, pitch: 45 });
  const [draggedPlacement, setDraggedPlacement] = useState<{
    readonly primitive: PrimitiveKind;
    readonly operation: ShapeOperation;
  } | null>(null);

  // The card picture for this project comes from the viewport itself. Project
  // Core owns the schedule and the encoding; the editor only says how to draw.
  useEffect(() => {
    const release = registerProjectSnapshotSource(
      projectId,
      () => viewportRef.current?.captureFrame() ?? null,
      // Never label a canvas containing unsaved edits with the previous
      // server revision. The snapshot becomes eligible after its draft save.
      () => (controller.saveState === 'saved' ? controller.serverRevision : null),
    );
    const stop = startProjectSnapshots(projectId);
    return () => {
      stop();
      release();
    };
  }, [controller.saveState, controller.serverRevision, projectId]);

  const ungroupCurrentSelection = useCallback((): void => {
    if (controller.selectedGroupId) controller.ungroupSelected();
    else controller.unbundleSelected();
  }, [controller]);

  const toggleShapeWorkplane = useCallback((): void => {
    if (Math.abs(workplaneY) > 0.000001) {
      setWorkplaneY(0);
      return;
    }
    const bounds = selectionBounds(controller.selectedNodes);
    if (bounds) setWorkplaneY(bounds.max.y);
  }, [controller.selectedNodes, workplaneY]);

  const shareProject = useCallback(async (): Promise<void> => {
    const shareData = { title: controller.title, url: window.location.href };
    if (typeof navigator.share === 'function') {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard.writeText(shareData.url);
  }, [controller.title]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (isTypingTarget(event.target)) return;
      const modifier = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (modifier && key === 'z') {
        event.preventDefault();
        if (event.shiftKey) controller.redo();
        else controller.undo();
      } else if (modifier && key === 'y') {
        event.preventDefault();
        controller.redo();
      } else if (modifier && key === 'x') {
        event.preventDefault();
        controller.cutSelected();
      } else if (modifier && key === 'c') {
        event.preventDefault();
        controller.copySelected();
      } else if (modifier && key === 'v') {
        event.preventDefault();
        controller.pasteCopied();
      } else if (modifier && key === 'd') {
        event.preventDefault();
        controller.duplicateSelected();
      } else if (modifier && key === 'a') {
        event.preventDefault();
        controller.selectAll();
      } else if (modifier && key === 'b') {
        event.preventDefault();
        controller.bundleSelected();
      } else if (modifier && key === 'g') {
        event.preventDefault();
        if (event.shiftKey) ungroupCurrentSelection();
        else controller.groupSelected('union');
      } else if (modifier && key === 'i') {
        event.preventDefault();
        controller.groupSelected('intersection');
      } else if (modifier && key === 'h') {
        event.preventDefault();
        if (event.shiftKey) controller.showAll();
        else controller.hideSelected();
      } else if (modifier && key === 'l') {
        event.preventDefault();
        controller.toggleSelectionLock();
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        controller.removeSelected();
      } else if (key === 'h') {
        event.preventDefault();
        controller.setSelectionOperation('hole');
      } else if (key === 's') {
        event.preventDefault();
        controller.setSelectionOperation('solid');
      } else if (key === 'l') {
        event.preventDefault();
        setAlignmentOpen((open) => !open);
      } else if (key === 'm') {
        event.preventDefault();
        setMirrorOpen((open) => !open);
      } else if (key === 'c') {
        event.preventDefault();
        setCruiseActive((active) => !active);
      } else if (key === 'r') {
        event.preventDefault();
        controller.toggleRuler(workplaneY);
      } else if (key === 'e') {
        event.preventDefault();
        toggleShapeWorkplane();
      } else if (key === 'd') {
        event.preventDefault();
        controller.dropSelectedToWorkplane(workplaneY);
      } else if (event.key === 'Escape') {
        if (alignmentOpen || mirrorOpen || cruiseActive) {
          setAlignmentOpen(false);
          setMirrorOpen(false);
          setCruiseActive(false);
        } else {
          controller.setSelectedId(null);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    alignmentOpen,
    controller,
    cruiseActive,
    mirrorOpen,
    toggleShapeWorkplane,
    ungroupCurrentSelection,
    workplaneY,
  ]);

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
  const editableSelectedCount = controller.selectedNodes.filter((node) => !node.locked).length;
  const selectedObjectCount = logicalSelectionCount(controller.selectedNodes);
  const canBundle =
    editableSelectedCount >= 2 &&
    !controller.selectedGroupId &&
    controller.selectedNodes.every((node) => !node.groupId);
  const canAlign = editableSelectedCount >= 2 && !controller.selectedGroupId;
  const canCruise =
    editableSelectedCount > 0 &&
    document.nodes.some((node) => node.visible && !controller.selectedIds.includes(node.id));
  const workplaneActive = Math.abs(workplaneY) > 0.000001;

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
        {controller.saveState === 'error' ? (
          <button
            type="button"
            className="asa3d-save-state asa3d-save-recovery save-error"
            title={controller.saveError ?? undefined}
            aria-label={`${controller.saveError ?? 'Не удалось сохранить.'} ${
              controller.requiresSignIn ? 'Войти снова' : 'Повторить сохранение'
            }`}
            onClick={controller.requiresSignIn ? controller.signInAgain : controller.retrySave}
          >
            <span>{controller.requiresSignIn ? 'Сессия завершена' : 'Сохранение прервано'}</span>
            <strong>{controller.requiresSignIn ? 'Войти снова' : 'Повторить'}</strong>
          </button>
        ) : (
          <span className={`asa3d-save-state save-${controller.saveState}`}>
            {controller.saveState === 'saved' && <CheckIcon />}
            {SAVE_LABELS[controller.saveState]}
          </span>
        )}
        <nav className="asa3d-mode-buttons" aria-label="Среда проекта">
          <button type="button" className="active" aria-current="page">
            <CubeIcon />
            <span>3D</span>
          </button>
          <EditorAvatar className="asa3d-user" avatar={avatar} />
        </nav>
      </header>

      <input ref={importRef} type="file" accept=".json,.asa3d.json" hidden onChange={importJson} />
      <ThreeDToolbar
        selectedCount={controller.selectedNodes.length}
        editableSelectedCount={editableSelectedCount}
        hasClipboard={controller.hasClipboard}
        hasHiddenNodes={controller.hasHiddenNodes}
        canUndo={controller.history.past.length > 0}
        canRedo={controller.history.future.length > 0}
        canBundle={canBundle}
        canUngroup={Boolean(controller.selectedGroupId || controller.selectedBundleId)}
        canAlign={canAlign}
        canCruise={canCruise}
        alignmentActive={alignmentOpen}
        mirrorActive={mirrorOpen}
        cruiseActive={cruiseActive}
        rulerActive={document.ruler.visible}
        workplaneActive={workplaneActive}
        onCopy={controller.copySelected}
        onPaste={controller.pasteCopied}
        onDuplicate={controller.duplicateSelected}
        onDelete={controller.removeSelected}
        onUndo={controller.undo}
        onRedo={controller.redo}
        onHideSelected={controller.hideSelected}
        onShowAll={controller.showAll}
        onBundle={controller.bundleSelected}
        onGroup={() => controller.groupSelected('union')}
        onUngroup={ungroupCurrentSelection}
        onToggleAlign={() => setAlignmentOpen((open) => !open)}
        onToggleMirror={() => setMirrorOpen((open) => !open)}
        onMirror={controller.mirrorSelected}
        onToggleCruise={() => setCruiseActive((active) => !active)}
        onToggleRuler={() => controller.toggleRuler(workplaneY)}
        onToggleWorkplane={toggleShapeWorkplane}
        onDrop={() => controller.dropSelectedToWorkplane(workplaneY)}
        onImport={() => importRef.current?.click()}
        onExportStl={() => downloadThreeDStl(document, controller.title)}
        onExportJson={() => downloadThreeDJson(document, controller.title)}
        sendControl={
          <VersionHistory
            projectId={projectId}
            versions={controller.versions}
            triggerLabel="Отправить"
            onShare={shareProject}
            onSaveVersion={() => controller.createCheckpoint()}
            onRestored={(restoredDocument, serverRevision) => {
              controller.acceptRestoredDocument(restoredDocument, serverRevision);
            }}
          />
        }
      />

      <section className="asa3d-workspace">
        <div className="asa3d-stage">
          <ThreeViewport
            ref={viewportRef}
            document={document}
            selectedIds={controller.selectedIds}
            workplaneY={workplaneY}
            onSelect={(nodeId, additive) => {
              if (cruiseActive && nodeId && controller.cruiseSelectedTo(nodeId)) {
                setCruiseActive(false);
                return;
              }
              controller.setSelectedId(nodeId, additive);
            }}
            onTransformCommit={controller.commitTransform}
            onTransformCommitMany={controller.commitTransforms}
            onDropPrimitive={controller.addPrimitive}
            activePlacement={draggedPlacement}
            onCameraChange={setCameraView}
          />

          <ViewCube
            orientation={cameraView}
            onOrbit={(deltaX, deltaY) => viewportRef.current?.orbitBy(deltaX, deltaY)}
            onSetView={(view) => viewportRef.current?.setView(view)}
            onSetDirection={(direction) => viewportRef.current?.setCameraDirection(direction)}
          />

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

          {(controller.selectedNode || controller.selectedGroupId) && (
            <ShapeInspector
              node={controller.selectedNode ?? undefined}
              group={
                controller.selectedGroupId
                  ? {
                      id: controller.selectedGroupId,
                      nodes: controller.selectedNodes,
                      operation: controller.selectedNodes[0]?.groupOperation ?? 'union',
                      onOperationChange: controller.setSelectedGroupOperation,
                    }
                  : undefined
              }
              execute={controller.execute}
            />
          )}

          {selectedObjectCount > 1 && !controller.selectedGroupId && (
            <section
              className="asa3d-multi-selection-panel"
              aria-label="Выбрано несколько объектов"
              data-testid="asa3d-multi-selection-panel"
              data-selection-count={selectedObjectCount}
            >
              <div>
                <strong>Выбрано: {objectCountLabel(selectedObjectCount)}</strong>
                <span>Перетаскивание двигает весь набор</span>
              </div>
              <div className="asa3d-multi-selection-actions">
                <button
                  type="button"
                  className="primary"
                  aria-label="Сгруппировать выбранные объекты"
                  onClick={() => controller.groupSelected('union')}
                  disabled={controller.selectedNodes.filter((node) => !node.locked).length < 2}
                >
                  <GroupIcon />
                  <span>Сгруппировать</span>
                </button>
                <button
                  type="button"
                  aria-label="Выровнять выбранные объекты"
                  aria-pressed={alignmentOpen}
                  onClick={() => setAlignmentOpen((open) => !open)}
                >
                  <AlignIcon />
                  <span>Выровнять</span>
                </button>
                <button
                  type="button"
                  className="close"
                  aria-label="Снять выделение"
                  onClick={() => controller.setSelectedId(null)}
                >
                  ×
                </button>
              </div>
            </section>
          )}

          {controller.selectedNodes.length > 0 && (alignmentOpen || document.ruler.visible) && (
            <SelectionTools
              nodes={controller.selectedNodes}
              ruler={document.ruler}
              onAlign={controller.alignSelected}
              onRulerOrigin={controller.setRulerOriginFromSelection}
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
          onAdd={(primitive, _position, additive, operation) =>
            controller.addPrimitive(primitive, { x: 0, y: workplaneY, z: 0 }, additive, operation)
          }
          onDragStateChange={setDraggedPlacement}
          gridVisible={document.grid.visible}
          onToggleGrid={() => replaceGrid({ visible: !document.grid.visible })}
          onOpenGridSettings={() => setGridSettingsOpen(true)}
          rulerVisible={document.ruler.visible}
          onToggleRuler={() => controller.toggleRuler(workplaneY)}
        />
      </section>

      {controller.notice && (
        <div className="asa3d-notice" role="status" aria-live="polite">
          <span>{controller.notice}</span>
          <button type="button" onClick={controller.clearNotice} aria-label="Закрыть уведомление">
            ×
          </button>
        </div>
      )}
    </main>
  );
}
