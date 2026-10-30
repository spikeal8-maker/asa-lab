import { useEffect, useRef, useState } from 'react';
import { PortalLink } from '../components/PortalLink';
import { onSessionLoggedOut } from '../session-fetch';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { publicProjectsApi, type PublicProject, type PublicationLikeState } from './api';

export function PublicationLike({
  publication,
  authenticated = false,
}: {
  readonly publication: PublicProject;
  readonly authenticated?: boolean;
}): JSX.Element {
  const [state, setState] = useState<PublicationLikeState | null>(null);
  const [busy, setBusy] = useState(false);
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
        <PortalLink
          href="/#/sign-in"
          className="publication-like-button"
          aria-label="Войти, чтобы поставить лайк"
          title="Войдите в аккаунт или класс, чтобы поставить лайк"
        >
          <span aria-hidden="true">♡</span>
          <span data-testid="publication-like-count">{publication.likeCount ?? 0}</span>
          <span>Войти</span>
        </PortalLink>
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
        <span aria-hidden="true">{state?.liked ? '♥' : '♡'}</span>
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
