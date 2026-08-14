import type { CheckersDocumentResult } from '../domain/document.js';
import type { CheckersGameRepository, CheckersGameSession } from '../application/game-service.js';

function copy(session: CheckersGameSession): CheckersGameSession {
  return structuredClone(session);
}

export class InMemoryCheckersGameRepository implements CheckersGameRepository {
  private readonly sessions = new Map<string, CheckersGameSession>();

  async findById(id: string): Promise<CheckersGameSession | null> {
    const session = this.sessions.get(id);
    return session ? copy(session) : null;
  }

  async create(session: CheckersGameSession): Promise<CheckersDocumentResult<CheckersGameSession>> {
    if (this.sessions.has(session.id)) {
      return { ok: false, message: 'Checkers session already exists' };
    }
    const stored = copy(session);
    this.sessions.set(stored.id, stored);
    return { ok: true, value: copy(stored) };
  }

  async save(
    session: CheckersGameSession,
    expectedVersion: number,
  ): Promise<CheckersDocumentResult<CheckersGameSession>> {
    const current = this.sessions.get(session.id);
    if (!current) return { ok: false, message: 'Checkers session not found' };
    if (current.version !== expectedVersion) {
      return {
        ok: false,
        message: `session version conflict: current version is ${current.version}`,
      };
    }
    if (session.version !== expectedVersion + 1) {
      return { ok: false, message: 'saved session must advance the version exactly once' };
    }
    const stored = copy(session);
    this.sessions.set(stored.id, stored);
    return { ok: true, value: copy(stored) };
  }
}
