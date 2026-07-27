import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  type ComponentKind,
  type Project,
  type ProjectVersion,
  type SchematicComponent,
  type SchematicDocument,
  type SolveResult,
} from '../api';

const PALETTE: { kind: ComponentKind; label: string; defaultValue: number; unit: string }[] = [
  { kind: 'source', label: 'Источник', defaultValue: 5, unit: 'В' },
  { kind: 'resistor', label: 'Резистор', defaultValue: 300, unit: 'Ом' },
  { kind: 'led', label: 'Светодиод', defaultValue: 2, unit: 'В' },
  { kind: 'wire', label: 'Провод', defaultValue: 0, unit: '' },
];

const KIND_LABEL: Record<ComponentKind, string> = {
  source: 'Источник',
  resistor: 'Резистор',
  led: 'Светодиод',
  wire: 'Провод',
};

function unitOf(kind: ComponentKind): string {
  return PALETTE.find((entry) => entry.kind === kind)?.unit ?? '';
}

interface TerminalSelection {
  componentId: string;
  terminal: 'a' | 'b';
}

export function SchematicEditor({
  projectId,
  onBack,
}: {
  projectId: string;
  onBack: () => void;
}): JSX.Element {
  const [project, setProject] = useState<Project | null>(null);
  const [document, setDocument] = useState<SchematicDocument | null>(null);
  const [result, setResult] = useState<SolveResult | null>(null);
  const [versions, setVersions] = useState<ProjectVersion[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingTerminal, setPendingTerminal] = useState<TerminalSelection | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const counter = useRef(0);

  const load = useCallback(async () => {
    setStatus('loading');
    const response = await api.openProject(projectId);
    if (!response.ok) {
      setStatus('error');
      return;
    }
    setProject(response.data.project);
    setDocument(response.data.draft.document);
    setResult(response.data.result);
    setVersions(response.data.versions);
    setStatus('ready');
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  function nextId(prefix: string): string {
    counter.current += 1;
    return `${prefix}-${Date.now().toString(36)}-${counter.current}`;
  }

  function addComponent(kind: ComponentKind): void {
    if (!document) return;
    const defaults = PALETTE.find((entry) => entry.kind === kind);
    const index = document.components.length;
    const component: SchematicComponent = {
      id: nextId(kind),
      kind,
      position: { x: 60 + (index % 4) * 150, y: 60 + Math.floor(index / 4) * 110 },
      value: defaults?.defaultValue ?? 0,
    };
    setDocument({ ...document, components: [...document.components, component] });
    setSelected(component.id);
    setNotice(`${KIND_LABEL[kind]} добавлен. Соедините выводы, чтобы замкнуть цепь.`);
  }

  function removeComponent(componentId: string): void {
    if (!document) return;
    setDocument({
      ...document,
      components: document.components.filter((component) => component.id !== componentId),
      connections: document.connections.filter(
        (connection) =>
          connection.from.componentId !== componentId && connection.to.componentId !== componentId,
      ),
    });
    setSelected(null);
  }

  function updateValue(componentId: string, value: number): void {
    if (!document) return;
    setDocument({
      ...document,
      components: document.components.map((component) =>
        component.id === componentId ? { ...component, value } : component,
      ),
    });
  }

  /** Two clicks on terminals create a connection between them. */
  function clickTerminal(componentId: string, terminal: 'a' | 'b'): void {
    if (!document) return;
    if (!pendingTerminal) {
      setPendingTerminal({ componentId, terminal });
      setNotice('Выберите второй вывод, чтобы соединить.');
      return;
    }
    if (pendingTerminal.componentId === componentId && pendingTerminal.terminal === terminal) {
      setPendingTerminal(null);
      setNotice('Выбор вывода отменён.');
      return;
    }
    const connection = {
      id: nextId('conn'),
      from: { ...pendingTerminal },
      to: { componentId, terminal },
    };
    setDocument({ ...document, connections: [...document.connections, connection] });
    setPendingTerminal(null);
    setNotice('Соединение добавлено.');
  }

  function removeConnection(connectionId: string): void {
    if (!document) return;
    setDocument({
      ...document,
      connections: document.connections.filter((connection) => connection.id !== connectionId),
    });
  }

  async function save(): Promise<void> {
    if (!document) return;
    setBusy(true);
    const response = await api.saveDraft(projectId, document);
    setBusy(false);
    if (response.ok) {
      setResult(response.data.result);
      setNotice('Схема сохранена.');
    } else {
      setNotice(`Не удалось сохранить: ${response.error.message}`);
    }
  }

  async function checkpoint(): Promise<void> {
    setBusy(true);
    const saved = await api.saveDraft(projectId, document as SchematicDocument);
    const response = saved.ok ? await api.createCheckpoint(projectId) : null;
    setBusy(false);
    if (response?.ok) {
      setVersions([response.data.version, ...versions]);
      setNotice(`Создана версия №${response.data.version.versionNo}. Её больше нельзя изменить.`);
    } else {
      setNotice('Не удалось создать версию.');
    }
  }

  const resultByComponent = useMemo(() => {
    const map = new Map<string, { current: number; voltageDrop: number; lit?: boolean }>();
    for (const entry of result?.components ?? []) {
      map.set(entry.componentId, entry);
    }
    return map;
  }, [result]);

  if (status === 'loading') {
    return (
      <div className="content" role="status" aria-live="polite">
        Загрузка проекта…
      </div>
    );
  }
  if (status === 'error' || !document) {
    return (
      <div className="content">
        <p className="form-error" role="alert">
          Не удалось открыть проект.
        </p>
        <button type="button" className="btn-secondary" onClick={onBack}>
          К списку проектов
        </button>
      </div>
    );
  }

  const selectedComponent = document.components.find((component) => component.id === selected);

  return (
    <main className="content editor">
      <div className="content-head">
        <div>
          <button type="button" className="btn-ghost" onClick={onBack}>
            ← Проекты
          </button>
          <h1>{project?.title ?? 'Проект'}</h1>
        </div>
        <div className="editor-actions">
          <button
            type="button"
            className="btn-secondary"
            onClick={() => void save()}
            disabled={busy}
          >
            Сохранить
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={() => void checkpoint()}
            disabled={busy}
          >
            Создать версию
          </button>
        </div>
      </div>

      {notice ? (
        <p className="notice-success" role="status" aria-live="polite">
          {notice}
        </p>
      ) : null}

      <div className="editor-layout">
        <section className="palette" aria-label="Элементы">
          <h2>Элементы</h2>
          {PALETTE.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className="btn-secondary palette-button"
              onClick={() => addComponent(entry.kind)}
            >
              {entry.label}
            </button>
          ))}
        </section>

        <section className="canvas" aria-label="Схема" data-testid="schematic-canvas">
          <h2 className="sr-only">Схема</h2>
          {document.components.length === 0 ? (
            <p className="muted">Схема пустая. Добавьте источник, резистор и светодиод.</p>
          ) : null}
          <ul className="component-list">
            {document.components.map((component) => {
              const measured = resultByComponent.get(component.id);
              return (
                <li
                  key={component.id}
                  className={`component-card${selected === component.id ? ' selected' : ''}`}
                  data-testid="schematic-component"
                  data-kind={component.kind}
                >
                  <button
                    type="button"
                    className="component-title"
                    onClick={() => setSelected(component.id)}
                    aria-pressed={selected === component.id}
                  >
                    {KIND_LABEL[component.kind]}
                    {component.kind === 'wire'
                      ? ''
                      : ` · ${component.value} ${unitOf(component.kind)}`}
                  </button>
                  <div className="terminals">
                    {(['a', 'b'] as const).map((terminal) => (
                      <button
                        key={terminal}
                        type="button"
                        className={`terminal${
                          pendingTerminal?.componentId === component.id &&
                          pendingTerminal.terminal === terminal
                            ? ' terminal-active'
                            : ''
                        }`}
                        onClick={() => clickTerminal(component.id, terminal)}
                        aria-label={`${KIND_LABEL[component.kind]}: вывод ${terminal.toUpperCase()}`}
                      >
                        {terminal.toUpperCase()}
                      </button>
                    ))}
                  </div>
                  {component.kind === 'led' && measured ? (
                    <p className="led-state" data-testid="led-state">
                      Светодиод {measured.lit ? 'горит' : 'не горит'}
                    </p>
                  ) : null}
                  {measured && component.kind !== 'led' ? (
                    <p className="muted">Падение {measured.voltageDrop} В</p>
                  ) : null}
                </li>
              );
            })}
          </ul>

          {document.connections.length > 0 ? (
            <>
              <h3>Соединения</h3>
              <ul className="connection-list">
                {document.connections.map((connection) => (
                  <li key={connection.id}>
                    {connection.from.componentId}:{connection.from.terminal.toUpperCase()} →{' '}
                    {connection.to.componentId}:{connection.to.terminal.toUpperCase()}
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() => removeConnection(connection.id)}
                      aria-label={`Удалить соединение ${connection.id}`}
                    >
                      Удалить
                    </button>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </section>

        <section className="inspector" aria-label="Результат">
          <h2>Результат</h2>
          <p className="reading" data-testid="current-reading">
            Ток: {result?.solved ? `${(result.current * 1000).toFixed(1)} мА` : '—'}
          </p>
          <ul className="diagnostics" data-testid="diagnostics">
            {(result?.diagnostics ?? []).map((diagnostic, index) => (
              <li
                key={`${diagnostic.code}-${index}`}
                className={`diagnostic ${diagnostic.severity}`}
              >
                {diagnostic.message}
              </li>
            ))}
          </ul>

          {selectedComponent && selectedComponent.kind !== 'wire' ? (
            <div className="parameter">
              <label htmlFor="component-value">
                {KIND_LABEL[selectedComponent.kind]} · значение ({unitOf(selectedComponent.kind)})
              </label>
              <input
                id="component-value"
                type="number"
                min={0}
                step="any"
                value={selectedComponent.value}
                onChange={(event) => updateValue(selectedComponent.id, Number(event.target.value))}
              />
              <button
                type="button"
                className="btn-ghost"
                onClick={() => removeComponent(selectedComponent.id)}
              >
                Удалить элемент
              </button>
            </div>
          ) : null}

          <h3>Версии</h3>
          {versions.length === 0 ? (
            <p className="muted">Версий пока нет.</p>
          ) : (
            <ul className="version-list" data-testid="version-list">
              {versions.map((version) => (
                <li key={version.id}>Версия №{version.versionNo}</li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}
