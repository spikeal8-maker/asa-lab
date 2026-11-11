import { useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { api, fileLearningPath, type FileLearningResponse } from '../api';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import './file-response.css';

type Props = {
  readonly activityRunId: string;
  readonly activityVersionId?: string | null;
  readonly onChanged: () => Promise<void>;
  readonly onRegisterLeaveGuard?: (id: string, guard: (() => boolean) | null) => void;
};

const accepted = '.pdf,.txt,.csv,.ino,.png,.jpg,.jpeg,.webp,.docx,.pptx,.xlsx,.sb3,.stl,.zip';
const uploadErrors: Record<string, string> = {
  file_content_invalid: 'Содержимое файла не соответствует формату или файл повреждён.',
  file_format_unsupported: 'Этот формат файла не поддерживается.',
  file_name_invalid: 'Измените имя файла и попробуйте загрузить его снова.',
  file_transfer_busy: 'Сейчас идёт много загрузок. Попробуйте ещё раз чуть позже.',
};

function fileProblem(file: File): string | null {
  const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!accepted.split(',').includes(extension)) return 'Этот формат файла не поддерживается.';
  const limit = extension === '.pdf' ? 25 : /^(\.png|\.jpe?g|\.webp)$/.test(extension) ? 20 : 50;
  if (file.size === 0) return 'Выберите непустой файл.';
  if (file.size > limit * 1_000_000) return `Размер файла превышает ${limit} МБ.`;
  return null;
}

export function FileResponseEditor(props: Props): JSX.Element {
  const continuity = useSyncExternalStore(
    subscribeTelemetry,
    () => telemetryContext().continuity,
    () => 0,
  );
  return (
    <FileResponseSession
      key={`${continuity}:${props.activityRunId}:${props.activityVersionId ?? ''}`}
      {...props}
      continuity={continuity}
    />
  );
}

function FileResponseSession({
  activityRunId,
  activityVersionId,
  onChanged,
  onRegisterLeaveGuard,
  continuity,
}: Props & { readonly continuity: number }): JSX.Element {
  const [response, setResponse] = useState<FileLearningResponse | null>(null);
  const [selected, setSelected] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshRequired, setRefreshRequired] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const pending = useRef(false);
  const mounted = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const helpId = useId();
  const request = useRef<{ key: string; id: string; file: File | null } | null>(null);
  const latest = useRef({ selected, onRegisterLeaveGuard });
  latest.current = { selected, onRegisterLeaveGuard };

  function active() {
    return mounted.current && telemetryContext().continuity === continuity;
  }

  function matches(value: FileLearningResponse) {
    return (
      value.activityRunId === activityRunId &&
      (!activityVersionId || value.activityVersionId === activityVersionId)
    );
  }

  useLayoutEffect(() => {
    mounted.current = true;
    const leave = () =>
      !pending.current &&
      (!latest.current.selected || window.confirm('Выбранный файл не загружен. Выйти из задания?'));
    const register = latest.current.onRegisterLeaveGuard;
    register?.(activityRunId, leave);
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (pending.current || latest.current.selected) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      mounted.current = false;
      register?.(activityRunId, null);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, [activityRunId]);

  useEffect(() => {
    let current = true;
    setBusy(true);
    setError(null);
    void api
      .readFileLearning(activityRunId)
      .then((result) => {
        if (!current || !active()) return;
        if (result.ok && matches(result.data)) {
          setResponse(result.data);
          setRefreshRequired(false);
          request.current = null;
        } else {
          setError(result.ok ? 'Получен ответ для другого задания.' : result.error.message);
        }
      })
      .catch(() => {
        if (current && active()) setError('Не удалось загрузить ответ.');
      })
      .finally(() => {
        if (current && active()) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [activityRunId, activityVersionId, continuity, refresh]);

  async function perform(action: 'start' | 'upload' | 'submit') {
    if (!active() || pending.current || !response || refreshRequired) return;
    const attempt = response.attempt;
    if (action === 'start' ? !response.canStart : !attempt || !response.canEdit) return;
    if (action === 'upload' && !selected) return;
    if (action === 'submit' && (!attempt?.file || selected)) return;
    const file = action === 'upload' ? selected : null;
    const key = JSON.stringify([action, attempt?.id, attempt?.revision]);
    if (request.current?.key !== key || request.current.file !== file) {
      request.current = { key, file, id: crypto.randomUUID() };
    }
    const requestId = request.current.id;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const result =
        action === 'start'
          ? await api.startFileLearning(activityRunId, requestId)
          : action === 'upload'
            ? await api.saveFileLearning(activityRunId, {
                requestId,
                attemptId: attempt!.id,
                expectedRevision: attempt!.revision,
                file: file!,
              })
            : await api.submitFileLearning(activityRunId, {
                requestId,
                attemptId: attempt!.id,
                expectedRevision: attempt!.revision,
              });
      if (!active()) return;
      if (!result.ok) {
        const conflict = result.error.code === 'draft_revision_conflict';
        setRefreshRequired(conflict);
        setError(
          conflict
            ? 'Ответ изменён в другом окне. Обновите его перед сохранением.'
            : (uploadErrors[result.error.code] ?? result.error.message),
        );
        return;
      }
      if (
        !matches(result.data) ||
        (action !== 'start' && result.data.attempt?.id !== attempt?.id) ||
        (action === 'upload' && !result.data.attempt?.file) ||
        (action === 'submit' && !result.data.attempt?.submissionId)
      ) {
        setError('Не удалось подтвердить действие для этой попытки.');
        return;
      }
      request.current = null;
      setResponse(result.data);
      if (action === 'upload') {
        setSelected(null);
        if (input.current) input.current.value = '';
      }
      if (action !== 'upload') {
        try {
          await onChanged();
        } catch {
          if (active()) setError('Ответ подтверждён. Не удалось обновить прогресс.');
        }
      }
    } catch {
      if (active()) setError('Не удалось подтвердить действие. Повторите попытку.');
    } finally {
      pending.current = false;
      if (active()) setBusy(false);
    }
  }

  const attempt = response?.attempt;
  return (
    <section className="file-response" aria-label="Файловый ответ">
      {error ? <p role="alert">{error}</p> : null}
      {!response && !error ? <p role="status">Загружаем ответ…</p> : null}
      {(refreshRequired || (!response && error)) && (
        <button
          type="button"
          className="btn-secondary"
          disabled={busy}
          onClick={() => setRefresh((value) => value + 1)}
        >
          Обновить ответ
        </button>
      )}
      {attempt?.file ? (
        <p>
          <a
            download
            href={`${fileLearningPath(activityRunId)}/files/${encodeURIComponent(attempt.file.id)}`}
          >
            Скачать {attempt.file.name}
          </a>{' '}
          · {attempt.file.sizeBytes.toLocaleString('ru-RU')} Б
        </p>
      ) : null}
      {response?.canEdit ? (
        <div>
          <div className="file-response-selection">
            <label className="file-response-picker">
              <input
                aria-label="Файл ответа"
                aria-describedby={helpId}
                ref={input}
                type="file"
                accept={accepted}
                disabled={busy || refreshRequired}
                onChange={(event) => {
                  const file = event.target.files?.item(0) ?? null;
                  const problem = file ? fileProblem(file) : null;
                  setError(problem);
                  setSelected(problem ? null : file);
                  if (problem) event.target.value = '';
                }}
              />
              <span className="btn-secondary" aria-hidden="true">
                Выбрать файл
              </span>
            </label>
            {selected ? <span>{selected.name}</span> : null}
          </div>
          <small id={helpId}>
            PDF до 25 МБ, PNG, JPG и WebP до 20 МБ. TXT, CSV, INO, DOCX, PPTX, XLSX, SB3, STL и ZIP
            до 50 МБ.
          </small>
        </div>
      ) : null}
      <div className="file-response-actions">
        {response?.canStart ? (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy || refreshRequired}
            onClick={() => void perform('start')}
          >
            {attempt ? 'Начать доработку' : 'Прикрепить файл'}
          </button>
        ) : null}
        {response?.canEdit ? (
          <>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !selected || refreshRequired}
              onClick={() => void perform('upload')}
            >
              Загрузить файл
            </button>
            <button
              type="button"
              className="btn-secondary"
              disabled={busy || !!selected || !attempt?.file || refreshRequired}
              onClick={() => void perform('submit')}
            >
              Сдать файл
            </button>
          </>
        ) : null}
      </div>
      {attempt ? (
        <small role="status">
          {busy
            ? 'Подтверждаем…'
            : attempt.submissionId
              ? 'Файл сдан'
              : selected
                ? 'Файл ожидает загрузки'
                : attempt.file
                  ? 'Файл сохранён'
                  : 'Файл ещё не прикреплён'}
          {' · '}Попытка {attempt.number}
        </small>
      ) : response && !response.canStart && !busy ? (
        <p role="status">Файловый ответ пока недоступен.</p>
      ) : null}
      {attempt?.feedback ? <p>Преподаватель: {attempt.feedback}</p> : null}
    </section>
  );
}
