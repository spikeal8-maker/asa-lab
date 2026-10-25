import type { AiWebSearchEvidence } from '@asa-lab/contracts';
import { webEvidenceContext } from './ai-web-search.js';
import type pg from 'pg';
import type { AiCursor, AiMessage, AiPage, AiThread } from './ai-chat.service.js';

interface ThreadRow {
  id: string;
  title: string;
  updated_at: Date | string;
  archived_at?: Date | string | null;
  match_preview?: string | null;
  cursor_at: string;
}

interface MessageRow {
  web_search?: AiWebSearchEvidence | null;
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: Date | string;
  request_id: string;
  state?: 'complete' | 'stopped';
  source_user_message_id?: string | null;
  source_prompt?: string | null;
  regenerated?: boolean;
  cursor_at: string;
}

function thread(row: ThreadRow): AiThread {
  return {
    id: row.id,
    title: row.title,
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.archived_at ? { archivedAt: new Date(row.archived_at).toISOString() } : {}),
    ...(row.match_preview ? { matchPreview: row.match_preview } : {}),
  };
}

function message(row: MessageRow): AiMessage {
  return {
    id: row.id,
    role: row.role,
    content: row.content,
    createdAt: new Date(row.created_at).toISOString(),
    requestId: row.request_id,
    state: row.state ?? 'complete',
    ...(row.source_user_message_id
      ? { sourceUserMessageId: row.source_user_message_id, sourcePrompt: row.source_prompt ?? '' }
      : {}),
    ...(row.regenerated ? { regenerated: true } : {}),
    ...(row.web_search ? { webSearch: row.web_search } : {}),
  };
}

/** All functions accept only the canonical owner already resolved by AI access. */
export class AiTextHistoryStore {
  constructor(private readonly pool: pg.Pool) {}

  async threads(
    owner: string,
    cursor: AiCursor | null,
    query = '',
    archived = false,
  ): Promise<AiPage<AiThread>> {
    const result = await this.pool.query<ThreadRow>(
      `SELECT page.*,
          to_char(page.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM ai_text_search_threads($1,$2::varchar,$3::boolean,$4::timestamptz,$5::uuid,$6) AS page`,
      [owner, query, archived, cursor?.at ?? null, cursor?.id ?? null, 51],
    );
    const last = result.rows[49];
    return {
      items: result.rows.slice(0, 50).map(thread),
      nextCursor: result.rows.length > 50 && last ? { at: last.cursor_at, id: last.id } : null,
    };
  }

  async archive(owner: string, threadId: string, archived: boolean): Promise<AiThread> {
    const result = await this.pool.query<ThreadRow>(
      'SELECT * FROM ai_text_archive($1,$2,$3::boolean)',
      [owner, threadId, archived],
    );
    const row = result.rows[0];
    if (!row) throw new Error('AI_THREAD_DENIED');
    return thread(row);
  }

  async messages(owner: string, threadId: string): Promise<readonly AiMessage[]> {
    const result = await this.pool.query<MessageRow>(
      'SELECT page.*, ai_web_search_evidence($1,$2,page.request_id,true) AS web_search FROM ai_text_messages_page($1,$2,NULL,NULL,80) page',
      [owner, threadId],
    );
    return result.rows.map(message);
  }

  async messagePage(
    owner: string,
    threadId: string,
    cursor: AiCursor | null,
  ): Promise<AiPage<AiMessage>> {
    const result = await this.pool.query<MessageRow>(
      `SELECT page.*, ai_web_search_evidence($1,$2,page.request_id,true) AS web_search,
          to_char(page.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
        FROM ai_text_messages_page($1,$2,$3::timestamptz,$4::uuid,$5) AS page`,
      [owner, threadId, cursor?.at ?? null, cursor?.id ?? null, 51],
    );
    const rows = result.rows.length > 50 ? result.rows.slice(1) : result.rows;
    const first = rows[0];
    return {
      items: rows.map(message),
      nextCursor: result.rows.length > 50 && first ? { at: first.cursor_at, id: first.id } : null,
    };
  }

  async requestMessages(
    owner: string,
    threadId: string,
    requestId: string,
  ): Promise<readonly AiMessage[]> {
    const result = await this.pool.query<MessageRow>(
      'SELECT page.*, ai_web_search_evidence($1,$2,page.request_id,true) AS web_search FROM ai_text_request_messages($1,$2,$3) page',
      [owner, threadId, requestId],
    );
    return result.rows.map(message);
  }

  async generationContext(
    owner: string,
    threadId: string,
    requestId: string,
  ): Promise<readonly { role: 'user' | 'assistant'; content: string }[]> {
    const result = await this.pool.query<{
      role: 'user' | 'assistant';
      content: string;
      web_search?: AiWebSearchEvidence | null;
    }>(
      'SELECT context.*, ai_web_search_evidence($1,$2,$3,false) AS web_search FROM ai_text_generation_context($1,$2,$3) context',
      [owner, threadId, requestId],
    );
    if (result.rows.length === 0) throw new Error('AI_CONTEXT_UNAVAILABLE');
    return result.rows.map((row, index) => ({
      role: row.role,
      content:
        row.content.slice(0, 3000) +
        (index === result.rows.length - 1 ? webEvidenceContext(row.web_search) : ''),
    }));
  }
}
