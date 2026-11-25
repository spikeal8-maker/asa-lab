import { useMemo, useRef, useState } from 'react';
import { parseElectronicsDocument } from '@asa-lab/electronics';

export default function ClassroomExactArduinoSource({
  document,
}: {
  readonly document: unknown;
}): JSX.Element | null {
  const boards = useMemo(() => {
    const parsed = parseElectronicsDocument(document);
    if (!parsed.ok) return [];
    return parsed.document.components.flatMap((board) => {
      const isArduino =
        board.componentTypeId === 'arduino-uno' || board.variantId === 'arduino-uno';
      const source = board.stateProperties?.['arduinoSource'];
      return isArduino && typeof source === 'string' && source.trim()
        ? [{ id: board.id, name: board.name?.trim(), source }]
        : [];
    });
  }, [document]);
  const [open, setOpen] = useState(false);
  const summary = useRef<HTMLElement>(null);
  if (boards.length === 0) return null;

  return (
    <details
      className="gradebook-arduino-source"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onKeyDown={(event) => {
        if (event.key !== 'Escape' || !event.currentTarget.open) return;
        event.preventDefault();
        event.currentTarget.open = false;
        summary.current?.focus();
      }}
    >
      <summary ref={summary}>Код Arduino</summary>
      {open &&
        boards.map((board, index) => {
          const name = board.name || 'Arduino Uno';
          const label = boards.length > 1 ? `Плата ${index + 1} · ${name}` : name;
          return (
            <div key={board.id}>
              <div>{label}</div>
              <pre role="region" aria-label={label} tabIndex={0}>
                <code>{board.source}</code>
              </pre>
            </div>
          );
        })}
    </details>
  );
}
