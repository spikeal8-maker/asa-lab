import { afterEach, describe, expect, it, vi } from 'vitest';
import { chessLiveApi } from '../../apps/web/src/chess/chess-live-api';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('chess live web API idempotent polling', () => {
  it('reuses the first matchmaking payload for the same command ID', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response(
          JSON.stringify({
            ticket: {
              id: 'ticket:1',
              playerId: 'user:1',
              timeControl: { initialMs: 600000, incrementMs: 5000 },
              pool: 'rapid',
              rated: true,
              colorPreference: 'random',
              rating: 1200,
              status: 'queued',
              expiresAtMs: 601000,
              pairedGameId: null,
              version: 1,
            },
            game: null,
            replayed: false,
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }),
    );

    const first = await chessLiveApi.joinMatchmaking({
      commandId: 'command:stable-poll',
      initialMs: 600000,
      incrementMs: 5000,
      rated: true,
      colorPreference: 'random',
      expiresInMs: 600000,
    });
    const replay = await chessLiveApi.joinMatchmaking({
      commandId: 'command:stable-poll',
      initialMs: 600000,
      incrementMs: 5000,
      rated: true,
      colorPreference: 'random',
      expiresInMs: 598731,
    });

    expect(first.ok).toBe(true);
    expect(replay.ok).toBe(true);
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toBe(bodies[0]);
    expect(JSON.parse(bodies[0]!)).toMatchObject({ expiresInMs: 600000 });
  });

  it('keeps different command IDs independent', async () => {
    const bodies: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_path: string, init?: RequestInit) => {
        bodies.push(String(init?.body));
        return new Response(JSON.stringify({ ticket: {}, game: null, replayed: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );

    await chessLiveApi.joinMatchmaking({
      commandId: 'command:one',
      initialMs: 60000,
      incrementMs: 0,
      rated: false,
      colorPreference: 'white',
      expiresInMs: 300000,
    });
    await chessLiveApi.joinMatchmaking({
      commandId: 'command:two',
      initialMs: 180000,
      incrementMs: 2000,
      rated: true,
      colorPreference: 'black',
      expiresInMs: 600000,
    });

    expect(JSON.parse(bodies[0]!)).toMatchObject({
      initialMs: 60000,
      rated: false,
      expiresInMs: 300000,
    });
    expect(JSON.parse(bodies[1]!)).toMatchObject({
      initialMs: 180000,
      rated: true,
      expiresInMs: 600000,
    });
  });
});
