// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { AiWebEvidence } from './AiWebEvidence';
import { AiMessageContent } from './AiMessageContent';
import { publicSourceUrl, readWebEvidence, searchThumbnailUrl } from './ai-web-evidence';
import { fetchWithSessionRefresh } from '../session-fetch';
vi.mock('../session-fetch', () => ({ fetchWithSessionRefresh: vi.fn() }));

const evidence = {
  schemaVersion: 1,
  provider: 'searxng',
  mode: 'web',
  status: 'ready',
  query: 'исследования',
  retrievedAt: '2026-10-25T12:00:00.000Z',
  sources: [
    {
      id: 1,
      title: 'Исследование <script>',
      url: 'https://example.org/research',
      hostname: 'spoofed.example.com',
      snippet: 'Результат <img src=x>',
    },
  ],
  images: [],
};

describe('server-issued internet evidence', () => {
  it('refuses SVG responses from the scoped proxy without constructing an external image', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const path =
      '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/1';
    vi.mocked(fetchWithSessionRefresh).mockResolvedValueOnce(
      new Response('<svg onload="alert(1)"/>', { headers: { 'content-type': 'image/svg+xml' } }),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(AiWebEvidence, {
            evidence: {
              ...evidence,
              images: [
                {
                  id: 1,
                  title: 'Изображение',
                  sourceUrl: 'https://example.org/image',
                  thumbnailUrl: path,
                },
              ],
            },
            seatId: 'seat-one',
          }),
        ),
      );
      expect(host.querySelector('img')).toBeNull();
      expect(host.textContent).toContain('Изображение недоступно');
      expect(vi.mocked(fetchWithSessionRefresh).mock.calls.at(-1)).toEqual([
        path,
        { headers: { 'x-asa-ai-seat': 'seat-one' }, signal: expect.any(AbortSignal) },
      ]);
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      vi.mocked(fetchWithSessionRefresh).mockReset();
    }
  });
  it('revokes authenticated preview bytes when the evidence leaves the page', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    const OriginalURL = URL;
    const create = vi.fn(() => 'blob:private-preview');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends OriginalURL {
        static override createObjectURL = create;
        static override revokeObjectURL = revoke;
      },
    );
    vi.mocked(fetchWithSessionRefresh).mockResolvedValueOnce(
      new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          createElement(AiWebEvidence, {
            evidence: {
              ...evidence,
              images: [
                {
                  id: 1,
                  title: 'Изображение',
                  sourceUrl: 'https://example.org/image',
                  thumbnailUrl:
                    '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/1',
                },
              ],
            },
          }),
        ),
      );
      expect(host.querySelector('img')?.getAttribute('src')).toBe('blob:private-preview');
      await act(async () => root.unmount());
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:private-preview');
    } finally {
      await act(async () => root.unmount());
      host.remove();
      vi.unstubAllGlobals();
      vi.mocked(fetchWithSessionRefresh).mockReset();
    }
  });
  it.each([
    'javascript:alert(1)',
    'data:text/html,test',
    'https://localhost./',
    'https://127.0.0.1/',
    'https://2130706433/',
    'https://[::1]/',
    'https://service.internal/',
    'https://user:secret@example.org/',
    'https://example.org:8443/',
    'https://router.home.arpa/',
  ])('rejects unsafe public source %s', (value) => {
    expect(publicSourceUrl(value)).toBeNull();
  });
  it('only accepts the owner-bound image proxy, never arbitrary remote previews', () => {
    const path =
      '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/1';
    expect(searchThumbnailUrl(path)).toBe(path);
    for (const value of [
      'https://avatars.mds.yandex.net/image.jpg',
      path + '?url=https://evil.org/',
      path.replace(/\/1$/, '/13'),
      '//evil.org/x.png',
      'data:image/svg+xml,x',
    ])
      expect(searchThumbnailUrl(value)).toBeNull();
  });
  it('escapes search text, derives the hostname from the real URL and only trusts matching citation IDs', () => {
    const html = renderToStaticMarkup(createElement(AiWebEvidence, { evidence }));
    expect(html).toContain('example.org');
    expect(html).not.toContain('spoofed.example.com');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    const answer = renderToStaticMarkup(
      createElement(AiMessageContent, {
        content:
          '[1](https://example.org/research) [2](https://other.org/) ![unsafe](https://evil.org/pixel.png)',
        webSearch: evidence,
      }),
    );
    expect(answer.match(/class="asa-ai-citation"/g)).toHaveLength(1);
    expect(answer).not.toContain('<img');
  });
  it('does not label failed or ambiguous attempts as received fresh sources', () => {
    const html = renderToStaticMarkup(
      createElement(AiWebEvidence, {
        evidence: {
          ...evidence,
          status: 'unavailable',
          reason: 'provider_unavailable',
          sources: [],
        },
      }),
    );
    expect(html).toContain('не подтверждён свежими источниками');
    expect(html).toContain('попытка');
    expect(html).not.toContain('получено');
  });
  it('renders a scrollable multi-image gallery with distinct source links and a truthful temperature card', () => {
    const basePath =
      '/api/ai/threads/11111111-1111-4111-8111-111111111111/web-search/22222222-2222-4222-8222-222222222222/images/';
    const html = renderToStaticMarkup(
      createElement(AiWebEvidence, {
        evidence: {
          ...evidence,
          mode: 'weather',
          images: [1, 2, 3].map((id) => ({
            id,
            title: 'Фото ' + id,
            thumbnailUrl: basePath + id,
            sourceUrl: `https://example.org/image-${id}`,
          })),
          weather: {
            provider: 'met-norway',
            forecastAt: '2026-10-25T12:00:00Z',
            forecastUpdatedAt: '2026-10-25T11:00:00Z',
            attributions: [],
            location: 'Москва',
            sourceUrl: 'https://www.yr.no/en/forecast',
            temperatureC: 12,
            hours: [
              {
                time: '2026-10-25T12:00:00Z',
                temperatureC: 12,
                humidityPercent: 65,
                windSpeedMs: 3,
              },
            ],
          },
        },
      }),
    );
    expect(html).toContain('aria-label="Найденные изображения, прокрутка по горизонтали"');
    expect(html.match(/class="asa-ai-web-image-preview"/g)).toHaveLength(3);
    for (const id of [1, 2, 3]) expect(html).toContain(`aria-label="Фото ${id}"`);
    expect(html).not.toContain('asa-ai-web-image-caption');
    expect(html).toContain('Температура 12 °C');
    expect(html).toContain('💧 65%');
    expect(html).toContain('💨 3.0 м/с');
    expect(html).toContain('MET Norway');
    expect(html).not.toContain('солнечно');
  });
  it('drops invalid weather values and future schemas without crashing history', () => {
    expect(readWebEvidence({ ...evidence, schemaVersion: 2 })).toBeNull();
    const result = readWebEvidence({
      ...evidence,
      weather: {
        provider: 'met-norway',
        forecastAt: '2026-10-25T12:00:00Z',
        forecastUpdatedAt: '2026-10-25T11:00:00Z',
        attributions: [],
        location: 'Москва',
        sourceUrl: 'https://www.yr.no/en/forecast',
        temperatureC: Infinity,
        hours: [
          { time: 'not-a-date', temperatureC: 20 },
          { time: '2026-10-25T12:00:00Z', temperatureC: 12 },
        ],
      },
    });
    expect(result?.weather?.temperatureC).toBeNull();
    expect(result?.weather?.hours).toHaveLength(1);
  });
});
