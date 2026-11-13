import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { api, type Classroom } from '../api';
import { onSessionLoggedOut } from '../session-fetch';
import {
  classroomNavigation,
  createClassNavigationGeneration,
  type ClassNavigation,
  type ClassNavigationItem,
} from './classroom-navigation';
import './classroom-navigator.css';

type LoadState = {
  readonly context: string;
  readonly kind: 'loading' | 'ready' | 'error';
  readonly navigation: ClassNavigation | null;
};

type Opening = { readonly context: string };
type Placement = {
  readonly opening: Opening | null;
  readonly style: CSSProperties;
};

export function ClassroomNavigator({
  classroom,
  onNavigateClassroom,
}: {
  readonly classroom: Pick<Classroom, 'id' | 'title' | 'status' | 'teacherRole'>;
  readonly onNavigateClassroom: (id: string, title: string) => void;
}): JSX.Element {
  const { id, title, status, teacherRole } = classroom;
  const context = JSON.stringify([id, status, teacherRole]);
  const popupId = useId();
  const container = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const popup = useRef<HTMLDivElement>(null);
  const pendingReveal = useRef(false);
  const generation = useRef(createClassNavigationGeneration());
  const loggedOut = useRef(false);
  const [ended, setEnded] = useState(false);
  const [retry, setRetry] = useState(0);
  const [openContext, setOpenContext] = useState<Opening | null>(null);
  const [placement, setPlacement] = useState<Placement>({
    opening: null,
    style: { left: 8, top: 8, width: 320, maxHeight: 240 },
  });
  const [load, setLoad] = useState<LoadState>({ context, kind: 'loading', navigation: null });
  const open = openContext?.context === context && !ended;
  const currentLoad = load.context === context ? load : null;
  const navigation = !ended && currentLoad?.kind === 'ready' ? currentLoad.navigation : null;

  function close(): void {
    pendingReveal.current = false;
    setOpenContext(null);
    opener.current?.focus({ preventScroll: true });
  }

  function show(): void {
    if (open || ended) return;
    pendingReveal.current = true;
    // Object identity distinguishes every opening, even in the same context.
    setOpenContext({ context });
  }

  function navigate(item: ClassNavigationItem): void {
    close();
    if (!loggedOut.current && item.id !== id) onNavigateClassroom(item.id, item.title);
  }

  useEffect(
    () =>
      onSessionLoggedOut(() => {
        loggedOut.current = true;
        generation.current.invalidate();
        pendingReveal.current = false;
        setEnded(true);
        setOpenContext(null);
        setLoad({ context: '', kind: 'error', navigation: null });
      }),
    [],
  );

  useEffect(() => {
    pendingReveal.current = false;
    setOpenContext(null);
  }, [context]);

  useEffect(() => {
    if (loggedOut.current) return;
    const isCurrent = generation.current.begin();
    setLoad({ context, kind: 'loading', navigation: null });
    async function fetchClasses(): Promise<void> {
      try {
        const response = await api.listClassrooms();
        if (!isCurrent() || loggedOut.current) return;
        if (!response.ok) {
          setLoad({ context, kind: 'error', navigation: null });
          return;
        }
        const result = classroomNavigation(response.data.items, { id, status, teacherRole });
        setLoad({ context, kind: result ? 'ready' : 'error', navigation: result });
      } catch {
        if (!isCurrent() || loggedOut.current) return;
        setLoad({ context, kind: 'error', navigation: null });
      }
    }
    void fetchClasses();
    return () => generation.current.invalidate();
  }, [context, id, status, teacherRole, retry]);

  useLayoutEffect(() => {
    if (!open || !openContext) return;
    const anchor = opener.current?.getBoundingClientRect();
    if (!anchor) return;
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft ?? 0;
    const topEdge = viewport?.offsetTop ?? 0;
    const width = viewport?.width ?? window.innerWidth;
    const height = viewport?.height ?? window.innerHeight;
    const popupWidth = Math.max(0, Math.min(320, width - 16));
    const below = Math.max(0, topEdge + height - anchor.bottom - 14);
    const above = Math.max(0, anchor.top - topEdge - 14);
    const useAbove = below < 180 && above > below;
    // This opening becomes ready only when React commits this placement.
    // Bottom anchoring accommodates both short content and later async content.
    setPlacement({
      opening: openContext,
      style: {
        left: Math.max(leftEdge + 8, Math.min(anchor.left, leftEdge + width - popupWidth - 8)),
        top: useAbove ? undefined : anchor.bottom + 6,
        bottom: useAbove ? window.innerHeight - anchor.top + 6 : undefined,
        width: popupWidth,
        maxHeight: Math.min(360, useAbove ? above : below),
      },
    });
    popup.current?.focus({ preventScroll: true });

    function dismiss(): void {
      pendingReveal.current = false;
      setOpenContext(null);
      opener.current?.focus({ preventScroll: true });
    }
    function outside(event: PointerEvent): void {
      if (event.target instanceof Node && !container.current?.contains(event.target)) dismiss();
    }
    function escape(event: globalThis.KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      dismiss();
    }
    function focusOutside(event: FocusEvent): void {
      if (event.target instanceof Node && !container.current?.contains(event.target)) {
        pendingReveal.current = false;
        setOpenContext(null);
      }
    }
    function scroll(event: Event): void {
      if (event.target instanceof Node && popup.current?.contains(event.target)) return;
      dismiss();
    }
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    document.addEventListener('focusin', focusOutside);
    window.addEventListener('resize', dismiss);
    window.addEventListener('scroll', scroll, true);
    viewport?.addEventListener('resize', dismiss);
    viewport?.addEventListener('scroll', dismiss);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
      document.removeEventListener('focusin', focusOutside);
      window.removeEventListener('resize', dismiss);
      window.removeEventListener('scroll', scroll, true);
      viewport?.removeEventListener('resize', dismiss);
      viewport?.removeEventListener('scroll', dismiss);
    };
  }, [open, openContext]);

  useLayoutEffect(() => {
    if (!open || placement.opening !== openContext || !pendingReveal.current || !navigation) return;
    const panel = popup.current;
    const active = document.activeElement;
    // Loading initially focuses the panel. User interaction cancels this handoff.
    if (!panel || (active !== panel && active !== opener.current)) return;
    const current = panel.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    if (!current) return;
    pendingReveal.current = false;
    current.focus({ preventScroll: true });
    const bounds = panel.getBoundingClientRect();
    const item = current.getBoundingClientRect();
    const top = bounds.top + panel.clientTop;
    const bottom = top + panel.clientHeight;
    if (item.top < top) panel.scrollTop -= top - item.top;
    else if (item.bottom > bottom) panel.scrollTop += item.bottom - bottom;
  }, [open, openContext, placement, navigation]);

  function popupKey(event: KeyboardEvent<HTMLDivElement>): void {
    pendingReveal.current = false;
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
    ];
    const index = items.findIndex((item) => item === document.activeElement);
    let target: HTMLButtonElement | undefined;
    if (event.key === 'Home') target = items[0];
    if (event.key === 'End') target = items.at(-1);
    if (event.key === 'ArrowDown') target = items[Math.min(items.length - 1, index + 1)];
    if (event.key === 'ArrowUp') target = index < 0 ? items.at(-1) : items[Math.max(0, index - 1)];
    if (target) {
      event.preventDefault();
      target.focus();
    }
  }

  function neighbor(item: ClassNavigationItem | null, direction: 'previous' | 'next'): JSX.Element {
    const label = direction === 'previous' ? 'Предыдущий класс' : 'Следующий класс';
    return (
      <button
        type="button"
        className="classroom-nav-neighbor"
        disabled={!item}
        aria-label={item ? `${label}: ${item.title}` : label}
        title={item?.title ?? label}
        onClick={() => {
          if (item) navigate(item);
        }}
      >
        {direction === 'previous' ? <span aria-hidden="true">‹</span> : null}
        <span className="classroom-nav-name">{item?.title ?? ''}</span>
        {direction === 'next' ? <span aria-hidden="true">›</span> : null}
      </button>
    );
  }

  return (
    <div className="classroom-nav" ref={container}>
      {neighbor(navigation?.previous ?? null, 'previous')}
      <h1>
        <button
          ref={opener}
          type="button"
          className="classroom-nav-opener"
          title={title}
          disabled={ended}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-controls={open ? popupId : undefined}
          onClick={() => {
            if (open) close();
            else show();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              show();
            }
          }}
        >
          <span className="classroom-nav-name">{title}</span>
          <span aria-hidden="true" className="classroom-nav-chevron">
            ⌄
          </span>
        </button>
      </h1>
      {neighbor(navigation?.next ?? null, 'next')}
      {open ? (
        <div
          ref={popup}
          id={popupId}
          role="dialog"
          aria-label="Выбрать класс"
          tabIndex={-1}
          className="classroom-nav-menu"
          style={placement.style}
          onKeyDown={popupKey}
          onPointerDownCapture={() => {
            pendingReveal.current = false;
          }}
          onWheelCapture={() => {
            pendingReveal.current = false;
          }}
          onTouchStartCapture={() => {
            pendingReveal.current = false;
          }}
          onFocusCapture={(event) => {
            if (event.target !== event.currentTarget) pendingReveal.current = false;
          }}
        >
          {!currentLoad || currentLoad.kind === 'loading' ? (
            <p role="status">Загружаем классы…</p>
          ) : navigation ? (
            navigation.items.map((item) => (
              <button
                type="button"
                key={item.id}
                aria-current={item.id === id ? 'true' : undefined}
                title={item.title}
                onClick={() => navigate(item)}
              >
                {item.title}
              </button>
            ))
          ) : (
            <>
              <p role="status">
                Не удалось показать доступные классы. Текущий класс остаётся открытым.
              </p>
              <button
                type="button"
                onClick={() => {
                  pendingReveal.current = true;
                  popup.current?.focus({ preventScroll: true });
                  setLoad({ context, kind: 'loading', navigation: null });
                  setRetry((value) => value + 1);
                }}
              >
                Повторить
              </button>
            </>
          )}
          <button type="button" onClick={close}>
            Закрыть
          </button>
        </div>
      ) : null}
    </div>
  );
}
