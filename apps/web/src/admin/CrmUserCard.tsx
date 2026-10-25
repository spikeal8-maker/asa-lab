import { CrmEmailChange } from './CrmEmailChange';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  crmApi,
  type CrmSubject,
  type CrmProfile,
  type CrmContentPage,
  type CrmDocument,
  type CrmContentCategory,
} from './crm-user-api';
import './crm-user-card.css';
const roleLabel: Record<string, string> = {
  creator: 'Автор',
  educator: 'Преподаватель',
  registered_student: 'Учащийся',
  guardian: 'Представитель',
  platform_admin: 'Администратор платформы',
};
const stateLabel: Record<string, string> = {
  verified: 'Подтверждено',
  suspended: 'Приостановлено',
  revoked: 'Отозвано',
  provisional: 'Предварительно',
  active: 'Действует',
  issued: 'Выдано',
  removed: 'Удалено',
  closed: 'Закрыто',
  archived: 'В архиве',
  deleted: 'Удалено',
  owner: 'Владелец класса',
  co_teacher: 'Совместное преподавание',
};
export function CrmUserCardLauncher(
  props: CrmSubject & { onAccessDenied: () => void; onChanged?: () => void },
) {
  const [open, setOpen] = useState(false);
  return (
    <div className="admin-user-history">
      <button
        type="button"
        className="btn-secondary"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {open ? 'Закрыть карточку пользователя' : 'Полная карточка пользователя'}
      </button>
      {open ? <CrmUserCard {...props} /> : null}
    </div>
  );
}
export function CrmUserCard(
  props: CrmSubject & { onAccessDenied: () => void; onChanged?: () => void },
) {
  return (
    <CrmCardBody
      key={`${props.kind}:${props.targetId}:${props.classroomId ?? 'platform'}`}
      {...props}
    />
  );
}
export function CrmProjectReader({
  subject,
  projectId,
  versionId,
  onAccessDenied,
}: {
  subject: CrmSubject;
  projectId: string;
  versionId?: string | undefined;
  onAccessDenied: () => void;
}) {
  const [value, setValue] = useState<CrmDocument | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(
    () => () => {
      sequence.current++;
    },
    [],
  );
  async function read() {
    const request = ++sequence.current;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.project(subject, projectId, versionId);
    if (request !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setValue(null);
        onAccessDenied();
      }
      return;
    }
    setValue(result.data);
  }
  return (
    <div>
      <button type="button" disabled={busy} onClick={() => void read()}>
        {busy
          ? 'Загружаем проект…'
          : versionId
            ? 'Просмотр сохранённой версии'
            : 'Просмотр проекта'}
      </button>
      {failure ? <p role="alert">{failure}</p> : null}
      {value ? (
        <div>
          <p>
            {value.title} · версия {value.revision} · только просмотр
          </p>
          <details open>
            <summary>Полные данные проекта</summary>
            <pre className="crm-document">{JSON.stringify(value.document, null, 2)}</pre>
          </details>
          <button type="button" onClick={() => setValue(null)}>
            Закрыть данные проекта
          </button>
        </div>
      ) : null}
    </div>
  );
}
function CrmCardBody(subject: CrmSubject & { onAccessDenied: () => void; onChanged?: () => void }) {
  const [profile, setProfile] = useState<CrmProfile | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  const [tab, setTab] = useState<'profile' | CrmContentCategory>('profile');
  const [name, setName] = useState(''),
    [birth, setBirth] = useState(''),
    [country, setCountry] = useState(''),
    [bio, setBio] = useState(''),
    [reason, setReason] = useState('');
  const [capability, setCapability] = useState('educator'),
    [capabilityState, setCapabilityState] = useState('verified');
  const live = useRef(true),
    sequence = useRef(0);
  const denied = useRef(subject.onAccessDenied);
  denied.current = subject.onAccessDenied;
  function apply(value: CrmProfile) {
    setProfile(value);
    setName(value.name ?? '');
    setBirth(value.birthDate ?? '');
    setCountry(value.country ?? '');
    setBio(value.bio ?? '');
    setReason('');
  }
  useEffect(() => {
    live.current = true;
    const request = ++sequence.current;
    setProfile(null);
    setFailure(null);
    void crmApi.profile(subject).then((result) => {
      if (!live.current || request !== sequence.current) return;
      if (!result.ok) {
        setFailure(result.error.message);
        if (result.status === 401 || result.status === 403) denied.current();
        return;
      }
      apply(result.data);
    });
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, [reload]);
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!profile) return;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.saveProfile(subject, {
      version: profile.version,
      name: name.trim(),
      birthDate: birth || null,
      country: country.trim().toUpperCase() || null,
      bio,
      reason: reason.trim(),
    });
    if (!live.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setProfile(null);
        denied.current();
      }
      return;
    }
    apply(result.data);
    subject.onChanged?.();
  }
  async function changeStudentStatus() {
    if (!profile) return;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.studentStatus(subject, {
      version: profile.version,
      status: profile.status === 'suspended' ? 'active' : 'suspended',
      reason: reason.trim(),
    });
    if (!live.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setProfile(null);
        denied.current();
      }
      return;
    }
    apply(result.data);
    subject.onChanged?.();
  }
  async function changeCapability() {
    if (!profile) return;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.capability(subject, {
      version: profile.version,
      capability,
      state: capabilityState,
      reason: reason.trim(),
    });
    if (!live.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setProfile(null);
        denied.current();
      }
      return;
    }
    apply(result.data);
    subject.onChanged?.();
  }
  return (
    <section className="crm-full-card" aria-label="Полная карточка пользователя">
      <div className="crm-full-heading">
        <h3>Карточка пользователя</h3>
        <button type="button" onClick={() => setReload((x) => x + 1)} disabled={busy}>
          Обновить карточку
        </button>
      </div>
      {failure ? <p role="alert">{failure}</p> : null}
      {!profile && !failure ? <p role="status">Загружаем карточку…</p> : null}
      {profile ? (
        <>
          <nav className="crm-full-nav" aria-label="Разделы CRM">
            {(
              [
                ['profile', 'Профиль и доступ'],
                ['projects', 'Все проекты'],
                ['messages', 'Переписка с ИИ'],
                ['sessions', 'Все входы'],
                ['events', 'Все действия'],
              ] as const
            ).map(([key, label]) => (
              <button
                type="button"
                key={key}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {label}
              </button>
            ))}
          </nav>
          {tab === 'profile' ? (
            <>
              <dl className="crm-full-summary">
                <div>
                  <dt>Тип записи</dt>
                  <dd>{profile.kind === 'student' ? 'Ученическое место' : 'Аккаунт'}</dd>
                </div>
                <div>
                  <dt>Регистрация</dt>
                  <dd>{new Date(profile.registeredAt).toLocaleString('ru-RU')}</dd>
                </div>
                <div>
                  <dt>Возраст</dt>
                  <dd>{profile.age === null ? 'Не указан' : `${profile.age} лет`}</dd>
                </div>
                <div>
                  <dt>Класс</dt>
                  <dd>
                    {profile.classTitle ??
                      (profile.kind === 'account'
                        ? profile.linkedIdentities.some((i) => i.kind === 'student') ||
                          profile.teachingClasses?.length
                          ? 'Связанные учебные места и преподавательские классы перечислены ниже'
                          : 'Связанные учебные места и преподавательские классы не найдены'
                        : 'Не указан')}
                  </dd>
                </div>
                <div>
                  <dt>Почта</dt>
                  <dd>{profile.email ?? 'Не указана'}</dd>
                </div>
                <div>
                  <dt>Состояние</dt>
                  <dd>{stateLabel[profile.status] ?? profile.status}</dd>
                </div>
              </dl>
              <form className="crm-full-form" onSubmit={(event) => void save(event)}>
                <label>
                  Имя
                  <input
                    value={name}
                    maxLength={120}
                    required
                    disabled={!profile.canEdit || busy}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
                <label>
                  Дата рождения
                  <input
                    type="date"
                    value={birth}
                    required={profile.kind === 'account'}
                    disabled={!profile.canEdit || busy}
                    onChange={(event) => setBirth(event.target.value)}
                  />
                </label>
                <label>
                  Страна — код из двух букв
                  <input
                    value={country}
                    maxLength={2}
                    required={profile.kind === 'account'}
                    disabled={!profile.canEdit || busy}
                    onChange={(event) => setCountry(event.target.value)}
                  />
                </label>
                <label className="crm-full-wide">
                  О пользователе
                  <textarea
                    value={bio}
                    maxLength={2000}
                    rows={3}
                    disabled={!profile.canEdit || busy}
                    onChange={(event) => setBio(event.target.value)}
                  />
                </label>
                {profile.canEdit ? (
                  <>
                    <label className="crm-full-wide">
                      Причина изменения
                      <textarea
                        value={reason}
                        minLength={3}
                        maxLength={500}
                        rows={2}
                        required
                        disabled={busy}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    </label>
                    <button type="submit" disabled={busy || reason.trim().length < 3}>
                      {busy ? 'Сохраняем…' : 'Сохранить профиль'}
                    </button>
                  </>
                ) : (
                  <p>Просмотр учебной карточки в пределах вашего класса.</p>
                )}
              </form>
              <h4>Права и роли</h4>
              <ul>
                {profile.capabilities.map((item) => (
                  <li key={item.capability}>
                    {roleLabel[item.capability] ?? item.capability}:{' '}
                    {stateLabel[item.state] ?? item.state}
                  </li>
                ))}
              </ul>
              {!profile.capabilities.length ? (
                <p>
                  {profile.kind === 'student'
                    ? 'Глобальные права аккаунта не применяются к ученическому месту.'
                    : 'Дополнительные права не назначены.'}
                </p>
              ) : null}
              <ul>
                {profile.memberships.map((item) => (
                  <li key={item.id}>
                    {item.title}: {item.role} · {item.state}
                  </li>
                ))}
              </ul>
              <ul>
                {(profile.teachingClasses ?? []).map((item) => (
                  <li key={item.id}>
                    Класс «{item.title}»:{' '}
                    {item.role === 'owner' ? 'Ответственный преподаватель' : 'Преподаватель'} ·{' '}
                    {item.status}
                  </li>
                ))}
              </ul>
              {profile.canEdit && profile.kind === 'account' ? (
                <CrmEmailChange
                  key={`${profile.id}:${profile.version}`}
                  accountId={profile.id}
                  version={profile.version}
                  onChanged={() => {
                    setReload((value) => value + 1);
                    subject.onChanged?.();
                  }}
                  onDenied={subject.onAccessDenied}
                />
              ) : null}
              {profile.canEdit && profile.kind === 'student' && profile.status !== 'removed' ? (
                <div>
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void changeStudentStatus()}
                  >
                    {profile.status === 'suspended'
                      ? 'Восстановить доступ ученика'
                      : 'Приостановить доступ ученика'}
                  </button>
                  <p>
                    Причина обязательна. Приостановка завершает входы ученика и сохраняет проекты и
                    историю.
                  </p>
                </div>
              ) : null}
              {profile.canManageCapabilities ? (
                <div className="crm-full-form">
                  <label>
                    Право
                    <select
                      value={capability}
                      onChange={(event) => setCapability(event.target.value)}
                    >
                      {Object.entries(roleLabel)
                        .filter(([key]) => key !== 'platform_admin')
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label>
                    Состояние права
                    <select
                      value={capabilityState}
                      onChange={(event) => setCapabilityState(event.target.value)}
                    >
                      {Object.entries(stateLabel)
                        .filter(([key]) => key !== 'provisional')
                        .map(([key, label]) => (
                          <option key={key} value={key}>
                            {label}
                          </option>
                        ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void changeCapability()}
                  >
                    Изменить право
                  </button>
                  <p>
                    Причина берётся из поля изменения профиля. Роль администратора управляется в
                    разделе «Управление».
                  </p>
                </div>
              ) : null}
              {profile.linkedIdentities.length ? (
                <>
                  <h4>Связанные записи</h4>
                  <ul>
                    {profile.linkedIdentities.map((item) => (
                      <li key={`${item.kind}:${item.id}`}>
                        {item.kind === 'account' ? 'Аккаунт' : 'Ученическое место'}:{' '}
                        {item.name ?? item.id}
                        {item.classId ? ` · класс ${item.classId}` : ''}
                      </li>
                    ))}
                  </ul>
                  <p>Связанные записи сохраняют собственные проекты и учебную историю.</p>
                </>
              ) : null}
            </>
          ) : (
            <CrmContent
              key={tab}
              subject={subject}
              category={tab}
              onAccessDenied={subject.onAccessDenied}
            />
          )}
        </>
      ) : null}
    </section>
  );
}
function CrmContent({
  subject,
  category,
  onAccessDenied,
}: {
  subject: CrmSubject;
  category: CrmContentCategory;
  onAccessDenied: () => void;
}) {
  const [page, setPage] = useState<CrmContentPage | null>(null),
    [failure, setFailure] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [document, setDocument] = useState<CrmDocument | null>(null);
  const sequence = useRef(0),
    mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    void load(null);
    return () => {
      mounted.current = false;
      sequence.current++;
    };
  }, []);
  async function load(cursor: string | null) {
    const current = ++sequence.current;
    setBusy(true);
    setFailure(null);
    const result = await crmApi.content(subject, category, cursor);
    if (!mounted.current || current !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        setDocument(null);
        onAccessDenied();
      }
      return;
    }
    setPage((old) => ({
      ...result.data,
      items: cursor && old ? [...old.items, ...result.data.items] : result.data.items,
    }));
  }
  async function openProject(id: string) {
    setDocument(null);
    setFailure(null);
    const current = ++sequence.current;
    setBusy(true);
    const result = await crmApi.project(subject, id);
    if (!mounted.current || current !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      setFailure(result.error.message);
      if (result.status === 401 || result.status === 403) {
        setPage(null);
        onAccessDenied();
      }
      return;
    }
    setDocument(result.data);
  }
  return (
    <section
      aria-label={
        {
          projects: 'Проекты пользователя',
          messages: 'Переписка пользователя с ИИ',
          sessions: 'Входы пользователя',
          events: 'Действия пользователя',
        }[category]
      }
    >
      <h4>
        {
          {
            projects: 'Все проекты пользователя',
            messages: 'Вопросы и ответы ИИ',
            sessions: 'Все сохранённые входы',
            events: 'Все сохранённые действия',
          }[category]
        }
      </h4>
      {category === 'messages' ? (
        <p>
          Сохранённые сообщения. У каждого указаны диалог, запрос и время. Удалённые самим
          пользователем диалоги восстановить нельзя; сведения об использовании остаются в истории.
        </p>
      ) : null}
      {busy ? <p role="status">Загружаем…</p> : null}
      {failure ? (
        <div role="alert">
          <p>{failure}</p>
          <button type="button" onClick={() => void load(page?.next ?? null)}>
            Повторить
          </button>
          <button
            type="button"
            onClick={() => {
              setPage(null);
              void load(null);
            }}
          >
            Загрузить заново
          </button>
        </div>
      ) : null}
      {page && !page.items.length && !busy ? <p>Сохранившихся записей нет.</p> : null}
      <ol className="crm-full-content">
        {page?.items.map((item) => (
          <li key={item.id}>
            {category === 'messages' ? (
              <>
                <strong>{item.role === 'user' ? 'Пользователь' : 'ИИ'}</strong>
                <p className="crm-message-text">{item.text}</p>
                <small>
                  Диалог: {item.threadId} · Запрос: {item.requestId} · {item.state}
                </small>
              </>
            ) : category === 'projects' ? (
              <>
                <strong>{item.title}</strong>
                <span>
                  {item.module} · {item.status}
                </span>
                <button type="button" disabled={busy} onClick={() => void openProject(item.id)}>
                  Просмотр проекта
                </button>
              </>
            ) : category === 'sessions' ? (
              <>
                <strong>
                  Вход:{' '}
                  {item.state === 'revoked'
                    ? 'Завершён'
                    : item.state === 'expired'
                      ? 'Срок истёк'
                      : 'Действует'}
                </strong>
                <span>
                  Последняя связь:{' '}
                  {item.lastSeenAt
                    ? new Date(item.lastSeenAt).toLocaleString('ru-RU')
                    : 'Не зафиксирована'}
                </span>
                <small>Сессия: {item.id}</small>
              </>
            ) : (
              <>
                <strong>{item.eventType}</strong>
                <span>
                  {item.module ?? 'Система'} · {item.state}
                </span>
                <span>
                  IP: {item.ipAddress ?? 'Не зафиксирован'} ·{' '}
                  {item.device ?? 'Устройство не зафиксировано'}
                </span>
              </>
            )}
            <time dateTime={item.occurredAt}>
              {new Date(item.occurredAt).toLocaleString('ru-RU')}
            </time>
          </li>
        ))}
      </ol>
      {page ? <p>Показано записей: {page.items.length}.</p> : null}
      {page?.next && !failure ? (
        <button type="button" disabled={busy} onClick={() => void load(page.next)}>
          Ещё записи
        </button>
      ) : null}
      {document ? (
        <section aria-label="Просмотр проекта">
          <h4>{document.title}</h4>
          <p>
            {document.module} · версия {document.revision} · только просмотр
          </p>
          {document.preview ? (
            <figure>
              <img
                className="crm-project-preview"
                src={document.preview.dataUrl}
                alt={`Сохранённый вид проекта «${document.title}»`}
              />
              <figcaption>
                Изображение сохранения № {document.preview.revision}
                {document.preview.revision !== document.revision
                  ? ' — может отличаться от текущего проекта'
                  : ''}
              </figcaption>
            </figure>
          ) : (
            <p>Изображение проекта не сохранено.</p>
          )}
          <details>
            <summary>Полные данные проекта — только просмотр</summary>
            <pre className="crm-document">{JSON.stringify(document.document, null, 2)}</pre>
          </details>
          <button type="button" onClick={() => setDocument(null)}>
            Закрыть просмотр
          </button>
        </section>
      ) : null}
    </section>
  );
}
