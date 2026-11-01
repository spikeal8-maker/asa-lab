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
}
interface Catalog {
  version: number;
  credentialCurrent: boolean;
  checkedAt: string | null;
  items: Model[];
}
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
}: {
  onAccessDenied: () => void;
  onUpdated?: (() => void) | undefined;
  onDirtyChange?: (dirty: boolean) => void;
}) {
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState('chat');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  function apply(value: Catalog) {
    setCatalog(value);
    setSelected(value.items.filter((m) => m.selected).map((m) => m.id));
  }
  useEffect(() => {
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
  }, [onAccessDenied]);
  async function request(refresh: boolean) {
    if (busy || (!refresh && !catalog)) return;
    setBusy(true);
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
          refresh
            ? 'Каталог обновлён. Платных запросов не было.'
            : 'Выбор сохранён. Доступ пользователям задаётся в Настройках.',
        );
        onUpdated?.();
      } else {
        if (!r.ok && [401, 403].includes(r.status)) onAccessDenied();
        setError(r.ok ? 'Несовместимый каталог моделей.' : r.error.message);
      }
    } finally {
      setBusy(false);
    }
  }
  const shown =
    catalog?.items.filter(
      (m) =>
        m.active &&
        m.kind === kind &&
        (m.label + ' ' + m.upstream).toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    ) ?? [];
  const dirty =
    !!catalog &&
    [...selected].sort().join() !==
      catalog.items
        .filter((m) => m.selected)
        .map((m) => m.id)
        .sort()
        .join();
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  return (
    <section className="asa-polza-catalog" aria-label="Каталог моделей Polza AI">
      <header>
        <div>
          <h3>Модели Polza AI</h3>
          <p>
            Выберите текстовые модели для раздела «Настройки». Там задаются доступ пользователям,
            порядок и лимиты.
          </p>
        </div>
        <button type="button" disabled={busy || dirty} onClick={() => void request(true)}>
          Обновить каталог
        </button>
      </header>
      {error ? <p role="alert">{error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {catalog ? (
        <>
          <div className="asa-polza-catalog-filters">
            <label>
              Тип модели
              <select
                aria-label="Тип моделей Polza"
                value={kind}
                onChange={(e) => setKind(e.target.value)}
              >
                <option value="chat">Текст и Vision</option>
                <option value="stt">Распознавание речи</option>
                <option value="image">Изображения</option>
                <option value="other">Другие</option>
              </select>
            </label>
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
          {kind !== 'chat' ? (
            <p className="asa-ai-integration-note">
              {kind === 'stt'
                ? 'Голосовой ввод настраивается во вкладке «Транскрибация». Сейчас используется GigaAM-v3.'
                : kind === 'image'
                  ? 'Генерация изображений в ASA настроена отдельно через ComfyUI. Эти модели показаны как возможности Polza.'
                  : 'Эти модели не используются в текстовом чате.'}
            </p>
          ) : null}
          <div className="asa-polza-catalog-list">
            {shown.map((m) => (
              <label key={m.id} className="asa-polza-catalog-model">
                {kind === 'chat' ? (
                  <input
                    type="checkbox"
                    aria-label={'В настройки: ' + m.label}
                    checked={selected.includes(m.id)}
                    disabled={busy || !catalog.credentialCurrent}
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
                  {m.vision ? <span>Vision</span> : kind === 'chat' ? <span>Текст</span> : null}
                  {m.tools ? <span>Инструменты</span> : null}
                </span>
              </label>
            ))}
          </div>
          {kind === 'chat' ? (
            <button
              type="button"
              className="asa-polza-primary"
              disabled={busy || !dirty || !catalog.credentialCurrent}
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
