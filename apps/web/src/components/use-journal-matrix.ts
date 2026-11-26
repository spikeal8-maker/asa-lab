import { useCallback, useRef, type RefCallback } from 'react';

/** The matrix scrolls sideways; its heading stays in view as the document scrolls down. */
export function useJournalMatrix(): RefCallback<HTMLDivElement> {
  const detach = useRef<(() => void) | null>(null);

  return useCallback((matrix) => {
    detach.current?.();
    detach.current = null;
    const table = matrix?.querySelector('table');
    const heading = table?.tHead;
    if (!matrix || !table || !heading) return;

    const portalHeader = matrix.closest('.portal-shell')?.querySelector('.portal-header');
    const viewport = window.visualViewport;
    let frame = 0;
    let focusFrame = 0;
    let offset = 0;
    let height = 0;
    const update = () => {
      frame = 0;
      const headerBox = heading.getBoundingClientRect();
      if (!headerBox.width) return;

      // The horizontal overflow ancestor limits native sticky positioning to the matrix.
      // Relate the heading to the portal header while keeping it inside the table.
      const headingTop = headerBox.top - offset;
      const viewportTop = Math.max(
        viewport?.offsetTop ?? 0,
        portalHeader?.getBoundingClientRect().bottom ?? 0,
      );
      const remaining = table.getBoundingClientRect().bottom - headingTop - headerBox.height;
      const next = Math.max(0, Math.min(viewportTop - headingTop, remaining));
      if (next !== offset) {
        offset = next;
        table.style.setProperty('--journal-head-offset', `${offset}px`);
      }
      if (headerBox.height !== height) {
        height = headerBox.height;
        table.style.setProperty('--journal-head-height', `${height}px`);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    const revealFocusedCell = () => {
      cancelAnimationFrame(focusFrame);
      focusFrame = requestAnimationFrame(() => {
        const button = document.activeElement;
        if (
          !(button instanceof HTMLButtonElement) ||
          !matrix.contains(button) ||
          !button.matches(':focus-visible')
        )
          return;
        const cell = button.closest('td, thead th');
        const name = cell?.parentElement?.firstElementChild;
        if (!name || cell === name) return;

        // The browser can focus a cell behind the pinned pupil name without scrolling it.
        const box = button.getBoundingClientRect();
        const visibleLeft = name.getBoundingClientRect().right;
        const visibleRight =
          matrix.getBoundingClientRect().left + matrix.clientLeft + matrix.clientWidth;
        if (box.left < visibleLeft) matrix.scrollLeft += box.left - visibleLeft;
        else if (box.right > visibleRight) matrix.scrollLeft += box.right - visibleRight;
      });
    };
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    observer?.observe(table);
    observer?.observe(heading);
    if (portalHeader) observer?.observe(portalHeader);
    matrix.addEventListener('focusin', revealFocusedCell);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    viewport?.addEventListener('scroll', schedule, { passive: true });
    viewport?.addEventListener('resize', schedule);
    schedule();

    detach.current = () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(focusFrame);
      observer?.disconnect();
      matrix.removeEventListener('focusin', revealFocusedCell);
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      viewport?.removeEventListener('scroll', schedule);
      viewport?.removeEventListener('resize', schedule);
      table.style.removeProperty('--journal-head-offset');
      table.style.removeProperty('--journal-head-height');
    };
  }, []);
}
