import { useEffect, useRef, useState } from 'react';
import {
  observationApi,
  type ClassroomCopyReceipt,
  type ClassroomCopySource,
} from '../classroom-observation-api';
import { newClientId } from '../client-id';
import { creatorViewToHref } from '../creator-portal/navigation';

export function ClassroomPrivateCopyAction({
  classroomId,
  seatId,
  projectId,
  source,
}: {
  readonly classroomId: string;
  readonly seatId: string;
  readonly projectId: string;
  readonly source: ClassroomCopySource;
}): JSX.Element | null {
  const [allowed, setAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [copy, setCopy] = useState<ClassroomCopyReceipt | null>(null);
  const [error, setError] = useState('');
  const activeRequest = useRef<AbortController | null>(null);
  const idempotencyKey = useRef<string | null>(null);
  useEffect(() => {
    const request = new AbortController();
    void observationApi
      .privateCopyCapability(classroomId, seatId, projectId, source, request.signal)
      .then((result) => {
        if (!request.signal.aborted) setAllowed(result.ok && result.data?.canCopy === true);
      });
    return () => {
      request.abort();
      activeRequest.current?.abort();
    };
  }, [classroomId, projectId, seatId, source]);

  async function activate() {
    if (copy) {
      window.location.assign(
        creatorViewToHref({
          kind: 'editor',
          projectId: copy.projectId,
          moduleKey: copy.moduleKey,
          returnTo: { kind: 'my-projects' },
        }),
      );
      return;
    }
    if (!allowed || activeRequest.current) return;
    const request = new AbortController();
    activeRequest.current = request;
    idempotencyKey.current ??= newClientId();
    setBusy(true);
    setError('');
    const result = await observationApi.copyPrivateProject(
      classroomId,
      seatId,
      projectId,
      source,
      idempotencyKey.current,
      request.signal,
    );
    if (request.signal.aborted) return;
    activeRequest.current = null;
    setBusy(false);
    if (!result.ok) setError(result.error.message || 'Не удалось создать копию.');
    else if (result.data?.projectId && result.data.moduleKey) setCopy(result.data);
    else setError('Не удалось подтвердить создание копии.');
  }

  if (!allowed) return null;
  return (
    <>
      <button
        type="button"
        className="btn-secondary"
        aria-disabled={busy}
        onClick={() => void activate()}
      >
        {copy
          ? 'Открыть копию'
          : busy
            ? 'Копируем…'
            : error
              ? 'Повторить копирование'
              : 'Копировать в «Мои проекты»'}
      </button>
      {copy || error ? (
        <span
          className={error ? 'form-error' : undefined}
          role={error ? 'alert' : 'status'}
          style={{ flexBasis: '100%', order: 1 }}
        >
          {error || 'Личная копия сохранена.'}
        </span>
      ) : null}
    </>
  );
}
