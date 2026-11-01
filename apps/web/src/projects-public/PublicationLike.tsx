import { useEffect, useId, useRef, useState } from 'react';
import { PortalLink } from '../components/PortalLink';
import { onSessionLoggedOut } from '../session-fetch';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { publicProjectsApi, type PublicProject, type PublicationLikeState } from './api';

function Heart({ filled = false }: { readonly filled?: boolean }): JSX.Element {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />
    </svg>
  );
}

export function LikeSignIn({
  onClose,
  comment = false,
}: {
  readonly onClose: () => void;
  readonly comment?: boolean;
}): JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="publication-sign-in"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
    >
      <button
        type="button"
        className="publication-sign-in-close"
        aria-label="Закрыть"
        onClick={onClose}
      >
        ×
      </button>
      <Heart />
      <h2 id={titleId}>{comment ? 'Понравился комментарий?' : 'Понравился проект?'}</h2>
      <p>Войдите в аккаунт или класс, чтобы сохранить лайк.</p>
      <PortalLink className="btn-primary" href="/#/sign-in">
        Войти
      </PortalLink>
      <button type="button" className="btn-secondary" onClick={onClose}>
        Не сейчас
      </button>
    </dialog>
  );
}

export function PublicationLike({
  publication,
  authenticated = false,
}: {
  readonly publication: PublicProject;
  readonly authenticated?: boolean;
}): JSX.Element {
  const [state, setState] = useState<PublicationLikeState | null>(null);
  const [busy, setBusy] = useState(false);
  const [guestPrompt, setGuestPrompt] = useState(false);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [retired, setRetired] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const inFlight = useRef(false);
  const intent = useRef<boolean | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    active.current = true;
    setReady(false);
    setState(null);
    setRetired(false);
    setError(null);
    // App has already resolved Account/Seat/anonymous through its existing identity flow.
    // This prop only avoids anonymous private probes; the API still proves every actor.
    if (!authenticated) {
      setReady(true);
      return () => {
        active.current = false;
        generation.current++;
      };
    }
    const continuity = telemetryContext().continuity;
    const retire = () => {
      generation.current++;
      controller.current?.abort();
      setState(null);
      setBusy(false);
      setRetired(true);
      setError('Контекст входа изменился. Откройте публикацию заново.');
    };
    const unsubscribe = subscribeTelemetry((context) => {
      if (context.continuity !== continuity) retire();
    });
    const logout = onSessionLoggedOut(retire);
    const pending = new AbortController();
    controller.current = pending;
    const current = ++generation.current;
    const initialTimeout = window.setTimeout(() => pending.abort(), 15_000);
    void publicProjectsApi.likeState(publication.publicationId, pending.signal).then((result) => {
      window.clearTimeout(initialTimeout);
      if (!active.current || current !== generation.current) return;
      if (
        result.ok &&
        result.data.publicationId === publication.publicationId &&
        result.data.revisionId === publication.revisionId
      ) {
        setState(result.data);
        setReady(true);
      } else if (!result.ok && result.status === 401) {
        setReady(true);
      } else {
        setError('Не удалось проверить лайк. Откройте публикацию заново.');
      }
    });
    return () => {
      active.current = false;
      generation.current++;
      window.clearTimeout(initialTimeout);
      pending.abort();
      controller.current?.abort();
      unsubscribe();
      logout();
    };
  }, [publication.publicationId, publication.revisionId, authenticated]);

  async function toggle() {
    if (!authenticated || inFlight.current || retired || !ready) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSignIn(false);
    intent.current ??= !state?.liked;
    const current = generation.current;
    const pending = new AbortController();
    controller.current = pending;
    const timeout = window.setTimeout(() => pending.abort(), 15_000);
    try {
      const result = await publicProjectsApi.like(
        publication.publicationId,
        publication.revisionId,
        intent.current,
        pending.signal,
      );
      if (!active.current || current !== generation.current) return;
      if (!result.ok) {
        if (result.status >= 400 && result.status < 500) intent.current = null;
        setSignIn(result.status === 401);
        setError(
          result.status === 401
            ? 'Войдите в аккаунт или класс.'
            : result.error.code === 'own_work'
              ? 'Нельзя поставить лайк своей работе.'
              : result.error.code === 'reactions_disabled'
                ? 'Реакции отключены администратором.'
                : result.status === 404 || result.status === 409
                  ? 'Публикация изменилась или недоступна. Откройте её заново.'
                  : 'Ответ не получен. Повторите действие — второй лайк не появится.',
        );
        return;
      }
      const refreshed = await publicProjectsApi.likeState(
        publication.publicationId,
        pending.signal,
      );
      if (!active.current || current !== generation.current) return;
      if (
        refreshed.ok &&
        refreshed.data.publicationId === publication.publicationId &&
        refreshed.data.revisionId === publication.revisionId
      ) {
        setState(refreshed.data);
        intent.current = null;
      } else {
        setError('Действие сохранено, но счётчик не обновился. Повторите действие для проверки.');
      }
    } catch {
      if (active.current && current === generation.current)
        setError('Ответ не получен. Повторите действие — второй лайк не появится.');
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      if (active.current && current === generation.current) setBusy(false);
    }
  }
  if (!authenticated) {
    return (
      <div className="publication-like">
        <button
          type="button"
          className="publication-like-button"
          aria-label="Нравится"
          title="Нравится"
          onClick={() => setGuestPrompt(true)}
          data-testid="publication-like-button"
        >
          <Heart />
          <span data-testid="publication-like-count">{publication.likeCount ?? 0}</span>
        </button>
        {guestPrompt ? <LikeSignIn onClose={() => setGuestPrompt(false)} /> : null}
      </div>
    );
  }
  const blocked = !!state && !(state.liked ? state.canUnlike : state.canLike);
  const title =
    state?.reason === 'own_work'
      ? 'Это ваша работа'
      : state?.reason === 'reactions_disabled' && !state.liked
        ? 'Реакции отключены администратором'
        : state?.liked
          ? 'Убрать свой лайк'
          : 'Нравится';
  return (
    <div className="publication-like">
      <button
        type="button"
        className="publication-like-button"
        aria-label={state?.liked ? 'Убрать лайк' : 'Нравится'}
        aria-pressed={state?.liked ?? false}
        title={title}
        disabled={busy || !ready || retired || blocked}
        onClick={() => void toggle()}
        data-testid="publication-like-button"
      >
        <Heart filled={state?.liked ?? false} />
        <span data-testid="publication-like-count">
          {state?.likeCount ?? publication.likeCount ?? 0}
        </span>
      </button>
      {error ? (
        <span role="status" className="publication-like-message">
          {error} {signIn ? <PortalLink href="/#/sign-in">Войти</PortalLink> : null}
        </span>
      ) : null}
    </div>
  );
}
