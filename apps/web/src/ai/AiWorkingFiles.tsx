import { useEffect, useMemo, useState } from 'react';
import { createAiScopeCall } from './ai-scope-api';
import { AiMessageContent } from './AiMessageContent';
import { AiChatIcon } from './AiChatIcon';

export interface WorkingFileInfo {
  id: string;
  name: string;
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
}: {
  threadId: string;
  seatId?: string | undefined;
  refreshKey: string;
  busy: boolean;
  onSources: (files: WorkingFileInfo[]) => void;
}): JSX.Element | null {
  const call = useMemo(() => createAiScopeCall(seatId), [seatId]);
  const [files, setFiles] = useState<WorkingFileInfo[]>([]);
  const [name, setName] = useState('');
  const [version, setVersion] = useState<number | null>(null);
  const [file, setFile] = useState<WorkingFileInfo | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [refresh, setRefresh] = useState(0);
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
  useEffect(() => {
    if (!head) return;
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
  }, [base, call, head?.id, head?.name, head?.version, version, refresh]);
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
  if (!file || !head) return null;
  const language = file.name.split('.').at(-1) ?? 'text';
  // The server stores literal code; choose a fence longer than any in that code.
  const longest = Math.max(2, ...((file.content ?? '').match(/`+/g) ?? []).map((s) => s.length));
  const fence = '`'.repeat(longest + 1);
  return (
    <section className="chat-working-files" aria-label="Рабочие файлы чата">
      <AiMessageContent
        key={file.id}
        content={fence + language + '\n' + (file.content ?? '') + '\n' + fence}
        codeHeader={{
          name: file.name,
          controls: (
            <>
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
                    {v.version === head.version ? ' · текущая' : ''}
                  </option>
                ))}
              </select>
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
        }}
      />
      {error && (
        <p role="alert" className="asa-ai-preview-notice">
          {error}
        </p>
      )}
    </section>
  );
}
