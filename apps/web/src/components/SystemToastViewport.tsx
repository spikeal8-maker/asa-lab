import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import {
  dismissSystemFeedback,
  getSystemFeedbackServerSnapshot,
  getSystemFeedbackSnapshot,
  subscribeSystemFeedback,
  type SystemFeedbackMessage,
  type SystemFeedbackTone,
} from './system-feedback';
import './system-feedback.css';

const labels: Record<SystemFeedbackTone, string> = {
  success: 'Успех',
  error: 'Ошибка',
  warning: 'Предупреждение',
  info: 'Сообщение',
};
const icons: Record<SystemFeedbackTone, string> = {
  success: '✓',
  error: '×',
  warning: '!',
  info: 'i',
};
const lifetimes: Record<SystemFeedbackTone, number | null> = {
  success: 4500,
  info: 5000,
  warning: 7000,
  error: null,
};
interface Placement {
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}
interface Budget {
  id: number;
  remaining: number | null;
}
const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

function Ribbon({ item }: { item: SystemFeedbackMessage | null }) {
  const root = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<Placement | null>(null);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [announcement, setAnnouncement] = useState<{
    id: number;
    tone: SystemFeedbackTone;
    text: string;
  } | null>(null);
  const budget = useRef<Budget | null>(null);
  const announced = useRef<number | null>(null);
  const active = item !== null;

  useLayoutEffect(() => {
    if (!active) {
      setPlacement(null);
      setHovered(false);
      setFocused(false);
      return;
    }
    let frame: number | null = null;
    let header: HTMLElement | null = null;
    let ancestors: HTMLElement[] = [];
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    const discovery = new MutationObserver(schedule);
    function bind(next: HTMLElement | null) {
      const dependencies: HTMLElement[] = [];
      let node = next ?? document.querySelector<HTMLElement>('.portal-header');
      while (node) {
        dependencies.push(node);
        let sibling = node.previousElementSibling;
        while (sibling) {
          if (sibling instanceof HTMLElement) dependencies.push(sibling);
          sibling = sibling.previousElementSibling;
        }
        node = node.parentElement;
      }
      if (
        header === next &&
        dependencies.length === ancestors.length &&
        dependencies.every((element, index) => element === ancestors[index])
      )
        return;
      header = next;
      ancestors = dependencies;
      resize?.disconnect();
      mutations.disconnect();
      discovery.disconnect();
      if (dependencies.length === 0) {
        discovery.observe(document.body, { childList: true, subtree: true });
        return;
      }
      for (const element of dependencies) {
        resize?.observe(element);
        mutations.observe(element, {
          attributes: true,
          attributeFilter: ['class', 'style', 'hidden'],
          childList: true,
        });
      }
    }
    function measure() {
      frame = null;
      const viewport = window.visualViewport;
      const top = finite(viewport?.offsetTop ?? 0, 0);
      const left = finite(viewport?.offsetLeft ?? 0, 0);
      const height = Math.max(0, finite(viewport?.height ?? window.innerHeight, 0));
      const width = Math.max(0, finite(viewport?.width ?? window.innerWidth, 0));
      const bottom = top + height;
      const nextHeader =
        Array.from(document.querySelectorAll<HTMLElement>('.portal-header')).find((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return (
            element.getClientRects().length > 0 &&
            style.visibility === 'visible' &&
            style.display !== 'none' &&
            Number(style.opacity) !== 0 &&
            Number.isFinite(rect.bottom) &&
            rect.width > 0 &&
            rect.height > 0 &&
            rect.bottom > top &&
            rect.top < bottom &&
            rect.right > left &&
            rect.left < left + width
          );
        }) ?? null;
      bind(nextHeader);
      const ribbonWidth = Math.max(0, Math.min(720, width - 16));
      const ribbonTop = header ? Math.max(top, header.getBoundingClientRect().bottom) : bottom;
      const available = Math.max(0, bottom - ribbonTop);
      // The close target needs 44px plus the ribbon's borders and padding.
      const next: Placement | null =
        header && ribbonWidth > 0 && available >= 52
          ? {
              top: ribbonTop,
              left: left + (width - ribbonWidth) / 2,
              width: ribbonWidth,
              maxHeight: available,
            }
          : null;
      setPlacement((previous) =>
        previous?.top === next?.top &&
        previous?.left === next?.left &&
        previous?.width === next?.width &&
        previous?.maxHeight === next?.maxHeight
          ? previous
          : next,
      );
      // Follow finite header/ancestor motion only for its active duration.
      const moving = ancestors.some((element) =>
        (element.getAnimations?.() ?? []).some((animation) => {
          const end = animation.effect?.getComputedTiming().endTime;
          return (
            animation.playState === 'running' && typeof end === 'number' && Number.isFinite(end)
          );
        }),
      );
      if (moving) schedule();
    }
    function schedule() {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    }
    function motion(event: Event) {
      if (event.target instanceof HTMLElement && ancestors.includes(event.target)) schedule();
    }
    const motionEvents = [
      'transitionrun',
      'transitionend',
      'transitioncancel',
      'animationstart',
      'animationend',
      'animationcancel',
    ];
    for (const event of motionEvents) document.addEventListener(event, motion, true);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule);
    measure();
    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      resize?.disconnect();
      mutations.disconnect();
      discovery.disconnect();
      for (const event of motionEvents) document.removeEventListener(event, motion, true);
      window.removeEventListener('resize', schedule);
      window.removeEventListener('scroll', schedule, true);
      viewport?.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
    };
  }, [active]);

  const positioned = active && placement !== null;
  useLayoutEffect(() => {
    const element = positioned ? root.current : null;
    setHovered(element?.matches(':hover') ?? false);
    setFocused(Boolean(element?.contains(document.activeElement)));
  }, [positioned]);

  useLayoutEffect(() => {
    const update = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', update);
    update();
    return () => document.removeEventListener('visibilitychange', update);
  }, []);

  useLayoutEffect(() => {
    if (!item) {
      budget.current = null;
      return;
    }
    if (budget.current?.id !== item.id) {
      budget.current = { id: item.id, remaining: lifetimes[item.tone] };
    }
    const lifetime = budget.current;
    if (hovered || focused || !placement || !visible || lifetime.remaining === null) return;
    const started = performance.now();
    const timer = window.setTimeout(() => dismissSystemFeedback(lifetime.id), lifetime.remaining);
    return () => {
      window.clearTimeout(timer);
      if (lifetime.remaining !== null) {
        lifetime.remaining = Math.max(0, lifetime.remaining - (performance.now() - started));
      }
    };
  }, [item, hovered, focused, placement !== null, visible]);

  useLayoutEffect(() => {
    // Clear first, then fill on a later task so identical publications announce again.
    setAnnouncement(null);
    if (!item || !placement || !visible || announced.current === item.id) return;
    const timer = window.setTimeout(() => {
      announced.current = item.id;
      setAnnouncement({
        id: item.id,
        tone: item.tone,
        text: `${labels[item.tone]}. ${item.message}`,
      });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [item, placement !== null, visible]);

  const currentAnnouncement =
    positioned && visible && announcement?.id === item?.id ? announcement : null;
  const politeText =
    currentAnnouncement && currentAnnouncement.tone !== 'error' ? currentAnnouncement.text : '';
  const assertiveText = currentAnnouncement?.tone === 'error' ? currentAnnouncement.text : '';

  return (
    <>
      <div
        className="system-feedback-announcement"
        role={politeText ? 'status' : undefined}
        aria-live={politeText ? undefined : 'polite'}
        aria-atomic="true"
      >
        {politeText}
      </div>
      <div
        className="system-feedback-announcement"
        role={assertiveText ? 'alert' : undefined}
        aria-live={assertiveText ? undefined : 'assertive'}
        aria-atomic="true"
      >
        {assertiveText}
      </div>
      <div
        ref={root}
        className="system-feedback-viewport"
        style={item && placement ? { ...placement } : { display: 'none' }}
        onPointerEnter={() => setHovered(true)}
        onPointerLeave={() => setHovered(false)}
        onFocusCapture={() => setFocused(true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
        }}
      >
        {item && placement ? (
          <div className={`system-feedback-ribbon system-feedback-${item.tone}`}>
            <span className="system-feedback-icon" aria-hidden="true">
              {item ? icons[item.tone] : ''}
            </span>
            <div
              className="system-feedback-copy"
              tabIndex={0}
              role="region"
              aria-label="Текст уведомления"
            >
              <strong>{item ? labels[item.tone] : ''}</strong>
              <span>{item?.message}</span>
            </div>
            <button
              type="button"
              className="system-feedback-close"
              aria-label="Закрыть уведомление"
              onClick={() => {
                if (item) dismissSystemFeedback(item.id);
              }}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        ) : null}
      </div>
    </>
  );
}

export interface SystemToastViewportProps {
  scopeKey: string;
}
/** Mount once in the current Dashboard or Classroom parent. */
export function SystemToastViewport({ scopeKey }: SystemToastViewportProps) {
  const item = useSyncExternalStore(
    subscribeSystemFeedback,
    getSystemFeedbackSnapshot,
    getSystemFeedbackServerSnapshot,
  );
  if (typeof document === 'undefined') return null;
  return createPortal(<Ribbon item={item?.scope === scopeKey ? item : null} />, document.body);
}
