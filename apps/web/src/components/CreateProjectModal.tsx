import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { api, type ModuleSummary, type Project, type ProjectScope } from '../api';
import { newClientId } from '../client-id';
import { CloseIcon } from '../electronics/workbench-icons';
import { ModuleGlyph, moduleAccent } from '../modules/ModuleGlyph';

export function CreateProjectModal({
  scope,
  classroomId,
  onClose,
  onCreated,
}: {
  scope: ProjectScope;
  classroomId?: string;
  onClose: () => void;
  onCreated: (project: Project) => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [modules, setModules] = useState<ModuleSummary[] | null>(null);
  const [selectedModule, setSelectedModule] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    document.body.style.overflow = 'hidden';
    window.requestAnimationFrame(() => titleRef.current?.focus());
    return () => {
      document.body.style.overflow = '';
      previous?.focus?.();
    };
  }, []);

  useEffect(() => {
    let active = true;
    void api.listModules().then((result) => {
      if (!active) return;
      if (!result.ok) {
        setError('Не удалось загрузить список учебных сред.');
        setModules([]);
        return;
      }
      setModules(result.data.items);
      setSelectedModule(result.data.items.find((module) => module.creatable)?.moduleKey ?? null);
    });
    return () => {
      active = false;
    };
  }, []);

  function trap(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape' && !busy) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable || focusable.length === 0) return;
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      setError('Введите название проекта.');
      titleRef.current?.focus();
      return;
    }
    if (!selectedModule) {
      setError('Выберите доступную учебную среду.');
      return;
    }
    setBusy(true);
    setError(null);
    const result = await api.createProject({
      scope,
      classroomId: scope === 'classroom' ? (classroomId ?? null) : null,
      title: trimmed,
      module: selectedModule,
      idempotencyKey: newClientId(),
    });
    setBusy(false);
    if (result.ok) {
      onCreated(result.data.project);
    } else {
      setError(result.error.message || 'Не удалось создать проект.');
    }
  }

  return (
    <div
      className="modal-backdrop project-create-backdrop"
      onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}
    >
      <div
        ref={dialogRef}
        className="project-create-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-project-title"
        onKeyDown={trap}
      >
        <div className="project-create-heading">
          <div>
            <p className="project-create-eyebrow">Новый проект</p>
            <h2 id="create-project-title">Что вы хотите создать?</h2>
          </div>
          <button
            type="button"
            className="project-create-close"
            onClick={onClose}
            disabled={busy}
            aria-label="Закрыть"
          >
            <CloseIcon />
          </button>
        </div>
        <form onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor="project-title">Название проекта</label>
          <input
            ref={titleRef}
            id="project-title"
            value={title}
            maxLength={255}
            onChange={(event) => setTitle(event.target.value)}
          />
          <fieldset className="module-picker" aria-busy={modules === null}>
            <legend>Среда проекта</legend>
            {modules === null ? <p className="module-picker-loading">Загружаем среды…</p> : null}
            <div className="module-picker-grid">
              {modules?.map((module) => {
                const selected = selectedModule === module.moduleKey;
                const style = {
                  '--module-accent': moduleAccent(module.moduleKey),
                } as CSSProperties;
                return (
                  <label
                    key={module.moduleKey}
                    className={`module-tile${selected ? ' selected' : ''}${
                      module.creatable ? '' : ' disabled'
                    }`}
                    style={style}
                  >
                    <input
                      type="radio"
                      name="module"
                      value={module.moduleKey}
                      checked={selected}
                      disabled={!module.creatable}
                      onChange={() => setSelectedModule(module.moduleKey)}
                    />
                    <span className="module-tile-icon">
                      <ModuleGlyph module={module} />
                    </span>
                    <span className="module-tile-title">{module.displayName}</span>
                    <span className="module-tile-description">{module.shortDescription}</span>
                    <span className="module-tile-meta">
                      {module.safeModeSupported
                        ? 'Поддерживает безопасный режим'
                        : 'Только взрослым'}
                    </span>
                    {!module.creatable ? <span className="module-coming">Скоро</span> : null}
                  </label>
                );
              })}
            </div>
          </fieldset>
          {error ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : null}
          <div className="project-create-actions">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={busy}>
              Отмена
            </button>
            <button type="submit" className="btn-primary" disabled={busy || modules === null}>
              {busy ? 'Создаём…' : 'Создать проект'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
