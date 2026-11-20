/**
 * A wall-time request for a genuinely acknowledged sleeping Arduino instruction.
 * The producer only supplies a deadline; it never advances an electrical state.
 */
export interface ArduinoWakeClock {
  readonly now: () => number;
  readonly setTimeout: (callback: () => void, delayMs: number) => number;
  readonly clearTimeout: (id: number) => void;
}

export interface ArduinoWakeLease {
  readonly startedAtMs: number | null;
  readonly hostOffsetMicroseconds: number;
  readonly source: object;
  readonly active: boolean;
}

/**
 * The one pending wake belongs to its original source and host session.
 * Late ACKs of the *same* instruction must not retire the already queued timer.
 * Busy sub-5ms loops rely on the unchanged host interval instead.
 */
export function createArduinoAcknowledgedWake(
  clock: ArduinoWakeClock,
  readLease: () => ArduinoWakeLease,
  dispatchCurrentHostDemand: () => void,
) {
  let pending: { dueMicroseconds: number; source: object; timeout: number } | null = null;

  const cancel = () => {
    if (pending) clock.clearTimeout(pending.timeout);
    pending = null;
  };

  const schedule = (dueMicroseconds: number | null) => {
    const lease = readLease();
    if (!lease.active || lease.startedAtMs === null || dueMicroseconds === null) {
      cancel();
      return;
    }
    if (pending?.dueMicroseconds === dueMicroseconds && pending.source === lease.source) return;
    cancel();

    const remainingMs =
      lease.startedAtMs + (dueMicroseconds - lease.hostOffsetMicroseconds) / 1000 - clock.now();
    if (!Number.isFinite(remainingMs) || remainingMs < 5 || remainingMs > 25_000) return;

    const timeout = clock.setTimeout(
      () => {
        if (pending?.timeout !== timeout) return;
        pending = null;
        const current = readLease();
        if (!current.active || current.source !== lease.source) return;
        dispatchCurrentHostDemand();
      },
      Math.ceil(remainingMs + 0.5),
    );
    pending = { dueMicroseconds, source: lease.source, timeout };
  };

  return { schedule, cancel };
}
