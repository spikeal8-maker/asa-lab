import type pg from 'pg';
import { createSessionToken, hashSessionToken, SESSION_TTL_HOURS } from '@asa-lab/identity';

export const REFRESH_TTL_DAYS = 30;

export type SessionSource = 'password' | 'max' | 'organization';

export type RefreshResult =
  | { readonly status: 'rotated'; readonly accessToken: string; readonly refreshToken: string }
  | { readonly status: 'stale' | 'invalid' | 'reused' };

export class RefreshSessionService {
  constructor(private readonly pool: pg.Pool) {}

  async attach(accessToken: string, source: SessionSource): Promise<string | null> {
    const refreshToken = createSessionToken();
    const result = await this.pool.query<{ attached: boolean }>(
      `SELECT session_refresh_attach($1, $2, $3, $4) AS attached`,
      [hashSessionToken(accessToken), hashSessionToken(refreshToken), source, REFRESH_TTL_DAYS],
    );
    return result.rows[0]?.attached === true ? refreshToken : null;
  }

  async rotate(refreshToken: string): Promise<RefreshResult> {
    const accessToken = createSessionToken();
    const nextRefreshToken = createSessionToken();
    const result = await this.pool.query<{ result: 'rotated' | 'stale' | 'invalid' | 'reused' }>(
      `SELECT session_refresh_rotate($1, $2, $3, $4) AS result`,
      [
        hashSessionToken(refreshToken),
        hashSessionToken(accessToken),
        hashSessionToken(nextRefreshToken),
        SESSION_TTL_HOURS,
      ],
    );
    const status = result.rows[0]?.result ?? 'invalid';
    return status === 'rotated'
      ? { status, accessToken, refreshToken: nextRefreshToken }
      : { status };
  }

  async revoke(refreshToken: string | undefined, accessToken: string | undefined): Promise<void> {
    if (!refreshToken && !accessToken) return;
    await this.pool.query(`SELECT session_refresh_revoke($1, $2)`, [
      refreshToken ? hashSessionToken(refreshToken) : '',
      accessToken ? hashSessionToken(accessToken) : '',
    ]);
  }
}
