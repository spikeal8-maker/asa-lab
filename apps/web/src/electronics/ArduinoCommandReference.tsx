import { useMemo, useState, type DragEvent } from 'react';
import {
  ARDUINO_COMMAND_CATEGORY_LABELS,
  ARDUINO_SNIPPET_MIME,
  arduinoSupportStatusLabel,
  filterArduinoCommandReference,
  type ArduinoCommandCategory,
  type ArduinoCommandReferenceEntry,
} from './arduino-command-reference';

function CommandReferenceItem({
  entry,
  expanded,
  canInsert,
  onExpandedChange,
  onInsert,
}: {
  entry: ArduinoCommandReferenceEntry;
  expanded: boolean;
  canInsert: boolean;
  onExpandedChange: () => void;
  onInsert: (snippet: string) => void;
}): JSX.Element {
  function startDrag(event: DragEvent<HTMLButtonElement>): void {
    if (!canInsert) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = 'copy';
    event.dataTransfer.setData(ARDUINO_SNIPPET_MIME, entry.example);
    event.dataTransfer.setData('text/plain', entry.example);
  }

  return (
    <article
      className={`arduino-command-reference-item support-${entry.status}${expanded ? ' expanded' : ''}`}
    >
      <header>
        <button
          type="button"
          className="arduino-command-drag"
          draggable={canInsert}
          onDragStart={startDrag}
          onClick={() => {
            if (canInsert) onInsert(entry.example);
          }}
          title={
            canInsert
              ? 'Щёлкните или перетащите пример в код'
              : 'Вставка доступна в текстовом режиме'
          }
        >
          <span aria-hidden="true">⋮⋮</span>
          <code>{entry.signature}</code>
        </button>
        <span className="arduino-command-status">{arduinoSupportStatusLabel(entry.status)}</span>
        <button
          type="button"
          className="arduino-command-expand"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Свернуть' : 'Развернуть'} описание ${entry.signature}`}
          onClick={onExpandedChange}
        >
          ‹
        </button>
      </header>
      {expanded ? (
        <div className="arduino-command-reference-details">
          <p>{entry.summary}</p>
          <small>{entry.limits}</small>
          <pre>{entry.example}</pre>
          {canInsert ? (
            <button type="button" onClick={() => onInsert(entry.example)}>
              Вставить пример в код
            </button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

export function ArduinoCommandReference({
  open,
  canInsert,
  onClose,
  onInsert,
}: {
  open: boolean;
  canInsert: boolean;
  onClose: () => void;
  onInsert: (snippet: string) => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ArduinoCommandCategory | 'all'>('all');
  const [expandedCommands, setExpandedCommands] = useState<ReadonlySet<string>>(() => new Set());
  const entries = useMemo(() => filterArduinoCommandReference(query, category), [category, query]);
  const groups = useMemo(
    () =>
      (Object.entries(ARDUINO_COMMAND_CATEGORY_LABELS) as [ArduinoCommandCategory, string][])
        .map(([group, label]) => ({
          group,
          label,
          entries: entries.filter((entry) => entry.category === group),
        }))
        .filter((group) => group.entries.length > 0),
    [entries],
  );

  function toggleExpanded(command: string): void {
    setExpandedCommands((current) => {
      const next = new Set(current);
      if (next.has(command)) next.delete(command);
      else next.add(command);
      return next;
    });
  }

  if (!open) return null;

  return (
    <aside className="arduino-command-reference" aria-label="Справочник команд Arduino">
      <header>
        <div>
          <strong>Команды Arduino</strong>
          <small>
            {canInsert
              ? 'Щёлкните или перетащите команду в код'
              : 'Для вставки перейдите в режим «Текст»'}
          </small>
        </div>
        <button type="button" onClick={onClose} aria-label="Закрыть справочник команд">
          ×
        </button>
      </header>
      <div className="arduino-command-reference-filters">
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Найти команду"
          aria-label="Поиск команды Arduino"
        />
        <select
          value={category}
          onChange={(event) => setCategory(event.target.value as ArduinoCommandCategory | 'all')}
          aria-label="Категория команд Arduino"
        >
          <option value="all">Все категории</option>
          {Object.entries(ARDUINO_COMMAND_CATEGORY_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <output className="arduino-command-reference-count">Найдено: {entries.length}</output>
      <div className="arduino-command-reference-list">
        {groups.map((group) => (
          <section className="arduino-command-reference-group" key={group.group}>
            <h3>
              {group.label}
              <span>{group.entries.length}</span>
            </h3>
            {group.entries.map((entry) => (
              <CommandReferenceItem
                key={entry.command}
                entry={entry}
                expanded={expandedCommands.has(entry.command)}
                canInsert={canInsert}
                onExpandedChange={() => toggleExpanded(entry.command)}
                onInsert={onInsert}
              />
            ))}
          </section>
        ))}
        {entries.length === 0 ? (
          <p className="arduino-command-reference-empty">Ничего не найдено.</p>
        ) : null}
      </div>
    </aside>
  );
}
