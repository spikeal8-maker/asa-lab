import { useRef, useState } from 'react';
import { downloadBlob } from './ai-download';

export function AiAnswerDownloads({ content }: { content: string }): JSX.Element {
  const menu = useRef<HTMLDetailsElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(format: 'pdf' | 'docx' | 'md' | 'txt'): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const { exportAnswer } = await import('./ai-document-export');
      const blob = await exportAnswer(content, format);
      downloadBlob(blob, 'asa-answer.' + format);
      menu.current?.removeAttribute('open');
    } catch {
      setError('Не удалось подготовить файл. Попробуйте ещё раз.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="chat-answer-download">
      <details ref={menu}>
        <summary>Скачать ответ</summary>
        <div className="chat-answer-formats" role="group" aria-label="Формат ответа">
          {(['pdf', 'docx', 'md', 'txt'] as const).map((format) => (
            <button key={format} type="button" disabled={busy} onClick={() => void save(format)}>
              {format.toUpperCase()}
            </button>
          ))}
        </div>
      </details>
      {busy ? <span role="status">Готовим файл…</span> : null}
      {error ? <span role="alert">{error}</span> : null}
    </div>
  );
}
