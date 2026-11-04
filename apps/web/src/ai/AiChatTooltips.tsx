import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Chat hints live outside scroll containers, so their rounded edges are not clipped. */
export function AiChatTooltips(): JSX.Element | null {
  const [hint, setHint] = useState<{
    text: string;
    left: number;
    top: number;
    below: boolean;
    dark: boolean;
  } | null>(null);
  useEffect(() => {
    const close = (): void => setHint(null);
    const show = (event: Event): void => {
      const target =
        event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-ai-tooltip]')
          : null;
      const root = target?.closest('.asa-ai-layout');
      if (
        !target ||
        !root ||
        target.getAttribute('aria-expanded') === 'true' ||
        (target.tagName === 'SUMMARY' && target.closest('details')?.open)
      ) {
        close();
        return;
      }
      const text = target.dataset['aiTooltip'];
      if (!text) return close();
      const box = target.getBoundingClientRect();
      const below = box.top < 64;
      const edge = Math.min(140, (window.innerWidth - 24) / 2) + 12;
      setHint({
        text,
        below,
        dark: root.getAttribute('data-chat-theme') === 'dark',
        left: Math.max(edge, Math.min(window.innerWidth - edge, box.left + box.width / 2)),
        top: below ? box.bottom + 8 : box.top - 8,
      });
    };
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close();
    };
    document.addEventListener('pointerover', show);
    document.addEventListener('focusin', show);
    document.addEventListener('pointerout', close);
    document.addEventListener('focusout', close);
    document.addEventListener('scroll', close, true);
    document.addEventListener('click', close);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerover', show);
      document.removeEventListener('focusin', show);
      document.removeEventListener('pointerout', close);
      document.removeEventListener('focusout', close);
      document.removeEventListener('scroll', close, true);
      document.removeEventListener('click', close);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, []);
  return hint
    ? createPortal(
        <div
          role="tooltip"
          className="ai-chat-tooltip"
          data-theme={hint.dark ? 'dark' : 'light'}
          style={{
            left: hint.left,
            top: hint.top,
            transform: `translate(-50%, ${hint.below ? '0' : '-100%'})`,
          }}
        >
          {hint.text}
        </div>,
        document.body,
      )
    : null;
}
