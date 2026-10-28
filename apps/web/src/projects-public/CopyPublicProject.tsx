import { useEffect, useRef, useState } from 'react';
import { newClientId } from '../client-id';
import { PortalLink } from '../components/PortalLink';
import { creatorViewToHref, threeDEditorHash } from '../creator-portal/navigation';
import { onSessionLoggedOut } from '../session-fetch';
import { subscribeTelemetry, telemetryContext } from '../telemetry-context';
import { publicProjectsApi, type PublicProject, type PublicProjectCopy } from './api';

/** Route only the new private Project through the existing subject editor. */
export function copiedProjectHref(copy: PublicProjectCopy): string | null {
  if (!copy.projectId || !['three-d', 'electronics'].includes(copy.moduleKey)) return null;
  const returnTo = { kind: 'my-projects' } as const;
  return copy.moduleKey === 'three-d'
    ? `/${threeDEditorHash(copy.projectId, returnTo)}`
    : creatorViewToHref({
        kind: 'editor',
        projectId: copy.projectId,
        moduleKey: copy.moduleKey,
        returnTo,
      });
}

export function copyError(status: number): string {
  if (status === 401) return 'Войдите в свой аккаунт, затем снова нажмите «Создать свою копию».';
  if (status === 403)
    return 'Копирование недоступно для текущего профиля, модуля или лицензии. Нужен личный аккаунт с разрешённым доступом.';
  if (status === 404 || status === 410) return 'Публикация больше недоступна для копирования.';
  if (status === 409)
    return 'Версия публикации изменилась или запрос конфликтует с предыдущим. Обновите страницу проекта перед копированием.';
  return 'Результат запроса пока неизвестен. Повторите попытку: тот же запрос не создаст вторую копию.';
}

export function CopyPublicProject({
  publication,
}: {
  readonly publication: PublicProject;
}): JSX.Element | null {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signIn, setSignIn] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const [href, setHref] = useState<string | null>(null);
  const inFlight = useRef(false);
  const intentKey = useRef<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const active = useRef(false);
  const retired = useRef(false);
  const eligible = publication.capabilities.canCopy;

  useEffect(() => {
    active.current = true;
    retired.current = false;
    const expected = telemetryContext().continuity;
    const retire = () => {
      retired.current = true;
      controller.current?.abort();
      setHref(null);
      setBusy(false);
      setBlocked(true);
      setSignIn(true);
      setError('Контекст входа изменился. Откройте публикацию заново в нужном аккаунте.');
    };
    // This is only a fence against late effects; the server proves identity and permissions.
    const unsubscribeContext = subscribeTelemetry((context) => {
      if (context.continuity !== expected) retire();
    });
    const unsubscribeLogout = onSessionLoggedOut(retire);
    return () => {
      active.current = false;
      controller.current?.abort();
      unsubscribeContext();
      unsubscribeLogout();
    };
  }, []);

  async function createCopy(): Promise<void> {
    if (inFlight.current || retired.current || !eligible || href) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    setSignIn(false);
    const pending = new AbortController();
    controller.current = pending;
    const expected = telemetryContext().continuity;
    // Keep the intent across every retry, including a lost success response.
    const timeout = window.setTimeout(() => pending.abort(), 30_000);
    try {
      intentKey.current ??= newClientId();
      const result = await publicProjectsApi.copy(
        publication.publicationId,
        publication.revisionId,
        intentKey.current,
        pending.signal,
      );
      if (!active.current || retired.current || telemetryContext().continuity !== expected) return;
      if (!result.ok) {
        setError(copyError(result.status));
        setSignIn(result.status === 401);
        setBlocked([403, 404, 409, 410].includes(result.status));
        return;
      }
      const destination =
        result.data?.moduleKey === publication.moduleKey ? copiedProjectHref(result.data) : null;
      if (!destination) {
        setError(
          'Не удалось прочитать результат. Повторите запрос, чтобы получить уже созданную копию.',
        );
        return;
      }
      setHref(destination);
    } catch {
      if (active.current && !retired.current) setError(copyError(0));
    } finally {
      window.clearTimeout(timeout);
      inFlight.current = false;
      if (active.current && !retired.current) setBusy(false);
    }
  }

  if (!eligible) return null;
  return (
    <section className="public-project-copy" aria-label="Личная копия проекта" aria-busy={busy}>
      {href ? (
        <>
          <p role="status">Приватная копия создана. Откройте её в редакторе.</p>
          <PortalLink className="btn-secondary" href={href}>
            Открыть мою копию
          </PortalLink>
        </>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          disabled={!eligible || busy || blocked}
          title="Личная копия появится в Моих проектах. Оригинал автора сохранится."
          onClick={() => void createCopy()}
        >
          {busy ? 'Создаём копию…' : 'Создать свою копию'}
        </button>
      )}
      {busy ? <p role="status">Создаём личный проект. Дождитесь результата…</p> : null}
      {error ? (
        <p className="notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {signIn ? (
        <PortalLink className="btn-secondary" href="/#/sign-in">
          Войти в аккаунт
        </PortalLink>
      ) : null}
    </section>
  );
}
