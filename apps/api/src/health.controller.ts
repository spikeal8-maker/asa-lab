import { Controller, Get, Inject, Optional, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import type pg from 'pg';
import { TOKENS } from './tokens.js';

const READINESS_TIMEOUT_MS = 1500;

@Controller('health')
export class HealthController {
  constructor(@Optional() @Inject(TOKENS.pool) private readonly pool: pg.Pool | null) {}

  @Get('live')
  live(): { status: 'live' } {
    return { status: 'live' };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) reply: FastifyReply): Promise<{
    status: 'ready' | 'not_ready';
    dependencies: { database: 'up' | 'down' };
  }> {
    let database: 'up' | 'down' = 'down';
    if (this.pool) {
      try {
        await Promise.race([
          this.pool.query('SELECT 1'),
          new Promise((_resolve, reject) =>
            setTimeout(() => reject(new Error('timeout')), READINESS_TIMEOUT_MS),
          ),
        ]);
        database = 'up';
      } catch {
        database = 'down';
      }
    }
    const ready = database === 'up';
    reply.code(ready ? 200 : 503);
    return { status: ready ? 'ready' : 'not_ready', dependencies: { database } };
  }
}
