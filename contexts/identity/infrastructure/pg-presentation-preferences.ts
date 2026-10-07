import type pg from 'pg';
import type {
  PresentationPreferencesPort,
  PresentationSnapshot,
  PresentationWrite,
  PresentationResult,
} from '../application/presentation-preferences.js';
export class PgPresentationPreferences implements PresentationPreferencesPort {
  constructor(private readonly pool: pg.Pool) {}
  async read(accountId: string): Promise<PresentationSnapshot | null> {
    const result = await this.pool.query('SELECT account_presentation_read($1) AS value', [
      accountId,
    ]);
    return result.rows[0]?.value ?? null;
  }
  async write(accountId: string, input: PresentationWrite): Promise<PresentationResult> {
    const result = await this.pool.query(
      'SELECT account_presentation_write($1,$2::jsonb) AS value',
      [accountId, JSON.stringify(input)],
    );
    return result.rows[0].value;
  }
}
