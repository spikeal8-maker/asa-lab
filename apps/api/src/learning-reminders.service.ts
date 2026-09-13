import {
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
  type OnModuleDestroy,
} from '@nestjs/common';
import type pg from 'pg';
import { TOKENS } from './tokens.js';

/** Database-backed idempotent sweep. No active browser or new queue system is required. */
@Injectable()
export class LearningRemindersService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LearningRemindersService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  constructor(@Inject(TOKENS.pool) private readonly pool: pg.Pool | null) {}
  onModuleInit(): void {
    if (!this.pool) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, 15000);
    this.timer.unref();
  }
  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }
  private async sweep(): Promise<void> {
    if (this.running || !this.pool) return;
    this.running = true;
    try {
      await this.pool.query('SELECT learning_notification_sweep()');
    } catch {
      this.logger.error('Learning reminder sweep failed; persisted evidence will be retried.');
    } finally {
      this.running = false;
    }
  }
}
