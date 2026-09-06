import { useEffect, useRef, useState, type ReactNode } from 'react';

/** Native scrolling: touch, trackpad and keyboard work without carousel libraries. */
export function HomeShelf({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}): JSX.Element {
  const track = useRef<HTMLUListElement>(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const update = (): void => {
    const node = track.current;
    if (node)
      setEdges({
        start: node.scrollLeft < 2,
        end: node.scrollLeft + node.clientWidth >= node.scrollWidth - 2,
      });
  };
  useEffect(() => {
    update();
    const observer = new ResizeObserver(update);
    if (track.current) observer.observe(track.current);
    return () => observer.disconnect();
  }, [children]);
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
        onScroll={update}
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
      <div className="home-shelf-controls">
        <button
          type="button"
          aria-label={`${label}: предыдущие`}
          disabled={edges.start}
          onClick={() => move(-1)}
        >
          ‹
        </button>
        <button
          type="button"
          aria-label={`${label}: следующие`}
          disabled={edges.end}
          onClick={() => move(1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
