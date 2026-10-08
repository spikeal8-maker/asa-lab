import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import './info-hint.css';

/** Short explanations stay available to pointer, keyboard and touch users. */
export function InfoHint({
  label,
  children,
}: {
  readonly label: string;
  readonly children: ReactNode;
}): JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12 });
  const trigger = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const pinned = useRef(false);
  const delay = useRef<ReturnType<typeof setTimeout>>();
  function keep(): void {
    clearTimeout(delay.current);
    window.dispatchEvent(new CustomEvent('asa-info-hint-open', { detail: id }));
    setOpen(true);
  }
  function close(): void {
    clearTimeout(delay.current);
    pinned.current = false;
    setOpen(false);
  }
  function leave(): void {
    if (pinned.current || document.activeElement === trigger.current) return;
    clearTimeout(delay.current);
    delay.current = setTimeout(close, 150);
  }
  useEffect(() => {
    const otherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== id) close();
    };
    window.addEventListener('asa-info-hint-open', otherOpened);
    return () => {
      clearTimeout(delay.current);
      window.removeEventListener('asa-info-hint-open', otherOpened);
    };
  }, [id]);
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const anchor = trigger.current;
    let observed: HTMLElement[] = [];
    const observer = new MutationObserver(checkOwner);
    function checkOwner(): void {
      if (!anchor.isConnected) {
        close();
        return;
      }
      const ancestors: HTMLElement[] = [];
      for (let owner: HTMLElement | null = anchor; owner; owner = owner.parentElement) {
        ancestors.push(owner);
        const style = getComputedStyle(owner);
        if (
          owner.hidden ||
          style.display === 'none' ||
          style.contentVisibility === 'hidden' ||
          (owner instanceof HTMLDialogElement && !owner.open)
        ) {
          close();
          return;
        }
      }
      const visibility = getComputedStyle(anchor).visibility;
      if (visibility === 'hidden' || visibility === 'collapse') {
        close();
        return;
      }
      // The popup can live outside a mounted-but-hidden settings panel. Watch
      // only this open hint's owner chain, including detach/visible reparenting.
      if (
        ancestors.length !== observed.length ||
        ancestors.some((owner, index) => owner !== observed[index])
      ) {
        observer.disconnect();
        for (const owner of ancestors)
          observer.observe(owner, {
            attributes: true,
            attributeFilter: ['hidden', 'style', 'class', 'open'],
            childList: true,
          });
        observed = ancestors;
      }
    }
    checkOwner();
    window.addEventListener('resize', checkOwner);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', checkOwner);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const anchor = trigger.current?.getBoundingClientRect();
      const box = popup.current?.getBoundingClientRect();
      if (!anchor || !box) return;
      const top = anchor.top - box.height - 4;
      setPosition({
        left: Math.max(12, Math.min(anchor.left, innerWidth - box.width - 12)),
        top: Math.max(
          12,
          Math.min(top >= 12 ? top : anchor.bottom + 4, innerHeight - box.height - 12),
        ),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !trigger.current?.contains(event.target) &&
        !popup.current?.contains(event.target)
      )
        close();
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, [open]);
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="info-hint-trigger"
        aria-label={label}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        // Require pointer movement: removing a modal can uncover this icon
        // beneath a stationary pointer without the user asking for a hint.
        onPointerMove={(event) => {
          if (event.pointerType !== 'touch') keep();
        }}
        onPointerLeave={leave}
        onFocus={keep}
        onBlur={(event) => {
          if (!pinned.current || event.relatedTarget) close();
        }}
        onClick={() => {
          if (pinned.current) close();
          else {
            pinned.current = true;
            keep();
          }
        }}
      >
        <span aria-hidden="true">i</span>
      </button>
      {open
        ? createPortal(
            <div
              ref={popup}
              id={id}
              role="tooltip"
              className="info-hint-popup"
              style={position}
              onPointerEnter={keep}
              onPointerLeave={leave}
            >
              {children}
            </div>,
            trigger.current?.closest('dialog') ?? document.body,
          )
        : null}
    </>
  );
}
