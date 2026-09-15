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
  if (!__ASA_BLOCKS_PREVIEW__ || !__ASA_BLOCKS_RUNTIME_ORIGIN__) return null;
  try {
    const origin = requireExactHttpOrigin(__ASA_BLOCKS_RUNTIME_ORIGIN__);
    // A preview must not give Scratch the portal's same-origin privileges.
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

  useEffect(() => {
    if (!runtimeOrigin) return undefined;
    const frame = iframeRef.current;
    if (!frame) return undefined;
    let bridge: BlocksRuntimeBridge | null = null;

    const onMessage = (event: MessageEvent): void => {
      if (!bridge?.acceptChildMessage(event)) return;
      const payload = event.data as Record<string, unknown>;
      if (payload['messageType'] === 'ASA_BLOCKS_STATUS') {
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
      frame.removeEventListener('load', onLoad);
      window.removeEventListener('message', onMessage);
      bridge?.stop();
      bridgeRef.current = null;
    };
  }, [projectId, runtimeOrigin]);

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
        <iframe ref={iframeRef} title="Scratch runtime" src={`${runtimeOrigin}/`} />
      </BlocksEditorShell>
      <div className="blocks-editor-preview-status" role="status">
        TEST · {status} · изменения пока не сохраняются
      </div>
    </div>
  );
}
