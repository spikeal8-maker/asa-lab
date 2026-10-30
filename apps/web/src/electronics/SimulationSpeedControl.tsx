import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { SIMULATION_RATES, type SimulationPacing } from './simulation-pacing';

function rateLabel(rate: number): string {
  return rate === 0 ? 'Пауза' : `×${String(rate).replace('.', ',')}`;
}

export function SimulationSpeedControl({
  pacing,
  onChange,
  children,
}: {
  readonly pacing: SimulationPacing;
  readonly onChange: (rate: number) => void;
  readonly children: ReactNode;
}) {
  const state = useSyncExternalStore(pacing.subscribe, pacing.read, pacing.read);
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
        onClick={() => setOpen((value) => !value)}
      >
        {children}
        <span className="workbench-simulation-rate">
          {state.phase === 'pausing' ? 'Приостановка…' : rateLabel(state.rate)}
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
