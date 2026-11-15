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

it('shows new TX after Clear then stopped/reset runtime and Run', () => {
  renderMonitor();
  act(() =>
    Array.from(host!.querySelectorAll('button'))
      .find((button) => button.textContent === 'Очист.')!
      .click(),
  );
  renderMonitor({ running: false, serial: undefined });
  renderMonitor({ serial: projection('a', ['512\n']) });
  expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('512\n');
});

it.each([1, 2])(
  'distinguishes identical reset/source generations after clearing %i TX entries',
  (count) => {
    const tx = projection('a', Array(count).fill('512\n'));
    renderMonitor({ serial: { ...tx, streamGeneration: 'project:1' } });
    act(() =>
      Array.from(host!.querySelectorAll('button'))
        .find((b) => b.textContent === 'Очист.')!
        .click(),
    );
    renderMonitor({ running: false, serial: { ...tx, streamGeneration: 'project:1' } });
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('');
    renderMonitor({ open: false, serial: { ...tx, streamGeneration: 'project:1' } });
    renderMonitor({ open: true, serial: { ...tx, streamGeneration: 'project:1' } });
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('');
    // Reset/source replay has exactly the same sequence, time and text; no empty render.
    renderMonitor({ serial: { ...tx, streamGeneration: 'project:2' } });
    expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('512\n'.repeat(count));
  },
);

it.each([
  { name: 'missing projection', running: true, serial: undefined },
  { name: 'waiting for begin', running: true, serial: projection('a', [], false) },
  { name: 'stopped initialized port', running: false, serial: projection('a', []) },
])('retains unsent input while $name and sends once after connection', (patch) => {
  const props = renderMonitor(patch);
  const input = host!.querySelector(
    'input[aria-label="Сообщение в последовательный порт"]',
  ) as HTMLInputElement;
  const send = host!.querySelector('button[type="submit"]') as HTMLButtonElement;
  const form = host!.querySelector('form')!;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => {
    setter.call(input, 'A');
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(send.disabled).toBe(true);
  expect(input.disabled).toBe(!patch.running);
  // A forced submit also covers Enter/programmatic submission bypassing the disabled button.
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(props.onSend).not.toHaveBeenCalled();
  expect(input.value).toBe('A');
  expect(host!.querySelector('.arduino-serial-output')!.textContent).toBe('');

  renderMonitor({ running: true, serial: projection('a', []), onSend: props.onSend });
  expect(input.value).toBe('A');
  expect(send.disabled).toBe(false);
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(props.onSend).toHaveBeenCalledExactlyOnceWith('a', 'A');
  expect(input.value).toBe('');
  expect(send.disabled).toBe(true);
  act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(props.onSend).toHaveBeenCalledTimes(1);
});
