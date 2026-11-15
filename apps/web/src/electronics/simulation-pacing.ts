export const SIMULATION_RATES = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10,
] as const;
export type SimulationPacePhase = 'running' | 'pausing' | 'paused';

/** Session-only host adapter. It never changes a document or canonical continuation. */
export class SimulationPacing {
  private state = { rate: 1, lastNonZero: 1, phase: 'running' as SimulationPacePhase };
  private listeners = new Set<() => void>();
  private anchor = { wall: 0, model: 0 };
  private changed = false;
  readonly subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  readonly read = () => this.state;
  get explicit(): boolean {
    return this.changed;
  }
  request(rate: number): boolean {
    if (!(SIMULATION_RATES as readonly number[]).includes(rate)) return false;
    this.changed = true;
    this.publish({
      rate,
      lastNonZero: rate || this.state.lastNonZero,
      phase: rate === 0 ? 'pausing' : 'running',
    });
    return true;
  }
  reset(): void {
    this.anchor = { wall: 0, model: 0 };
    this.changed = this.state.rate !== 1;
  }
  reanchor(committed: number, wall: number): void {
    this.anchor = { wall, model: committed };
  }
  settlePause(): void {
    if (this.state.rate === 0 && this.state.phase !== 'paused')
      this.publish({ ...this.state, phase: 'paused' });
  }
  horizon(wall: number, committed: number): number | null {
    return this.state.rate === 0
      ? null
      : Math.max(
          committed,
          this.anchor.model + Math.floor(Math.max(0, wall - this.anchor.wall) * this.state.rate),
        );
  }
  private publish(state: typeof this.state): void {
    this.state = state;
    for (const listener of this.listeners) listener();
  }
}
