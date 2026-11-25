import { lazy, Suspense, useId, useRef, useState, type KeyboardEvent } from 'react';
import type { PublicSimulationComponent } from '@asa-lab/contracts';
import type { ArduinoCodeMode } from '../electronics/arduino-program-state';
import './arduino-program-preview.css';

const Blocks = lazy(() =>
  import('./PublicArduinoBlocks')
    .then((module) => ({ default: module.PublicArduinoBlocks }))
    .catch(() => ({ default: () => <p role="status">Не удалось загрузить просмотр блоков.</p> })),
);

export interface PreviewBoard {
  readonly id: string;
  readonly name: string;
  readonly mode: ArduinoCodeMode;
  readonly workspace: string | null;
  readonly source: string | null;
  readonly scope: 'classroom' | 'publication';
}

export function publishedArduinoPrograms(
  components: readonly PublicSimulationComponent[],
): PreviewBoard[] {
  return components.flatMap((board) => {
    const props = board.stateProperties;
    if (typeof props?.arduinoSource !== 'string') return [];
    const mode = props.arduinoCodeMode;
    return [
      {
        id: board.id,
        name: board.name?.trim() || 'Arduino Uno',
        mode: mode === 'blocks' || mode === 'blocks-text' ? mode : 'text',
        workspace: typeof props.arduinoBlocks === 'string' ? props.arduinoBlocks : null,
        source: props.arduinoSource,
        scope: 'publication',
      },
    ];
  });
}

export function useArduinoProgramPreview(boards: readonly PreviewBoard[]) {
  const [open, setOpen] = useState(false);
  const [headerTools, setHeaderTools] = useState<HTMLDivElement | null>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const panelId = useId();
  const label = boards.every((board) => board.mode === 'text')
    ? 'Код'
    : boards.every((board) => board.mode !== 'text')
      ? 'Блоки'
      : 'Программа';

  function close() {
    setOpen(false);
    opener.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (!open || event.key !== 'Escape' || event.defaultPrevented) return;
    event.preventDefault();
    event.stopPropagation();
    close();
  }

  const button = boards.length ? (
    <button
      ref={opener}
      type="button"
      className="arduino-program-toggle"
      aria-expanded={open}
      aria-controls={open ? panelId : undefined}
      onClick={() => setOpen(!open)}
    >
      {label}
    </button>
  ) : null;
  const panel =
    open && boards.length ? (
      <aside
        id={panelId}
        className="public-electronics-code arduino-program-preview"
        aria-label="Программа"
      >
        <div className="public-electronics-code-heading">
          <strong>{boards.length === 1 ? boards[0]?.name : 'Программа плат'}</strong>
          {boards.length === 1 && boards[0]?.mode !== 'text' && (
            <div ref={setHeaderTools} className="arduino-program-header-tools" />
          )}
          <button type="button" onClick={close} aria-label="Закрыть программу">
            ×
          </button>
        </div>
        {boards.map((board, index) => {
          const name = boards.length > 1 ? `Плата ${index + 1} · ${board.name}` : board.name;
          const code = (
            <pre role="region" aria-label={name} tabIndex={0}>
              <code>{board.source}</code>
            </pre>
          );
          return (
            <div key={board.id}>
              {boards.length > 1 && <h3>{name}</h3>}
              {board.mode === 'text' ? (
                code
              ) : board.workspace ? (
                <Suspense fallback={<p role="status">Загружаем блоки…</p>}>
                  <Blocks value={board.workspace} scope={board.scope} controlsHost={headerTools} />
                </Suspense>
              ) : (
                <p role="status">В этой версии отсутствует сохранённая схема блоков.</p>
              )}
              {board.mode === 'blocks-text' && board.source && (
                <details>
                  <summary>Сгенерированный текст</summary>
                  {code}
                </details>
              )}
            </div>
          );
        })}
      </aside>
    ) : null;
  return { button, panel, onKeyDown };
}
