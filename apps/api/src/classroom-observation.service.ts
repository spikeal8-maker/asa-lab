import { HttpException } from '@nestjs/common';
import type pg from 'pg';

/** Only fixed, scoped SECURITY DEFINER readers; the runtime role cannot read
 * underlying projects, identities, analytics or obligation helpers directly. */
export class ClassroomObservationService {
  constructor(private readonly pool: pg.Pool) {}
  async read<T>(
    fn:
      | 'classroom_observation_summary'
      | 'classroom_observation_projects'
      | 'classroom_observation_history'
      | 'classroom_participant_prepare',
    args: unknown[],
  ): Promise<T> {
    const result = await this.pool.query<{ data: T | null }>(
      `SELECT ${fn}(${args.map((_, i) => `$${i + 1}`).join(',')}) AS data`,
      args,
    );
    const data = result.rows[0]?.data;
    if (data === null || data === undefined || data === false) {
      throw new HttpException({ error: { code: 'not_found', message: 'Класс недоступен.' } }, 404);
    }
    return data;
  }
}
