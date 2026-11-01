import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import type { ThreeDDocument } from '@asa-lab/three-d';
import type { ThreeDPresentationHandle } from './ThreeDPresentation';
import { acquireHoverPreview } from './hover-preview-lease';
import './three-d-presentation.css';

const Presentation = lazy(() =>
  import('./ThreeDPresentation').then((m) => ({ default: m.ThreeDPresentation })),
);
type Source =
  | {
      readonly kind: 'publication';
      readonly id: string;
      readonly revisionId: string;
      readonly revisionNo: number;
    }
  | { readonly kind: 'project'; readonly id: string; readonly version?: string };

export function ThreeDHoverPreview({
  source,
  children,
}: {
  readonly source: Source;
  readonly children: ReactNode;
}): JSX.Element {
  const host = useRef<HTMLDivElement>(null),
    view = useRef<ThreeDPresentationHandle>(null);
  const [model, setModel] = useState<ThreeDDocument | null>(null),
    [ready, setReady] = useState(false);
  const pointer = useRef({ x: 0, y: 0 });
  const kind = source.kind,
    id = source.id,
    revisionId = source.kind === 'publication' ? source.revisionId : '',
    revisionNo = source.kind === 'publication' ? source.revisionNo : 0,
    version = source.kind === 'project' ? source.version : '';
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const card = element.closest('.public-project-card,.project-card') ?? element;
    const motion = matchMedia('(prefers-reduced-motion: reduce)');
    let timer = 0,
      frame = 0,
      sequence = 0,
      disposed = false,
      controller: AbortController | null = null,
      release: (() => void) | null = null;
    const stop = () => {
      sequence++;
      window.clearTimeout(timer);
      cancelAnimationFrame(frame);
      controller?.abort();
      controller = null;
      view.current?.dispose();
      release?.();
      release = null;
      if (!disposed) {
        setModel(null);
        setReady(false);
      }
    };
    const enter = (event: Event) => {
      if (
        (event as PointerEvent).pointerType === 'touch' ||
        motion.matches ||
        document.visibilityState === 'hidden'
      )
        return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        stop();
        release = acquireHoverPreview(stop);
        const request = ++sequence,
          abort = new AbortController();
        controller = abort;
        void (async () => {
          let document: ThreeDDocument;
          if (kind === 'publication') {
            const { publicProjectsApi } = await import('../projects-public/api');
            const result = await publicProjectsApi.artifact(id, revisionId, abort.signal);
            if (!result.ok || result.data.artifact.schemaVersion !== 4) return;
            const artifact = result.data.artifact;
            if (
              artifact.provenance.publicationId !== id ||
              artifact.provenance.revisionNumber !== revisionNo
            )
              return;
            const { publicThreeDDocument } = await import('./public-three-d-document');
            document = publicThreeDDocument(artifact);
          } else {
            const { api } = await import('../api');
            const result = await api.openProject(id, abort.signal);
            if (!result.ok || result.data.project.moduleKey !== 'three-d') return;
            const { parseThreeDDocument } = await import('@asa-lab/three-d');
            const parsed = parseThreeDDocument(result.data.draft.document);
            if (!parsed.ok || !parsed.value.nodes.length || parsed.value.nodes.length > 256) return;
            document = {
              ...parsed.value,
              nodes: parsed.value.nodes.map((n) => ({ ...n, locked: true })),
              grid: { ...parsed.value.grid, visible: false },
              ruler: { ...parsed.value.ruler, visible: false },
            };
          }
          if (!disposed && !abort.signal.aborted && request === sequence) setModel(document);
        })().catch(() => {});
      }, 180);
    };
    const move = (event: Event) => {
      const e = event as PointerEvent,
        rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      pointer.current = {
        x: Math.max(-1, Math.min(1, (2 * (e.clientX - rect.left)) / rect.width - 1)),
        y: Math.max(-1, Math.min(1, (2 * (e.clientY - rect.top)) / rect.height - 1)),
      };
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() =>
        view.current?.pointer(pointer.current.x, pointer.current.y),
      );
    };
    const visibility = () => {
      if (document.visibilityState === 'hidden') stop();
    };
    card.addEventListener('pointerenter', enter);
    card.addEventListener('pointerleave', stop);
    card.addEventListener('pointermove', move);
    document.addEventListener('visibilitychange', visibility);
    motion.addEventListener('change', stop);
    return () => {
      disposed = true;
      stop();
      card.removeEventListener('pointerenter', enter);
      card.removeEventListener('pointerleave', stop);
      card.removeEventListener('pointermove', move);
      document.removeEventListener('visibilitychange', visibility);
      motion.removeEventListener('change', stop);
    };
  }, [kind, id, revisionId, revisionNo, version]);
  return (
    <div ref={host} className="three-d-hover-preview" data-testid="three-d-hover-preview">
      {children}
      {model && (
        <div className={`three-d-hover-live${ready ? ' is-ready' : ''}`} aria-hidden="true">
          <Suspense fallback={null}>
            <Presentation
              passive
              ref={view}
              document={model}
              onReady={() => {
                setReady(true);
                view.current?.pointer(pointer.current.x, pointer.current.y);
              }}
              onError={() => {
                view.current?.dispose();
                setModel(null);
                setReady(false);
              }}
            />
          </Suspense>
        </div>
      )}
    </div>
  );
}
