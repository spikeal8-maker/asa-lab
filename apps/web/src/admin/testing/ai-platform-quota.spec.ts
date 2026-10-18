// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiAdminPage } from '../AdminAiPage';
import { call } from '../admin-api';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

let root: Root;
let host: HTMLDivElement;
const config = {
  enabled: true,
  provider: 'openai',
  model: 'gpt-5-mini',
  paidOperationsPerHour: 0,
  apiKeyConfigured: true,
  encryptionReady: true,
  keyFingerprint: null,
  configurationVersion: 1,
  updatedAt: null,
};

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.mocked(call).mockReset();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function render(limit: number) {
  vi.mocked(call).mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...config, paidOperationsPerHour: limit },
  });
  await act(async () => root.render(createElement(AiAdminPage, { onAccessDenied: vi.fn() })));
}

function button(label: string): HTMLButtonElement {
  return [...host.querySelectorAll('button')].find((item) => item.textContent === label)!;
}

describe('AI admin paid operation limit', () => {
  it('labels the safe zero default as a platform count and disables a paid provider test', async () => {
    await render(0);
    const field = host.querySelector<HTMLInputElement>('input[type=number]')!;
    expect(field.value).toBe('0');
    expect(field.min).toBe('0');
    expect(field.step).toBe('1');
    expect(field.required).toBe(true);
    expect(host.textContent).toContain('Общий лимит платных ИИ-операций за час');
    expect(host.textContent).toContain('а не денежный бюджет');
    expect(host.textContent).toContain('включая проверку подключения');
    expect(button('Проверить подключение').disabled).toBe(true);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it('includes the explicitly configured count in settings saves without making a paid test', async () => {
    await render(7);
    expect(host.querySelector<HTMLInputElement>('input[type=number]')!.value).toBe('7');
    await act(async () => {
      host
        .querySelector('form')!
        .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    });
    const write = vi.mocked(call).mock.calls.find(([, options]) => options?.method === 'PUT');
    expect(JSON.parse(String(write?.[1]?.body))).toMatchObject({ paidOperationsPerHour: 7 });
    expect(vi.mocked(call).mock.calls.some(([url]) => url.endsWith('/test'))).toBe(false);
  });
});
