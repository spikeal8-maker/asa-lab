import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SIMULATION_RATES, type SimulationPacing } from './simulation-pacing';
import type { NativeOpticalPresentation } from './native-optical-presentation';

type CommittedClock = Pick<NativeOpticalPresentation, 'readClock' | 'subscribeClock'>;

const SAMPLE_INTERVAL_MS = 1000;

function formatRate(rate: number): string {
  return `×${String(rate).replace('.', ',')}`;
}

function rateLabel(rate: number): string {
  return rate === 0 ? 'Пауза' : formatRate(rate);
}

function measuredRateLabel(rate: number | null): string {
  if (rate === null) return '—';
  if (rate > 0 && rate < 0.01) return '<×0,01';
  return formatRate(Math.round(rate * 100) / 100);
}

export function SimulationSpeedControl({
  pacing,
  committedClock = null,
  onChange,
  children,
}: {
  readonly pacing: SimulationPacing;
  readonly committedClock?: CommittedClock | null;
  readonly onChange: (rate: number) => void;
  readonly children: ReactNode;
}) {
  const state = useSyncExternalStore(pacing.subscribe, pacing.read, pacing.read);
  const [sample, setSample] = useState<{
    clock: CommittedClock;
    pace: typeof state;
    rate: number;
  } | null>(null);
  useEffect(() => {
    if (!committedClock || state.rate === 0) {
      setSample(null);
      return;
    }

    let timer: number | undefined;
    let model = committedClock.readClock();
    const resetSample = () => {
      window.clearInterval(timer);
      setSample(null);
      if (document.hidden) return;

      let wall = window.performance.now();
      let previous = committedClock.readClock();
      timer = window.setInterval(() => {
        const now = window.performance.now();
        const committed = committedClock.readClock();
        const elapsed = now - wall;
        if (elapsed <= 0) return;
        const rate = (committed - previous) / 1000 / elapsed;
        setSample((last) =>
          last?.clock === committedClock && last.pace === state && last.rate === rate
            ? last
            : { clock: committedClock, pace: state, rate },
        );
        previous = committed;
        wall = now;
      }, SAMPLE_INTERVAL_MS);
    };
    const unsubscribe = committedClock.subscribeClock(() => {
      const committed = committedClock.readClock();
      if (committed < model) resetSample();
      model = committed;
    });
    document.addEventListener('visibilitychange', resetSample);
    resetSample();
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', resetSample);
      unsubscribe();
    };
  }, [committedClock, state]);

  const actual = sample?.clock === committedClock && sample.pace === state ? sample.rate : null;
  const actualLabel = measuredRateLabel(actual);
  const slower = actual !== null && actual < state.rate * 0.9;
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 8, top: 64 });
  const host = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const positionPanel = () => {
      const bounds = button.current?.getBoundingClientRect();
      if (bounds)
        setPosition({
          left: Math.max(8, Math.min(bounds.left, window.innerWidth - 308)),
          top: Math.max(8, Math.min(bounds.bottom + 6, window.innerHeight - 180)),
        });
    };
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !host.current?.contains(event.target)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    positionPanel();
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    window.addEventListener('resize', positionPanel);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key);
      window.removeEventListener('resize', positionPanel);
    };
  }, [open]);
  return (
    <div className="workbench-simulation-pace" ref={host}>
      <button
        ref={button}
        type="button"
        className="workbench-simulation-clock-button"
        aria-label="Изменить скорость моделирования"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-description={
          state.rate > 0
            ? `Фактическая скорость ${actualLabel}. Выбрано ${rateLabel(state.rate)}.`
            : undefined
        }
        onClick={() => setOpen((value) => !value)}
      >
        {children}
        <span className="workbench-simulation-rate" data-actual-rate={actual ?? undefined}>
          {state.phase === 'pausing' ? 'Пауза…' : state.rate === 0 ? 'Пауза' : actualLabel}
        </span>
      </button>
      {open ? (
        <div
          className="workbench-simulation-pace-panel"
          role="dialog"
          aria-label="Скорость моделирования"
          style={position}
        >
          <label htmlFor="electronics-simulation-rate">
            Скорость моделирования:{' '}
            <strong>{state.phase === 'pausing' ? 'Приостановка…' : rateLabel(state.rate)}</strong>
          </label>
          {state.rate > 0 && (
            <div>
              Фактически: {actualLabel}
              {slower ? ' · Медленнее выбранной' : null}
            </div>
          )}
          <input
            id="electronics-simulation-rate"
            type="range"
            min="0"
            max={SIMULATION_RATES.length - 1}
            step="1"
            value={SIMULATION_RATES.indexOf(state.rate as (typeof SIMULATION_RATES)[number])}
            aria-valuetext={rateLabel(state.rate)}
            onChange={(event) => onChange(SIMULATION_RATES[Number(event.target.value)]!)}
          />
          <div className="workbench-simulation-pace-scale">
            <span>Пауза</span>
            <span>×1</span>
            <span>×10</span>
          </div>
          <div className="workbench-simulation-pace-actions">
            <button
              type="button"
              onClick={() => onChange(state.rate === 0 ? state.lastNonZero : 0)}
            >
              {state.rate === 0 ? `Продолжить ${rateLabel(state.lastNonZero)}` : 'Пауза'}
            </button>
            <button type="button" onClick={() => onChange(1)}>
              ×1
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
