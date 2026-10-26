import { useEffect, useId, useLayoutEffect, useRef, useState, type RefObject } from 'react';
import { createPortal } from 'react-dom';

/** Presentation only: observe the toolbar without replacing its native input handlers. */
export function WorkbenchTooltip({ root }: { readonly root: RefObject<HTMLElement> }): JSX.Element | null {
  const id = useId();
  const bubble = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ target: HTMLElement; text: string; left: number; top: number } | null>(null);

  useEffect(() => {
    const host = root.current;
    if (!host) return;
    let hovered: HTMLElement | null = null;
    let keyboard = true;
    const target = (node: EventTarget | null): HTMLElement | null => {
      const element = node instanceof Element ? node.closest<HTMLElement>('[data-workbench-tooltip]') : null;
      return element && host.contains(element) ? element : null;
    };
    const hide = () => setTip(null);
    const show = (element: HTMLElement | null) => {
      const text = element?.dataset['workbenchTooltip'];
      if (!element || !text) return;
      const box = element.getBoundingClientRect();
      setTip({ target: element, text, left: box.left, top: box.bottom + 6 });
    };
    const over = (event: PointerEvent) => {
      if (event.pointerType === 'touch') { keyboard = false; hide(); return; }
      const next = target(event.target);
      if (next !== hovered) { hovered = next; show(next); }
    };
    const out = (event: PointerEvent) => {
      if (target(event.relatedTarget) !== hovered) { hovered = null; hide(); }
    };
    const focus = (event: FocusEvent) => { if (keyboard) show(target(event.target)); };
    const down = () => { keyboard = false; hide(); };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Tab') keyboard = true;
      if (event.key === 'Escape') hide();
    };
    const reposition = () => setTip(current => current ? { ...current } : null);
    host.addEventListener('pointerover', over, true);
    host.addEventListener('pointerout', out, true);
    host.addEventListener('focusin', focus);
    host.addEventListener('focusout', hide);
    document.addEventListener('pointerdown', down, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => {
      host.removeEventListener('pointerover', over, true);
      host.removeEventListener('pointerout', out, true);
      host.removeEventListener('focusin', focus);
      host.removeEventListener('focusout', hide);
      document.removeEventListener('pointerdown', down, true);
      document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', reposition, true);
      window.removeEventListener('resize', reposition);
    };
  }, [root]);

  useLayoutEffect(() => {
    if (!tip) return;
    const box = tip.target.getBoundingClientRect();
    const text = tip.target.dataset['workbenchTooltip'];
    if (!root.current?.contains(tip.target) || !text || !box.width || !box.height) { setTip(null); return; }
    const bounds = bubble.current?.getBoundingClientRect();
    if (!bounds) return;
    const left = Math.max(8, Math.min(box.left, window.innerWidth - bounds.width - 8));
    const top = Math.max(8, box.bottom + bounds.height + 14 <= window.innerHeight ? box.bottom + 6 : box.top - bounds.height - 6);
    if (text !== tip.text || left !== tip.left || top !== tip.top) setTip({ ...tip, text, left, top });
  });

  const described = tip?.target;
  useLayoutEffect(() => {
    if (!described) return;
    const tokens = (described.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    described.setAttribute('aria-describedby', [...tokens, id].join(' '));
    return () => {
      const next = (described.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(value => value && value !== id);
      if (next.length) described.setAttribute('aria-describedby', next.join(' '));
      else described.removeAttribute('aria-describedby');
    };
  }, [described, id]);

  return tip ? createPortal(<div ref={bubble} id={id} role="tooltip" className="workbench-tooltip" style={{ left: tip.left, top: tip.top }}>{tip.text}</div>, document.body) : null;
}
