import { useEffect, useState, type FormEvent } from 'react';
import { api, type Collection } from '../api';
import './collect-picker.css';

/**
 * «Добавить в коллекцию» для своей работы.
 *
 * Подборки собираются и из своего, и из чужого со стены: человек складывает
 * туда то, что хочет держать рядом, независимо от того, кто это сделал.
 */
export function CollectPicker({
  projectId,
  title,
  onClose,
}: {
  readonly projectId: string;
  readonly title: string;
  readonly onClose: () => void;
}): JSX.Element {
  const [collections, setCollections] = useState<readonly Collection[]>([]);
  const [holding, setHolding] = useState<ReadonlySet<string>>(new Set());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void api.listCollections().then((result) => {
      if (result.ok) setCollections(result.data.items);
    });
    void api.collectionsHolding(projectId).then((result) => {
      if (result.ok) setHolding(new Set(result.data.collectionIds));
    });
  }, [projectId]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function toggle(collectionId: string): Promise<void> {
    const inside = !holding.has(collectionId);
    setBusy(true);
    const result = await api.setCollectionItem(collectionId, projectId, inside);
    setBusy(false);
    if (!result.ok) return;
    setHolding((current) => {
      const next = new Set(current);
      if (inside) next.add(collectionId);
      else next.delete(collectionId);
      return next;
    });
    const fresh = await api.listCollections();
    if (fresh.ok) setCollections(fresh.data.items);
  }

  async function createAndAdd(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!draft.trim()) return;
    setBusy(true);
    const created = await api.createCollection(draft.trim());
    if (created.ok) {
      await api.setCollectionItem(created.data.id, projectId, true);
      const fresh = await api.listCollections();
      if (fresh.ok) setCollections(fresh.data.items);
      setHolding((current) => new Set(current).add(created.data.id));
    }
    setDraft('');
    setBusy(false);
  }

  return (
    <div className="modal-backdrop" role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="collect-title">
        <h2 id="collect-title">Добавить в коллекцию</h2>
        <p>«{title}»</p>

        {collections.length === 0 ? (
          <p className="account-hint">Подборок пока нет — создайте первую.</p>
        ) : (
          <ul className="collect-picker-list">
            {collections.map((entry) => (
              <li key={entry.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={holding.has(entry.id)}
                    disabled={busy}
                    onChange={() => void toggle(entry.id)}
                  />
                  <span>{entry.title}</span>
                </label>
                <small>{entry.itemCount === 0 ? 'пусто' : `работ: ${entry.itemCount}`}</small>
              </li>
            ))}
          </ul>
        )}

        <form className="collect-picker-create" onSubmit={(event) => void createAndAdd(event)}>
          <input
            value={draft}
            maxLength={120}
            disabled={busy}
            placeholder="Новая подборка"
            onChange={(event) => setDraft(event.target.value)}
          />
          <button type="submit" className="btn-secondary" disabled={busy || !draft.trim()}>
            Создать и добавить
          </button>
        </form>

        <div className="modal-actions">
          <button type="button" className="btn-primary" onClick={onClose}>
            Готово
          </button>
        </div>
      </div>
    </div>
  );
}
