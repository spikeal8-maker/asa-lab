import type pg from 'pg';

/**
 * A teacher's response to a piece of work.
 *
 * The rule about who may respond lives in the database function, which knows
 * whose learner a project belongs to. This class only carries values across.
 */

export const FEEDBACK_BADGES: readonly string[] = ['excellent', 'good', 'progress', 'redo'];

export interface ProjectFeedbackEntry {
  readonly badge: string | null;
  readonly comment: string | null;
  readonly updatedAt: string;
  readonly author: string;
}

interface FeedbackRow {
  badge: string | null;
  comment: string | null;
  updated_at: Date | string;
  author_display_name: string | null;
}

function toEntry(row: FeedbackRow): ProjectFeedbackEntry {
  return {
    badge: row.badge,
    comment: row.comment,
    updatedAt:
      row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    author: row.author_display_name ?? 'Педагог',
  };
}

export class ProjectFeedbackService {
  constructor(private readonly pool: pg.Pool | null) {}

  /** Null when the responder is not a teacher of this learner. */
  async save(
    principalId: string,
    projectId: string,
    badge: string | null,
    comment: string | null,
  ): Promise<ProjectFeedbackEntry | null> {
    if (!this.pool) return null;
    const result = await this.pool.query(
      `SELECT badge, comment, updated_at, author_display_name
         FROM project_feedback_save($1,$2,$3,$4)`,
      [principalId, projectId, badge, comment],
    );
    const row = result.rows[0] as FeedbackRow | undefined;
    return row ? toEntry(row) : null;
  }

  async list(principalId: string, projectId: string): Promise<ProjectFeedbackEntry[]> {
    if (!this.pool) return [];
    const result = await this.pool.query(
      `SELECT badge, comment, updated_at, author_display_name
         FROM project_feedback_list($1,$2)`,
      [principalId, projectId],
    );
    return (result.rows as FeedbackRow[]).map(toEntry);
  }
}
