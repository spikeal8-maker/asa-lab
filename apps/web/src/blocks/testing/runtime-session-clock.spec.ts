import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestBlocksRuntimeSessionResult } from '../runtime-session';

const SERVER_MS = Date.UTC(2030, 0, 1);
const value = () => ({
  runtimeOrigin: 'https://asa.example.test',
  runtimeToken: 'signed.runtime.token',
  expiresAt: SERVER_MS / 1000 + 600,
  draftRevision: 1,
  projectJson: null,
  assets: [],
});
const response = (date: string | null = new Date(SERVER_MS).toUTCString()) =>
  new Response(JSON.stringify(value()), {
    headers: { 'content-type': 'application/json', ...(date === null ? {} : { date }) },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('Scratch capability timing uses server Date and monotonic elapsed time', () => {
  it.each([-3, 3])(
    'accepts a fresh server grant with client clock offset %s hours',
    async (hours) => {
      vi.spyOn(Date, 'now').mockReturnValue(SERVER_MS + hours * 3_600_000);
      vi.spyOn(performance, 'now').mockReturnValue(100);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response()),
      );
      const result = await requestBlocksRuntimeSessionResult(
        'project',
        new AbortController().signal,
      );
      expect(result.session?.expiresAt).toBe(SERVER_MS / 1000 + 600);
      expect(result.session?.expiresAtMonotonicMs).toBe(599_100);
    },
  );

  it('subtracts response/body latency and ignores calendar changes during the request', async () => {
    let elapsed = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    const answer = response();
    const read = answer.json.bind(answer);
    vi.spyOn(answer, 'json').mockImplementation(async () => {
      elapsed = 2100;
      vi.spyOn(Date, 'now').mockReturnValue(SERVER_MS + 86_400_000);
      return read();
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => answer),
    );
    const result = await requestBlocksRuntimeSessionResult('project', new AbortController().signal);
    expect(result.session!.expiresAtMonotonicMs - elapsed).toBe(597_000);
  });

  it.each([null, 'invalid', new Date(SERVER_MS + 600_000).toUTCString()])(
    'rejects missing/invalid server timing or an expired server grant: %s',
    async (date) => {
      vi.spyOn(Date, 'now').mockReturnValue(0);
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => response(date)),
      );
      const result = await requestBlocksRuntimeSessionResult(
        'project',
        new AbortController().signal,
      );
      expect(result.session).toBeNull();
    },
  );

  it('rejects a response whose conservative lifetime elapsed while reading it', async () => {
    let elapsed = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => elapsed);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        elapsed = 600_000;
        return response();
      }),
    );
    const result = await requestBlocksRuntimeSessionResult('project', new AbortController().signal);
    expect(result.session).toBeNull();
  });
});
