import { useEffect, useRef, type ReactNode } from 'react';

/** Native scrolling: touch, trackpad and keyboard work without carousel libraries. */
export function HomeShelf({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  const track = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const node = track.current;
    if (!node) return;
    const wheel = (event: WheelEvent): void => {
      // Preserve pinch zoom, native horizontal gestures, and scrolling inside menus.
      if (
        event.ctrlKey ||
        event.shiftKey ||
        Math.abs(event.deltaX) >= Math.abs(event.deltaY) ||
        (event.target instanceof Element && event.target.closest('.project-card-menu'))
      )
        return;
      const max = node.scrollWidth - node.clientWidth;
      if (
        max <= 1 ||
        (event.deltaY < 0 && node.scrollLeft <= 1) ||
        (event.deltaY > 0 && node.scrollLeft >= max - 1)
      )
        return;
      if (!event.cancelable) return;
      event.preventDefault();
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? node.clientWidth : 1;
      node.scrollBy({ left: event.deltaY * unit, behavior: 'instant' });
    };
    node.addEventListener('wheel', wheel, { passive: false });
    return () => node.removeEventListener('wheel', wheel);
  }, []);
  const move = (direction: number): void => {
    const node = track.current;
    node?.scrollBy({
      left: direction * node.clientWidth * 0.8,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth',
    });
  };
  return (
    <div className="home-shelf">
      <ul
        ref={track}
        className="home-shelf-track project-card-grid"
        aria-label={label}
        tabIndex={0}
        onKeyDown={(event) => {
          if (
            event.target !== event.currentTarget ||
            !['ArrowLeft', 'ArrowRight'].includes(event.key)
          )
            return;
          event.preventDefault();
          move(event.key === 'ArrowRight' ? 1 : -1);
        }}
      >
        {children}
      </ul>
    </div>
  );
}
