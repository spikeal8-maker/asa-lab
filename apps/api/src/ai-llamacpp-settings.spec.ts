import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  LlamaCppSettingsStore,
  type LlamaCppApplyResult,
  type LlamaCppSettings,
} from './ai-llamacpp-settings.js';

const initial: LlamaCppSettings = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:8080',
  model: 'fixture:27b',
  revision: 4,
  updatedAt: null,
  apiKeyConfigured: true,
  contextTokens: null,
  confirmedContextTokens: 212992,
  contextSource: 'metadata',
  toolsVerified: false,
  temperature: null,
  topP: null,
  maxOutputTokens: null,
};
type Receipt = { digest: string; state: string; result?: LlamaCppApplyResult; error?: unknown };
function fixture(overrides: Partial<LlamaCppSettings> = {}) {
  let config = { ...initial, ...overrides };
  let cipher: string | null = config.apiKeyConfigured ? 'old-ciphertext' : null;
  const receipts = new Map<string, Receipt>();
  let beforeSet: (() => void) | undefined;
  let deny = false;
  const query = vi.fn(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('ai_llamacpp_admin_get')) {
      if (deny) throw { code: '42501', message: 'private permission details' };
      return { rows: [{ value: { ...config } }] };
    }
    if (sql.includes('ai_llamacpp_runtime'))
      return {
        rows: [
          {
            enabled: config.enabled,
            base_url: config.baseUrl,
            model: config.model,
            revision: config.revision,
            context_tokens: config.contextTokens,
            confirmed_context_tokens: config.confirmedContextTokens,
            tools_verified: config.toolsVerified,
            temperature: config.temperature,
            top_p: config.topP,
            max_output_tokens: config.maxOutputTokens,
            api_key_ciphertext: cipher,
            api_key_iv: cipher ? 'fixture-iv' : null,
            api_key_auth_tag: cipher ? 'fixture-tag' : null,
          },
        ],
      };
    const id = String(params[1]);
    const digest = String(params[2]);
    if (sql.includes('ai_llamacpp_apply_claim')) {
      const receipt = receipts.get(id);
      if (receipt) {
        if (receipt.digest !== digest)
          throw { code: '22023', message: 'AI_LLAMACPP_REPLAY_CONFLICT' };
        return { rows: [{ value: receipt }] };
      }
      if (params[3] !== config.revision) throw { code: '40001' };
      receipts.set(id, { state: 'pending', digest });
      return { rows: [{ value: { state: 'claimed' } }] };
    }
    if (sql.includes('ai_llamacpp_apply_fail')) {
      const receipt = receipts.get(id);
      if (receipt?.state === 'pending')
        receipts.set(id, { ...receipt, state: 'failed', error: JSON.parse(String(params[3])) });
      return { rows: [] };
    }
    if (sql.includes('ai_llamacpp_admin_set')) {
      const payload = JSON.parse(String(params[1]));
      beforeSet?.();
      if (payload.revision !== config.revision) throw { code: '40001' };
      if (payload.action === 'replace') cipher = payload.ciphertext;
      if (payload.action === 'clear') cipher = null;
      config = {
        enabled: payload.enabled,
        baseUrl: payload.baseUrl,
        model: payload.model,
        revision: config.revision + 1,
        updatedAt: '2026-11-24T20:00:00.000Z',
        apiKeyConfigured: Boolean(cipher),
        contextTokens: payload.contextTokens,
        confirmedContextTokens: payload.confirmedContextTokens,
        contextSource:
          payload.confirmedContextTokens !== null
            ? 'metadata'
            : payload.contextTokens !== null
              ? 'admin'
              : 'unknown',
        toolsVerified: payload.toolsVerified,
        temperature: payload.temperature,
        topP: payload.topP,
        maxOutputTokens: payload.maxOutputTokens,
      };
      const result = { config: { ...config }, verified: payload.verified, test: payload.test };
      receipts.set(String(params[2]), { digest: payload.applyDigest, state: 'complete', result });
      return { rows: [{ value: result }] };
    }
    throw new Error('Unexpected SQL');
  });
  const fetchImpl = vi.fn<typeof fetch>(async (url, init) => {
    const path = new URL(String(url)).pathname;
    if (path === '/v1/models')
      return Response.json({ data: [{ id: 'fixture:27b', meta: { n_ctx_train: 262144 } }] });
    if (path === '/props')
      return Response.json({
        default_generation_settings: { n_ctx: 212992 },
        chat_template_caps: { supports_tools: true },
      });
    const body = JSON.parse(String(init?.body));
    if (body.tools)
      return Response.json({
        choices: [
          {
            finish_reason: 'tool_calls',
            message: {
              content: null,
              tool_calls: [
                {
                  id: 'call_probe',
                  type: 'function',
                  function: { name: 'web_search', arguments: '{"query":"asa_llamacpp_probe"}' },
                },
              ],
            },
          },
        ],
      });
    return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] });
  });
  const encrypt = vi.fn((key: string) => ({
    ciphertext: 'encrypted:' + key,
    iv: 'random-' + Math.random(),
    tag: 'tag',
    fingerprint: 'fixture-fingerprint',
  }));
  const decrypt = vi.fn(() => 'saved-fixture-key');
  const withSlot = vi.fn(
    async <T>(_actor: string, _id: string, run: (signal: AbortSignal) => Promise<T>) =>
      run(new AbortController().signal),
  );
  const store = new LlamaCppSettingsStore({ query } as unknown as pg.Pool, {
    encrypt,
    decrypt,
    fetchImpl,
    withSlot,
  });
  return {
    store,
    query,
    fetchImpl,
    encrypt,
    decrypt,
    withSlot,
    receipts,
    get config() {
      return config;
    },
    setBeforeSet(fn: () => void) {
      beforeSet = fn;
    },
    bumpRevision() {
      config = { ...config, revision: config.revision + 1 };
    },
    deny() {
      deny = true;
    },
  };
}

describe('llama.cpp server-owned independent settings', () => {
  it('returns safe admin configuration and keeps credentials server-only', async () => {
    const f = fixture();
    expect(await f.store.admin('actor')).toEqual(initial);
    expect(JSON.stringify(await f.store.admin('actor'))).not.toMatch(
      /ciphertext|saved-fixture-key/,
    );
    expect((await f.store.runtime()).apiKey).toBe('saved-fixture-key');
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('uses saved credentials only for the same normalized endpoint', async () => {
    const f = fixture();
    await f.store.discover('actor', { baseUrl: '127.0.0.1/v1', revision: 4 });
    expect(new Headers(f.fetchImpl.mock.calls[0]?.[1]?.headers).get('authorization')).toBe(
      'Bearer saved-fixture-key',
    );
    f.fetchImpl.mockClear();
    f.decrypt.mockClear();
    await f.store.discover('actor', { baseUrl: '127.0.0.2', revision: 4 });
    expect(new Headers(f.fetchImpl.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('rejects a draft key not bound to its requested endpoint before network access', async () => {
    const f = fixture();
    await expect(
      f.store.discover('actor', {
        baseUrl: '127.0.0.2',
        revision: 4,
        apiKey: 'draft-key',
        apiKeyEndpoint: initial.baseUrl,
      }),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_key_invalid' });
    await expect(
      f.store.discover('actor', { baseUrl: '127.0.0.2', revision: 4, apiKey: 'draft-key' }),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_key_invalid' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('checks admin authorization and revision before discovery or decryption', async () => {
    const f = fixture();
    await expect(
      f.store.discover('actor', { baseUrl: initial.baseUrl, revision: 3 }),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_config_changed' });
    f.deny();
    await expect(
      f.store.discover('actor', { baseUrl: initial.baseUrl, revision: 4 }),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_admin_denied', status: 403 });
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.decrypt).not.toHaveBeenCalled();
  });
  it('discovers with a saved key while disabled but isolates broken disabled credentials from catalog runtime', async () => {
    const f = fixture({ enabled: false });
    expect((await f.store.runtime()).apiKey).toBeNull();
    expect(f.decrypt).not.toHaveBeenCalled();
    await f.store.discover('actor', { baseUrl: initial.baseUrl, revision: 4 });
    expect(f.decrypt).toHaveBeenCalledOnce();
  });
});

describe('llama.cpp checked apply and durable receipt semantics', () => {
  it.each([400, 500])(
    'distinguishes unsupported tools from a failed server probe (%s)',
    async (status) => {
      const f = fixture();
      f.fetchImpl.mockImplementation(async (url, init) => {
        const path = new URL(String(url)).pathname;
        if (path === '/v1/models') return Response.json({ data: [{ id: initial.model }] });
        if (path === '/props')
          return Response.json({ default_generation_settings: { n_ctx: 212992 } });
        const body = JSON.parse(String(init?.body));
        if (body.tools) return new Response('private upstream details', { status });
        return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] });
      });
      const result = f.store.apply('actor', initial, 'tool-failure');
      if (status === 400) expect((await result).config.toolsVerified).toBe(false);
      else {
        await expect(result).rejects.toMatchObject({ code: 'ai_llamacpp_upstream_error' });
        expect(f.config).toEqual(initial);
      }
    },
  );
  it('claims before provider calls, verifies text and tools, then atomically saves encrypted settings', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async (url, init) => {
      expect(f.receipts.get('apply-1')?.state).toBe('pending');
      const path = new URL(String(url)).pathname;
      if (path === '/v1/models') return Response.json({ data: [{ id: initial.model }] });
      if (path === '/props')
        return Response.json({ default_generation_settings: { n_ctx: 212992 } });
      const body = JSON.parse(String(init?.body));
      return body.tools
        ? Response.json({
            choices: [
              {
                finish_reason: 'tool_calls',
                message: {
                  content: null,
                  tool_calls: [
                    {
                      id: 'probe',
                      type: 'function',
                      function: { name: 'web_search', arguments: '{"query":"asa_llamacpp_probe"}' },
                    },
                  ],
                },
              },
            ],
          })
        : Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] });
    });
    const result = await f.store.apply(
      'actor',
      { ...initial, apiKey: 'new-key', apiKeyEndpoint: initial.baseUrl },
      'apply-1',
    );
    expect(result).toMatchObject({
      verified: true,
      config: {
        revision: 5,
        apiKeyConfigured: true,
        confirmedContextTokens: 212992,
        toolsVerified: true,
      },
      test: { model: initial.model, toolsVerified: true },
    });
    expect(f.withSlot).toHaveBeenCalledOnce();
    expect(f.encrypt).toHaveBeenCalledWith('new-key');
    expect(JSON.stringify(result)).not.toContain('new-key');
    expect(f.query.mock.calls.every(([sql]) => !sql.includes('ollama'))).toBe(true);
  });
  it('returns the original result after a lost response without another probe, IV or revision increment', async () => {
    const f = fixture();
    const input = { ...initial, apiKey: 'new-key', apiKeyEndpoint: initial.baseUrl };
    const first = await f.store.apply('actor', input, 'same-request');
    const count = f.fetchImpl.mock.calls.length;
    expect(await f.store.apply('actor', input, 'same-request')).toEqual(first);
    expect(f.fetchImpl).toHaveBeenCalledTimes(count);
    expect(f.encrypt).toHaveBeenCalledOnce();
    expect(f.config.revision).toBe(5);
  });
  it('does not mark an early admin outage terminal and later recovers the same completed request', async () => {
    const f = fixture();
    const input = { ...initial, apiKey: 'new-key', apiKeyEndpoint: initial.baseUrl };
    const completed = await f.store.apply('actor', input, 'admin-outage-replay');
    const execute = f.query.getMockImplementation()!;
    let adminUnavailable = true;
    f.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ai_llamacpp_admin_get') && adminUnavailable)
        throw new Error('private database connection details');
      return execute(sql, params);
    });
    const calls = f.fetchImpl.mock.calls.length;
    const outage = await f.store
      .apply('actor', input, 'admin-outage-replay')
      .catch((error) => error);
    expect(outage).toMatchObject({
      code: 'ai_llamacpp_unavailable',
      status: 503,
      applyState: undefined,
    });
    expect(outage.message).not.toMatch(/private|database|connection/);
    expect(f.receipts.get('admin-outage-replay')?.state).toBe('complete');
    adminUnavailable = false;
    expect(await f.store.apply('actor', input, 'admin-outage-replay')).toEqual(completed);
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.encrypt).toHaveBeenCalledOnce();
    expect(f.config.revision).toBe(5);
  });
  it.each([
    ['validation', 'ai_llamacpp_config_invalid'],
    ['claim', 'ai_llamacpp_config_changed'],
    ['authorization', 'ai_llamacpp_admin_denied'],
  ])('does not mark an early %s error as a confirmed terminal receipt', async (phase, code) => {
    const f = fixture();
    if (phase === 'claim') f.bumpRevision();
    if (phase === 'authorization') f.deny();
    await expect(
      f.store.apply(
        'actor',
        phase === 'validation' ? { ...initial, model: '' } : initial,
        'early-error',
      ),
    ).rejects.toMatchObject({ code, applyState: undefined });
    expect(f.receipts.size).toBe(0);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('marks a confirmed unavailable failure terminal on recovery and replay without changing receipt JSON', async () => {
    const f = fixture();
    f.withSlot.mockRejectedValue(new Error('private slot infrastructure details'));
    await expect(f.store.apply('actor', initial, 'terminal-unavailable')).rejects.toMatchObject({
      code: 'ai_llamacpp_unavailable',
      status: 503,
      applyState: 'failed',
    });
    expect(f.receipts.get('terminal-unavailable')?.state).toBe('failed');
    expect(Object.keys(f.receipts.get('terminal-unavailable')!.error as object).sort()).toEqual([
      'code',
      'message',
      'status',
    ]);
    await expect(f.store.apply('actor', initial, 'terminal-unavailable')).rejects.toMatchObject({
      code: 'ai_llamacpp_unavailable',
      status: 503,
      applyState: 'failed',
    });
    expect(f.withSlot).toHaveBeenCalledOnce();
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.config).toEqual(initial);
  });
  it('keeps the request pending when a claim is durable but its response is lost', async () => {
    const f = fixture();
    const execute = f.query.getMockImplementation()!;
    let loseClaimResponse = true;
    f.query.mockImplementation(async (sql, params) => {
      const result = await execute(sql, params);
      if (sql.includes('ai_llamacpp_apply_claim') && loseClaimResponse) {
        loseClaimResponse = false;
        throw new Error('private database connection details');
      }
      return result;
    });
    await expect(f.store.apply('actor', initial, 'lost-claim')).rejects.toMatchObject({
      code: 'ai_llamacpp_apply_pending',
      status: 409,
      applyState: undefined,
    });
    expect(f.receipts.get('lost-claim')?.state).toBe('pending');
    await expect(f.store.apply('actor', initial, 'lost-claim')).rejects.toMatchObject({
      code: 'ai_llamacpp_apply_pending',
      applyState: undefined,
    });
    expect(f.config).toEqual(initial);
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.encrypt).not.toHaveBeenCalled();
  });
  it('recovers a committed apply after its database response is lost without declaring failure', async () => {
    const f = fixture();
    const execute = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => {
      const result = await execute(sql, params);
      if (sql.includes('ai_llamacpp_admin_set'))
        throw new Error('private commit response connection details');
      return result;
    });
    const input = { ...initial, apiKey: 'new-key', apiKeyEndpoint: initial.baseUrl };
    const result = await f.store.apply('actor', input, 'lost-commit');
    expect(result).toMatchObject({ verified: true, config: { revision: 5, toolsVerified: true } });
    expect(f.receipts.get('lost-commit')).toMatchObject({ state: 'complete', result });
    expect(f.receipts.get('lost-commit')?.error).toBeUndefined();
    const calls = f.fetchImpl.mock.calls.length;
    expect(await f.store.apply('actor', input, 'lost-commit')).toEqual(result);
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.encrypt).toHaveBeenCalledOnce();
    expect(f.config.revision).toBe(5);
  });
  it.each([false, true])(
    'retains an unknown commit request for same-ID recovery (committed: %s)',
    async (committed) => {
      const f = fixture();
      const execute = f.query.getMockImplementation()!;
      let disconnected = false;
      f.query.mockImplementation(async (sql, params) => {
        if (disconnected) throw new Error('private unavailable database details');
        if (sql.includes('ai_llamacpp_admin_set')) {
          if (committed) await execute(sql, params);
          disconnected = true;
          throw new Error('lost commit response');
        }
        return execute(sql, params);
      });
      const input = { ...initial, apiKey: 'candidate-secret', apiKeyEndpoint: initial.baseUrl };
      await expect(f.store.apply('actor', input, 'unknown-commit')).rejects.toMatchObject({
        code: 'ai_llamacpp_apply_pending',
        status: 409,
        applyState: undefined,
      });
      expect(f.receipts.get('unknown-commit')?.state).toBe(committed ? 'complete' : 'pending');
      expect(f.receipts.get('unknown-commit')?.error).toBeUndefined();
      const calls = f.fetchImpl.mock.calls.length;
      disconnected = false;
      if (committed) {
        const result = await f.store.apply('actor', input, 'unknown-commit');
        expect(result).toMatchObject({ verified: true, config: { revision: 5 } });
        expect(JSON.stringify(result)).not.toMatch(/candidate-secret|private|connection/);
      } else {
        await expect(f.store.apply('actor', input, 'unknown-commit')).rejects.toMatchObject({
          code: 'ai_llamacpp_apply_pending',
        });
        expect(f.config).toEqual(initial);
      }
      expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
      expect(f.encrypt).toHaveBeenCalledOnce();
      expect(f.config.revision).toBe(committed ? 5 : 4);
    },
  );
  it('replays endpoint changes with implicit key clearing using the same semantic digest', async () => {
    const f = fixture();
    const input = { ...initial, baseUrl: '127.0.0.2' };
    const first = await f.store.apply('actor', input, 'changed-endpoint');
    expect(first.config.apiKeyConfigured).toBe(false);
    expect(
      f.fetchImpl.mock.calls.every(([, init]) => !new Headers(init?.headers).has('authorization')),
    ).toBe(true);
    const count = f.fetchImpl.mock.calls.length;
    expect(await f.store.apply('actor', input, 'changed-endpoint')).toEqual(first);
    expect(f.fetchImpl).toHaveBeenCalledTimes(count);
  });
  it('does not repeat an unknown pending probe or accept a changed payload with the same request ID', async () => {
    const f = fixture();
    const input = { ...initial };
    await f.store.apply('actor', input, 'pending-request');
    const receipt = f.receipts.get('pending-request')!;
    f.receipts.set('pending-request', { ...receipt, state: 'pending' });
    f.fetchImpl.mockClear();
    await expect(f.store.apply('actor', input, 'pending-request')).rejects.toMatchObject({
      code: 'ai_llamacpp_apply_pending',
    });
    await expect(
      f.store.apply('actor', { ...input, temperature: 1 }, 'pending-request'),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_replay_conflict' });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('preserves the previous configuration and persists a redacted failure for retries', async () => {
    const f = fixture();
    f.fetchImpl.mockResolvedValue(
      new Response('candidate-secret private-endpoint', { status: 401 }),
    );
    const input = { ...initial, apiKey: 'candidate-secret', apiKeyEndpoint: initial.baseUrl };
    await expect(f.store.apply('actor', input, 'failure-request')).rejects.toMatchObject({
      code: 'ai_llamacpp_auth',
      status: 502,
      applyState: 'failed',
    });
    expect(f.config).toEqual(initial);
    const calls = f.fetchImpl.mock.calls.length;
    await expect(f.store.apply('actor', input, 'failure-request')).rejects.toMatchObject({
      code: 'ai_llamacpp_auth',
      applyState: 'failed',
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(JSON.stringify(f.receipts.get('failure-request'))).not.toContain('candidate-secret');
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_llamacpp_admin_set'))).toBe(false);
  });
  it('preserves the request and configuration when writing a terminal failure is not confirmed', async () => {
    const f = fixture();
    const execute = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ai_llamacpp_apply_fail'))
        throw new Error('candidate-secret private database connection details');
      return execute(sql, params);
    });
    f.fetchImpl.mockResolvedValue(
      new Response('candidate-secret private upstream', { status: 401 }),
    );
    const input = { ...initial, apiKey: 'candidate-secret', apiKeyEndpoint: initial.baseUrl };
    const error = await f.store.apply('actor', input, 'unknown-failure').catch((value) => value);
    expect(error).toMatchObject({
      code: 'ai_llamacpp_apply_pending',
      status: 409,
      applyState: undefined,
    });
    expect(error.message).not.toMatch(/candidate-secret|private|database/);
    expect(f.receipts.get('unknown-failure')?.state).toBe('pending');
    expect(f.config).toEqual(initial);
    const calls = f.fetchImpl.mock.calls.length;
    await expect(f.store.apply('actor', input, 'unknown-failure')).rejects.toMatchObject({
      code: 'ai_llamacpp_apply_pending',
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
    expect(f.encrypt).toHaveBeenCalledOnce();
    expect(f.query.mock.calls.some(([sql]) => sql.includes('ai_llamacpp_admin_set'))).toBe(false);
  });
  it('recovers a terminal failure whose write response was lost from the durable receipt', async () => {
    const f = fixture();
    const execute = f.query.getMockImplementation()!;
    f.query.mockImplementation(async (sql, params) => {
      const result = await execute(sql, params);
      if (sql.includes('ai_llamacpp_apply_fail')) throw new Error('lost failure response');
      return result;
    });
    f.fetchImpl.mockResolvedValue(new Response('private upstream', { status: 401 }));
    await expect(f.store.apply('actor', initial, 'durable-failure')).rejects.toMatchObject({
      code: 'ai_llamacpp_auth',
      status: 502,
      applyState: 'failed',
    });
    expect(f.receipts.get('durable-failure')?.state).toBe('failed');
    expect(f.config).toEqual(initial);
    const calls = f.fetchImpl.mock.calls.length;
    await expect(f.store.apply('actor', initial, 'durable-failure')).rejects.toMatchObject({
      code: 'ai_llamacpp_auth',
      applyState: 'failed',
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
  });
  it('keeps a failure outcome unknown until its terminal receipt can be read', async () => {
    const f = fixture();
    const execute = f.query.getMockImplementation()!;
    let failRecoveryRead = false;
    f.query.mockImplementation(async (sql, params) => {
      if (sql.includes('ai_llamacpp_apply_claim') && failRecoveryRead)
        throw new Error('private receipt read connection details');
      const result = await execute(sql, params);
      if (sql.includes('ai_llamacpp_apply_fail')) failRecoveryRead = true;
      return result;
    });
    f.fetchImpl.mockResolvedValue(new Response('private upstream', { status: 401 }));
    await expect(f.store.apply('actor', initial, 'unread-failure')).rejects.toMatchObject({
      code: 'ai_llamacpp_apply_pending',
      status: 409,
      applyState: undefined,
    });
    expect(f.receipts.get('unread-failure')?.state).toBe('failed');
    expect(f.config).toEqual(initial);
    const calls = f.fetchImpl.mock.calls.length;
    failRecoveryRead = false;
    await expect(f.store.apply('actor', initial, 'unread-failure')).rejects.toMatchObject({
      code: 'ai_llamacpp_auth',
      status: 502,
      applyState: 'failed',
    });
    expect(f.fetchImpl).toHaveBeenCalledTimes(calls);
  });
  it('preserves settings when revision changes during a successful network probe', async () => {
    const f = fixture();
    f.setBeforeSet(() => f.bumpRevision());
    await expect(
      f.store.apply('actor', { ...initial, temperature: 1 }, 'concurrent-request'),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_config_changed' });
    expect(f.config.temperature).toBeNull();
    expect(f.config.revision).toBe(5);
  });
  it('allows offline disable without decrypting, claiming the GPU slot or contacting the provider', async () => {
    const f = fixture();
    f.decrypt.mockImplementation(() => {
      throw new Error('bad root key');
    });
    const result = await f.store.apply('actor', { ...initial, enabled: false }, 'disable-request');
    expect(result).toMatchObject({
      verified: false,
      test: null,
      config: { enabled: false, apiKeyConfigured: true },
    });
    expect(f.fetchImpl).not.toHaveBeenCalled();
    expect(f.decrypt).not.toHaveBeenCalled();
    expect(f.withSlot).not.toHaveBeenCalled();
  });
  it('fails closed when encryption is unavailable, leaving the previous working key intact', async () => {
    const f = fixture();
    f.encrypt.mockImplementation(() => {
      throw new Error('secret details');
    });
    await expect(
      f.store.apply(
        'actor',
        { ...initial, apiKey: 'new-key', apiKeyEndpoint: initial.baseUrl },
        'encryption-request',
      ),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_encryption_unavailable' });
    expect(f.config).toEqual(initial);
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
  it('does not claim tools from metadata when a real tool probe returns ordinary text', async () => {
    const f = fixture();
    f.fetchImpl.mockImplementation(async (url) => {
      const path = new URL(String(url)).pathname;
      if (path === '/v1/models') return Response.json({ data: [{ id: initial.model }] });
      if (path === '/props')
        return Response.json({
          default_generation_settings: { n_ctx: 212992 },
          chat_template_caps: { supports_tools: true },
        });
      return Response.json({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] });
    });
    expect((await f.store.apply('actor', initial, 'text-only')).config.toolsVerified).toBe(false);
  });
  it('refuses a configured context larger than confirmed metadata before generation', async () => {
    const f = fixture();
    await expect(
      f.store.apply('actor', { ...initial, contextTokens: 262144 }, 'too-long'),
    ).rejects.toMatchObject({ code: 'ai_llamacpp_context_invalid' });
    expect(f.fetchImpl.mock.calls.every(([url]) => !String(url).includes('chat/completions'))).toBe(
      true,
    );
    expect(f.config).toEqual(initial);
  });
  it('fails closed without a cross-instance slot implementation', async () => {
    const f = fixture();
    const store = new LlamaCppSettingsStore({ query: f.query } as unknown as pg.Pool, {
      encrypt: f.encrypt,
      decrypt: f.decrypt,
      fetchImpl: f.fetchImpl,
    });
    await expect(store.apply('actor', initial, 'no-slot')).rejects.toMatchObject({
      code: 'ai_llamacpp_unavailable',
    });
    expect(f.fetchImpl).not.toHaveBeenCalled();
  });
});
