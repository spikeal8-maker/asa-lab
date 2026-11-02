import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createAiScopeCall } from './ai-scope-api';
import { AiMessageContent } from './AiMessageContent';
import { AiChatIcon } from './AiChatIcon';

export interface WorkingFileInfo {
  id: string;
  name: string;
  anchorRequestId: string;
  version: number;
  headVersion?: number;
  content?: string;
  sourceMessageId: string | null;
  sourceBlock: number | null;
  versions?: { version: number; summary: string; createdAt: string }[];
}
export function AiWorkingFiles({
  threadId,
  seatId,
  refreshKey,
  busy,
  onSources,
  messages,
  targets,
  latestRequestId,
}: {
  threadId: string;
  seatId?: string | undefined;
  refreshKey: string;
  busy: boolean;
  onSources: (files: WorkingFileInfo[]) => void;
  messages: readonly { id: string; requestId: string; role: string; webSearch?: unknown }[];
  targets: Readonly<Record<string, HTMLElement>>;
  latestRequestId: string | undefined;
}): JSX.Element | null {
  const call = useMemo(() => createAiScopeCall(seatId), [seatId]);
  const [files, setFiles] = useState<WorkingFileInfo[]>([]);
  const [name, setName] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [file, setFile] = useState<WorkingFileInfo | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const seenFile = useRef(false);
  const previousTurn = useRef(latestRequestId);
  const base = '/api/ai/threads/' + encodeURIComponent(threadId) + '/working-files';
  useEffect(() => {
    const controller = new AbortController();
    void call<{ items: WorkingFileInfo[] }>(base, { signal: controller.signal }).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setFiles(result.data.items);
        onSources(result.data.items);
        setName((previous) =>
          result.data.items.some((f) => f.name === previous)
            ? previous
            : (result.data.items.at(-1)?.name ?? ''),
        );
      }
    });
    return () => controller.abort();
  }, [base, call, refreshKey, refresh, onSources]);
  const head = files.find((f) => f.name === name);
  const anchor =
    messages.find((m) => m.id === head?.sourceMessageId) ??
    messages.find((m) => m.requestId === head?.anchorRequestId && m.role === 'assistant') ??
    messages.find((m) => m.requestId === head?.anchorRequestId) ??
    messages.find((m) => m.role === 'assistant') ??
    messages[0];
  const target = anchor ? targets[anchor.id] : undefined;
  useEffect(() => {
    if (!head) return;
    if (!seenFile.current) {
      seenFile.current = true;
      previousTurn.current = latestRequestId;
      setCollapsed(Boolean(latestRequestId && latestRequestId !== head.anchorRequestId));
    } else if (previousTurn.current !== latestRequestId) {
      previousTurn.current = latestRequestId;
      setCollapsed(true);
      setVersion(null);
    }
  }, [head?.id, latestRequestId]);
  useEffect(() => {
    if (!head || collapsed || !target) return;
    const controller = new AbortController();
    void call<WorkingFileInfo>(
      base + '/' + encodeURIComponent(head.name) + (version ? '?version=' + version : ''),
      { signal: controller.signal },
    ).then((result) => {
      if (controller.signal.aborted) return;
      if (result.ok) {
        setFile(result.data);
        setError('');
      } else setError(result.error.message);
    });
    return () => controller.abort();
  }, [base, call, head?.id, head?.name, head?.version, version, refresh, collapsed, target]);
  async function restore(): Promise<void> {
    if (!file || !head || saving || busy) return;
    setSaving(true);
    setError('');
    const result = await call<WorkingFileInfo>(
      base + '/' + encodeURIComponent(file.name) + '/restore',
      {
        method: 'POST',
        body: JSON.stringify({
          version: file.version,
          expectedVersion: head.version,
          operationId: crypto.randomUUID(),
        }),
      },
    );
    setSaving(false);
    if (result.ok) {
      setVersion(null);
      setFile(result.data);
      setRefresh((n) => n + 1);
    } else {
      setError(result.error.message);
      setRefresh((n) => n + 1);
    }
  }
  if (!head || !target) return null;
  if (collapsed)
    return createPortal(
      <button
        type="button"
        className="chat-working-collapsed"
        aria-label={'Открыть файл ' + head.name}
        aria-expanded={false}
        onClick={() => setCollapsed(false)}
      >
        <AiChatIcon name="file" size={18} />
        <span>{head.name}</span>
        <small>v{head.version}</small>
        <span className="chat-working-open">Открыть</span>
        <AiChatIcon name="chevron-down" size={16} />
      </button>,
      target,
    );
  if (!file) return null;
  const language = file.name.split('.').at(-1) ?? 'text';
  // The server stores literal code; choose a fence longer than any in that code.
  const longest = Math.max(2, ...((file.content ?? '').match(/`+/g) ?? []).map((s) => s.length));
  const fence = '`'.repeat(longest + 1);
  return createPortal(
    <section className="chat-working-files" aria-label="Рабочие файлы чата">
      <AiMessageContent
        key={file.id}
        seatId={seatId}
        previewEvidence={[
          ...messages.map((message) => message.webSearch),
          anchor?.webSearch,
        ].filter(Boolean)}
        content={fence + language + '\n' + (file.content ?? '') + '\n' + fence}
        codeHeader={{
          name: file.name,
          actions: (
            <>
              <button
                type="button"
                aria-label="Свернуть предпросмотр"
                data-ai-tooltip="Свернуть в строку"
                onClick={() => setCollapsed(true)}
              >
                <AiChatIcon name="chevron-down" size={17} />
              </button>
              {file.version !== head.version && (
                <button
                  type="button"
                  aria-label="Восстановить эту версию"
                  data-ai-tooltip="Восстановить как новую версию"
                  disabled={busy || saving}
                  onClick={() => void restore()}
                >
                  <AiChatIcon name="refresh" size={17} />
                </button>
              )}
            </>
          ),
          controls: (
            <>
              <span className="ai-working-picker" data-ai-tooltip={file.name}>
                <AiChatIcon name="file" size={16} />
                <select
                  className="ai-working-name"
                  aria-label="Рабочий файл"
                  title={file.name}
                  value={file.name}
                  onChange={(event) => {
                    setFile(null);
                    setVersion(null);
                    setName(event.target.value);
                  }}
                >
                  {files.map((f) => (
                    <option key={f.id} value={f.name}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </span>
              <select
                className="ai-working-version"
                aria-label="Версия файла"
                title={file.versions?.find((v) => v.version === file.version)?.summary}
                value={file.version}
                disabled={saving}
                onChange={(event) =>
                  setVersion(
                    Number(event.target.value) === head.version ? null : Number(event.target.value),
                  )
                }
              >
                {file.versions?.map((v) => (
                  <option key={v.version} value={v.version}>
                    v{v.version}
                  </option>
                ))}
              </select>
            </>
          ),
        }}
      />
      {error && (
        <p role="alert" className="asa-ai-preview-notice">
          {error}
        </p>
      )}
    </section>,
    target,
  );
}
