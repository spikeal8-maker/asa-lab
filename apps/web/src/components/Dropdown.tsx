import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A menu that closes when the page is used elsewhere.
 *
 * `<details>` gives a disclosure for free but not a menu: left alone it stays
 * open behind whatever is clicked next, so a teacher who opens a row's actions
 * and then clicks a different row ends up with two panels hanging over the
 * page. That is what made the class list feel broken.
 *
 * This adds the two behaviours every menu on the web has and `<details>` has
 * not: an outside click closes it, and Escape closes it and returns focus to
 * the control that opened it. The disclosure semantics — a real summary, real
 * buttons, keyboard support — are kept, because they were the good part.
 */
export function Dropdown({
  label,
  className,
  ariaLabel,
  disabled = false,
  fitViewport = false,
  children,
}: {
  readonly label: ReactNode;
  readonly className: string;
  readonly ariaLabel?: string;
  readonly disabled?: boolean;
  /** Keep tall action menus within the visible viewport on narrow or scrolled pages. */
  readonly fitViewport?: boolean;
  /** Receives a way to close the menu, so an item can act and dismiss. */
  readonly children: (close: () => void) => ReactNode;
}): JSX.Element {
  const ref = useRef<HTMLDetailsElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => {
    if (ref.current) ref.current.open = false;
    setOpen(false);
  }, []);

  function fitOpenMenu(element: HTMLDetailsElement): void {
    if (!fitViewport) return;
    const menu = element.querySelector<HTMLElement>(':scope > .dropdown-menu');
    const trigger = element.querySelector<HTMLElement>(':scope > summary');
    if (!menu || !trigger) return;
    element.removeAttribute('data-dropdown-placement');
    menu.style.maxHeight = '';
    if (!element.open) return;

    const anchor = trigger.getBoundingClientRect();
    const stickyBottom = document.querySelector('.portal-header')?.getBoundingClientRect().bottom ?? 0;
    const availableAbove = Math.max(0, anchor.top - Math.max(8, stickyBottom) - 8);
    const availableBelow = Math.max(0, window.innerHeight - anchor.bottom - 8);
    const openAbove = menu.getBoundingClientRect().height > availableBelow &&
      availableAbove > availableBelow;
    const space = openAbove ? availableAbove : availableBelow;
    element.dataset.dropdownPlacement = openAbove ? 'above' : 'below';
    menu.style.maxHeight = `${Math.floor(space)}px`;
  }

  useEffect(() => {
    function onPointer(event: MouseEvent): void {
      const element = ref.current;
      if (element?.open && !element.contains(event.target as Node)) {
        element.open = false;
        setOpen(false);
      }
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && ref.current?.open) {
        ref.current.open = false;
        setOpen(false);
        ref.current.querySelector('summary')?.focus();
      }
    }
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <details
      ref={ref}
      className={className}
      onToggle={(event) => {
        const element = event.currentTarget as HTMLDetailsElement;
        fitOpenMenu(element);
        setOpen(element.open);
      }}
    >
      {/* A summary is announced as a disclosure triangle, which is not what this
          is: it opens a menu of actions. Saying so makes it reachable by name
          for anyone using a screen reader — and, as it happens, for a test. */}
      <summary
        role="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={ariaLabel}
        aria-disabled={disabled ? 'true' : undefined}
        onClick={(event) => {
          if (disabled) event.preventDefault();
        }}
      >
        {label}
      </summary>
      <div className="dropdown-menu">{children(close)}</div>
    </details>
  );
}
