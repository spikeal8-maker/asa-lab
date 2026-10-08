import { LearningInbox } from '../components/LearningInbox';
import { PresentationControls, usePresentation } from '../components/PresentationPreferences';
import { LearningNotificationPreferences } from '../components/LearningNotificationPreferences';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
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
import { requestAvatarChooser } from '../components/avatar-chooser-events';
import { InfoHint } from '../components/InfoHint';
import {
  defaultAvatarForAccount,
  PROFILE_AVATAR_CHANGED_EVENT,
} from '../creator-portal/default-avatars';
import '../components/seat-avatar.css';
import { deviceTimeZone, timeZoneLabel } from '../components/school-time';
import {
  requestSettingsNavigation,
  pushSettingsAwareLocation,
  settingsPanelFromLocation,
  useSettingsDraftGuard,
  type SettingsPanel,
  type SettingsDraft,
} from '../components/settings-navigation';

const USERNAME_PATTERN = String.raw`[a-zA-Z0-9][a-zA-Z0-9._\-]*[a-zA-Z0-9]`;

const SETTINGS_PANELS: ReadonlyArray<{
  readonly id: SettingsPanel;
  readonly label: string;
}> = [
  { id: 'profile', label: 'Профиль' },
  { id: 'interface', label: 'Интерфейс' },
  { id: 'notifications', label: 'Уведомления' },
  { id: 'security', label: 'Безопасность' },
  { id: 'capabilities', label: 'Материалы и классы' },
  { id: 'school', label: 'Школы' },
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
  const [panel, setPanel] = useState<SettingsPanel>(() =>
    window.location.hash.startsWith('#/account/') ? settingsPanelFromLocation() : initialPanel,
  );
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [maxStatus, setMaxStatus] = useState<MaxAccountStatus | null>(null);
  const [maxConfig, setMaxConfig] = useState<MaxAuthConfig | null>(null);
  const [passwordStatus, setPasswordStatus] = useState<AccountPasswordStatus | null>(null);
  const [sessions, setSessions] = useState<AccountSession[]>([]);
  const [avatarDataUrl, setAvatarDataUrl] = useState<string | null>(null);
  const avatarVersion = useRef(0);
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [bio, setBio] = useState('');
  const profileDirty = useRef(false);
  const profileLoaded = useRef(false);
  const loadGeneration = useRef(0);
  const [resourceErrors, setResourceErrors] = useState<string[]>([]);
  const [schoolTitle, setSchoolTitle] = useState('');
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [maxPairingToken, setMaxPairingToken] = useState<string | null>(null);
  const [maxPairingUrl, setMaxPairingUrl] = useState<string | null>(null);
  const notificationControl = useRef<SettingsDraft | null>(null);
  const [notificationsDirty, setNotificationsDirty] = useState(false);
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
    if (!zones.includes('UTC')) zones = ['UTC', ...zones];
    const current = session.timeZone ?? deviceZone;
    return zones.includes(current) ? zones : [current, ...zones];
  }, [deviceZone, session.timeZone]);

  useEffect(() => {
    setTimeZone(session.timeZone ?? deviceZone);
  }, [deviceZone, session.timeZone]);

  useEffect(() => {
    if (window.location.hash.startsWith('#/account/')) return;
    setPanel(initialPanel);
  }, [initialPanel]);
  useEffect(() => {
    const sync = () => {
      if (window.location.hash.startsWith('#/account')) setPanel(settingsPanelFromLocation());
    };
    window.addEventListener('settings-route', sync);
    return () => window.removeEventListener('settings-route', sync);
  }, []);

  useEffect(() => {
    const sync = (event: Event) => {
      avatarVersion.current += 1;
      setAvatarDataUrl((event as CustomEvent<string | null>).detail);
    };
    window.addEventListener(PROFILE_AVATAR_CHANGED_EVENT, sync);
    return () => window.removeEventListener(PROFILE_AVATAR_CHANGED_EVENT, sync);
  }, []);

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
          const version = avatarVersion.current;
          const result = await api.accountAvatar();
          if (!current() || version !== avatarVersion.current) return;
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

  const isEducator = educatorEnabled(profile);
  const schoolWorkspaces = useMemo(
    () => profile?.workspaces.filter((workspace) => workspace.kind === 'organization') ?? [],
    [profile],
  );
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
  async function saveTimeZone(event?: FormEvent<HTMLFormElement>): Promise<boolean> {
    event?.preventDefault();
    setBusyAction('time-zone');
    setError(null);
    setNotice(null);
    const result = await api.setAccountTimeZone(timeZone, false);
    if (!result.ok) {
      setBusyAction(null);
      setError(result.error.message || 'Не удалось сохранить часовой пояс.');
      return false;
    }
    await refreshSession();
    setBusyAction(null);
    setNotice(`Часовой пояс: ${timeZoneLabel(result.data.timeZone ?? timeZone)}.`);
    return true;
  }

  async function saveProfile(event?: FormEvent<HTMLFormElement>): Promise<boolean> {
    event?.preventDefault();
    if (
      !new RegExp(`^${USERNAME_PATTERN}$`).test(username) ||
      username.length < 3 ||
      username.length > 40 ||
      displayName.trim().length < 2 ||
      displayName.length > 255 ||
      bio.length > 960
    ) {
      setError('Проверьте имя пользователя и отображаемое имя в профиле.');
      return false;
    }
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
      return false;
    }

    profileDirty.current = false;
    setProfile(result.data);
    setUsername(result.data.username);
    setDisplayName(result.data.displayName);
    setBio(result.data.bio ?? '');
    await refreshSession();
    setBusyAction(null);
    setNotice('Изменения сохранены.');
    return true;
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
          ? 'Сначала подключите преподавание в разделе «Материалы и классы».'
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

  const profileChanged =
    profile !== null &&
    (username !== profile.username ||
      displayName !== profile.displayName ||
      bio !== (profile.bio ?? ''));
  profileDirty.current = profileChanged;
  function discardProfile() {
    if (!profile) return;
    profileDirty.current = false;
    setUsername(profile.username);
    setDisplayName(profile.displayName);
    setBio(profile.bio ?? '');
    setError(null);
    setNotice(null);
  }
  const presentation = usePresentation();
  const draftDialog = useSettingsDraftGuard([
    presentation,
    {
      dirty: profileChanged,
      save: () => (busyAction === null ? saveProfile() : Promise.resolve(false)),
      discard: discardProfile,
    },
    {
      dirty: timeZone !== (session.timeZone ?? deviceZone),
      save: () => (busyAction === null ? saveTimeZone() : Promise.resolve(false)),
      discard: () => setTimeZone(session.timeZone ?? deviceZone),
    },
    {
      dirty: notificationsDirty,
      save: async () => (await notificationControl.current?.save()) ?? false,
      discard: () => notificationControl.current?.discard(),
    },
  ]);
  function changePanel(next: SettingsPanel) {
    if (next === panel) return;
    requestSettingsNavigation(() => {
      setPanel(next);
      setError(null);
      setNotice(null);
      pushSettingsAwareLocation(`#/account/${next}`);
      window.dispatchEvent(new Event('settings-route'));
    });
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
        <h1>Настройки</h1>
        <p role="alert">{error ?? 'Профиль временно недоступен.'}</p>
        <button type="button" className="btn-secondary" onClick={() => void refresh()}>
          Повторить
        </button>
      </main>
    );

  const maxManagedProfile = profile.email.endsWith('@users.asa.invalid');
  // Preserve old deep links and their guarded history entries without keeping
  // informational pages as separate navigation destinations.
  const selectedPanel = panel === 'privacy' ? 'security' : panel === 'requests' ? 'school' : panel;

  return (
    <main id="main-content" className="account-page account-settings-page" tabIndex={-1}>
      <header className="account-heading">
        <h1>Настройки</h1>
      </header>

      <div className="account-settings-shell">
        <label className="account-mobile-panel-picker">
          <select
            aria-label="Выбрать раздел настроек"
            value={selectedPanel}
            onChange={(event) => changePanel(event.target.value as SettingsPanel)}
          >
            {SETTINGS_PANELS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <aside className="account-settings-navigation" aria-label="Разделы настроек">
          <nav>
            {SETTINGS_PANELS.map((item) => (
              <button
                key={item.id}
                type="button"
                className={selectedPanel === item.id ? 'active' : undefined}
                aria-current={selectedPanel === item.id ? 'page' : undefined}
                onClick={() => changePanel(item.id)}
              >
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
          {error && panel !== 'interface' ? (
            <p className="account-message error" role="alert">
              {error}
            </p>
          ) : null}
          {notice && panel !== 'interface' ? (
            <p className="account-message success" role="status">
              {notice}
            </p>
          ) : null}

          {panel === 'profile' ? (
            <section className="account-settings-section" aria-labelledby="profile-settings-title">
              <h2 id="profile-settings-title" className="account-panel-title sr-only">
                Профиль
              </h2>

              <div className="account-avatar-editor">
                <button
                  type="button"
                  className="account-avatar-preview-button"
                  aria-label="Выбрать аватар"
                  onClick={() => requestAvatarChooser({ kind: 'account', id: session.user.id })}
                >
                  <img src={effectiveAvatarUrl} alt="Аватар" />
                </button>
                <InfoHint label="Информация об аватаре">
                  Выберите изображение и подтвердите «Использовать». Можно загрузить PNG, JPEG или
                  WebP до 8 МБ. Изображение обрезается по центру до квадрата. Поля профиля
                  сохраняются отдельно.
                </InfoHint>
              </div>

              <form
                className="account-profile-form account-profile-fields"
                onSubmit={(event) => void saveProfile(event)}
              >
                <div className="account-field">
                  <div className="account-field-heading">
                    <label htmlFor="account-username">Имя пользователя</label>
                    <InfoHint label="О логине профиля">
                      Уникальное имя от 3 до 40 символов: латинские буквы, цифры, точка, дефис и
                      подчёркивание. Сохраняется вместе с полями профиля.
                    </InfoHint>
                  </div>
                  <input
                    id="account-username"
                    value={username}
                    required
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
                </div>
                <div className="account-field">
                  <div className="account-field-heading">
                    <label htmlFor="account-display-name">Отображаемое имя</label>
                    <InfoHint label="О публичном имени">
                      Это имя видно рядом с опубликованными проектами и в классах. От 2 до 255
                      символов. Email и дата рождения остаются закрытыми.
                    </InfoHint>
                  </div>
                  <input
                    id="account-display-name"
                    value={displayName}
                    required
                    minLength={2}
                    maxLength={255}
                    autoComplete="name"
                    disabled={busyAction === 'profile'}
                    onChange={(event) => {
                      profileDirty.current = true;
                      setDisplayName(event.target.value);
                    }}
                  />
                </div>
                <div className="account-field account-field-wide">
                  <div className="account-field-heading">
                    <label htmlFor="account-bio">О себе</label>
                    <InfoHint label="О личном описании">
                      Короткое описание интересов и занятий, до 960 символов. Оно видно другим
                      пользователям после сохранения профиля.
                    </InfoHint>
                  </div>
                  <textarea
                    id="account-bio"
                    value={bio}
                    maxLength={960}
                    rows={3}
                    placeholder="Например: преподаю технологию, собираю роботов и создаю учебные модели."
                    disabled={busyAction === 'profile'}
                    onChange={(event) => {
                      profileDirty.current = true;
                      setBio(event.target.value);
                    }}
                  />
                  <span className="account-character-count">{bio.length} / 960</span>
                </div>
                <div className="account-form-actions">
                  <button
                    type="submit"
                    className="btn-primary account-action"
                    disabled={
                      busyAction !== null ||
                      !profileChanged ||
                      !new RegExp(`^${USERNAME_PATTERN}$`).test(username) ||
                      username.length < 3 ||
                      displayName.trim().length < 2
                    }
                  >
                    {busyAction === 'profile' ? 'Сохраняем…' : 'Сохранить изменения'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busyAction !== null || !profileChanged}
                    onClick={discardProfile}
                  >
                    Отменить
                  </button>
                </div>
              </form>
            </section>
          ) : null}

          {panel === 'interface' ? (
            <section className="account-settings-section" aria-label="Интерфейс">
              <h2 className="account-panel-title sr-only">Интерфейс</h2>
              <PresentationControls />
              <form
                className="account-profile-form account-time-zone"
                aria-label="Часовой пояс"
                onSubmit={(event) => void saveTimeZone(event)}
              >
                <div className="account-field">
                  <div className="account-field-heading">
                    <label htmlFor="account-time-zone">Часовой пояс</label>
                    <InfoHint label="Информация о часовом поясе">
                      Меняет отображение дат и времени для вас. Время занятий и сроки не
                      переносятся. Сохраняется отдельно от вида интерфейса кнопкой «Сохранить» ниже.
                    </InfoHint>
                  </div>
                  <select
                    id="account-time-zone"
                    value={timeZone}
                    disabled={busyAction !== null}
                    onChange={(event) => setTimeZone(event.target.value)}
                  >
                    {timeZoneOptions.map((zone) => (
                      <option key={zone} value={zone}>
                        {timeZoneLabel(zone)}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="account-hint">
                  Пример времени: {formatDate(new Date().toISOString(), timeZone)}
                </p>
                <div className="account-form-actions">
                  <button
                    type="submit"
                    className="btn-primary"
                    aria-label="Сохранить часовой пояс"
                    disabled={busyAction !== null || timeZone === (session.timeZone ?? deviceZone)}
                  >
                    {busyAction === 'time-zone' ? 'Сохраняем…' : 'Сохранить'}
                  </button>
                  <button
                    type="button"
                    className="btn-secondary"
                    aria-label="Отменить изменения часового пояса"
                    disabled={busyAction !== null || timeZone === (session.timeZone ?? deviceZone)}
                    onClick={() => setTimeZone(session.timeZone ?? deviceZone)}
                  >
                    Отменить
                  </button>
                </div>
              </form>
              <div className="account-interface-feedback">
                {error ? (
                  <p className="account-message error" role="alert">
                    {error}
                  </p>
                ) : null}
                {notice ? (
                  <p className="account-save-status" role="status">
                    {notice}
                  </p>
                ) : null}
              </div>
            </section>
          ) : null}

          {panel === 'capabilities' ? (
            <section className="account-settings-section" aria-label="Материалы и классы">
              <h2 className="account-panel-title sr-only">Материалы и классы</h2>
              <article className="account-capability-card">
                <div>
                  <div className="account-field-heading">
                    <h3>Материалы</h3>
                    <InfoHint label="Информация о материалах">
                      Подключает создание учебных материалов в личной библиотеке. Не даёт управление
                      классами и учениками. Ваши проекты и обучение сохраняются.
                    </InfoHint>
                  </div>
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
              <article className="account-capability-card">
                <div>
                  <div className="account-field-heading">
                    <h3>Классы</h3>
                    <InfoHint label="Информация о преподавании">
                      Подключает создание классов и проведение занятий. Школа не обязательна.
                      Создание материалов подключается отдельно; личные проекты и обучение
                      сохраняются.
                    </InfoHint>
                  </div>
                  {isEducator ? <span className="account-hint">Подключено</span> : null}
                </div>
                {isEducator && session.navigation.classes ? (
                  <button type="button" className="btn-primary" onClick={onOpenClasses}>
                    Открыть классы
                  </button>
                ) : !isEducator ? (
                  <button
                    type="button"
                    className="btn-primary"
                    disabled={busyAction !== null}
                    onClick={() => void enableTeaching()}
                  >
                    {busyAction === 'educator' ? 'Подключаем…' : 'Подключить'}
                  </button>
                ) : (
                  <p>Управление классами недоступно в текущем пространстве.</p>
                )}
              </article>
            </section>
          ) : null}

          <div hidden={panel !== 'notifications'}>
            <section className="account-settings-section" aria-label="Уведомления">
              <h2 className="account-panel-title sr-only">Уведомления</h2>
              {selectedPanel === 'notifications' ? (
                <LearningInbox
                  key={`account:${session.user.id}:${session.activeWorkspace.workspaceId}`}
                />
              ) : null}
              <LearningNotificationPreferences
                teaching={
                  session.navigation.classroomManagement ||
                  session.actions?.includes('class.read.staff') === true
                }
                controlRef={notificationControl}
                onDirtyChange={setNotificationsDirty}
              />
            </section>
          </div>

          {selectedPanel === 'school' ? (
            <section className="account-settings-section" aria-labelledby="school-settings-title">
              <h2 id="school-settings-title" className="account-panel-title sr-only">
                Школы
              </h2>
              {schoolWorkspaces.length ? (
                <ul className="account-school-memberships">
                  {schoolWorkspaces.map((workspace) => (
                    <li key={workspace.workspaceId}>
                      <div>
                        <strong>{workspace.title}</strong>
                        <span>{schoolRoleLabel(workspace.role)}</span>
                      </div>
                      {isEducator ? (
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={busyAction !== null}
                          onClick={() =>
                            requestSettingsNavigation(() => void openSchoolClasses(workspace))
                          }
                        >
                          {busyAction === `school:${workspace.workspaceId}`
                            ? 'Открываем…'
                            : 'Открыть классы'}
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="account-hint">Вы не состоите в школе.</p>
              )}
              {isEducator ? (
                <form
                  className="account-create-school"
                  onSubmit={(event) => void createSchool(event)}
                >
                  <div className="account-field">
                    <div className="account-field-heading">
                      <label htmlFor="new-school-title">Название школы</label>
                      <InfoHint label="Информация о создании школы">
                        Создайте школу, если нужно общее пространство для преподавателей и классов.
                        Вы станете её администратором. Личный аккаунт и преподавание доступны без
                        школы.
                      </InfoHint>
                    </div>
                    <input
                      id="new-school-title"
                      value={schoolTitle}
                      minLength={2}
                      maxLength={120}
                      required
                      placeholder="Например: Школа №1580"
                      onChange={(event) => setSchoolTitle(event.target.value)}
                    />
                  </div>
                  <button
                    type="submit"
                    className="btn-primary"
                    disabled={busyAction !== null || schoolTitle.trim().length < 2}
                  >
                    {busyAction === 'create-school' ? 'Создаём…' : 'Создать школу'}
                  </button>
                </form>
              ) : null}
              <div className="account-invitation-row">
                <div className="account-field-heading">
                  <span>Приглашения</span>
                  <InfoHint label="Информация о приглашениях">
                    Для вступления в класс откройте адрес приглашения, полученный от преподавателя.
                    Ваши занятия доступны по ссылке «Моё обучение с преподавателем».
                  </InfoHint>
                </div>
                <a className="btn-secondary" href="#/attending">
                  Моё обучение с преподавателем
                </a>
              </div>
            </section>
          ) : null}

          {selectedPanel === 'security' ? (
            <section className="account-settings-section" aria-labelledby="security-settings-title">
              <h2 id="security-settings-title" className="account-panel-title sr-only">
                Безопасность
              </h2>

              <div className="account-private-facts">
                <div>
                  <div className="account-field-heading">
                    <span>Email</span>
                    <InfoHint label="Информация: Email">
                      Контактный адрес закрыт от других пользователей. Здесь он доступен только для
                      просмотра.
                    </InfoHint>
                  </div>
                  <strong>
                    {maxManagedProfile ? 'Не требуется — вход через MAX' : profile.email}
                  </strong>
                </div>
                <div>
                  <div className="account-field-heading">
                    <span>Дата рождения</span>
                    <InfoHint label="Информация: Дата рождения">
                      Дата рождения закрыта от других пользователей. Это поле не публикуется в
                      проектах и классах.
                    </InfoHint>
                  </div>
                  <strong>{maxManagedProfile ? 'Не указана' : profile.birthDate}</strong>
                </div>
                <div>
                  <div className="account-field-heading">
                    <span>Страна</span>
                    <InfoHint label="Информация: Страна">
                      Страна из данных аккаунта доступна здесь только для просмотра. Часовой пояс
                      выбирается отдельно в разделе «Интерфейс».
                    </InfoHint>
                  </div>
                  <strong>{profile.country}</strong>
                </div>

                <div>
                  <div className="account-field-heading">
                    <span>MAX</span>
                    <InfoHint label="Информация о MAX">
                      Подключённый MAX используется для подтверждения аккаунта и входа без пароля.
                      Действие подключения доступно, когда MAX настроен для этого портала.
                    </InfoHint>
                  </div>
                  <strong>
                    {maxStatus === null
                      ? 'Статус недоступен'
                      : maxStatus.linked
                        ? 'Подтверждён'
                        : 'Не подключён'}
                  </strong>
                  {maxStatus?.verifiedAt ? (
                    <small>Связан {formatDate(maxStatus.verifiedAt, timeZone)}</small>
                  ) : null}
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
                  {maxStatus && !maxStatus.linked && maxConfig?.enabled && maxConfig.launchUrl ? (
                    <div className="account-max-connect">
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
              </div>

              {passwordStatus ? (
                <form
                  className="account-password-form"
                  onSubmit={(event) => void changePassword(event)}
                >
                  <div className="account-field-heading account-field-wide">
                    <h3>{passwordStatus?.configured ? 'Изменить пароль' : 'Создать пароль'}</h3>
                    <InfoHint label="Информация о пароле">
                      Не меньше 10 символов. После сохранения остальные активные входы будут
                      завершены.
                      {passwordStatus?.canResetWithoutCurrent
                        ? ' Вход через MAX подтверждён: текущий пароль не требуется.'
                        : ' Укажите текущий пароль, чтобы подтвердить изменение.'}
                    </InfoHint>
                  </div>
                  {!passwordStatus?.canResetWithoutCurrent ? (
                    <label className="account-field-wide">
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

      {draftDialog}
    </main>
  );
}
