import { useEffect, useRef, useState } from 'react';
import {
  journalApi,
  journalPresets,
  journalAccessibleLabel,
  journalLevels,
  type JournalScale,
  type JournalPreset,
} from '../classroom-journal-api';

export function JournalScaleSettings({ classroomId }: { classroomId: string }) {
  return <Settings key={classroomId} classroomId={classroomId} />;
}
function Settings({ classroomId }: { classroomId: string }) {
  const [scale, setScale] = useState<JournalScale | null>(null);
  const [preset, setPreset] = useState<JournalPreset>('five');
  const [archived, setArchived] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [saved, setSaved] = useState(false);
  const active = useRef(false);
  const receipt = useRef<{ payload: string; id: string } | null>(null);
  useEffect(() => {
    active.current = true;
    let current = true;
    void journalApi.settings(classroomId).then((r) => {
      if (!current) return;
      if (r.ok) {
        setScale(r.data.scale);
        setPreset(r.data.scale.preset);
        setArchived(r.data.status !== 'active');
        setError('');
      } else setError(r.error.message);
    });
    return () => {
      current = false;
      active.current = false;
    };
  }, [classroomId, reload]);
  async function save() {
    if (!scale || busy || archived) return;
    const input = { preset, expectedRevision: scale.version };
    const payload = JSON.stringify(input);
    if (receipt.current?.payload !== payload)
      receipt.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError('');
    setSaved(false);
    const r = await journalApi.scale(classroomId, { ...input, requestId: receipt.current.id });
    if (!active.current) return;
    setBusy(false);
    if (r.ok) {
      setScale(r.data);
      receipt.current = null;
      setSaved(true);
    } else setError(r.error.message);
  }
  return (
    <section className="learning-notification-settings" aria-label="Шкала ручного журнала">
      <h3>Шкала ручного журнала</h3>
      <p>
        Для новых столбцов. Прежние оценки сохраняют свою шкалу. Ноль — оценка, пустая ячейка —
        отсутствие оценки.
      </p>
      {error ? (
        <p role="alert">
          {error}{' '}
          <button
            disabled={busy}
            onClick={() => {
              receipt.current = null;
              setReload((n) => n + 1);
            }}
          >
            Обновить шкалу
          </button>
        </p>
      ) : null}
      <label>
        Шкала новых столбцов{' '}
        <select
          value={preset}
          disabled={!scale || busy || archived}
          onChange={(e) => {
            setPreset(e.target.value as JournalPreset);
            setSaved(false);
          }}
        >
          {Object.entries(journalPresets).map(([id, title]) => (
            <option key={id} value={id}>
              {title}
            </option>
          ))}
        </select>
      </label>
      {['smileys', 'symbols'].includes(preset) ? (
        <p>
          От низшего к высшему:{' '}
          {journalLevels(preset)
            .map((v) => journalAccessibleLabel(preset, v))
            .join(' → ')}
        </p>
      ) : null}
      <button
        className="btn-primary"
        disabled={!scale || busy || archived}
        onClick={() => void save()}
      >
        {busy ? 'Сохраняем…' : 'Сохранить шкалу'}
      </button>
      {saved ? <p role="status">Шкала сохранена, версия {scale?.version}.</p> : null}
      {archived ? <p>Архивный класс: только просмотр.</p> : null}
    </section>
  );
}
