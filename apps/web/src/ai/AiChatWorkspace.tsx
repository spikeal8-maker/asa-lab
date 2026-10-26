import { useEffect, useState } from 'react';
import { call } from '../api-call';
import { AiChatPage } from './AiChatPage';
import './ai-chat-scope.css';

interface ScopeList {
  personal: boolean;
  items: Array<{ seatId: string; classroomTitle: string; displayName: string }>;
}
/** Remount the complete conversation state when the selected owner changes.
 * Drafts, pagination, retry IDs and streams never migrate between owners. */
export function AiChatWorkspace() {
  const [scopes, setScopes] = useState<ScopeList | null>(null);
  const [selected, setSelected] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void call<ScopeList>('/api/ai/scopes').then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      setScopes(result.data);
      setSelected(result.data.personal ? 'personal' : (result.data.items[0]?.seatId ?? ''));
    });
    return () => {
      active = false;
    };
  }, [reload]);
  if (error)
    return (
      <main className="ai-chat-scope-state" role="alert">
        <h1>ИИ-чат</h1>
        <p>{error}</p>
        <button type="button" onClick={() => setReload((value) => value + 1)}>
          Повторить загрузку
        </button>
      </main>
    );
  if (!scopes)
    return (
      <main className="ai-chat-scope-state" role="status">
        Загружаем доступные чаты…
      </main>
    );
  if (!selected)
    return (
      <main className="ai-chat-scope-state">
        <h1>ИИ-чат</h1>
        <p>Школьный чат недоступен. Войдите в действующий класс заново.</p>
      </main>
    );
  const current = scopes.items.find((scope) => scope.seatId === selected);
  const choices = scopes.items.length + (scopes.personal ? 1 : 0);
  // A single owner needs no visible context stripe. With several valid owners,
  // keep a compact selector in the one existing toolbar, not another header row.
  const scopeControl =
    choices > 1 ? (
      <label className="chat-scope">
        <span className="sr-only">Контекст чата</span>
        <select
          aria-label="Контекст чата"
          value={selected}
          onChange={(event) => setSelected(event.currentTarget.value)}
        >
          {scopes.personal ? <option value="personal">Личный чат</option> : null}
          {scopes.items.map((scope) => (
            <option key={scope.seatId} value={scope.seatId}>
              {scope.classroomTitle} · {scope.displayName}
            </option>
          ))}
        </select>
      </label>
    ) : current ? (
      <span className="asa-ai-school-scope-label" title={current.classroomTitle}>
        Школьный чат
      </span>
    ) : null;
  return (
    <AiChatPage
      key={selected}
      {...(current ? { seatId: current.seatId } : {})}
      scopeControl={scopeControl}
    />
  );
}
