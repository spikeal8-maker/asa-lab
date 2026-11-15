import { useLayoutEffect, useRef, type TextareaHTMLAttributes } from 'react';

/** A document field starts at one line and keeps all of its text visible. */
export function GrowingTextarea({
  value,
  className = '',
  ...props
}: Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'rows' | 'value'> & {
  readonly value: string;
}): JSX.Element {
  const ref = useRef<HTMLTextAreaElement>(null);
  const resize = () => {
    const element = ref.current;
    if (!element || element.getBoundingClientRect().width === 0) return;
    element.style.height = 'auto';
    const border = element.offsetHeight - element.clientHeight;
    element.style.height = `${element.scrollHeight + border}px`;
  };
  useLayoutEffect(resize, [value]);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let width = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width !== width) {
        width = entry.contentRect.width;
        resize();
      }
    });
    observer.observe(element);
    window.addEventListener('resize', resize);
    document.fonts?.addEventListener('loadingdone', resize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', resize);
      document.fonts?.removeEventListener('loadingdone', resize);
    };
  }, []);
  return (
    <textarea
      {...props}
      ref={ref}
      className={`course-growing-textarea ${className}`.trim()}
      value={value}
      rows={1}
    />
  );
}
