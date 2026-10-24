import type pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { AiChatService } from './ai-chat.service';

const current = {
  enabled: true,
  baseUrl: 'http://127.0.0.1:11434',
  model: 'ornith:9b',
  revision: 4,
  updatedAt: null,
};

function subject() {
  const fetchImpl = vi.fn<typeof fetch>(async (url) => {
    const path = new URL(String(url)).pathname;
    if (path === '/api/tags') {
      return new Response(JSON.stringify({ models: [{ name: 'ornith:9b', size: 65000 }] }));
    }
    if (path === '/api/chat') {
      return new Response(
        JSON.stringify({ message: { content: 'OK' }, done: false }) +
          '\n' +
          JSON.stringify({ done: true }) +
          '\n',
      );
    }
    throw new Error('Unexpected upstream endpoint');
  });
  const service = new AiChatService({} as pg.Pool, {
    encryptionKey: '12'.repeat(32),
    fetchImpl,
  });
  const get = vi.spyOn(service, 'ollamaSettings').mockResolvedValue(current);
  const save = vi
    .spyOn(service, 'saveOllamaSettings')
    .mockResolvedValue({ ...current, model: 'ornith:9b', revision: 5 });
  return { service, fetchImpl, save, get };
}

describe('Ollama one action: verify before save', () => {
  it('verifies a real model response and commits only after success', async () => {
    const { service, save, fetchImpl } = subject();
    const result = await service.applyOllamaSettings(
      'principal',
      { ...current, baseUrl: 'http://192.168.1.20:11434' },
      'request-1',
    );
    expect(result.verified).toBe(true);
    expect(result.test?.model).toBe('ornith:9b');
    expect(save).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      '/api/tags',
      '/api/chat',
    ]);
  });

  it('does not persist an unavailable model', async () => {
    const { service, save, fetchImpl } = subject();
    await expect(
      service.applyOllamaSettings('principal', { ...current, model: 'missing:1b' }, 'request-2'),
    ).rejects.toMatchObject({ code: 'ai_ollama_model_missing' });
    expect(save).not.toHaveBeenCalled();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rechecks saved configuration without bumping revision', async () => {
    const { service, save } = subject();
    const result = await service.applyOllamaSettings('principal', current, 'request-3');
    expect(result.verified).toBe(true);
    expect(result.config.revision).toBe(4);
    expect(save).not.toHaveBeenCalled();
  });

  it('rejects a stale model result when an administrator changes settings during inference', async () => {
    const { service, get, save } = subject();
    get
      .mockReset()
      .mockResolvedValueOnce(current)
      .mockResolvedValueOnce({ ...current, revision: 5, enabled: false });
    await expect(
      service.applyOllamaSettings('principal', current, 'request-concurrent'),
    ).rejects.toMatchObject({ code: 'ai_ollama_config_changed' });
    expect(get).toHaveBeenCalledTimes(2);
    expect(save).not.toHaveBeenCalled();
  });

  it('stores a disabled selection without requesting GPU inference', async () => {
    const { service, save, fetchImpl } = subject();
    const result = await service.applyOllamaSettings(
      'principal',
      { ...current, enabled: false },
      'request-4',
    );
    expect(result.verified).toBe(false);
    expect(result.test).toBeNull();
    expect(save).toHaveBeenCalledOnce();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('never contacts the internet or saves stale revisions', async () => {
    const { service, save, fetchImpl } = subject();
    await expect(
      service.applyOllamaSettings(
        'principal',
        { ...current, baseUrl: 'https://example.com:443' },
        'request-5',
      ),
    ).rejects.toMatchObject({ code: 'ai_ollama_url_denied' });
    await expect(
      service.applyOllamaSettings('principal', { ...current, revision: 3 }, 'request-6'),
    ).rejects.toMatchObject({ code: 'ai_ollama_config_changed' });
    expect(save).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
