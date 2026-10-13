import { journalShiftMonth } from '../classroom-journal-api';

export function JournalMonthNavigation({
  month,
  disabled,
  onChange,
}: {
  month: string;
  disabled?: boolean;
  onChange: (month: string) => void;
}) {
  return (
    <nav className="manual-journal-monthbar" aria-label="Навигация по месяцам журнала">
      <button
        type="button"
        aria-label="Предыдущий месяц"
        title="Предыдущий месяц"
        disabled={disabled || !month || month <= '2000-01'}
        onClick={() => onChange(journalShiftMonth(month, -1))}
      >
        <span aria-hidden="true">‹</span>
      </button>
      <label>
        Месяц журнала{' '}
        <input
          type="month"
          min="2000-01"
          max="2100-12"
          value={month}
          disabled={disabled}
          onChange={(event) => {
            if (/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(event.target.value))
              onChange(event.target.value);
          }}
        />
      </label>
      <button
        type="button"
        aria-label="Следующий месяц"
        title="Следующий месяц"
        disabled={disabled || !month || month >= '2100-12'}
        onClick={() => onChange(journalShiftMonth(month, 1))}
      >
        <span aria-hidden="true">›</span>
      </button>
    </nav>
  );
}
