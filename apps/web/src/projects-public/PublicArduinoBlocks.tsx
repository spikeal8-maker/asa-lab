import { useEffect, useRef, useState } from 'react';
import * as ScratchBlocks from 'scratch-blocks';
import { registerArduinoBlockDefinitions } from '../electronics/arduino-block-definitions';
import { migrateLegacyArduinoWorkspaceState } from '../electronics/arduino-block-schema';
import { ARDUINO_SCRATCH_THEME } from '../electronics/arduino-block-appearance';
import { publicArduinoBlocks } from '@asa-lab/contracts';
import scratchZoomOutUrl from '../../node_modules/scratch-blocks/media/zoom-out.svg?url';
import scratchZoomResetUrl from '../../node_modules/scratch-blocks/media/zoom-reset.svg?url';
import scratchZoomInUrl from '../../node_modules/scratch-blocks/media/zoom-in.svg?url';

/** The editor's block renderer, with no editor controls, writes or code generation. */
export function PublicArduinoBlocks({ value }: { readonly value: string }): JSX.Element {
  const host = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    setFailed(false);
    let workspace: ScratchBlocks.WorkspaceSvg | null = null;
    let observer: ResizeObserver | null = null;
    try {
      const safe = publicArduinoBlocks(value);
      if (!safe) throw Error();
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
        zoom: { controls: true, wheel: true, startScale: 0.7, minScale: 0.3, maxScale: 1.5 },
      });
      ScratchBlocks.serialization.workspaces.load(
        migrateLegacyArduinoWorkspaceState(JSON.parse(safe)),
        workspace,
      );
      for (const [selector, url] of [
        ['.blocklyZoomIn image', scratchZoomInUrl],
        ['.blocklyZoomOut image', scratchZoomOutUrl],
        ['.blocklyZoomReset image', scratchZoomResetUrl],
      ]) {
        for (const image of element.querySelectorAll(selector)) {
          image.setAttribute('href', url);
          image.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url);
        }
      }
      workspace.getAllBlocks(false).forEach((b) => {
        b.setEditable(false);
        b.setMovable(false);
        b.setDeletable(false);
      });
      const current = workspace;
      let previousWidth = 0;
      const resize = () => {
        ScratchBlocks.svgResize(current);
        if (element.clientWidth > 0 && previousWidth !== element.clientWidth) {
          previousWidth = element.clientWidth;
          const bounds = current.getBlocksBoundingBox();
          const width = bounds.right - bounds.left;
          if (width > 0)
            current.setScale(Math.max(0.45, Math.min(0.7, (previousWidth - 52) / width)));
          current.scrollCenter();
        }
      };
      observer = new ResizeObserver(resize);
      observer.observe(element);
      resize();
      workspace.scrollCenter();
    } catch {
      setFailed(true);
      workspace?.dispose();
      workspace = null;
    }
    return () => {
      observer?.disconnect();
      workspace?.dispose();
    };
  }, [value]);
  return (
    <>
      <div
        ref={host}
        className="public-arduino-blocks"
        data-testid="public-arduino-blocks"
        aria-label="Программа Arduino — блоки, только просмотр"
        hidden={failed}
      />
      {failed ? (
        <p role="status">
          Не удалось показать блоки этой программы. Попробуйте открыть панель заново.
        </p>
      ) : null}
    </>
  );
}
