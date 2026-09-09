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
  type AccountPasswordStatus,
  type AccountSession,
  type MaxAccountStatus,
  type MaxAuthConfig,
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
import { ClassesIcon, CloseIcon, InspectIcon, UserIcon } from '../electronics/workbench-icons';
import { deviceTimeZone, timeZoneLabel } from '../components/school-time';

const USERNAME_PATTERN = String.raw`[a-zA-Z0-9][a-zA-Z0-9._\-]*[a-zA-Z0-9]`;

type SettingsPanel =
  | 'profile'
  | 'school'
  | 'security'
  | 'interface'
  | 'notifications'
  | 'capabilities'
  | 'requests'
  | 'privacy';

const SETTINGS_PANELS: ReadonlyArray<{
  readonly id: SettingsPanel;
  readonly label: string;
  readonly icon: JSX.Element;
}> = [
  { id: 'profile', label: 'Профиль', icon: <UserIcon /> },
  { id: 'security', label: 'Вход и безопасность', icon: <InspectIcon /> },
  { id: 'interface', label: 'Интерфейс', icon: <InspectIcon /> },
  { id: 'notifications', label: 'Уведомления', icon: <InspectIcon /> },
  { id: 'capabilities', label: 'Возможности', icon: <ClassesIcon /> },
  { id: 'school', label: 'Мои доступы', icon: <ClassesIcon /> },
  { id: 'requests', label: 'Приглашения и запросы', icon: <ClassesIcon /> },
  { id: 'privacy', label: 'Данные и приватность', icon: <InspectIcon /> },
];

/** Sign-in history reads in the account's own zone, like everything else. */
function formatDate(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  }).format(new Date(value));
}

function schoolRoleLabel(role: string): string {
  if (role === 'school_admin' || role === 'owner') return 'Администратор школы';
  if (role === 'educator') return 'Педагог';
  if (role === 'student' || role === 'learner') return 'Ученик';
  return 'Участник школы';
}

function educatorEnabled(profile: AccountProfile | null): boolean {
  return Boolean(
    profile?.capabilities.some(
      (entry) =>
        entry.capability === 'educator' &&
        (entry.state === 'provisional' || entry.state === 'verified'),
    ),
  );
}

export function AccountPage({
  session,
  onSessionChanged,
  onOpenClasses,
  initialPanel = 'profile',
}: {
  session: SessionPayload;
  onSessionChanged: (session: SessionPayload) => void;
  onOpenClasses: () => void;
  initialPanel?: SettingsPanel;
}): JSX.Element {
  const [panel, setPanel] = useState<SettingsPanel>(initialPanel);
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [maxStatus, setMaxStatus] = useState<MaxAccountStatus | null>(null);
  const [maxConfig, setMaxConfig] = useState<MaxAuthConfig | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<AccountPasswordStatus | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const profileDirty = useRef(false);
  const profileLoaded = useRef(false);
  const loadGeneration = useRef(0);
  const [resourceErrors, setResourceErrors] = useState<string[]>([]);
  const [schoolTitle, setSchoolTitle] = useState('');
  const [classroomCount, setClassroomCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [maxPairingToken, setMaxPairingToken] = useState<string | null>(null);
  const [maxPairingUrl, setMaxPairingUrl] = useState<string | null>(null);
  const avatarInput = useRef<HTMLInputElement>(null);
  const deviceZone = useMemo(() => deviceTimeZone(), []);
  const [timeZone, setTimeZone] = useState(session.timeZone ?? deviceZone);
  /**
   * Every zone this browser knows, with the one in force kept in the list even
   * if the platform has never heard of it — a teacher must be able to see what
   * their account is set to before changing it.
   */
  const timeZoneOptions = useMemo(() => {
    let zones: string[];
    try {
      zones = [...(Intl.supportedValuesOf?.('timeZone') ?? [])];
    } catch {
      zones = [];
    }
    if (zones.length === 0) zones = [deviceZone, 'UTC'];
    const current = session.timeZone ?? deviceZone;
    return zones.includes(current) ? zones : [current, ...zones];
  }, [deviceZone, session.timeZone]);

  useEffect(() => {
    setTimeZone(session.timeZone ?? deviceZone);
  }, [deviceZone, session.timeZone]);

  useEffect(() => setPanel(initialPanel), [initialPanel]);

  const refresh = useCallback(async (): Promise<void> => {
    const generation = ++loadGeneration.current;
    setLoading(!profileLoaded.current);
    setError(null);
    setResourceErrors([]);
    // Each resource settles independently. A slow avatar or unavailable MAX must
    // not hold the profile behind a spinner, nor erase an unsaved profile draft.
    const current = () => generation === loadGeneration.current;
    const failed = (label: string) => {
      if (current()) setResourceErrors((items) => [...items, label]);
    };
    await Promise.all([
      (async () => {
        try {
          const result = await api.accountProfile();
          if (!current()) return;
          if (!result.ok) throw new Error('profile_unavailable');
          setProfile(result.data);
          if (!profileDirty.current) {
            setUsername(result.data.username);
            setDisplayName(result.data.displayName);
            setBio(result.data.bio ?? '');
          }
          profileLoaded.current = true;
        } catch {
          if (current()) setError('Не удалось загрузить профиль. Повторите попытку.');
        } finally {
          if (current()) setLoading(false);
        }
      })(),
      (async () => {
        try {
          const result = await api.listAccountSessions();
          if (!current()) return;
          if (!result.ok) throw new Error('sessions_unavailable');
          setSessions(result.data.items);
        } catch {
          failed('Активные входы');
        }
      })(),
      (async () => {
        try {
          const result = await api.accountAvatar();
          if (!current()) return;
          if (!result.ok) throw new Error('avatar_unavailable');
          setAvatarDataUrl(result.data.avatarDataUrl);
        } catch {
          failed('Аватар');
        }
      })(),
      (async () => {
        try {
          const result = await api.maxStatus();
          if (!current()) return;
          setMaxStatus(result.ok ? result.data : null);
          if (!result.ok) failed('Статус MAX');
        } catch {
          if (current()) setMaxStatus(null);
          failed('Статус MAX');
        }
      })(),
      (async () => {
        try {
          const result = await api.maxConfig();
          if (!current()) return;
          setMaxConfig(result.ok ? result.data : null);
          if (!result.ok) failed('Подключение MAX');
        } catch {
          if (current()) setMaxConfig(null);
          failed('Подключение MAX');
        }
      })(),
      (async () => {
        try {
          const result = await api.accountPasswordStatus();
          if (!current()) return;
          setPasswordStatus(result.ok ? result.data : null);
          if (!result.ok) failed('Пароль');
        } catch {
          if (current()) setPasswordStatus(null);
          failed('Пароль');
        }
      })(),
    ]);
  }, []);

  useEffect(() => {
    void refresh();
    return () => {
      loadGeneration.current += 1;
    };
  }, [refresh]);

  useEffect(() => {
    const protectDraft = (event: BeforeUnloadEvent) => {
      if (!profileDirty.current) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', protectDraft);
    return () => window.removeEventListener('beforeunload', protectDraft);
  }, []);

  useEffect(() => {
    if (!maxPairingToken) return;
    let active = true;
    let timer: number | null = null;
    const check = async (): Promise<void> => {
      const result = await api.completeMaxPairing(maxPairingToken);
      if (!active) return;
      if (result.ok && result.data.status === 'authenticated') {
        setMaxPairingToken(null);
        setBusyAction(null);
        onSessionChanged(result.data.session);
        setNotice('MAX подключён.');
        await refresh();
        return;
      }
      if (!result.ok && result.status !== 0) {
        setMaxPairingToken(null);
        setBusyAction(null);
        setError(
          result.error.code === 'max_pairing_expired'
            ? 'Время подтверждения истекло. Откройте MAX ещё раз.'
            : 'Не удалось подтвердить MAX.',
        );
        return;
      }
      timer = window.setTimeout(() => void check(), 6_000);
    };
    timer = window.setTimeout(() => void check(), 2_000);
    return () => {
      active = false;
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [maxPairingToken, onSessionChanged, refresh]);

  useEffect(() => {
    if (!session.navigation.classroomManagement) {
      setClassroomCount(null);
      return;
    }
    let cancelled = false;
    void api.listClassrooms().then((result) => {
      if (!cancelled) setClassroomCount(result.ok ? result.data.meta.total : null);
    });
    return () => {
      cancelled = true;
    };
  }, [session.activeWorkspace.workspaceId, session.navigation.classroomManagement]);

  const isEducator = educatorEnabled(profile);
  const schoolWorkspaces = useMemo(
    () => profile?.workspaces.filter((workspace) => workspace.kind === 'organization') ?? [],
    [profile],
  );
  const activeSchool = schoolWorkspaces.find(
    (workspace) => workspace.workspaceId === session.activeWorkspace.workspaceId,
  );
  const activeSchoolIsAdmin =
    activeSchool?.role === 'school_admin' || activeSchool?.role === 'owner';
  const defaultAvatar = defaultAvatarForAccount(session.user.id);
  const effectiveAvatarUrl = avatarDataUrl ?? defaultAvatar.src;

  async function refreshSession(): Promise<boolean> {
    const result = await api.me();
    if (!result.ok || !result.data.authenticated) {
      setError('Сессия изменилась. Обновите страницу и войдите снова.');
      return false;
    }
    onSessionChanged(result.data);
    return true;
  }

  /**
   * The teacher deciding, rather than the browser reporting: `false` means
   * overwrite whatever is stored, which is the point of the control.
   */
  async function saveTimeZone(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyAction('time-zone');
    setError(null);
    setNotice(null);
    const result = await api.setAccountTimeZone(timeZone, false);
    if (!result.ok) {
      setBusyAction(null);
      setError(result.error.message || 'Не удалось сохранить часовой пояс.');
      return;
    }
    await refreshSession();
    setBusyAction(null);
    setNotice(`Часовой пояс: ${timeZoneLabel(result.data.timeZone ?? timeZone)}.`);
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyAction('profile');
    setError(null);
    setNotice(null);

    const result = await api.updateAccountProfile(username, displayName, bio);
    if (!result.ok) {
      setBusyAction(null);
      setError(
        result.error.code === 'username_taken'
          ? 'Это имя пользователя уже занято.'
          : result.error.message,
      );
      return;
    }

    profileDirty.current = false;
    setProfile(result.data);
    setUsername(result.data.username);
    setDisplayName(result.data.displayName);
    setBio(result.data.bio ?? '');
    await refreshSession();
    setBusyAction(null);
    setNotice('Изменения сохранены.');
  }

  async function enableTeaching(): Promise<void> {
    setBusyAction('educator');
    setError(null);
    setNotice(null);
    try {
      const result = await api.selfAttestEducator();
      if (!result.ok) {
        setError(
          result.error.code === 'underage'
            ? 'Преподавание доступно совершеннолетним пользователям.'
            : result.error.message || 'Не удалось подключить преподавание.',
        );
        return;
      }
      await Promise.all([refresh(), refreshSession()]);
      setNotice('Преподавание подключено. Ваши личные проекты и обучение сохранены.');
    } finally {
      setBusyAction(null);
    }
  }

  async function enableAuthoring(): Promise<void> {
    setBusyAction('author');
    setError(null);
    setNotice(null);
    try {
      const result = await api.selfAttestContentAuthor();
      if (!result.ok) {
        setError(result.error.message);
        return;
      }
      await Promise.all([refresh(), refreshSession()]);
      setNotice('Создание материалов подключено. Доступ к ученикам не изменён.');
    } finally {
      setBusyAction(null);
    }
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
      setError('Не удалось вернуть стандартный аватар.');
      return;
    }
    setAvatarDataUrl(null);
    notifyProfileAvatarChanged(null);
    setNotice('Установлен стандартный аватар ASA Lab.');
  }

  async function switchSchool(workspace: WorkspaceRef): Promise<boolean> {
    if (workspace.workspaceId === session.activeWorkspace.workspaceId) return true;
    setBusyAction(`school:${workspace.workspaceId}`);
    setError(null);
    const result = await api.switchWorkspace(workspace.workspaceId);
    if (!result.ok || !(await refreshSession())) {
      setBusyAction(null);
      setError(result.ok ? 'Не удалось открыть школу.' : result.error.message);
      return false;
    }
    setBusyAction(null);
    return true;
  }

  async function openSchoolClasses(workspace: WorkspaceRef): Promise<void> {
    if (await switchSchool(workspace)) onOpenClasses();
  }

  async function createSchool(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setBusyAction('create-school');
    setError(null);
    setNotice(null);
    const result = await api.createSchool(schoolTitle);
    if (!result.ok) {
      setBusyAction(null);
      setError(
        result.error.code === 'educator_required'
          ? 'Сначала подключите преподавание в разделе «Возможности».'
          : result.error.message,
      );
      return;
    }
    const switched = await api.switchWorkspace(result.data.school.workspaceId);
    if (!switched.ok || !(await refreshSession())) {
      setBusyAction(null);
      setError('Школа создана, но её не удалось открыть. Обновите страницу.');
      return;
    }
    setSchoolTitle('');
    await refresh();
    setBusyAction(null);
    setNotice(`Школа «${result.data.school.title}» создана. Вы её администратор.`);
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

  async function unlinkMax(): Promise<void> {
    if (!window.confirm('Отключить MAX и завершить все входы, выполненные через MAX?')) return;
    setBusyAction('max-unlink');
    setError(null);
    const result = await api.unlinkMax();
    setBusyAction(null);
    if (!result.ok) {
      setError('Не удалось отключить MAX. Повторите попытку.');
      return;
    }
    setNotice(result.data.unlinked ? 'MAX отключён.' : 'MAX уже был отключён.');
    await refresh();
  }

  async function startMaxPairing(): Promise<void> {
    const popup = window.open('', '_blank');
    if (popup) popup.opener = null;
    setBusyAction('max-pairing');
    setError(null);
    setNotice(null);
    const result = await api.startMaxPairing('link');
    if (!result.ok) {
      popup?.close();
      setBusyAction(null);
      setError('Не удалось открыть MAX. Попробуйте ещё раз.');
      return;
    }
    setMaxPairingToken(result.data.pairingToken);
    setMaxPairingUrl(result.data.launchUrl);
    setNotice(
      'В MAX нажмите «Начать». Ничего вводить не нужно — привязка завершится автоматически.',
    );
    if (popup) popup.location.href = result.data.launchUrl;
  }

  async function changePassword(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword.length < 10) {
      setError('Новый пароль должен содержать не меньше 10 символов.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Повтор нового пароля не совпадает.');
      return;
    }
    setBusyAction('password');
    const result = await api.changeAccountPassword(currentPassword, newPassword);
    setBusyAction(null);
    if (!result.ok) {
      setError(
        result.error.code === 'current_password_invalid'
          ? 'Текущий пароль указан неверно.'
          : result.error.message || 'Не удалось изменить пароль.',
      );
      return;
    }
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setPasswordStatus({ configured: true, canResetWithoutCurrent: false });
    setNotice('Пароль изменён. Остальные входы завершены.');
    const sessionsResult = await api.listAccountSessions();
    if (sessionsResult.ok) setSessions(sessionsResult.data.items);
  }

  if (loading) {
    return (
      <main id="main-content" className="account-page" aria-busy="true" tabIndex={-1}>
        <div className="account-loading" role="status">
          Загружаем настройки…
        </div>
      </main>
    );
  }

  if (!profile)
    return (
      <main id="main-content" className="account-page" tabIndex={-1}>
        <h1>Ваш аккаунт</h1>
        <p role="alert">{error ?? 'Профиль временно недоступен.'}</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>
          Повторить
        </button>
      </main>
    );

  const maxManagedProfile = profile.email.endsWith('@users.asa.invalid');

  const profileChanged =
    username !== profile.username ||
    displayName !== profile.displayName ||
    bio !== (profile.bio ?? '');

  return (
    <main id="main-content" className="account-page account-settings-page" tabIndex={-1}>
      <header className="account-heading">
        <p className="portal-eyebrow">Настройки</p>
        <h1>Ваш аккаунт</h1>
      </header>

      <div className="account-settings-shell">
        <label className="account-mobile-panel-picker">
          Раздел настроек
          <select
            aria-label="Выбрать раздел настроек"
            value={panel}
            onChange={(event) => {
              setPanel(event.target.value as SettingsPanel);
              setError(null);
              setNotice(null);
            }}
          >
            {SETTINGS_PANELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
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
                  if (
                    profileChanged &&
                    !window.confirm(
                      'Оставить несохранённые изменения в черновике и перейти в другой раздел?',
                    )
                  )
                    return;
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
          {resourceErrors.length > 0 ? (
            <div className="account-message error" role="status">
              Не удалось обновить: {resourceErrors.join(', ')}. Остальные настройки доступны.
              <button
                type="button"
                className="account-inline-action"
                onClick={() => void refresh()}
              >
                Повторить загрузку
              </button>
            </div>
          ) : null}
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
                <p className="account-card-kicker">Профиль</p>
                <h2 id="profile-settings-title">Как вас видят другие</h2>
                <p>
                  Эти данные будут показаны рядом с вашими опубликованными проектами и в классах.
                  Email и дата рождения остаются закрытыми.
                </p>
              </div>

              <div className="account-avatar-editor">
                <img src={effectiveAvatarUrl} alt="Текущий аватар" />
                <div>
                  <strong>Аватар</strong>
                  <span>Выберите готовый аватар ASA Lab или загрузите своё изображение.</span>
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
                  <small>Короткое уникальное имя для профиля, например @ivan.petrov.</small>
                  <input
                    value={username}
                    minLength={3}
                    maxLength={40}
                    pattern={USERNAME_PATTERN}
                    autoComplete="username"
                    disabled={busyAction === 'profile'}
                    onChange={(event) => {
                      profileDirty.current = true;
                      setUsername(event.target.value);
                    }}
                  />
                </label>
                <label>
                  Отображаемое имя
                  <small>Это имя увидят другие пользователи в проектах и классах.</small>
                  <input
                    value={displayName}
                    minLength={2}
                    maxLength={255}
                    autoComplete="name"
                    disabled={busyAction === 'profile'}
                    onChange={(event) => {
                      profileDirty.current = true;
                      setDisplayName(event.target.value);
                    }}
                  />
                </label>
                <label>
                  О себе
                  <small>Расскажите о своих интересах, предметах или проектах.</small>
                  <textarea
                    value={bio}
                    maxLength={960}
                    rows={4}
                    placeholder="Например: преподаю технологию, собираю роботов и создаю учебные модели."
                    disabled={busyAction === 'profile'}
                    onChange={(event) => {
                      profileDirty.current = true;
                      setBio(event.target.value);
                    }}
                  />
                  <span className="account-character-count">{bio.length} / 960</span>
                </label>
                <button
                  type="submit"
                  className="btn-primary account-action"
                  disabled={busyAction !== null || !profileChanged}
                >
                  {busyAction === 'profile' ? 'Сохраняем…' : 'Сохранить изменения'}
                </button>
              </form>
            </section>
          ) : null}

          {panel === 'interface' ? (
            <section className="account-settings-section" aria-label="Интерфейс">
              <h2>Интерфейс</h2>
              <form
                className="account-profile-form account-time-zone"
                onSubmit={(event) => void saveTimeZone(event)}
              >
                <label>
                  Часовой пояс
                  <small>
                    В нём показываются все даты и время в классах: когда ученик заходил, когда
                    сохранял работу. Определён по вашему устройству — измените, если преподаёте в
                    другом поясе.
                  </small>
                  <select value={timeZone} onChange={(event) => setTimeZone(event.target.value)}>
                    {timeZoneOptions.map((zone) => (
                      <option key={zone} value={zone}>
                        {timeZoneLabel(zone)}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  className="btn-secondary account-action"
                  disabled={busyAction !== null || timeZone === (session.timeZone ?? deviceZone)}
                >
                  {busyAction === 'time-zone' ? 'Сохраняем…' : 'Сохранить часовой пояс'}
                </button>
              </form>
            </section>
          ) : null}

          {panel === 'capabilities' ? (
            <section className="account-settings-section" aria-label="Возможности">
              <h2>Возможности</h2>
              <article className="account-school-empty">
                <div>
                  <h3>Создавать материалы</h3>
                  <p>Личная библиотека учебных материалов. Без управления классами и учениками.</p>
                </div>
                {session.navigation.contentAuthoring ? (
                  <a className="btn-secondary" href="#/challenges">
                    Открыть материалы
                  </a>
                ) : (
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busyAction !== null}
                    onClick={() => void enableAuthoring()}
                  >
                    {busyAction === 'author' ? 'Подключаем…' : 'Подключить авторство'}
                  </button>
                )}
              </article>
              <article className="account-school-empty">
                <div>
                  <h3>Преподавание</h3>
                  <p>
                    {isEducator
                      ? 'Подключено. Личные проекты и обучение остаются доступны.'
                      : 'Создавайте классы и проводите занятия. Школа для подключения не требуется.'}
                  </p>
                </div>
                {isEducator ? (
                  <button type="button" className="btn-primary" onClick={onOpenClasses}>
                    Открыть классы
                  </button>
                ) : (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busyAction !== null}
                    onClick={() => void enableTeaching()}
                  >
                    {busyAction === 'educator' ? 'Подключаем…' : 'Подключить'}
                  </button>
                )}
              </article>
            </section>
          ) : null}

          {panel === 'notifications' ? (
            <section className="account-settings-section" aria-label="Уведомления">
              <h2>Уведомления</h2>
              <p>
                События классов и аккаунта показываются в меню ASA Lab. Настройка отдельных рассылок
                пока недоступна.
              </p>
              <p>Подключение MAX для входа само по себе не включает рассылку сообщений.</p>
            </section>
          ) : null}

          {panel === 'requests' ? (
            <section className="account-settings-section" aria-label="Приглашения и запросы">
              <h2>Приглашения и запросы</h2>
              <p>
                Откройте адрес приглашения, полученный от преподавателя. Общий список приглашений
                пока недоступен.
              </p>
              <a className="btn-secondary" href="#/attending">
                Моё обучение с преподавателем
              </a>
            </section>
          ) : null}

          {panel === 'privacy' ? (
            <section className="account-settings-section" aria-label="Данные и приватность">
              <h2>Данные и приватность</h2>
              <p>
                Email и дата рождения не показываются другим пользователям. Видимость проектов
                задаётся отдельно в каждом проекте.
              </p>
              <p>
                Самостоятельное удаление аккаунта и выгрузка архива пока недоступны. Для запроса
                обратитесь через справку.
              </p>
              <a className="btn-secondary" href="#/help">
                Справка
              </a>
            </section>
          ) : null}

          {panel === 'school' ? (
            <section className="account-settings-section" aria-labelledby="school-settings-title">
              <div className="account-section-heading">
                <h2 id="school-settings-title">Мои доступы</h2>
                <p>
                  Ваши рабочие пространства. Доступ к каждому классу и материалу проверяется
                  отдельно.
                </p>
              </div>
              <ul>
                {profile.workspaces.map((workspace) => (
                  <li key={workspace.workspaceId}>
                    {workspace.title} ·{' '}
                    {workspace.kind === 'personal'
                      ? 'Личное пространство'
                      : schoolRoleLabel(workspace.role)}
                  </li>
                ))}
              </ul>

              {!isEducator ? (
                <div className="account-school-empty">
                  <ClassesIcon />
                  <div>
                    <h3>Личное пространство</h3>
                    <p>Проекты и обучение доступны без подключения преподавания.</p>
                  </div>
                </div>
              ) : (
                <>
                  {activeSchool ? (
                    <div className="account-school-dashboard">
                      <div className="account-school-dashboard-heading">
                        <div>
                          <span>
                            {activeSchoolIsAdmin ? 'Администрирование школы' : 'Текущая школа'}
                          </span>
                          <h3>{activeSchool.title}</h3>
                        </div>
                        <strong>{schoolRoleLabel(activeSchool.role)}</strong>
                      </div>
                      <div className="account-school-metrics">
                        <div>
                          <strong>{classroomCount ?? '—'}</strong>
                          <span>Классы</span>
                        </div>
                        <div>
                          <strong>Активна</strong>
                          <span>Школа</span>
                        </div>
                        <div>
                          <strong>{activeSchoolIsAdmin ? 'Полный' : 'Педагог'}</strong>
                          <span>
                            {activeSchoolIsAdmin ? 'Доступ администратора' : 'Роль в школе'}
                          </span>
                        </div>
                      </div>
                      <button type="button" className="btn-primary" onClick={onOpenClasses}>
                        Управлять классами
                      </button>
                    </div>
                  ) : null}

                  {schoolWorkspaces.length > 0 ? (
                    <div className="account-school-list">
                      <h3>Мои школы</h3>
                      {schoolWorkspaces.map((workspace) => {
                        const active = workspace.workspaceId === activeSchool?.workspaceId;
                        return (
                          <article key={workspace.workspaceId} className={active ? 'active' : ''}>
                            <div>
                              <strong>{workspace.title}</strong>
                              <span>{schoolRoleLabel(workspace.role)}</span>
                            </div>
                            <button
                              type="button"
                              className={active ? 'btn-primary' : 'btn-secondary'}
                              disabled={busyAction !== null}
                              onClick={() => void openSchoolClasses(workspace)}
                            >
                              {busyAction === `school:${workspace.workspaceId}`
                                ? 'Открываем…'
                                : 'Открыть классы'}
                            </button>
                          </article>
                        );
                      })}
                    </div>
                  ) : null}

                  <form
                    className="account-create-school"
                    onSubmit={(event) => void createSchool(event)}
                  >
                    <div>
                      <h3>
                        {schoolWorkspaces.length > 0 ? 'Создать ещё одну школу' : 'Создать школу'}
                      </h3>
                      <p>Школа появится в списке сразу после создания.</p>
                    </div>
                    <label>
                      Название школы
                      <input
                        value={schoolTitle}
                        minLength={2}
                        maxLength={120}
                        required
                        placeholder="Например: Школа №1580"
                        onChange={(event) => setSchoolTitle(event.target.value)}
                      />
                    </label>
                    <button
                      type="submit"
                      className="btn-primary"
                      disabled={busyAction !== null || schoolTitle.trim().length < 2}
                    >
                      {busyAction === 'create-school' ? 'Создаём…' : 'Создать школу'}
                    </button>
                  </form>
                </>
              )}
            </section>
          ) : null}

          {panel === 'security' ? (
            <section className="account-settings-section" aria-labelledby="security-settings-title">
              <div className="account-section-heading">
                <p className="account-card-kicker">Учётная запись</p>
                <h2 id="security-settings-title">Вход и безопасность</h2>
                <p>Пароль, MAX, закрытые данные и устройства, на которых открыт ASA Lab.</p>
              </div>

              <div className="account-private-facts">
                <div>
                  <span>Email</span>
                  <strong>
                    {maxManagedProfile ? 'Не требуется — вход через MAX' : profile.email}
                  </strong>
                  <small>
                    {maxManagedProfile
                      ? 'Не нужен для входа через MAX'
                      : 'Контактный адрес аккаунта'}
                  </small>
                </div>
                <div>
                  <span>Дата рождения</span>
                  <strong>{maxManagedProfile ? 'Не указана' : profile.birthDate}</strong>
                  <small>
                    {maxManagedProfile
                      ? 'Не запрашивается при входе через MAX'
                      : 'Не показывается другим пользователям'}
                  </small>
                </div>
                <div>
                  <span>Страна</span>
                  <strong>{profile.country}</strong>
                  <small>Используется для правил аккаунта</small>
                </div>
              </div>

              <div className="account-private-facts">
                <div>
                  <span>MAX</span>
                  <strong>
                    {maxStatus === null
                      ? 'Статус недоступен'
                      : maxStatus.linked
                        ? 'Подтверждён'
                        : 'Не подключён'}
                  </strong>
                  <small>
                    {maxStatus?.verifiedAt
                      ? `Связан ${formatDate(maxStatus.verifiedAt, timeZone)}`
                      : 'Для подтверждения аккаунта и входа без пароля'}
                  </small>
                  {maxStatus?.linked ? (
                    <button
                      type="button"
                      className="account-revoke"
                      disabled={busyAction !== null}
                      onClick={() => void unlinkMax()}
                    >
                      {busyAction === 'max-unlink' ? 'Отключаем…' : 'Отключить MAX'}
                    </button>
                  ) : null}
                </div>
                {maxStatus && !maxStatus.linked && maxConfig?.enabled && maxConfig.launchUrl ? (
                  <div>
                    <span>Подтверждение</span>
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={busyAction !== null}
                      onClick={() => void startMaxPairing()}
                    >
                      {maxPairingToken ? 'Ждём MAX…' : 'Подключить MAX'}
                    </button>
                    <small>Откройте бота MAX и нажмите «Начать»</small>
                    {maxPairingUrl && maxPairingToken ? (
                      <a href={maxPairingUrl} target="_blank" rel="noreferrer">
                        Открыть MAX ещё раз
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>

              {passwordStatus ? (
                <form
                  className="account-password-form"
                  onSubmit={(event) => void changePassword(event)}
                >
                  <div className="account-section-heading">
                    <h3>{passwordStatus?.configured ? 'Изменить пароль' : 'Создать пароль'}</h3>
                    <p>
                      {passwordStatus?.canResetWithoutCurrent
                        ? 'Вы вошли через MAX, поэтому текущий пароль не требуется.'
                        : 'После изменения все остальные активные входы будут завершены.'}
                    </p>
                  </div>
                  {!passwordStatus?.canResetWithoutCurrent ? (
                    <label>
                      Текущий пароль
                      <input
                        type="password"
                        autoComplete="current-password"
                        value={currentPassword}
                        onChange={(event) => setCurrentPassword(event.target.value)}
                      />
                    </label>
                  ) : null}
                  <label>
                    Новый пароль
                    <input
                      type="password"
                      minLength={10}
                      maxLength={200}
                      autoComplete="new-password"
                      value={newPassword}
                      onChange={(event) => setNewPassword(event.target.value)}
                    />
                  </label>
                  <label>
                    Повторите новый пароль
                    <input
                      type="password"
                      minLength={10}
                      maxLength={200}
                      autoComplete="new-password"
                      value={confirmPassword}
                      onChange={(event) => setConfirmPassword(event.target.value)}
                    />
                  </label>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={
                      busyAction !== null ||
                      newPassword.length < 10 ||
                      newPassword !== confirmPassword ||
                      (!passwordStatus?.canResetWithoutCurrent && currentPassword.length === 0)
                    }
                  >
                    {busyAction === 'password' ? 'Сохраняем…' : 'Сохранить пароль'}
                  </button>
                </form>
              ) : (
                <p role="status">
                  Состояние пароля временно недоступно. Повторите загрузку настроек.
                </p>
              )}

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
                      <span>Последняя активность: {formatDate(entry.lastSeenAt, timeZone)}</span>
                      <span>Выполнен вход: {formatDate(entry.createdAt, timeZone)}</span>
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
                <p>Готовые изображения или собственная фотография.</p>
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
