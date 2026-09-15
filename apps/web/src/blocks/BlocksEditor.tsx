import { useEffect, useMemo, useRef, useState } from 'react';
import { newClientId } from '../client-id';
import { BlocksEditorShell } from './BlocksEditorShell';
import { BlocksRuntimeBridge, requireExactHttpOrigin } from './runtime-protocol';

interface BlocksEditorProps {
  projectId: string;
  onBack: () => void;
  accountLabel: string;
  accountInitials: string;
  avatarUrl?: string | null;
  onAccountClick: () => void;
}

function configuredRuntimeOrigin(): string | null {
  if (typeof window === 'undefined') return null;
  if (typeof __ASA_BLOCKS_RUNTIME_ORIGIN__ === 'undefined' || !__ASA_BLOCKS_RUNTIME_ORIGIN__)
    return null;
  try {
    const origin = requireExactHttpOrigin(__ASA_BLOCKS_RUNTIME_ORIGIN__);
    // Visibility never grants the runtime portal authority or permits mixed content.
    if (window.location.origin.startsWith('https:') && origin.startsWith('http:')) return null;
    return origin === window.location.origin ? null : origin;
  } catch {
    return null;
  }
}

export function BlocksEditor({
  projectId,
  onBack,
  accountLabel,
  accountInitials,
  avatarUrl = null,
  onAccountClick,
}: BlocksEditorProps): JSX.Element {
  const runtimeOrigin = useMemo(configuredRuntimeOrigin, []);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const bridgeRef = useRef<BlocksRuntimeBridge | null>(null);
  const [status, setStatus] = useState('Подключение Scratch…');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!runtimeOrigin) return undefined;
    const frame = iframeRef.current;
    if (!frame) return undefined;
    let bridge: BlocksRuntimeBridge | null = null;
    const startupTimer = window.setTimeout(() => setStatus('Ошибка Scratch runtime'), 45000);

    const onMessage = (event: MessageEvent): void => {
      if (!bridge?.acceptChildMessage(event)) return;
      const payload = event.data as Record<string, unknown>;
      if (payload['messageType'] === 'ASA_BLOCKS_STATUS') {
        if (payload['status'] === 'editor-ready') window.clearTimeout(startupTimer);
        setStatus(String(payload['status'] ?? 'Scratch подключён'));
      }
      if (payload['messageType'] === 'ASA_BLOCKS_FATAL') setStatus('Ошибка Scratch runtime');
    };

    const onLoad = (): void => {
      const childWindow = frame.contentWindow;
      if (!childWindow) return;
      bridge?.stop();
      bridge = new BlocksRuntimeBridge({
        childWindow,
        runtimeOrigin,
        projectId,
        mode: 'editor',
        versionId: null,
        apiOrigin: window.location.origin,
        runtimeToken: `preview-${newClientId()}`,
        draftRevision: 0,
        hasProjectJson: false,
        assets: [],
        recoveryNamespace: `asa-blocks-preview-${projectId}`,
        onMessage: (message) => {
          if (message['messageType'] === 'ASA_BLOCKS_READY') setStatus('Scratch готов');
        },
        onFatal: () => setStatus('Ошибка Scratch runtime'),
      });
      bridgeRef.current = bridge;
      bridge.sendInit();
    };

    window.addEventListener('message', onMessage);
    frame.addEventListener('load', onLoad);
    return () => {
      window.clearTimeout(startupTimer);
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      bridge?.stop();
      bridgeRef.current = null;
    };
  }, [projectId, runtimeOrigin, attempt]);

  if (!runtimeOrigin) {
    return (
      <main className="page-center" role="alert">
        <section className="login-card">
          <h1>Среда Scratch не подключена</h1>
          <p>Для этого развёртывания не настроен изолированный Scratch runtime.</p>
          <button type="button" className="btn-secondary" onClick={onBack}>
            К проектам
          </button>
        </section>
      </main>
    );
  }

  return (
    <div className="blocks-editor-fullscreen" data-asa-blocks-fullscreen>
      <BlocksEditorShell
        accountLabel={accountLabel}
        accountInitials={accountInitials}
        avatarUrl={avatarUrl}
        onAccountClick={onAccountClick}
      >
        <iframe
          key={attempt}
          ref={iframeRef}
          title="Scratch runtime"
          src={`${runtimeOrigin}/?asaStatus=parent`}
        />
      </BlocksEditorShell>
      <div className="blocks-editor-preview-status" role="status">
        {status} · изменения пока не сохраняются в аккаунте. Сохраняйте работу на компьютер: Файл →
        Сохранить на компьютер (.sb3).
        {status === 'Ошибка Scratch runtime' ? (
          <button
            type="button"
            className="blocks-editor-retry"
            onClick={() => {
              setStatus('Подключение Scratch…');
              setAttempt((value) => value + 1);
            }}
          >
            Повторить подключение
          </button>
        ) : null}
      </div>
    </div>
  );
}
