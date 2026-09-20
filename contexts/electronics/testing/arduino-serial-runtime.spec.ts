import { describe, expect, it } from 'vitest';
import {
  advanceClockedArduinoRuntime,
  resetArduinoRuntime,
  type ArduinoRuntimeState,
} from '../domain/arduino-program-runtime.js';
import {
  appendArduinoSerialTx,
  arduinoSerialAvailable,
  ARDUINO_SERIAL_RX_BUFFER_LIMIT,
  ARDUINO_SERIAL_TX_HISTORY_LIMIT,
  ARDUINO_SERIAL_TX_TEXT_LIMIT,
  beginArduinoSerial,
  enqueueArduinoSerialRx,
  initialArduinoSerialState,
  isArduinoSerialState,
  readArduinoSerial,
} from '../domain/arduino-serial-runtime.js';

function through(
  source: string,
  targetTimeMs: number,
  instructionBudget = 16_384,
  previous?: ArduinoRuntimeState,
) {
  for (let attempt = 0; attempt < 100_000; attempt++) {
    const result = advanceClockedArduinoRuntime(source, {}, targetTimeMs, previous, undefined, {
      instructionBudget,
    });
    if (result.executionStatus !== 'yielded') return result;
    previous = JSON.parse(JSON.stringify(result.state)) as ArduinoRuntimeState;
  }
  throw new Error('Serial program did not reach target time');
}

describe('Arduino deterministic Serial TX runtime', () => {
  it('records begin metadata and ordered print/println TX at canonical instruction timestamps', () => {
    const source = `
      void setup() {
        Serial.begin(9600);
        Serial.print(12);
        Serial.println(34);
        Serial.println();
        Serial.print("hello");
        Serial.println("world");
      }
      void loop() { delay(100); }
    `;
    const result = through(source, 1);
    expect(result.diagnostics).toEqual([]);
    expect(result.state.serial).toMatchObject({
      version: 1,
      begun: true,
      baudRate: 9600,
      nextTxSequence: 5,
    });
    expect(result.state.serial?.tx.map((entry) => entry.text)).toEqual([
      '12',
      '34\n',
      '\n',
      'hello',
      'world\n',
    ]);
    const timestamps = result.state.serial!.tx.map((entry) => entry.atMicroseconds);
    expect(timestamps.every(Number.isSafeInteger)).toBe(true);
    expect(timestamps.slice(1).every((value, index) => value === timestamps[index]! + 1)).toBe(
      true,
    );
  });

  it('does not invent TX before Serial.begin and does not fault the runtime', () => {
    const result = through('void setup(){Serial.println(1);}void loop(){delay(100);}', 1);
    expect(result.executionStatus).toBe('ready');
    expect(result.diagnostics).toEqual([]);
    expect(result.state.serial).toEqual(initialArduinoSerialState());
  });

  it('continues sequence after JSON restore without duplicating earlier TX', () => {
    const source = `
      void setup() {
        Serial.begin(9600);
        Serial.println(1);
        delayMicroseconds(20);
        Serial.println(2);
      }
      void loop(){delay(100);}
    `;
    const early = through(source, 0.01);
    expect(early.state.serial?.tx.map((entry) => entry.text)).toEqual(['1\n']);
    const restored = JSON.parse(JSON.stringify(early.state)) as ArduinoRuntimeState;
    const resumed = through(source, 0.1, 16_384, restored);
    expect(resumed.state.serial?.tx.map((entry) => [entry.sequence, entry.text])).toEqual([
      [0, '1\n'],
      [1, '2\n'],
    ]);
    expect(isArduinoSerialState(resumed.state.serial)).toBe(true);
  });

  it('is invariant across large and one-instruction work partitions', () => {
    const source = `
      int count=0;
      void setup(){Serial.begin(115200);}
      void loop(){
        count++;
        Serial.print(count);
        Serial.println(" tick");
        delayMicroseconds(10);
      }
    `;
    const whole = through(source, 0.08, 16_384);
    const partitioned = through(source, 0.08, 1);
    expect(partitioned.state).toEqual(whole.state);
    expect(partitioned.state.serial).toEqual(whole.state.serial);
    expect(partitioned.state.variables).toEqual(whole.state.variables);
  });

  it('resets Serial continuation when the loaded program changes', () => {
    const firstSource =
      'void setup(){Serial.begin(9600);Serial.println(1);}void loop(){delay(100);}';
    const nextSource =
      'void setup(){Serial.begin(115200);Serial.println(2);}void loop(){delay(100);}';
    const first = through(firstSource, 1);
    expect(first.state.serial?.tx).toHaveLength(1);

    const changedStart = through(nextSource, 2, 16_384, first.state);
    expect(changedStart.state.serial?.baudRate).toBe(115200);
    expect(changedStart.state.serial?.nextTxSequence).toBe(0);
    expect(changedStart.state.serial?.tx).toEqual([]);

    const changed = through(nextSource, 3, 16_384, changedStart.state);
    expect(changed.state.serial?.baudRate).toBe(115200);
    expect(changed.state.serial?.nextTxSequence).toBe(1);
    expect(changed.state.serial?.tx.map((entry) => entry.text)).toEqual(['2\n']);
  });

  it('starts a fresh Serial sequence on explicit runtime reset', () => {
    const source = `
      void setup(){Serial.begin(9600);}
      void loop(){Serial.println(7);delay(1);}
    `;
    const accumulated = through(source, 4);
    expect(accumulated.state.serial!.nextTxSequence).toBeGreaterThan(1);

    const reset = resetArduinoRuntime(source, {}, 0);
    expect(reset.diagnostics).toEqual([]);
    expect(reset.state.serial?.nextTxSequence).toBe(1);
    expect(reset.state.serial?.tx).toEqual([expect.objectContaining({ sequence: 0, text: '7\n' })]);
  });

  it('keeps old TX-only v1 state valid and round-trips bounded RX bytes deterministically', () => {
    const legacy = { version: 1 as const, begun: true, baudRate: 9600, nextTxSequence: 0, tx: [] };
    expect(isArduinoSerialState(legacy)).toBe(true);

    let state = beginArduinoSerial(initialArduinoSerialState(), 9600);
    state = enqueueArduinoSerialRx(state, 10, 'A€');
    expect(arduinoSerialAvailable(state)).toBe(4);
    expect(state.rx?.map((entry) => entry.byte)).toEqual([65, 0xe2, 0x82, 0xac]);
    expect(JSON.parse(JSON.stringify(state))).toEqual(state);

    const first = readArduinoSerial(state);
    expect(first.value).toBe(65);
    expect(arduinoSerialAvailable(first.state)).toBe(3);
    const second = readArduinoSerial(first.state);
    expect(second.value).toBe(0xe2);
  });

  it('ignores RX before begin, returns -1 when empty and drops overflow tail', () => {
    const cold = initialArduinoSerialState();
    expect(enqueueArduinoSerialRx(cold, 0, 'AB')).toEqual(cold);
    expect(readArduinoSerial(cold).value).toBe(-1);

    let state = beginArduinoSerial(cold, 9600);
    state = enqueueArduinoSerialRx(state, 5, 'x'.repeat(300));
    expect(state.rx).toHaveLength(ARDUINO_SERIAL_RX_BUFFER_LIMIT);
    expect(state.nextRxSequence).toBe(ARDUINO_SERIAL_RX_BUFFER_LIMIT);
    expect(state.rx?.at(-1)).toMatchObject({ sequence: 255, atMicroseconds: 5, byte: 120 });
    expect(enqueueArduinoSerialRx(state, 6, 'later')).toEqual(state);
  });

  it('keeps TX history and each TX payload deterministically bounded', () => {
    let state = { ...initialArduinoSerialState(), begun: true, baudRate: 9600 };
    for (let index = 0; index < 300; index++)
      state = appendArduinoSerialTx(
        state,
        index,
        index === 299 ? 'x'.repeat(ARDUINO_SERIAL_TX_TEXT_LIMIT + 100) : String(index),
      );

    expect(state.tx).toHaveLength(ARDUINO_SERIAL_TX_HISTORY_LIMIT);
    expect(state.tx[0]?.sequence).toBe(44);
    expect(state.tx.at(-1)?.sequence).toBe(299);
    expect(state.tx.at(-1)?.text).toHaveLength(ARDUINO_SERIAL_TX_TEXT_LIMIT);
    expect(isArduinoSerialState(JSON.parse(JSON.stringify(state)))).toBe(true);
  });
});
