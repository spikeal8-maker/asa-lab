import type { LiveClockPort, LiveIdPort } from '../application/ports';

export class MutableLiveClock implements LiveClockPort {
  constructor(private value: number) {}

  nowMs(): number {
    return this.value;
  }

  set(nowMs: number): void {
    this.value = nowMs;
  }

  advance(deltaMs: number): void {
    this.value += deltaMs;
  }
}

export class DeterministicLiveIds implements LiveIdPort {
  private counters = new Map<string, number>();
  private publicCounter = 0;
  private bit: 0 | 1 = 0;

  nextId(prefix: 'challenge' | 'game' | 'event' | 'ticket' | 'rating'): string {
    const next = (this.counters.get(prefix) ?? 0) + 1;
    this.counters.set(prefix, next);
    return `${prefix}:${next}`;
  }

  nextPublicCode(): string {
    this.publicCounter += 1;
    return `LIVE${String(this.publicCounter).padStart(8, '0')}`;
  }

  randomBit(): 0 | 1 {
    const value = this.bit;
    this.bit = value === 0 ? 1 : 0;
    return value;
  }
}
