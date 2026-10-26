import { useEffect, useRef, useState } from 'react';
import { adminApi, type ClassBindings } from './admin-api';

export function OrganizationClassBindings({
  onAccessDenied,
  onChanged,
}: {
  onAccessDenied: () => void;
  onChanged: () => void;
}) {
  const [search, setSearch] = useState(''),
    [data, setData] = useState<ClassBindings | null>(null);
  const [classId, setClassId] = useState(''),
    [workspaceId, setWorkspaceId] = useState(''),
    [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      sequence.current++;
    };
  }, []);
  const lock = useRef(false),
    sequence = useRef(0);
  const load = async () => {
    const request = ++sequence.current;
    setBusy(true);
    setMessage(null);
    const result = await adminApi.classBindings(search.trim());
    if (request !== sequence.current) return;
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        setData(null);
        onAccessDenied();
        return;
      }
      setMessage('Не удалось найти классы и организации. Повторите поиск.');
      return;
    }
    setData(result.data);
    setClassId('');
    setWorkspaceId('');
  };
  const save = async () => {
    const selected = data?.classes.find((c) => c.id === classId);
    if (!selected || lock.current) return;
    lock.current = true;
    setBusy(true);
    setMessage(null);
    try {
      const result = await adminApi.bindClass({
        classId,
        workspaceId: workspaceId || null,
        expectedWorkspaceId: selected.workspaceId,
        reason,
      });
      if (!live.current) return;
      if (!result.ok) {
        if (result.status === 401 || result.status === 403) {
          setData(null);
          onAccessDenied();
          return;
        }
        setMessage(
          result.status === 409
            ? 'Привязка уже изменена другим администратором. Повторите поиск; введённая причина сохранена.'
            : 'Привязка не сохранена. Проверьте поля и повторите.',
        );
        return;
      }
      setData((current) =>
        current
          ? {
              ...current,
              classes: current.classes.map((c) =>
                c.id === classId ? { ...c, workspaceId: workspaceId || null } : c,
              ),
            }
          : null,
      );
      setReason('');
      setMessage(
        'Привязка сохранена. Доступ сотрудников организации пересчитывается при каждом чтении.',
      );
      onChanged();
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <details className="crm-directory-bindings">
      <summary>Связь классов с организациями</summary>
      <p>
        Администратор платформы явно назначает классу одну организацию или снимает привязку. Это
        даёт действующим владельцу и администратору организации доступ к учебным карточкам этого
        класса. Владельцы класса и личные материалы аккаунтов не меняются.
      </p>
      <div className="crm-directory-fields">
        <label>
          <span>Поиск классов и организаций</span>
          <input maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>
          Найти классы и организации
        </button>
      </div>
      {data ? (
        <>
          <p>Показано до 100 совпадений каждого типа. Уточните поиск, если нужной записи нет.</p>
          <div className="crm-directory-fields">
            <label>
              <span>Класс</span>
              <select
                disabled={busy}
                value={classId}
                onChange={(e) => {
                  setClassId(e.target.value);
                  setWorkspaceId(
                    data.classes.find((c) => c.id === e.target.value)?.workspaceId ?? '',
                  );
                }}
              >
                <option value="">Выберите класс</option>
                {data.classes.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} · {c.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Организация класса</span>
              <select
                disabled={busy || !classId}
                value={workspaceId}
                onChange={(e) => setWorkspaceId(e.target.value)}
              >
                <option value="">Без организации</option>
                {workspaceId && !data.organizations.some((w) => w.id === workspaceId) ? (
                  <option value={workspaceId}>Текущая организация · {workspaceId}</option>
                ) : null}
                {data.organizations.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.title} · {w.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Причина изменения</span>
              <input maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            </label>
            <button
              type="button"
              className="btn-primary"
              disabled={busy || !classId || reason.trim().length < 3}
              onClick={() => void save()}
            >
              {busy ? 'Сохраняем…' : 'Сохранить привязку'}
            </button>
          </div>
        </>
      ) : null}
      {message ? <p role="status">{message}</p> : null}
    </details>
  );
}
