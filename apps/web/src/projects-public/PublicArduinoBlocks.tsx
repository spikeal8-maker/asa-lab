import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import * as ScratchBlocks from 'scratch-blocks';
import { registerArduinoBlockDefinitions } from '../electronics/arduino-block-definitions';
import { migrateLegacyArduinoWorkspaceState } from '../electronics/arduino-block-schema';
import { ARDUINO_SCRATCH_THEME } from '../electronics/arduino-block-appearance';
import { classroomArduinoBlocks, publicArduinoBlocks } from '@asa-lab/contracts';
import scratchZoomOutUrl from '../../node_modules/scratch-blocks/media/zoom-out.svg?url';
import scratchZoomResetUrl from '../../node_modules/scratch-blocks/media/zoom-reset.svg?url';
import scratchZoomInUrl from '../../node_modules/scratch-blocks/media/zoom-in.svg?url';

/** The editor's block renderer, with no editor controls, writes or code generation. */
export function PublicArduinoBlocks({
  value,
  scope,
  controlsHost,
}: {
  readonly value: string;
  readonly scope: 'publication' | 'classroom';
  readonly controlsHost: HTMLElement | null;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const controls = useRef<{ workspace: ScratchBlocks.WorkspaceSvg; reset: () => void } | null>(
    null,
  );
  const [state, setState] = useState<'ready' | 'empty' | 'unavailable'>('ready');
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setState('ready');
    let workspace: ScratchBlocks.WorkspaceSvg | null = null;
    let observer: ResizeObserver | null = null;
    try {
      const safe =
        scope === 'classroom' ? classroomArduinoBlocks(value) : publicArduinoBlocks(value);
      if (!safe) throw Error();
      const saved = JSON.parse(safe);
      if (saved.blocks.blocks.length === 0) {
        setState('empty');
        return;
      }
      registerArduinoBlockDefinitions();
      workspace = ScratchBlocks.inject(element, {
        readOnly: true,
        sounds: false,
        trashcan: false,
        media: new URL('.', new URL(scratchZoomInUrl, document.baseURI)).href,
        theme: ARDUINO_SCRATCH_THEME,
        scratchTheme: ScratchBlocks.ScratchBlocksTheme.CLASSIC,
        scrollbars: true,
        move: { scrollbars: true, drag: true, wheel: true },
        zoom: { controls: false, wheel: true, startScale: 0.8, minScale: 0.3, maxScale: 1.5 },
      });
      const group = ScratchBlocks.Events.getGroup();
      const recordUndo = ScratchBlocks.Events.getRecordUndo();
      try {
        ScratchBlocks.serialization.workspaces.load(
          migrateLegacyArduinoWorkspaceState(saved),
          workspace,
        );
      } catch (error) {
        // A failed Blockly load must not affect a different viewer or editor on the page.
        ScratchBlocks.Events.setGroup(group);
        ScratchBlocks.Events.setRecordUndo(recordUndo);
        ScratchBlocks.utils.dom.stopTextWidthCache();
        workspace.setResizesEnabled(true);
        throw error;
      }
      workspace.getAllBlocks(false).forEach((b) => {
        b.setEditable(false);
        b.setMovable(false);
        b.setDeletable(false);
      });
      const current = workspace;
      let rendered = false;
      let positioned = false;
      const showProgramStart = () => {
        const roots = current.getTopBlocks(true);
        const start =
          roots.find((block) => block.type === 'asa_setup') ??
          roots.find((block) => block.type === 'asa_loop') ??
          roots[0];
        if (!start || element.clientWidth === 0 || element.clientHeight === 0) return;
        const scale = current.options.zoomOptions.startScale;
        current.setScale(scale);
        const bounds = current.getBlocksBoundingBox();
        if (
          (bounds.right - bounds.left) * scale <= element.clientWidth - 48 &&
          (bounds.bottom - bounds.top) * scale <= element.clientHeight - 48
        ) {
          current.scrollCenter();
        } else {
          const { x, y } = start.getRelativeToSurfaceXY();
          current.scroll(20 - x * scale, 28 - y * scale);
        }
        positioned = true;
      };
      const resize = () => {
        ScratchBlocks.svgResize(current);
        if (rendered && !positioned) showProgramStart();
      };
      controls.current = { workspace: current, reset: showProgramStart };
      observer = new ResizeObserver(resize);
      observer.observe(element);
      void ScratchBlocks.renderManagement.finishQueuedRenders().then(() => {
        if (workspace !== current) return;
        rendered = true;
        resize();
      });
    } catch {
      setState('unavailable');
      workspace?.dispose();
      workspace = null;
    }
    return () => {
      controls.current = null;
      observer?.disconnect();
      workspace?.dispose();
      workspace = null;
    };
  }, [value, scope]);
  const zoomTools = (
    <div className="arduino-program-zoom" role="group" aria-label="Масштаб блоков">
      <button
        type="button"
        aria-label="Уменьшить блоки"
        title="Уменьшить блоки"
        onClick={() => controls.current?.workspace.zoomCenter(-1)}
      >
        <img alt="" src={scratchZoomOutUrl} />
      </button>
      <button
        type="button"
        aria-label="К началу программы"
        title="К началу программы"
        onClick={() => controls.current?.reset()}
      >
        <img alt="" src={scratchZoomResetUrl} />
      </button>
      <button
        type="button"
        aria-label="Увеличить блоки"
        title="Увеличить блоки"
        onClick={() => controls.current?.workspace.zoomCenter(1)}
      >
        <img alt="" src={scratchZoomInUrl} />
      </button>
    </div>
  );
  return (
    <>
      {state === 'ready' && (controlsHost ? createPortal(zoomTools, controlsHost) : zoomTools)}
      <div
        ref={host}
        className="public-arduino-blocks"
        data-testid="public-arduino-blocks"
        aria-label="Программа Arduino — блоки, только просмотр"
        hidden={state !== 'ready'}
      />
      {state !== 'ready' ? (
        <p role="status">
          {state === 'empty'
            ? 'В программе пока нет блоков.'
            : 'Не удалось показать блоки этой версии.'}
        </p>
      ) : null}
    </>
  );
}
