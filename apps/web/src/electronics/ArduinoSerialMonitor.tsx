import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import type { ElectronicsArduinoSerialProjection } from '@asa-lab/electronics/engine';

export interface ArduinoSerialMonitorProps {
  readonly open: boolean;
  readonly running: boolean;
  readonly boardId: string;
  readonly serial?: ElectronicsArduinoSerialProjection;
  readonly onOpenChange: (open: boolean) => void;
  readonly onSend: (boardId: string, text: string) => void;
}

function Chevron(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m4 6 4 4 4-4" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArduinoSerialMonitor({
  open,
  running,
  boardId,
  serial,
  onOpenChange,
  onSend,
}: ArduinoSerialMonitorProps): JSX.Element {
  const [input, setInput] = useState('');
  const [clearedThroughByBoard, setClearedThroughByBoard] = useState<
    Readonly<Record<string, number>>
  >({});
  const outputRef = useRef<HTMLDivElement>(null);
  const clearedThrough = clearedThroughByBoard[boardId] ?? -1;
  const visibleTx = useMemo(
    () => (serial?.tx ?? []).filter((entry) => entry.sequence > clearedThrough),
    [clearedThrough, serial?.tx],
  );
  const status = !running ? 'Остановлен' : serial?.begun ? 'Подключён' : 'Ожидает Serial.begin';

  function send(event: FormEvent): void {
    event.preventDefault();
    if (!running || !input) return;
    onSend(boardId, input);
    setInput('');
  }

  function clear(): void {
    const lastSequence = serial?.tx.at(-1)?.sequence;
    if (lastSequence === undefined) return;
    setClearedThroughByBoard((current) => ({ ...current, [boardId]: lastSequence }));
  }

  useEffect(() => {
    const output = outputRef.current;
    if (output) output.scrollTop = output.scrollHeight;
  }, [visibleTx]);

  return (
    <section className={`arduino-serial-monitor${open ? ' open' : ''}`}>
      <button
        type="button"
        className="arduino-serial-title"
        onClick={() => onOpenChange(!open)}
        aria-expanded={open}
      >
        <span className="arduino-serial-icon" aria-hidden="true" />
        Монитор последовательного интерфейса
        <span className={`arduino-serial-status${running && serial?.begun ? ' running' : ''}`}>
          {status}
        </span>
        <Chevron />
      </button>
      <div className="arduino-serial-body" aria-hidden={!open}>
        <div className="arduino-serial-output" ref={outputRef} aria-live="polite">
          {visibleTx.map((entry) => (
            <div key={entry.sequence} style={{ whiteSpace: 'pre-wrap' }}>
              {entry.text}
            </div>
          ))}
        </div>
        <form onSubmit={send}>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="Введите сообщение для Arduino"
            aria-label="Сообщение в последовательный порт"
            disabled={!running}
          />
          <input
            readOnly
            aria-label="Скорость последовательного порта"
            value={serial?.baudRate === undefined ? '—' : `${serial.baudRate} бод`}
          />
          <button type="submit" disabled={!running || !input}>
            Отпр.
          </button>
          <button type="button" onClick={clear}>
            Очист.
          </button>
        </form>
      </div>
    </section>
  );
}
