import { useMemo, useState } from 'react';
import {
  ARDUINO_COMMAND_CATEGORY_LABELS,
  arduinoSupportStatusLabel,
  filterArduinoCommandReference,
  type ArduinoCommandCategory,
} from './arduino-command-reference';

export function ArduinoCommandReference({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element | null {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ArduinoCommandCategory | 'all'>('all');
  const entries = useMemo(() => filterArduinoCommandReference(query, category), [category, query]);

  if (!open) return null;

  return (
    <aside className="arduino-command-reference" aria-label="Справочник команд Arduino">
      <header>
        <div>
          <strong>Команды Arduino</strong>
          <small>Показываются только фактические возможности симуляции</small>
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
        {entries.map((entry) => (
          <article key={entry.command} className={`support-${entry.status}`}>
            <header>
              <code>{entry.signature}</code>
              <span>{arduinoSupportStatusLabel(entry.status)}</span>
            </header>
            <p>{entry.summary}</p>
            <small>{entry.limits}</small>
            <pre>{entry.example}</pre>
          </article>
        ))}
        {entries.length === 0 ? (
          <p className="arduino-command-reference-empty">Ничего не найдено.</p>
        ) : null}
      </div>
    </aside>
  );
}
