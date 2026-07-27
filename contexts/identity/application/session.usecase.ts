import { hashSessionToken } from '../domain/session-token.js';
import type { SessionContext, SessionStorePort } from './ports.js';

export class SessionUseCase {
  constructor(private readonly sessions: SessionStorePort) {}

  async resolve(token: string | undefined): Promise<SessionContext | null> {
    if (!token) {
      return null;
    }
    return this.sessions.resolve(hashSessionToken(token));
  }

  async logout(token: string | undefined): Promise<void> {
    if (token) {
      await this.sessions.revoke(hashSessionToken(token));
    }
  }
}
