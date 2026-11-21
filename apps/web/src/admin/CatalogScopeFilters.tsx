import { useEffect, useRef, useState } from 'react';
import { adminApi, type AdminScope, type CatalogFilters } from './admin-api';
export function CatalogScopeFilters({
  scope,
  filters,
  onChange,
  onAccessDenied,
}: {
  scope: AdminScope;
  filters: CatalogFilters;
  onChange: (key: keyof CatalogFilters, value: string) => void;
  onAccessDenied: () => void;
}) {
  const [search, setSearch] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<{
    classes: { id: string; title: string }[];
    organizations: { id: string; title: string }[];
  }>({ classes: [], organizations: [] });
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function load() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const result = await adminApi.catalogFilterOptions(scope, search.trim());
    if (!live.current) return;
    setBusy(false);
    if (!result.ok) {
      if (result.status === 401 || result.status === 403) {
        setData({ classes: [], organizations: [] });
        onAccessDenied();
        return;
      }
      setError('Справочник недоступен. Повторите поиск.');
      return;
    }
    setData(result.data);
  }
  return (
    <div className="crm-directory-scope-fields">
      <label>
        <span>Поиск класса или организации для фильтра</span>
        <input maxLength={100} value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <button type="button" className="btn-secondary" disabled={busy} onClick={() => void load()}>
        {busy ? 'Ищем…' : 'Найти значения фильтра'}
      </button>
      <small>До 100 совпадений. Уточните поиск, если нужного названия нет.</small>
      {error ? <p role="alert">{error}</p> : null}
      {(
        [
          ['classId', 'Класс', data.classes],
          ...(scope.kind === 'platform'
            ? [['organizationId', 'Организация', data.organizations]]
            : []),
        ] as [keyof CatalogFilters, string, { id: string; title: string }[]][]
      ).map(([key, label, items]) => (
        <label key={key}>
          <span>{label}</span>
          <select value={filters[key] ?? ''} onChange={(e) => onChange(key, e.target.value)}>
            <option value="">Все</option>
            {filters[key] && !items.some((i) => i.id === filters[key]) ? (
              <option value={filters[key]}>Выбранная запись · {filters[key]}</option>
            ) : null}
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}
