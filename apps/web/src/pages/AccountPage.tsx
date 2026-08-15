import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from 'react';
import {
  api,
  type AccountProfile,
  type AccountSession,
  type SessionPayload,
  type WorkspaceRef,
} from '../api';
import { createAvatarDataUrl } from '../creator-portal/avatar-file';
import {
  DEFAULT_AVATARS,
  defaultAvatarFile,
  defaultAvatarForAccount,
  notifyProfileAvatarChanged,
  type DefaultAvatar,
} from '../creator-portal/default-avatars';
import {
  ClassesIcon,
  CloseIcon,
  FolderIcon,
  InspectIcon,
  UserIcon,
} from '../electronics/workbench-icons';

const USERNAME_PATTERN = String.raw`[a-zA-Z0-9][a-zA-Z0-9._\-]*[a-zA-Z0-9]`;

type SettingsPanel = 'profile' | 'access' | 'workspaces' | 'security';

const SETTINGS_PANELS: ReadonlyArray<{
  readonly id: SettingsPanel;
  readonly label: string;
  readonly icon: JSX.Element;
}> = [
  { id: 'profile', label: 'Профиль', icon: <UserIcon /> },
  { id: 'access', label: 'Права и классы', icon: <ClassesIcon /> },
  { id: 'workspaces', label: 'Рабочие пространства', icon: <FolderIcon /> },
  { id: 'security', label: 'Учётная запись', icon: <InspectIcon /> },
];

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function workspaceKindLabel(kind: string): string {
  return kind === 'personal' ? 'Личное пространство' : 'Пространство школы';
}

function workspaceRoleLabel(role: string): string {
  if (role === 'owner') return 'Владелец пространства';
  if (role === 'educator') return 'Педагог организации';
  if (role === 'learner') return 'Участник класса';
  return 'Участник';
}

function verificationLabel(state: string): string {
  if (state === 'verified') return 'Email подтверждён';
  return 'Проверка почты пока не подключена';
}

export function AccountPage({
  session,
  onSessionChanged,
}: {
  session: SessionPayload;
  onSessionChanged: (session: SessionPayload) => void;
}): JSX.Element {
  const [panel, setPanel] = useState<SettingsPanel>('profile');
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    setError(null);
    const [profileResult, sessionsResult, avatarResult] = await Promise.all([
      api.accountProfile(),
      api.listAccountSessions(),
      api.accountAvatar(),
    ]);
    if (!profileResult.ok || !sessionsResult.ok || !avatarResult.ok) {
      setError('Не удалось загрузить настройки аккаунта.');
      setLoading(false);
      return;
    }
    setProfile(profileResult.data);
    setUsername(profileResult.data.username);
    setDisplayName(profileResult.data.displayName);
    setBio(profileResult.data.bio ?? '');
    setSessions(sessionsResult.data.items);
    setAvatarDataUrl(avatarResult.data.avatarDataUrl);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const educator = useMemo(
    () => profile?.capabilities.find((entry) => entry.capability === 'educator'),
    [profile],
  );
  const currentWorkspace = profile?.workspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );
  const defaultAvatar = defaultAvatarForAccount(session.user.id);
  const effectiveAvatarUrl = avatarDataUrl ?? defaultAvatar.src;
  const accountRole = educator ? 'Педагог' : 'Участник';
  const canManageClasses = session.navigation.classroomManagement;

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
    const result = await api.updateAccountProfile(username, displayName, bio);
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

  async function saveAvatarFile(file: File): Promise<void> {
    if (busyAction) return;
    setBusyAction('avatar');
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await createAvatarDataUrl(file);
      const result = await api.updateAccountAvatar(dataUrl);
      if (!result.ok) {
        setError('Не удалось сохранить аватар.');
        return;
      }
      setAvatarDataUrl(result.data.avatarDataUrl);
      notifyProfileAvatarChanged(result.data.avatarDataUrl);
      setAvatarPickerOpen(false);
      setNotice('Аватар обновлён.');
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : 'Не удалось обработать файл.');
    } finally {
      setBusyAction(null);
    }
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = '';
    if (file) await saveAvatarFile(file);
  }

  async function chooseDefaultAvatar(avatar: DefaultAvatar): Promise<void> {
    try {
      await saveAvatarFile(await defaultAvatarFile(avatar));
    } catch (avatarError) {
      setError(avatarError instanceof Error ? avatarError.message : 'Не удалось выбрать аватар.');
    }
  }

  async function restoreDefaultAvatar(): Promise<void> {
    if (busyAction) return;
    setBusyAction('avatar');
    setError(null);
    setNotice(null);
    const result = await api.updateAccountAvatar(null);
    setBusyAction(null);
    if (!result.ok) {
      setError('Не удалось восстановить стандартный аватар.');
      return;
    }
    setAvatarDataUrl(null);
    notifyProfileAvatarChanged(null);
    setNotice('Восстановлен стандартный аватар ASA Lab.');
  }

  async function switchWorkspace(workspace: WorkspaceRef): Promise<void> {
    if (workspace.workspaceId === session.activeWorkspace.workspaceId) return;
    setBusyAction(`workspace:${workspace.workspaceId}`);
    setError(null);
    setNotice(null);
    const result = await api.switchWorkspace(workspace.workspaceId);
    if (!result.ok || !(await refreshSession())) {
      setError(result.ok ? 'Не удалось обновить пространство.' : result.error.message);
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
          ? 'Режим педагога доступен только совершеннолетнему владельцу аккаунта.'
          : result.error.message,
      );
      setBusyAction(null);
      return;
    }
    await Promise.all([refresh(), refreshSession()]);
    setBusyAction(null);
    setNotice('Режим педагога включён. Для создания классов выберите пространство школы.');
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
    setNotice('Выбранный вход завершён.');
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
        ? 'Других активных входов нет.'
        : `Завершено входов: ${result.data.revoked}.`,
    );
  }

  if (loading || !profile) {
    return (
      <main id="main-content" className="account-page" aria-busy="true" tabIndex={-1}>
        <div className="account-loading" role="status">
          Загружаем настройки…
        </div>
      </main>
    );
  }

  return (
    <main id="main-content" className="account-page account-settings-page" tabIndex={-1}>
      <header className="account-heading">
        <p className="portal-eyebrow">Настройки</p>
        <h1>Профиль и доступ</h1>
        <p>Здесь меняются только понятные пользователю данные и режимы аккаунта.</p>
      </header>

      <div className="account-settings-shell">
        <aside className="account-settings-navigation" aria-label="Разделы настроек">
          <strong>Настройки</strong>
          <nav>
            {SETTINGS_PANELS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={panel === item.id ? 'active' : undefined}
                aria-current={panel === item.id ? 'page' : undefined}
                onClick={() => {
                  setPanel(item.id);
                  setError(null);
                  setNotice(null);
                }}
              >
                <span aria-hidden="true">{item.icon}</span>
                {item.label}
              </button>
            ))}
          </nav>
        </aside>

        <div className="account-settings-content">
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

          {panel === 'profile' ? (
            <section className="account-settings-section" aria-labelledby="profile-settings-title">
              <div className="account-section-heading">
                <p className="account-card-kicker">Публичный профиль</p>
                <h2 id="profile-settings-title">Редактировать профиль</h2>
                <p>
                  При публикации проекта зрители увидят аватар, отображаемое имя, имя пользователя и
                  текст «О себе». Email и дата рождения остаются закрытыми.
                </p>
              </div>

              <div className="account-avatar-editor">
                <img src={effectiveAvatarUrl} alt="Текущий аватар" />
                <div>
                  <strong>Аватар</strong>
                  <span>Выберите образ ASA Lab или загрузите своё изображение.</span>
                  <div className="account-avatar-buttons">
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyAction !== null}
                      onClick={() => setAvatarPickerOpen(true)}
                    >
                      Выбрать аватар
                    </button>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyAction !== null}
                      onClick={() => avatarInput.current?.click()}
                    >
                      Загрузить свой
                    </button>
                    {avatarDataUrl ? (
                      <button
                        type="button"
                        className="account-inline-action"
                        disabled={busyAction !== null}
                        onClick={() => void restoreDefaultAvatar()}
                      >
                        Вернуть стандартный
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
              <input
                ref={avatarInput}
                className="portal-avatar-file-input"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Загрузить свой аватар"
                onChange={(event) => void uploadAvatar(event)}
              />

              <form className="account-profile-form" onSubmit={(event) => void saveProfile(event)}>
                <label>
                  Имя пользователя
                  <small>Короткое имя для профиля и входа, например @ivan.petrov.</small>
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
                  <small>Это имя увидят другие пользователи рядом с проектами и в классах.</small>
                  <input
                    value={displayName}
                    minLength={2}
                    maxLength={255}
                    autoComplete="name"
                    onChange={(event) => setDisplayName(event.target.value)}
                  />
                </label>
                <label>
                  Роль аккаунта
                  <small>
                    Роль определяется подтверждёнными возможностями и не меняется вручную.
                  </small>
                  <input value={accountRole} disabled />
                </label>
                <label>
                  О себе
                  <small>Расскажите о своих интересах, предметах или проектах.</small>
                  <textarea
                    value={bio}
                    maxLength={960}
                    rows={7}
                    placeholder="Например: преподаю технологию, собираю роботов и создаю учебные модели."
                    onChange={(event) => setBio(event.target.value)}
                  />
                  <span className="account-character-count">{bio.length} / 960</span>
                </label>
                <button
                  type="submit"
                  className="btn-primary account-action"
                  disabled={
                    busyAction !== null ||
                    (username === profile.username &&
                      displayName === profile.displayName &&
                      bio === (profile.bio ?? ''))
                  }
                >
                  {busyAction === 'profile' ? 'Сохраняем…' : 'Сохранить профиль'}
                </button>
              </form>
            </section>
          ) : null}

          {panel === 'access' ? (
            <section className="account-settings-section" aria-labelledby="access-settings-title">
              <div className="account-section-heading">
                <p className="account-card-kicker">Роли и возможности</p>
                <h2 id="access-settings-title">Кто и что может делать</h2>
                <p>Личный профиль, педагог и управление школой — это разные уровни доступа.</p>
              </div>

              <div className="account-access-list">
                <article className="ready">
                  <span>1</span>
                  <div>
                    <h3>Личный аккаунт</h3>
                    <p>Создание личных проектов и открытие раздела классов.</p>
                  </div>
                  <strong>Активен</strong>
                </article>
                <article className="ready">
                  <span>2</span>
                  <div>
                    <h3>Доступ к классам</h3>
                    <p>
                      Подтверждение email сейчас не требуется. Ученик входит по коду класса, а
                      педагог управляет классами в пространстве школы.
                    </p>
                  </div>
                  <strong>Письмо не требуется</strong>
                </article>
                <article className={educator ? 'ready' : ''}>
                  <span>3</span>
                  <div>
                    <h3>Педагог</h3>
                    <p>Совершеннолетний пользователь включает режим педагога в своём аккаунте.</p>
                  </div>
                  {educator ? (
                    <strong>Включён</strong>
                  ) : (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyAction !== null}
                      onClick={() => void attestEducator()}
                    >
                      Включить
                    </button>
                  )}
                </article>
                <article className={canManageClasses ? 'ready' : ''}>
                  <span>4</span>
                  <div>
                    <h3>Владелец класса</h3>
                    <p>
                      Для создания класса нужен режим педагога и пространство учебной организации.
                    </p>
                  </div>
                  <strong>{canManageClasses ? 'Можно создавать' : 'Нужна организация'}</strong>
                </article>
                <article className={currentWorkspace?.role === 'owner' ? 'ready' : ''}>
                  <span>5</span>
                  <div>
                    <h3>Администратор или представитель школы</h3>
                    <p>
                      Эту роль назначает владелец организации после проверки школы. Самостоятельно
                      выбрать её в профиле нельзя.
                    </p>
                  </div>
                  <strong>
                    {currentWorkspace?.role === 'owner' ? 'Владелец пространства' : 'Не назначено'}
                  </strong>
                </article>
              </div>
            </section>
          ) : null}

          {panel === 'workspaces' ? (
            <section
              className="account-settings-section"
              aria-labelledby="workspace-settings-title"
            >
              <div className="account-section-heading">
                <p className="account-card-kicker">Контекст работы</p>
                <h2 id="workspace-settings-title">Рабочие пространства</h2>
                <p>
                  Личное пространство хранит ваши проекты. Пространство школы открывает назначенные
                  организацией роли и классы.
                </p>
              </div>
              <ul className="account-workspace-list account-workspace-settings-list">
                {profile.workspaces.map((workspace) => {
                  const active = workspace.workspaceId === session.activeWorkspace.workspaceId;
                  return (
                    <li key={workspace.workspaceId} className={active ? 'active' : undefined}>
                      <div>
                        <strong>{workspace.title}</strong>
                        <span>{workspaceKindLabel(workspace.kind)}</span>
                        <small>{workspaceRoleLabel(workspace.role)}</small>
                      </div>
                      <button
                        type="button"
                        className={active ? 'account-current' : 'btn-secondary'}
                        disabled={active || busyAction !== null}
                        onClick={() => void switchWorkspace(workspace)}
                      >
                        {active
                          ? 'Используется сейчас'
                          : busyAction === `workspace:${workspace.workspaceId}`
                            ? 'Переключаем…'
                            : 'Переключиться'}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <p className="account-section-note">
                Роль в пространстве школы назначает организация. Смена пространства не выдаёт новых
                прав автоматически.
              </p>
            </section>
          ) : null}

          {panel === 'security' ? (
            <section className="account-settings-section" aria-labelledby="security-settings-title">
              <div className="account-section-heading">
                <p className="account-card-kicker">Учётная запись</p>
                <h2 id="security-settings-title">Email и активные входы</h2>
                <p>Закрытые данные и устройства, на которых открыт ASA Lab.</p>
              </div>

              <div className="account-private-facts">
                <div>
                  <span>Email</span>
                  <strong>{profile.email}</strong>
                  <small>
                    {verificationLabel(profile.emailVerificationState)}. Это не ограничивает проекты
                    и классы.
                  </small>
                </div>
                <div>
                  <span>Дата рождения</span>
                  <strong>{profile.birthDate}</strong>
                  <small>Не показывается другим пользователям</small>
                </div>
                <div>
                  <span>Страна</span>
                  <strong>{profile.country}</strong>
                  <small>Используется для правил аккаунта</small>
                </div>
              </div>

              <div className="account-sessions-heading">
                <h3>Активные входы</h3>
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
                          <span className="account-session-current">Текущий вход</span>
                        ) : null}
                      </strong>
                      <span>Последняя активность: {formatDate(entry.lastSeenAt)}</span>
                      <span>Выполнен вход: {formatDate(entry.createdAt)}</span>
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
          ) : null}
        </div>
      </div>

      {avatarPickerOpen ? (
        <div className="account-avatar-backdrop" role="presentation">
          <section
            className="account-avatar-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="avatar-dialog-title"
          >
            <header>
              <div>
                <p className="account-card-kicker">Библиотека ASA Lab</p>
                <h2 id="avatar-dialog-title">Выберите аватар</h2>
                <p>Стандартные изображения безопасны для профиля и классов.</p>
              </div>
              <button
                type="button"
                aria-label="Закрыть выбор аватара"
                onClick={() => setAvatarPickerOpen(false)}
              >
                <CloseIcon />
              </button>
            </header>
            <div className="account-avatar-grid" aria-label="Стандартные аватары">
              {DEFAULT_AVATARS.map((avatar) => (
                <button
                  type="button"
                  key={avatar.id}
                  className={
                    !avatarDataUrl && avatar.id === defaultAvatar.id ? 'selected' : undefined
                  }
                  aria-label={`Выбрать: ${avatar.label}`}
                  disabled={busyAction !== null}
                  onClick={() => void chooseDefaultAvatar(avatar)}
                >
                  <img src={avatar.src} alt="" loading="lazy" />
                </button>
              ))}
            </div>
            <footer>
              <button
                type="button"
                className="btn-secondary"
                disabled={busyAction !== null}
                onClick={() => avatarInput.current?.click()}
              >
                Загрузить своё изображение
              </button>
              <span>PNG, JPEG или WebP · до 8 МБ</span>
            </footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}
