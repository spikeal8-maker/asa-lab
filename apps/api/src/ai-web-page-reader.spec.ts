import { describe, expect, it, vi } from 'vitest';
import { pageText, publicPageAddress, readPublicPage } from './ai-web-page-reader';
import { pageReadTool, parseNativeToolCalls } from './ai-native-tools';

const body = Buffer.from(
  '<html><main><h1>Facts &amp; data</h1><p>' +
    'Useful public article. '.repeat(20) +
    '</p><script>secret()</script></main></html>',
);
const signal = () => new AbortController().signal;
const resolve = vi.fn(async () => [{ address: '93.184.215.14', family: 4 }]);
const transport = vi.fn(async () => ({ status: 200, type: 'text/html; charset=utf-8', body }));
describe('bounded public page reading', () => {
  it.each([
    '127.0.0.1',
    '192.168.1.112',
    '169.254.169.254',
    '100.64.0.1',
    '10.0.0.1',
    '::1',
    '::ffff:127.0.0.1',
    '64:ff9b::7f00:1',
    '2001:db8::1',
  ])('rejects private or reserved address %s', (address) => {
    expect(publicPageAddress(address)).toBe(false);
  });
  it('extracts bounded text without scripts, forms, navigation or execution', () => {
    expect(
      pageText(
        '<nav>menu</nav><main>Hello &amp; &#1052;&#1080;&#1088;<script>bad()</script><form>password</form></main>',
      ),
    ).toBe('Hello & Мир');
    expect(pageText('a'.repeat(9000))).toHaveLength(4500);
  });
  it('pins the validated public address and returns article text', async () => {
    const result = await readPublicPage('https://example.org/a', signal(), () => true, {
      resolve,
      transport,
    });
    expect(result).toContain('Facts & data');
    expect(result).not.toContain('secret');
    expect(transport).toHaveBeenLastCalledWith(
      new URL('https://example.org/a'),
      { address: '93.184.215.14', family: 4 },
      expect.any(AbortSignal),
    );
  });
  it('rejects a mixed public/private DNS answer before connecting', async () => {
    const connect = vi.fn();
    expect(
      await readPublicPage('https://example.org', signal(), () => true, {
        resolve: async () => [
          { address: '93.184.215.14', family: 4 },
          { address: '192.168.1.112', family: 4 },
        ],
        transport: connect,
      }),
    ).toBeNull();
    expect(connect).not.toHaveBeenCalled();
  });
  it('revalidates redirects and refuses a changed domain or HTTPS downgrade', async () => {
    for (const location of ['https://internal.example.org/private', 'http://example.org/private']) {
      const connect = vi.fn(async () => ({
        status: 302,
        type: '',
        location,
        body: Buffer.alloc(0),
      }));
      expect(
        await readPublicPage(
          'https://example.org',
          signal(),
          (url) => new URL(url).hostname === 'example.org',
          { resolve, transport: connect },
        ),
      ).toBeNull();
      expect(connect).toHaveBeenCalledTimes(1);
    }
  });
  it('blocks rebinding to a private address on a same-domain redirect', async () => {
    const dns = vi
      .fn()
      .mockResolvedValueOnce([{ address: '93.184.215.14', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    const connect = vi.fn(async () => ({
      status: 302,
      type: '',
      location: '/private',
      body: Buffer.alloc(0),
    }));
    expect(
      await readPublicPage('https://example.org', signal(), () => true, {
        resolve: dns,
        transport: connect,
      }),
    ).toBeNull();
    expect(connect).toHaveBeenCalledTimes(1);
  });
  it('rejects binary or oversized responses and already cancelled operations', async () => {
    for (const reply of [
      { status: 200, type: 'application/pdf', body },
      { status: 200, type: 'text/plain', body: Buffer.alloc(512 * 1024 + 1) },
    ]) {
      expect(
        await readPublicPage('https://example.org', signal(), () => true, {
          resolve,
          transport: async () => reply,
        }),
      ).toBeNull();
    }
    expect(
      await readPublicPage('https://example.org', AbortSignal.abort(), () => true, {
        resolve,
        transport,
      }),
    ).toBeNull();
  });
  it('accepts only model-selected IDs from the offered search results', () => {
    const offered = [pageReadTool([1, 2, 3])];
    const calls = (sourceIds: unknown) => [
      { function: { name: 'read_page', arguments: { sourceIds } } },
    ];
    expect(parseNativeToolCalls(calls([2, 3]), offered)[0]?.arguments.sourceIds).toEqual([2, 3]);
    for (const ids of [[9], [1, 1], [], [1, 2, 3], ['https://example.org']])
      expect(() => parseNativeToolCalls(calls(ids), offered)).toThrow();
  });
});
