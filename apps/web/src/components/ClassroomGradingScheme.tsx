import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api';

export function ClassroomGradingScheme({ classroomId }: { classroomId: string }) {
  const [title, setTitle] = useState(''),
    [bands, setBands] = useState([
      { min: '0', label: '' },
      { min: '', label: '' },
    ]);
  const [version, setVersion] = useState<number | null>(null),
    [error, setError] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [loaded, setLoaded] = useState(false);
  const request = useRef<{ payload: string; id: string } | null>(null);
  const load = useCallback(async () => {
    const r = await api.classroomGradingScheme(classroomId);
    if (r.ok) {
      setTitle(r.data.title ?? '');
      setVersion(r.data.version);
      if (r.data.bands.length)
        setBands(
          r.data.bands.map((b) => ({ min: String(b.minBasisPoints / 100), label: b.label })),
        );
      setLoaded(true);
      setError(null);
    } else setError(r.error.message);
  }, [classroomId]);
  useEffect(() => {
    void load();
  }, [load]);
  const valid =
    title.trim() &&
    bands.every(
      (b) =>
        b.label.trim() &&
        b.min !== '' &&
        Number.isInteger(Number(b.min) * 100) &&
        Number(b.min) >= 0 &&
        Number(b.min) <= 100,
    ) &&
    bands.some((b) => Number(b.min) === 0) &&
    new Set(bands.map((b) => Number(b.min))).size === bands.length;
  async function publish() {
    if (!valid || busy) return;
    const values = bands.map((b) => ({
      minBasisPoints: Math.round(Number(b.min) * 100),
      label: b.label.trim(),
    }));
    const payload = JSON.stringify({ title, bands: values });
    if (request.current?.payload !== payload)
      request.current = { payload, id: crypto.randomUUID() };
    setBusy(true);
    setError(null);
    const result = await api.publishGradingScheme(classroomId, title, values, request.current.id);
    setBusy(false);
    if (result.ok) await load();
    else setError(result.error.message);
  }
  return (
    <details className="learning-notification-settings">
      <summary>Шкала новых оцениваемых заданий</summary>
      <p>
        Шкала закрепляется при назначении. Новая версия не меняет прежние задания и результаты. Без
        шкалы показываются только исходные баллы.
      </p>
      {version ? (
        <p role="status">
          Выбрана шкала «{title}», версия {version}.
        </p>
      ) : null}
      {error ? (
        <p role="alert">
          {error}
          <button onClick={() => void load()}>Обновить</button>
        </p>
      ) : null}
      {loaded ? (
        <>
          <label>
            Название шкалы
            <input
              maxLength={120}
              value={title}
              disabled={busy}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          {bands.map((band, index) => (
            <div className="learning-notification-actions" key={index}>
              <label>
                От, %
                <input
                  aria-label={`Порог ${index + 1}, %`}
                  type="number"
                  min="0"
                  max="100"
                  step="0.01"
                  value={band.min}
                  disabled={busy}
                  onChange={(e) =>
                    setBands(bands.map((b, i) => (i === index ? { ...b, min: e.target.value } : b)))
                  }
                />
              </label>
              <label>
                Оценка
                <input
                  aria-label={`Обозначение оценки ${index + 1}`}
                  maxLength={24}
                  value={band.label}
                  disabled={busy}
                  onChange={(e) =>
                    setBands(
                      bands.map((b, i) => (i === index ? { ...b, label: e.target.value } : b)),
                    )
                  }
                />
              </label>
              {bands.length > 2 ? (
                <button
                  disabled={busy}
                  onClick={() => setBands(bands.filter((_, i) => i !== index))}
                >
                  Удалить диапазон {index + 1}
                </button>
              ) : null}
            </div>
          ))}
          <p>
            Каждый порог включён; следующий порог начинает следующий диапазон. Нижний диапазон
            начинается с 0%.
          </p>
          <div className="learning-notification-actions">
            <button
              disabled={busy || bands.length >= 10}
              onClick={() => setBands([...bands, { min: '', label: '' }])}
            >
              Добавить диапазон
            </button>
            <button
              className="btn-primary"
              disabled={busy || !valid}
              onClick={() => void publish()}
            >
              Сохранить шкалу для новых заданий
            </button>
            <button disabled={busy} onClick={() => void load()}>
              Отменить
            </button>
          </div>
        </>
      ) : null}
    </details>
  );
}
