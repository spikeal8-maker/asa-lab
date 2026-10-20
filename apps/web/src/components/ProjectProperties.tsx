import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { api, type Project } from '../api';
import { PublicationPanel } from '../projects-public/PublicationPanel';
import { PUBLIC_PROJECT_LICENSES as LICENCES } from '../projects-public/presentation';
import './project-properties.css';

/** Private metadata and explicit publication share a form, never a save command. */

export function ProjectProperties({
  project,
  onClose,
  onSaved,
  initialSection = 'properties',
}: {
  readonly project: Project;
  readonly onClose: () => void;
  readonly onSaved: () => void;
  readonly initialSection?: 'properties' | 'publication';
}): JSX.Element {
  const [title, setTitle] = useState(project.title);
  const [description, setDescription] = useState(project.description ?? '');
  const [tags, setTags] = useState<readonly string[]>(project.tags ?? []);
  const [tagDraft, setTagDraft] = useState('');
  const [license, setLicense] = useState(project.license ?? 'reserved');
  const [saving, setSaving] = useState(false);
  const [publicationBusy, setPublicationBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const publicationSection = useRef<HTMLDivElement>(null);
  const busy = saving || publicationBusy;

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      if (initialSection === 'publication') {
        publicationSection.current?.focus();
        publicationSection.current?.scrollIntoView({ block: 'nearest' });
      } else dialog.current?.querySelector<HTMLInputElement>('#properties-title')?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [initialSection]);

  useEffect(() => {
    function onKey(event: globalThis.KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!busy) onClose();
      }
      if (event.key !== 'Tab') return;
      const focusable = [
        ...(dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]',
        ) ?? []),
      ].filter((element) => element.getClientRects().length > 0);
      const first = focusable[0];
      const last = focusable.at(-1);
      if (
        event.shiftKey &&
        (document.activeElement === first || !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        last?.focus();
      } else if (
        !event.shiftKey &&
        (document.activeElement === last || !dialog.current?.contains(document.activeElement))
      ) {
        event.preventDefault();
        first?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  function addTag(): void {
    const value = tagDraft.trim().toLowerCase().slice(0, 32);
    setTagDraft('');
    if (!value || tags.includes(value) || tags.length >= 10) return;
    setTags([...tags, value]);
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addTag();
    }
  }

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (busy) return;
    if (!title.trim()) {
      setError('Введите имя проекта.');
      return;
    }
    setSaving(true);
    setError(null);
    const result = await api.saveProjectProperties(project.id, {
      title: title.trim(),
      description: description.trim() || null,
      tags: [...tags],
      license,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message || 'Не удалось сохранить свойства.');
      return;
    }
    onSaved();
  }

  const licenceHint = LICENCES.find((entry) => entry.value === license)?.hint ?? '';

  return (
    <div className="modal-backdrop" role="presentation">
      <div
        ref={dialog}
        className="modal project-properties publication-properties"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-properties-title"
      >
        <header className="project-properties-head">
          <h2 id="project-properties-title">
            {initialSection === 'publication' ? 'Публикация проекта' : 'Свойства проекта'}
          </h2>
          <button
            type="button"
            className="project-properties-close"
            aria-label="Закрыть"
            disabled={busy}
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <form onSubmit={(event) => void save(event)}>
          <label htmlFor="properties-title">Имя проекта</label>
          <input
            id="properties-title"
            value={title}
            maxLength={255}
            disabled={busy}
            onChange={(event) => setTitle(event.target.value)}
          />

          <label htmlFor="properties-description">Описание проекта</label>
          <textarea
            id="properties-description"
            rows={3}
            maxLength={2000}
            value={description}
            disabled={busy}
            placeholder="Расскажите, что это и как сделано."
            onChange={(event) => setDescription(event.target.value)}
          />

          <label htmlFor="properties-tags">Теги</label>
          <p className="account-hint">Не более десяти. Добавить — Enter или запятая.</p>
          <div className="project-properties-tags">
            {tags.map((tag) => (
              <span key={tag}>
                {tag}
                <button
                  type="button"
                  aria-label={`Убрать тег ${tag}`}
                  disabled={busy}
                  onClick={() => setTags(tags.filter((entry) => entry !== tag))}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
          <input
            id="properties-tags"
            value={tagDraft}
            maxLength={32}
            disabled={busy || tags.length >= 10}
            placeholder={tags.length >= 10 ? 'Десять — предел' : 'Помогите найти вашу работу'}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={onTagKey}
            onBlur={addTag}
          />

          <label htmlFor="properties-license">Лицензия</label>
          <select
            id="properties-license"
            value={license}
            disabled={busy}
            onChange={(event) => setLicense(event.target.value)}
          >
            {LICENCES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
          <p className="account-hint">{licenceHint}</p>

          <div ref={publicationSection} tabIndex={-1}>
            <PublicationPanel
              projectId={project.id}
              metadata={{
                title: title.trim(),
                description: description.trim() || null,
                tags,
                license,
              }}
              disabled={saving}
              onBusyChange={setPublicationBusy}
            />
          </div>

          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}

          <div className="modal-actions">
            <button type="button" className="btn-secondary" disabled={busy} onClick={onClose}>
              Закрыть
            </button>
            <button type="submit" className="btn-primary" disabled={busy}>
              {saving ? 'Сохраняем…' : 'Сохранить свойства'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
