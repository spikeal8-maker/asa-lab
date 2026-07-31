import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  api,
  type AccountProfile,
  type AccountSession,
  type SessionPayload,
  type WorkspaceRef,
} from '../api';

const USERNAME_PATTERN = String.raw`[a-zA-Z0-9][a-zA-Z0-9._\-]*[a-zA-Z0-9]`;

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function workspaceKindLabel(kind: string): string {
  return kind === 'personal' ? 'Личное пространство' : 'Организация';
}

function verificationLabel(state: string): string {
  if (state === 'verified') return 'Подтверждён';
  if (state === 'pending') return 'Ожидает подтверждения';
  return 'Не подтверждён';
}

export function AccountPage({
  session,
  onSessionChanged,
}: {
  session: SessionPayload;
  onSessionChanged: (session: SessionPayload) => void;
}): JSX.Element {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const [profileResult, sessionsResult] = await Promise.all([
      api.accountProfile(),
      api.listAccountSessions(),
    ]);
    if (!profileResult.ok || !sessionsResult.ok) {
      setError('Не удалось загрузить настройки аккаунта.');
      setLoading(false);
      return;
    }
    setProfile(profileResult.data);
    setUsername(profileResult.data.username);
    setDisplayName(profileResult.data.displayName);
    setSessions(sessionsResult.data.items);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const educator = useMemo(
    () => profile?.capabilities.find((entry) => entry.capability === 'educator'),
    [profile],
  );

  async function refreshSession(): Promise<boolean> {
    const result = await api.me();
    if (!result.ok || !result.data.authenticated) {
      setError('Сессия изменилась. Обновите страницу и войдите снова.');
      return false;
    }
    onSessionChanged(result.data);
    return true;
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyAction('profile');
    setError(null);
    setNotice(null);
    const result = await api.updateAccountProfile(username, displayName);
    setBusyAction(null);
    if (!result.ok) {
      setError(
        result.error.code === 'username_taken'
          ? 'Это имя пользователя уже занято.'
          : result.error.message,
      );
      return;
    }
    setProfile(result.data);
    await refreshSession();
    setNotice('Профиль сохранён.');
  }

  async function switchWorkspace(workspace: WorkspaceRef): Promise<void> {
    if (workspace.workspaceId === session.activeWorkspace.workspaceId) return;
    setBusyAction(`workspace:${workspace.workspaceId}`);
    setError(null);
    setNotice(null);
    const result = await api.switchWorkspace(workspace.workspaceId);
    if (!result.ok || !(await refreshSession())) {
      setError(result.ok ? 'Не удалось обновить контекст.' : result.error.message);
      setBusyAction(null);
      return;
    }
    setBusyAction(null);
    setNotice(`Активно: ${workspace.title}.`);
  }

  async function attestEducator(): Promise<void> {
    setBusyAction('educator');
    setError(null);
    setNotice(null);
    const result = await api.selfAttestEducator();
    if (!result.ok) {
      setError(
        result.error.code === 'underage'
          ? 'Режим педагога доступен только совершеннолетним владельцам аккаунта.'
          : result.error.message,
      );
      setBusyAction(null);
      return;
    }
    await Promise.all([refresh(), refreshSession()]);
    setBusyAction(null);
    setNotice(
      result.data.created
        ? 'Самодекларация принята. Возможность педагога включена.'
        : 'Возможность педагога уже была включена.',
    );
  }

  async function revokeSession(target: AccountSession): Promise<void> {
    setBusyAction(`session:${target.id}`);
    setError(null);
    setNotice(null);
    const result = await api.revokeAccountSession(target.id);
    setBusyAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSessions((current) => current.filter((entry) => entry.id !== target.id));
    setNotice('Выбранная сессия завершена.');
  }

  async function revokeOthers(): Promise<void> {
    setBusyAction('sessions');
    setError(null);
    setNotice(null);
    const result = await api.revokeOtherAccountSessions();
    setBusyAction(null);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setSessions((current) => current.filter((entry) => entry.current));
    setNotice(
      result.data.revoked === 0
        ? 'Других активных сессий нет.'
        : `Завершено сессий: ${result.data.revoked}.`,
    );
  }

  if (loading || !profile) {
    return (
      <main id="main-content" className="account-page" aria-busy="true" tabIndex={-1}>
        <div className="account-loading" role="status">
          Загружаем настройки аккаунта…
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="account-page" tabIndex={-1}>
      <header className="account-heading">
        <p className="portal-eyebrow">Account C1</p>
        <h1>Аккаунт и рабочие пространства</h1>
        <p>Профиль, возможности и активные входы собраны в одном месте.</p>
      </header>

      {error ? (
        <p className="account-message error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="account-message success" role="status">
          {notice}
        </p>
      ) : null}

      <div className="account-layout">
        <section className="account-card account-profile-card" aria-labelledby="account-profile">
          <div className="account-card-heading">
            <div>
              <p className="account-card-kicker">Личные данные</p>
              <h2 id="account-profile">Профиль</h2>
            </div>
            <span className={`account-status ${profile.emailVerificationState}`}>
              Email: {verificationLabel(profile.emailVerificationState)}
            </span>
          </div>
          <form className="account-form" onSubmit={(event) => void saveProfile(event)}>
            <label>
              Email
              <input value={profile.email} disabled aria-describedby="email-locked" />
            </label>
            <p id="email-locked" className="account-field-note">
              Email нельзя изменить в текущем Alpha-baseline.
            </p>
            <label>
              Имя пользователя
              <input
                value={username}
                minLength={3}
                maxLength={40}
                pattern={USERNAME_PATTERN}
                autoComplete="username"
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>
            <label>
              Отображаемое имя
              <input
                value={displayName}
                minLength={2}
                maxLength={255}
                autoComplete="name"
                onChange={(event) => setDisplayName(event.target.value)}
              />
            </label>
            <div className="account-readonly-grid">
              <span>
                Дата рождения
                <strong>{profile.birthDate}</strong>
              </span>
              <span>
                Страна
                <strong>{profile.country}</strong>
              </span>
            </div>
            <button
              type="submit"
              className="btn-primary account-action"
              disabled={
                busyAction !== null ||
                (username === profile.username && displayName === profile.displayName)
              }
            >
              {busyAction === 'profile' ? 'Сохраняем…' : 'Сохранить профиль'}
            </button>
          </form>
        </section>

        <section className="account-card" aria-labelledby="account-workspaces">
          <div className="account-card-heading">
            <div>
              <p className="account-card-kicker">Контекст</p>
              <h2 id="account-workspaces">Рабочие пространства</h2>
            </div>
          </div>
          <ul className="account-workspace-list">
            {profile.workspaces.map((workspace) => {
              const active = workspace.workspaceId === session.activeWorkspace.workspaceId;
              return (
                <li key={workspace.workspaceId} className={active ? 'active' : undefined}>
                  <div>
                    <strong>{workspace.title}</strong>
                    <span>
                      {workspaceKindLabel(workspace.kind)} · {workspace.role}
                    </span>
                  </div>
                  <button
                    type="button"
                    className={active ? 'account-current' : 'btn-secondary'}
                    disabled={active || busyAction !== null}
                    onClick={() => void switchWorkspace(workspace)}
                  >
                    {active
                      ? 'Активно'
                      : busyAction === `workspace:${workspace.workspaceId}`
                        ? 'Переключаем…'
                        : 'Переключить'}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="account-card" aria-labelledby="account-capabilities">
          <div className="account-card-heading">
            <div>
              <p className="account-card-kicker">Возможности</p>
              <h2 id="account-capabilities">Режимы аккаунта</h2>
            </div>
          </div>
          <ul className="account-capability-list">
            {profile.capabilities.map((capability) => (
              <li key={capability.capability}>
                <strong>{capability.capability}</strong>
                <span>{capability.state}</span>
              </li>
            ))}
          </ul>
          {!educator ? (
            <div className="account-attestation">
              <h3>Я педагог</h3>
              <p>
                Совершеннолетний владелец может самостоятельно включить режим педагога. Дата
                рождения проверяется сервером и не передаётся в запросе.
              </p>
              <button
                type="button"
                className="btn-secondary"
                disabled={busyAction !== null}
                onClick={() => void attestEducator()}
              >
                {busyAction === 'educator' ? 'Проверяем…' : 'Подтвердить статус педагога'}
              </button>
            </div>
          ) : (
            <p className="account-capability-ready">
              Режим педагога включён: <strong>{educator.state}</strong>.
            </p>
          )}
        </section>

        <section className="account-card account-sessions-card" aria-labelledby="account-sessions">
          <div className="account-card-heading">
            <div>
              <p className="account-card-kicker">Безопасность</p>
              <h2 id="account-sessions">Активные сессии</h2>
            </div>
            <button
              type="button"
              className="btn-secondary"
              disabled={busyAction !== null || sessions.every((entry) => entry.current)}
              onClick={() => void revokeOthers()}
            >
              {busyAction === 'sessions' ? 'Завершаем…' : 'Завершить остальные'}
            </button>
          </div>
          <ul className="account-session-list">
            {sessions.map((entry) => (
              <li key={entry.id}>
                <div className="account-session-icon" aria-hidden="true">
                  {entry.current ? '●' : '○'}
                </div>
                <div>
                  <strong>
                    {entry.userAgentSummary ?? 'Неизвестное устройство'}
                    {entry.current ? (
                      <span className="account-session-current">Текущая</span>
                    ) : null}
                  </strong>
                  <span>Последняя активность: {formatDate(entry.lastSeenAt)}</span>
                  <span>Создана: {formatDate(entry.createdAt)}</span>
                </div>
                {entry.current ? null : (
                  <button
                    type="button"
                    className="account-revoke"
                    disabled={busyAction !== null}
                    onClick={() => void revokeSession(entry)}
                  >
                    {busyAction === `session:${entry.id}` ? 'Завершаем…' : 'Завершить'}
                  </button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
