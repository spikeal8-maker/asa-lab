import { useEffect, useRef, useState } from 'react';
import { newClientId } from '../client-id';
import { onSessionLoggedOut } from '../session-fetch';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { publicProjectsApi, type PublicProject, type PublicationReportReceipt } from './api';

export const REPORT_REASONS = [
  ['spam', 'Спам'],
  ['abuse', 'Оскорбления'],
  ['dangerous_content', 'Опасное содержимое'],
  ['personal_data', 'Персональные данные'],
  ['copyright', 'Авторские права'],
  ['other', 'Другое'],
] as const;
export const normalizeReportComment = (value: string): string => value.replace(/^ +| +$/g, '');
export function validReportReceipt(status: number, data: PublicationReportReceipt | null): boolean {
  return (
    status === 200 &&
    data?.status === 'received' &&
    typeof data.duplicate === 'boolean' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.reportId)
  );
}
export function reportError(status: number): string {
  if (status === 400) return 'Проверьте причину и комментарий.';
  if (status === 401) return 'Войдите в личный аккаунт и откройте публикацию заново.';
  if (status === 403)
    return 'Жалобы доступны только из личного аккаунта. В текущем профиле отправка запрещена.';
  if (status === 404 || status === 410)
    return 'Публикация больше недоступна. Обновите страницу проекта.';
  if (status === 409)
    return 'Публикация изменилась или жалоба уже зарегистрирована. Обновите страницу проекта.';
  if (status === 429) return 'Слишком много жалоб. Повторите позже.';
  return 'Отправка не подтверждена. Повторите попытку: тот же запрос не создаст вторую жалобу.';
}

export function ReportPublicProject({
  publication,
  onRefresh,
}: {
  readonly publication: PublicProject;
  readonly onRefresh: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState(0);
  const [receipt, setReceipt] = useState<PublicationReportReceipt | null>(null);
  const [retired, setRetired] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);

  const menu = useRef<HTMLDetailsElement>(null);
  const pending = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const active = useRef(false);
  const stale = useRef(false);
  // A failed/closed dialog retains the exact normalized payload's retry key.
  const intent = useRef<{ payload: string; key: string } | null>(null);
  const normalized = normalizeReportComment(comment);
  const length = Array.from(normalized).length;
  useEffect(() => {
    active.current = true;
    const expected = telemetryContext().continuity;
    const retire = () => {
      stale.current = true;
      pending.current?.abort();
      setRetired(true);
      setReceipt(null);
      setFailure(401);
      setError('Контекст входа изменился. Войдите в личный аккаунт и откройте публикацию заново.');
      setBusy(false);
    };
    const context = subscribeTelemetry((value) => {
      if (value.continuity !== expected) retire();
    });
    const logout = onSessionLoggedOut(retire);
    return () => {
      active.current = false;
      pending.current?.abort();
      context();
      logout();
    };
  }, []);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  function close(): void {
    pending.current?.abort();
    dialog.current?.close();
    setOpen(false);
    menu.current?.querySelector('summary')?.focus();
  }
  async function submit(): Promise<void> {
    if (
      locked.current ||
      stale.current ||
      receipt ||
      !reason ||
      length > 500 ||
      normalized.includes('\0')
    )
      return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setFailure(0);
    const controller = new AbortController();
    pending.current = controller;
    const payload = { revisionId: publication.revisionId, reason, comment: normalized };
    const serialized = JSON.stringify(payload);
    if (intent.current?.payload !== serialized)
      intent.current = { payload: serialized, key: newClientId() };
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      const result = await publicProjectsApi.report(
        publication.publicationId,
        payload,
        intent.current.key,
        controller.signal,
      );
      if (!active.current || stale.current || controller.signal.aborted) return;
      if (!result.ok) {
        setFailure(result.status);
        setError(reportError(result.status));
        return;
      }
      if (!validReportReceipt(result.status, result.data)) {
        setError(reportError(0));
        return;
      }
      setReceipt(result.data);
    } catch {
      if (active.current && !stale.current && !controller.signal.aborted) setError(reportError(0));
    } finally {
      window.clearTimeout(timeout);
      locked.current = false;
      if (active.current && !stale.current) {
        setBusy(false);
        if (controller.signal.aborted) setError(reportError(0));
      }
    }
  }
  const blocked = retired || [401, 403, 404, 409, 410].includes(failure);
  return (
    <>
      <details className="public-report-menu" ref={menu}>
        <summary aria-label="Другие действия" title="Другие действия">
          ⋯
        </summary>
        <button
          type="button"
          onClick={() => {
            if (menu.current) menu.current.open = false;
            setOpen(true);
          }}
        >
          Пожаловаться
        </button>
      </details>
      {open ? (
        <dialog
          ref={dialog}
          className="public-report-dialog"
          aria-labelledby="public-report-title"
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
            aria-busy={busy}
          >
            <h2 id="public-report-title">Пожаловаться</h2>
            <p className="public-report-project">{publication.title}</p>
            {receipt ? (
              <p role="status">{receipt.duplicate ? 'Жалоба уже получена.' : 'Жалоба получена.'}</p>
            ) : (
              <>
                <label htmlFor="public-report-reason">Причина</label>
                <select
                  id="public-report-reason"
                  required
                  value={reason}
                  disabled={busy || blocked}
                  onChange={(event) => {
                    setReason(event.target.value);
                    setError(null);
                  }}
                >
                  <option value="">Выберите причину</option>
                  {REPORT_REASONS.map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <label htmlFor="public-report-comment">Комментарий (необязательно)</label>
                <textarea
                  id="public-report-comment"
                  rows={3}
                  value={comment}
                  disabled={busy || blocked}
                  aria-describedby="public-report-count"
                  aria-invalid={length > 500 || normalized.includes('\0')}
                  onChange={(event) => {
                    setComment(event.target.value);
                    setError(null);
                  }}
                />
                <small id="public-report-count">{length}/500</small>
                {error ? (
                  <p className="notice-error" role="alert">
                    {error}
                  </p>
                ) : null}
                {failure === 401 ? <a href="/#/sign-in">Войти в аккаунт</a> : null}
                {[404, 409, 410].includes(failure) ? (
                  <button type="button" className="btn-secondary" onClick={onRefresh}>
                    Обновить страницу проекта
                  </button>
                ) : null}
              </>
            )}
            <div className="public-report-buttons">
              <button type="button" className="btn-secondary" onClick={close}>
                {receipt ? 'Закрыть' : 'Отмена'}
              </button>
              {!receipt ? (
                <button
                  type="submit"
                  className="btn-primary"
                  disabled={busy || blocked || !reason || length > 500 || normalized.includes('\0')}
                >
                  {busy ? 'Отправляем…' : 'Отправить'}
                </button>
              ) : null}
            </div>
          </form>
        </dialog>
      ) : null}
    </>
  );
}
