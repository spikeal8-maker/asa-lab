import type { Terminal } from './document.js';
import type { ArduinoRuntimeEvent, ArduinoRuntimeState } from './arduino-program-runtime.js';

export const ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT = 256 as const;
type EventQueue = readonly ArduinoRuntimeEvent[];

export function isArduinoGpioTerminal(value: unknown): value is Terminal {
  return typeof value === 'string' && /^(?:d(?:[0-9]|1[0-3])|a[0-5])$/.test(value);
}

function validEvent(
  event: ArduinoRuntimeEvent,
  index: number,
  queue: EventQueue,
  nextSequence: number,
): boolean {
  return (
    event !== null &&
    typeof event === 'object' &&
    Number.isSafeInteger(event.sequence) &&
    event.sequence >= 0 &&
    event.sequence < nextSequence &&
    (index === 0 || event.sequence > queue[index - 1]!.sequence) &&
    Number.isSafeInteger(event.atMicroseconds) &&
    event.atMicroseconds >= 0 &&
    (index === 0 || event.atMicroseconds >= queue[index - 1]!.atMicroseconds) &&
    isArduinoGpioTerminal(event.terminal) &&
    ['pin-mode-change', 'output-change', 'tone-start', 'tone-stop'].includes(event.kind) &&
    (event.mode === undefined ||
      event.mode === 'INPUT' ||
      event.mode === 'INPUT_PULLUP' ||
      event.mode === 'OUTPUT') &&
    (event.voltage === undefined ||
      (Number.isFinite(event.voltage) && event.voltage >= 0 && event.voltage <= 5)) &&
    (event.frequencyHz === undefined ||
      (Number.isFinite(event.frequencyHz) && event.frequencyHz >= 1 && event.frequencyHz <= 20_000))
  );
}

export function runtimeHistoryIsValid(state: ArduinoRuntimeState, verified?: EventQueue): boolean {
  return verified
    ? verified.length === 0 || verified[verified.length - 1]!.sequence < state.nextEventSequence
    : state.eventQueue.every((event, index) =>
        validEvent(event, index, state.eventQueue, state.nextEventSequence),
      );
}

function detachValidatedHistory(state: ArduinoRuntimeState): ArduinoRuntimeEvent[] | undefined {
  const source = state.eventQueue;
  const queue: ArduinoRuntimeEvent[] = [];
  for (let index = 0; index < source.length; index++) {
    if (!Object.hasOwn(source, index)) return undefined;
    const event = { ...source[index]! };
    if (!validEvent(event, index, queue, state.nextEventSequence)) return undefined;
    queue.push(event);
  }
  return queue;
}

interface HistoryReceipt {
  readonly state: ArduinoRuntimeState;
  readonly queue: EventQueue;
  readonly project: () => ArduinoRuntimeEvent[];
}

function untouched(receipt: HistoryReceipt | undefined, state: ArduinoRuntimeState) {
  return receipt?.state === state &&
    Object.getOwnPropertyDescriptor(state, 'eventQueue')?.get === receipt.project
    ? receipt.queue
    : undefined;
}

class RuntimeHistoryOwner {
  before?: HistoryReceipt | undefined;
  after?: HistoryReceipt | undefined;
  revoked = false;
}

// The exact runtime object needs to remain live to use a private receipt.
const histories = new WeakMap<object, RuntimeHistoryOwner>();

export function registerRuntimeHistory(owner: object): RuntimeHistoryOwner {
  const history = new RuntimeHistoryOwner();
  histories.set(owner, history);
  return history;
}

export function disposeRuntimeHistory(owner: object): void {
  histories.delete(owner);
}

export function verifiedRuntimeHistory(owner: object, state: ArduinoRuntimeState) {
  const history = histories.get(owner);
  return untouched(history?.after, state) ?? untouched(history?.before, state);
}

export class ArduinoRuntimeEventQueue {
  readonly #history: RuntimeHistoryOwner | undefined;
  #verified: boolean;
  #events: EventQueue;
  #mutable: boolean;

  constructor(previous: ArduinoRuntimeState | undefined, history: RuntimeHistoryOwner | undefined) {
    const inherited = previous ? untouched(history?.after, previous) : undefined;
    // The scheduler has already validated the initial continuation. Import
    // privately once. Inspecting or replacing a detached view ends reuse.
    const loaded =
      previous && history && !history.revoked && !history.after
        ? detachValidatedHistory(previous)
        : undefined;
    this.#history = history;
    this.#verified = Boolean(history && !history.revoked && (!previous || inherited || loaded));
    this.#events = inherited ?? loaded ?? (previous ? [...previous.eventQueue] : []);
    this.#mutable = !inherited;
  }

  append(event: ArduinoRuntimeEvent, nextSequence: number): void {
    if (!this.#mutable) {
      this.#events = [...this.#events];
      this.#mutable = true;
    }
    const queue = this.#events as ArduinoRuntimeEvent[];
    const entry = this.#verified ? { ...event } : event;
    queue.push(entry);
    if (queue.length > ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT)
      queue.splice(0, queue.length - ARDUINO_RUNTIME_EVENT_QUEUE_LIMIT);
    // Entries in the inherited window already passed the full predicate. Head
    // trimming preserves their order and each newly appended entry is checked.
    if (this.#verified && !validEvent(entry, queue.length - 1, queue, nextSequence)) {
      this.#verified = false;
    }
  }

  clear(): void {
    this.#events = [];
    this.#verified = this.#history !== undefined && !this.#history.revoked;
  }

  snapshot(owned: boolean): EventQueue {
    return owned && !this.#verified ? [...this.#events] : this.#events;
  }

  retain(state: ArduinoRuntimeState): void {
    const history = this.#history;
    if (!history) return;
    // The electrical step consumes the pre-instruction view before applying
    // the output and settling the post-instruction view.
    history.before = history.after;
    if (!this.#verified) {
      history.revoked = true;
      history.after = undefined;
      return;
    }
    const queue = this.#events;
    const project = () => {
      const value = queue.map((event) => ({ ...event }));
      Object.defineProperty(state, 'eventQueue', {
        value,
        enumerable: true,
        configurable: true,
        writable: true,
      });
      return value;
    };
    history.after = { state, queue, project };
    Object.defineProperty(state, 'eventQueue', {
      get: project,
      enumerable: true,
      configurable: true,
    });
  }
}
