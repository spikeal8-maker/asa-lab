/* @vitest-environment jsdom */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ElectronicsArduinoSerialProjection } from '@asa-lab/electronics/engine';
import { ArduinoSerialMonitor, type ArduinoSerialMonitorProps } from '../ArduinoSerialMonitor';

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

const projection = (
  componentId: string,
  texts: readonly string[],
  begun = true,
): ElectronicsArduinoSerialProjection => ({
  componentId,
  begun,
  ...(begun ? { baudRate: 9600 } : {}),
  tx: texts.map((text, sequence) => ({
    sequence,
    atMicroseconds: sequence + 1,
    text,
  })),
  rxPendingBytes: 0,
});

let host: HTMLDivElement | null = null;
let root: Root | null = null;

function renderMonitor(patch: Partial<ArduinoSerialMonitorProps> = {}): ArduinoSerialMonitorProps {
  const props: ArduinoSerialMonitorProps = {
    open: true,
    running: true,
    boardId: 'a',
    serial: projection('a', ['one\n', 'two\n']),
    onOpenChange: vi.fn(),
    onSend: vi.fn(),
    ...patch,
  };
  host ??= document.body.appendChild(document.createElement('div'));
  root ??= createRoot(host);
  act(() => root!.render(createElement(ArduinoSerialMonitor, props)));
  return props;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  root = null;
  host?.remove();
  host = null;
});

describe('Arduino real Serial Monitor', () => {
  it('shows real TX in runtime order and actual runtime baud', () => {
    renderMonitor();
    const output = host!.querySelector('.arduino-serial-output')!;
    expect(output.textContent).toContain('one');
    expect(output.textContent).toContain('two');
    expect(output.textContent!.indexOf('one')).toBeLessThan(output.textContent!.indexOf('two'));
    const baud = host!.querySelector(
      'input[aria-label="Скорость последовательного порта"]',
    ) as HTMLInputElement;
    expect(baud.readOnly).toBe(true);
    expect(baud.value).toBe('9600 бод');
    expect(host!.textContent).toContain('Подключён');
  });

  it('sends RX without echoing user input into TX output', () => {
    const props = renderMonitor({ serial: projection('a', []) });
    const input = host!.querySelector(
      'input[aria-label="Сообщение в последовательный порт"]',
    ) as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
    act(() => {
      setter.call(input, 'ABC');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => {
      host!
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    expect(props.onSend).toHaveBeenCalledWith('a', 'ABC');
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('');
  });

  it('isolates boards and clear hides only already-seen TX', () => {
    renderMonitor();
    const clear = Array.from(host!.querySelectorAll('button')).find(
      (button) => button.textContent === 'Очист.',
    )!;
    act(() => clear.click());
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('');

    renderMonitor({ serial: projection('a', ['one\n', 'two\n', 'three\n']) });
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toContain('three');
    expect(host!.querySelector('.arduino-serial-output')!.textContent).not.toContain('one');

    renderMonitor({ boardId: 'b', serial: projection('b', ['board-b\n']) });
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toContain('board-b');
    expect(host!.querySelector('.arduino-serial-output')!.textContent).not.toContain('three');
  });

  it('reports stopped and waiting-for-begin states from runtime truth', () => {
    renderMonitor({ running: false });
    expect(host!.textContent).toContain('Остановлен');
    renderMonitor({ running: true, serial: projection('a', [], false) });
    expect(host!.textContent).toContain('Ожидает Serial.begin');
  });
});
