import { useEffect, useRef, useState } from 'react';
import { responsibilitiesApi, type Responsibility } from './crm-responsibilities-api';
import { adminApi, type ClassBindings } from './admin-api';
const labels: Record<string, string> = {
  owner: 'Владелец',
  school_admin: 'Администратор организации',
  moderator: 'Модератор',
  billing_admin: 'Оплата',
  member: 'Участник',
  educator: 'Преподаватель',
  co_teacher: 'Коллега класса',
  student: 'Ученик (только чтение)',
};
export function CrmResponsibilities({
  scopeKind,
  scopeId,
  targetId,
  onDenied,
}: {
  scopeKind: 'platform' | 'organization';
  scopeId: string | null;
  targetId: string;
  onDenied: () => void;
}) {
  const [kind, setKind] = useState<'organization' | 'classroom'>('organization'),
    [scope, setScope] = useState(scopeId ?? ''),
    [data, setData] = useState<Responsibility | null>(null),
    [role, setRole] = useState(''),
    [reason, setReason] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [search, setSearch] = useState(''),
    [searching, setSearching] = useState(false),
    [options, setOptions] = useState<ClassBindings | null>(null);
  const generation = useRef(0),
    denied = useRef(onDenied);
  denied.current = onDenied;
  useEffect(() => {
    generation.current++;
    setData(null);
    setScope(scopeId ?? '');
    setKind('organization');
    setReason('');
    setMessage('');
    setBusy(false);
    setOptions(null);
    setSearch('');
    setSearching(false);
  }, [scopeKind, scopeId, targetId]);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  async function loadOptions() {
    const token = ++generation.current;
    setSearching(true);
    setData(null);
    setOptions(null);
    setScope('');
    setMessage('');
    const result = await adminApi.classBindings(search.trim());
    if (token !== generation.current) return;
    setSearching(false);
    if (result.ok) setOptions(result.data);
    else {
      setMessage('Не удалось загрузить области.');
      if (result.status === 401 || result.status === 403) denied.current();
    }
  }
  async function load() {
    const token = ++generation.current;
    setData(null);
    setBusy(true);
    try {
      const r = await responsibilitiesApi.read(kind, scope, targetId);
      if (token !== generation.current) return;
      if (r.ok) {
        setData(r.data);
        setRole(
          r.data.role && r.data.allowedRoles.includes(r.data.role)
            ? r.data.role
            : (r.data.allowedRoles[0] ?? ''),
        );
        setMessage('');
      } else {
        setMessage('Доступ недоступен в этой области.');
        if (r.status === 403 || r.status === 401) denied.current();
      }
    } catch {
      if (token === generation.current) setMessage('Не удалось загрузить доступ.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  async function save(state: string) {
    if (!data) return;
    const token = ++generation.current;
    setBusy(true);
    try {
      const r = await responsibilitiesApi.update(data.kind, data.scopeId, targetId, {
        version: data.version,
        role,
        state,
        reason,
      });
      if (token !== generation.current) return;
      if (r.ok) {
        setData(r.data);
        setReason('');
        setMessage('Доступ сохранён.');
      } else {
        setData(null);
        setMessage(
          r.status === 409
            ? 'Доступ изменился. Загрузите его снова.'
            : 'Изменение доступа отклонено.',
        );
        if (r.status === 403 || r.status === 401) denied.current();
      }
    } catch {
      if (token === generation.current)
        setMessage('Не удалось сохранить доступ. Загрузите его снова.');
    } finally {
      if (token === generation.current) setBusy(false);
    }
  }
  return (
    <section className="crm-responsibilities" aria-label="Ответственность и доступ">
      <h3>Ответственность и доступ</h3>
      {scopeKind === 'platform' && (
        <>
          <label>
            Область{' '}
            <select
              value={kind}
              disabled={busy}
              onChange={(e) => {
                generation.current++;
                setData(null);
                setOptions(null);
                setScope('');
                setSearching(false);
                setMessage('');
                setKind(e.target.value as 'organization' | 'classroom');
              }}
            >
              <option value="organization">Организация</option>
              <option value="classroom">Класс</option>
            </select>
          </label>
          <label>
            Поиск организации или класса по названию{' '}
            <input
              value={search}
              maxLength={100}
              disabled={busy}
              onChange={(e) => {
                generation.current++;
                setSearch(e.target.value);
                setData(null);
                setOptions(null);
                setScope('');
                setSearching(false);
                setMessage('');
              }}
            />
          </label>
          <button type="button" disabled={busy} onClick={() => void loadOptions()}>
            Найти по названию
          </button>
          {searching && <p role="status">Поиск областей…</p>}
          {options && (
            <>
              <label>
                Название области{' '}
                <select
                  value={scope}
                  disabled={busy}
                  onChange={(e) => {
                    generation.current++;
                    setData(null);
                    setScope(e.target.value);
                  }}
                >
                  <option value="">Выберите область</option>
                  {(kind === 'organization' ? options.organizations : options.classes).map(
                    (item) => (
                      <option key={item.id} value={item.id}>
                        {item.title}
                      </option>
                    ),
                  )}
                </select>
              </label>
              {(kind === 'organization' ? options.organizations : options.classes).length === 0 && (
                <p role="status">Ничего не найдено. Уточните название и повторите поиск.</p>
              )}
              {(kind === 'organization' ? options.organizations : options.classes).length >=
                100 && (
                <p role="status">
                  Показаны первые 100 результатов. Уточните название, чтобы найти нужную область.
                </p>
              )}
            </>
          )}
        </>
      )}
      <button type="button" disabled={busy || !scope} onClick={() => void load()}>
        Загрузить доступ
      </button>
      {data && (
        <>
          <p>
            Текущая роль: {data.role ? (labels[data.role] ?? data.role) : 'Нет'}; состояние:{' '}
            {data.state === 'active'
              ? 'Активен'
              : data.state === 'suspended'
                ? 'Приостановлен'
                : data.state === 'revoked'
                  ? 'Отозван'
                  : 'Нет'}
          </p>
          {data.allowedRoles.length > 0 ? (
            <>
              <label>
                Роль{' '}
                <select value={role} disabled={busy} onChange={(e) => setRole(e.target.value)}>
                  {data.allowedRoles.map((r) => (
                    <option key={r} value={r}>
                      {labels[r] ?? r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Причина изменения{' '}
                <textarea
                  value={reason}
                  maxLength={500}
                  disabled={busy}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              <button
                type="button"
                disabled={busy || reason.trim().length < 3}
                onClick={() => void save('active')}
              >
                Назначить
              </button>
              <button
                type="button"
                disabled={
                  busy || reason.trim().length < 3 || !data.role || data.state === 'revoked'
                }
                onClick={() => void save('revoked')}
              >
                Отозвать
              </button>
              {data.kind === 'organization' && (
                <button
                  type="button"
                  disabled={
                    busy || reason.trim().length < 3 || !data.role || data.state === 'revoked'
                  }
                  onClick={() => void save('suspended')}
                >
                  Приостановить
                </button>
              )}
            </>
          ) : (
            <p>Эта ответственность доступна только для чтения.</p>
          )}
        </>
      )}
      {message && <p role="status">{message}</p>}
    </section>
  );
}
