import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AiChatIcon } from './AiChatIcon';
import { downloadBlob } from './ai-download';
import { markdownTables } from './ai-markdown-tables';

const FORMATS = [
  ['pdf', 'Документ для просмотра и печати'],
  ['docx', 'Документ для Microsoft Word'],
  ['md', 'Текст с разметкой Markdown'],
  ['txt', 'Обычный текст без оформления'],
] as const;
const TABLE_FORMATS = [
  ['xlsx', 'Excel · все таблицы отдельными листами'],
  ['csv', 'Первая таблица · запятая, UTF-8'],
  ['csv-excel', 'Первая таблица · точка с запятой, BOM'],
] as const;
type ExportFormat = (typeof FORMATS)[number][0] | (typeof TABLE_FORMATS)[number][0];

export function AiAnswerDownloads({ content }: { content: string }): JSX.Element {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const tables = useMemo(() => (open ? markdownTables(content) : []), [content, open]);
  const formats = tables.length ? [...FORMATS, ...TABLE_FORMATS] : FORMATS;

  useLayoutEffect(() => {
    if (!open) return;
    const button = trigger.current;
    const menu = panel.current;
    if (!button || !menu) return;

    function position(): void {
      if (!button || !menu) return;
      const anchor = button.getBoundingClientRect();
      const scroll = button.closest('.chat-scroll')?.getBoundingClientRect();
      const margin = 8;
      const left = Math.max(0, scroll?.left ?? 0) + margin;
      const right =
        Math.min(document.documentElement.clientWidth, scroll?.right ?? Infinity) - margin;
      const top = Math.max(0, scroll?.top ?? 0) + margin;
      const bottom = Math.min(window.innerHeight, scroll?.bottom ?? Infinity) - margin;
      if (anchor.bottom <= top || anchor.top >= bottom || right <= left || bottom <= top) {
        setOpen(false);
        if (menu.contains(document.activeElement)) button.focus({ preventScroll: true });
        return;
      }
      const width = Math.min(280, right - left);
      const fitsRight = anchor.right + margin + width <= right;
      const fitsLeft = anchor.left - margin - width >= left;
      menu.style.width = width + 'px';
      menu.style.maxHeight = bottom - top + 'px';
      menu.style.left =
        (fitsRight
          ? anchor.right + margin
          : fitsLeft
            ? anchor.left - margin - width
            : Math.max(left, Math.min(anchor.left, right - width))) + 'px';
      const height = menu.getBoundingClientRect().height;
      const sideTop = Math.max(top, Math.min(anchor.top, bottom - height));
      const below = anchor.bottom + margin;
      const above = anchor.top - margin - height;
      menu.style.top =
        (fitsRight || fitsLeft
          ? sideTop
          : below + height <= bottom
            ? below
            : above >= top
              ? above
              : sideTop) + 'px';
    }
    function closeOutside(event: PointerEvent): void {
      if (event.target instanceof Node && !root.current?.contains(event.target)) {
        setOpen(false);
        button?.focus({ preventScroll: true });
      }
    }
    const scroller = button.closest('.chat-scroll');
    const anchor = button.getBoundingClientRect();
    const scroll = scroller?.getBoundingClientRect();
    if (scroll && (anchor.top < scroll.top + 8 || anchor.bottom > scroll.bottom - 8)) {
      button.scrollIntoView({ block: 'nearest' });
    }
    position();
    menu.querySelector('button')?.focus({ preventScroll: true });
    document.addEventListener('pointerdown', closeOutside);
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    const observer = new ResizeObserver(position);
    observer.observe(menu);
    if (scroller) observer.observe(scroller);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
      observer.disconnect();
    };
  }, [open]);

  function close(): void {
    setOpen(false);
    trigger.current?.focus({ preventScroll: true });
  }
  async function save(format: ExportFormat): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      if (format === 'xlsx' || format === 'csv' || format === 'csv-excel') {
        const firstTable = tables[0];
        if (!firstTable) return;
        const { exportCsv, exportXlsx } = await import('./ai-table-export');
        const blob = format === 'xlsx' ? await exportXlsx(tables) : exportCsv(firstTable, format);
        const name = format === 'csv-excel' ? 'asa-table-excel.csv' : 'asa-table.' + format;
        downloadBlob(blob, name);
      } else {
        const { exportAnswer } = await import('./ai-document-export');
        const blob = await exportAnswer(content, format);
        downloadBlob(blob, 'asa-answer.' + format);
      }
      if (panel.current?.contains(document.activeElement)) close();
      else setOpen(false);
    } catch {
      setError('Не удалось подготовить файл. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="chat-answer-download"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (!open || event.key !== 'Escape') return;
        event.preventDefault();
        event.stopPropagation();
        close();
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="chat-answer-download-trigger"
        aria-label="Скачать ответ"
        data-ai-tooltip="Скачать ответ"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <AiChatIcon name="download" size={18} />
      </button>
      {open ? (
        <div
          id={id}
          ref={panel}
          className="chat-answer-formats"
          role="group"
          aria-label="Формат ответа"
          aria-busy={busy}
        >
          {formats.map(([format, description]) => (
            <button
              key={format}
              type="button"
              aria-label={format === 'csv-excel' ? 'CSV Excel' : format.toUpperCase()}
              aria-describedby={id + '-' + format}
              aria-disabled={busy || undefined}
              onClick={() => void save(format)}
            >
              <strong>{format === 'csv-excel' ? 'CSV Excel' : format.toUpperCase()}</strong>
              <span id={id + '-' + format}>{description}</span>
            </button>
          ))}
        </div>
      ) : null}
      <span className="sr-only" role="status">
        {busy ? 'Готовим файл' : ''}
      </span>
      {error ? (
        <span className="chat-answer-download-error" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
