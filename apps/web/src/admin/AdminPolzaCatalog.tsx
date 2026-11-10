import { useEffect, useState } from 'react';
import { call } from './admin-api';
interface Model {
  id: string;
  upstream: string;
  label: string;
  kind: string;
  vision: boolean;
  tools: boolean;
  active: boolean;
  selected: boolean;
  catalogMonth?: string | null;
}
interface Catalog {
  version: number;
  credentialCurrent: boolean;
  checkedAt: string | null;
  items: Model[];
}
const GROUP_TABS = {
  chat: 'Текст',
  image: 'Изображения',
  stt: 'Транскрибация',
  video: 'Видео',
} as const;
const MODEL_GROUPS = {
  chat: 'Текстовые модели Polza AI',
  image: 'Модели изображений Polza AI',
  stt: 'Модели транскрибации Polza AI',
  video: 'Видеомодели Polza AI',
};
function validCatalog(value: unknown): value is Catalog {
  const v = value as Catalog | null;
  return (
    !!v &&
    Number.isSafeInteger(v.version) &&
    typeof v.credentialCurrent === 'boolean' &&
    Array.isArray(v.items) &&
    v.items.length <= 1200 &&
    v.items.every(
      (m) =>
        m &&
        typeof m.id === 'string' &&
        typeof m.label === 'string' &&
        typeof m.upstream === 'string' &&
        typeof m.kind === 'string' &&
        typeof m.selected === 'boolean' &&
        typeof m.active === 'boolean' &&
        typeof m.vision === 'boolean' &&
        typeof m.tools === 'boolean',
    )
  );
}
export function AdminPolzaCatalog({
  onAccessDenied,
  onUpdated,
  onDirtyChange,
  onBusyChange,
  kind: initialKind = 'chat',
  connection = false,
  connectionDirty = false,
  connected = true,
}: {
  onAccessDenied: () => void;
  onUpdated?: (() => void) | undefined;
  onDirtyChange?: (dirty: boolean) => void;
  onBusyChange?: (busy: boolean) => void;
  kind?: keyof typeof MODEL_GROUPS;
  connected?: boolean;
  connection?: boolean;
  connectionDirty?: boolean;
}) {
  const [category, setCategory] = useState<keyof typeof GROUP_TABS>('chat');
  const kind = connection ? category : initialKind;
  const selectable = connection || kind === 'chat';
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function apply(value: Catalog) {
    setCatalog(value);
    setSelected(value.items.filter((m) => m.active && m.selected).map((m) => m.id));
  }
  useEffect(() => {
    if (!connected) return;
    let live = true;
    void call<Catalog>('/api/admin/v1/ai/polza/models').then((r) => {
      if (!live) return;
      if (r.ok && validCatalog(r.data)) apply(r.data);
      else {
        if (!r.ok && [401, 403].includes(r.status)) onAccessDenied();
        setError(r.ok ? 'Несовместимый каталог моделей.' : r.error.message);
      }
    });
    return () => {
      live = false;
    };
  }, [connected, onAccessDenied]);
  async function request(refresh: boolean) {
    if (busy || connectionDirty || (!refresh && !catalog)) return;
    setBusy(true);
    onBusyChange?.(true);
    setError('');
    setNotice('');
    try {
      const r = await call<Catalog>('/api/admin/v1/ai/polza/models' + (refresh ? '/refresh' : ''), {
        method: refresh ? 'POST' : 'PUT',
        body: JSON.stringify(refresh ? {} : { version: catalog!.version, ids: selected }),
      });
      if (r.ok && validCatalog(r.data)) {
        apply(r.data);
        setNotice(
          refresh ? 'Каталог обновлён. Платных запросов не было.' : 'Выбор моделей сохранён.',
        );
        onUpdated?.();
      } else {
        if (!r.ok && [401, 403].includes(r.status)) onAccessDenied();
        setError(r.ok ? 'Несовместимый каталог моделей.' : r.error.message);
      }
    } finally {
      setBusy(false);
      onBusyChange?.(false);
    }
  }
  const shown = (catalog?.credentialCurrent ? catalog.items : []).filter(
    (m) =>
      m.active &&
      m.kind === kind &&
      (selectable || m.selected) &&
      (m.label + ' ' + m.upstream).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
  );
  const dirty =
    !!catalog &&
    [...selected].sort().join() !==
      catalog.items
        .filter((m) => m.active && m.selected)
        .map((m) => m.id)
        .sort()
        .join();
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return (
    <section className="asa-polza-catalog" aria-label={MODEL_GROUPS[kind]}>
      <header>
        <div>
          <h3>{MODEL_GROUPS[kind]}</h3>
        </div>
        {connected && selectable ? (
          <button
            type="button"
            disabled={busy || dirty || connectionDirty}
            onClick={() => void request(true)}
          >
            Обновить каталог
          </button>
        ) : (
          <a href="#/admin/ai?section=connections&provider=polza">
            {connected ? 'Выбрать модели' : 'Подключить Polza AI'}
          </a>
        )}
      </header>
      {connection ? (
        <div className="asa-polza-category" role="group" aria-label="Категории моделей Polza">
          {(Object.keys(GROUP_TABS) as (keyof typeof GROUP_TABS)[]).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={category === id}
              onClick={() => {
                setCategory(id);
                setQuery('');
              }}
            >
              {GROUP_TABS[id]}
            </button>
          ))}
        </div>
      ) : null}
      {connectionDirty ? <p>Сначала сохраните подключение.</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {connected && catalog ? (
        <>
          <div className="asa-polza-catalog-filters">
            <label>
              Поиск
              <input
                type="search"
                aria-label="Поиск моделей Polza"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Название или ID модели"
              />
            </label>
            <span>{shown.length} моделей</span>
          </div>
          {!catalog.credentialCurrent ? (
            <p className="asa-ai-integration-note">Обновите каталог для сохранённого ключа.</p>
          ) : null}
          {catalog.credentialCurrent && !shown.length ? (
            <p role="status">
              {query
                ? 'По запросу ничего не найдено.'
                : selectable
                  ? 'В каталоге нет моделей этого типа.'
                  : 'Выберите модели в подключении Polza AI.'}
            </p>
          ) : null}
          <div className="asa-polza-catalog-list">
            {shown.map((m) => (
              <label key={m.id} className="asa-polza-catalog-model">
                {selectable ? (
                  <input
                    type="checkbox"
                    aria-label={(kind === 'chat' ? 'В настройки: ' : 'Выбрать: ') + m.label}
                    checked={selected.includes(m.id)}
                    disabled={busy || connectionDirty || !catalog.credentialCurrent}
                    onChange={(e) =>
                      setSelected((p) =>
                        e.target.checked ? [...p, m.id] : p.filter((id) => id !== m.id),
                      )
                    }
                  />
                ) : null}
                <span>
                  <strong>{m.label}</strong>
                  <small>{m.upstream}</small>
                </span>
                <span className="asa-polza-catalog-badges">
                  {m.catalogMonth && /^\d{4}-\d{2}$/.test(m.catalogMonth) ? (
                    <time dateTime={m.catalogMonth} title="Месяц по данным каталога Polza">
                      {m.catalogMonth}
                    </time>
                  ) : (
                    <span title="Провайдер не указал дату">Дата не указана</span>
                  )}
                  {m.vision ? <span>Vision</span> : kind === 'chat' ? <span>Текст</span> : null}
                  {m.tools ? <span>Инструменты</span> : null}
                  {kind === 'stt' && m.upstream === 'ai-sage/gigaam-v3' ? (
                    <span>Модель ASA для голосового ввода</span>
                  ) : null}
                </span>
              </label>
            ))}
          </div>
          {selectable ? (
            <button
              type="button"
              className="asa-polza-primary"
              disabled={busy || connectionDirty || !dirty || !catalog.credentialCurrent}
              onClick={() => void request(false)}
            >
              Сохранить выбор моделей
            </button>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
