import type {
  ChessNetworkAccess,
  ChessNetworkAction,
  ChessNetworkInvite,
  ChessNetworkMatch,
  ChessNetworkPolicy,
  ChessNetworkScope,
} from '@asa-lab/contracts';
import { call, type ApiResult } from '../api-call';
import { newClientId } from '../client-id';

interface CommandResult {
  invite?: ChessNetworkInvite;
  match?: ChessNetworkMatch;
  replayed: boolean;
}
const path = '/api/games/chess';
const REQUEST_TIMEOUT_MS = 15_000;
const pendingCommands = new Map<string, string>();
/** Bound fetch, session refresh and body consumption, even if transport ignores abort. */
async function request<T>(url: string, init: RequestInit = {}): Promise<ApiResult<T>> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<ApiResult<T>>((resolve) => {
    timer = setTimeout(() => {
      resolve({
        ok: false,
        status: 0,
        error: {
          code: 'network_timeout',
          message:
            'Сервер не ответил вовремя. Результат действия пока неизвестен. Повторите запрос.',
        },
      });
      controller.abort();
    }, REQUEST_TIMEOUT_MS);
  });
  try {
    // The race also fences a late body: it can never replace an already returned timeout.
    return await Promise.race([call<T>(url, { ...init, signal: controller.signal }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}
async function command<T>(url: string, input: unknown, method = 'POST'): Promise<ApiResult<T>> {
  const body = JSON.stringify(input);
  const intent = `${method}:${url}:${body}`;
  const existing = pendingCommands.get(intent);
  if (!existing && pendingCommands.size >= 64)
    return {
      ok: false,
      status: 429,
      error: {
        code: 'pending_commands',
        message: 'Повторите незавершённое действие после восстановления связи.',
      },
    };
  const id = existing ?? newClientId();
  pendingCommands.set(intent, id);
  const result = await request<T>(url, { method, headers: { 'idempotency-key': id }, body });
  // A lost response may follow a committed command. Retain its exact identity.
  if (result.ok || (result.status >= 400 && result.status < 500 && result.status !== 429))
    pendingCommands.delete(intent);
  return result;
}
export const chessNetworkApi = {
  access: () => request<ChessNetworkAccess>(`${path}/access`, { cache: 'no-store' }),
  history: (cursor?: string) =>
    request<{
      matches: ChessNetworkMatch[];
      invites: ChessNetworkInvite[];
      nextCursor: string | null;
    }>(`${path}/history${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`, {
      cache: 'no-store',
    }),
  match: (id: string) =>
    request<{ match: ChessNetworkMatch }>(`${path}/matches/${encodeURIComponent(id)}`, {
      cache: 'no-store',
    }),
  invite: (code: string) =>
    request<{ invite: ChessNetworkInvite }>(`${path}/invites/${encodeURIComponent(code)}`, {
      cache: 'no-store',
    }),
  create: (input: {
    scope: ChessNetworkScope;
    initialMs: number;
    incrementMs: number;
    colorPreference: 'white' | 'black' | 'random';
  }) => command<CommandResult>(`${path}/invites`, input),
  accept: (code: string) =>
    command<CommandResult>(`${path}/invites/${encodeURIComponent(code)}/accept`, {}),
  cancel: (id: string, expectedVersion: number) =>
    command<CommandResult>(`${path}/invites/${encodeURIComponent(id)}/cancel`, { expectedVersion }),
  action: (id: string, expectedVersion: number, action: ChessNetworkAction, uci?: string) =>
    command<CommandResult>(`${path}/matches/${encodeURIComponent(id)}/commands`, {
      expectedVersion,
      action,
      ...(uci ? { uci } : {}),
    }),
  readPolicy: (id: string) =>
    request<ChessNetworkPolicy>(`${path}/policy/${encodeURIComponent(id)}`, { cache: 'no-store' }),
  savePolicy: (
    id: string,
    input: Omit<ChessNetworkPolicy, 'version'> & { expectedVersion: number },
  ) =>
    command<ChessNetworkPolicy & { replayed: boolean }>(
      `${path}/policy/${encodeURIComponent(id)}`,
      input,
      'PUT',
    ),
};
