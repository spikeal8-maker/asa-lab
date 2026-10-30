import { lookup } from 'node:dns/promises';
import { request } from 'node:https';
import { BlockList, isIP } from 'node:net';
import { publicWebUrl } from './ai-web-search-provider.js';

const blocked = new BlockList();
for (const [ip, bits] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  blocked.addSubnet(ip, bits, 'ipv4');
for (const [ip, bits] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  blocked.addSubnet(ip, bits, 'ipv6');

export function publicPageAddress(address: string): boolean {
  const family = isIP(address);
  return family === 4
    ? !blocked.check(address, 'ipv4')
    : family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !blocked.check(address, 'ipv6');
}

/** Text only: never execute HTML, scripts, remote images or page-supplied instructions. */
export function pageText(html: string, limit = 4500): string {
  // Monotonic scanner avoids quadratic regex backtracking on hostile malformed HTML.
  const lower = html.toLowerCase();
  const hidden = new Set([
    'head',
    'script',
    'style',
    'noscript',
    'svg',
    'iframe',
    'nav',
    'footer',
    'header',
    'form',
  ]);
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open < 0) {
      chunks.push(html.slice(cursor));
      break;
    }
    chunks.push(html.slice(cursor, open));
    if (html.startsWith('<!--', open)) {
      const end = html.indexOf('-->', open + 4);
      cursor = end < 0 ? html.length : end + 3;
      continue;
    }
    const end = html.indexOf('>', open + 1);
    if (end < 0) break;
    const tag = /^([a-z][a-z0-9]*)\b/i.exec(html.slice(open + 1, end))?.[1]?.toLowerCase();
    cursor = end + 1;
    if (tag && hidden.has(tag)) {
      const close = lower.indexOf('</' + tag, cursor);
      if (close < 0) break;
      const closeEnd = html.indexOf('>', close);
      cursor = closeEnd < 0 ? html.length : closeEnd + 1;
    }
    chunks.push(' ');
  }
  return chunks
    .join(' ')
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (raw, entity: string) => {
      if (entity.startsWith('#')) {
        const point =
          entity[1]?.toLowerCase() === 'x'
            ? parseInt(entity.slice(2), 16)
            : Number(entity.slice(1));
        return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
          ? String.fromCodePoint(point)
          : ' ';
      }
      return (
        ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' } as Record<string, string>)[
          entity.toLowerCase()
        ] ?? raw
      );
    })
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, Math.max(500, Math.min(8000, limit)));
}

interface Address {
  address: string;
  family: number;
}
interface PageReply {
  status: number;
  type: string;
  location?: string | undefined;
  body: Buffer;
}
export interface PageReaderOptions {
  textLimit?: number;
  resolve?: (hostname: string) => Promise<Address[]>;
  transport?: (url: URL, address: Address, signal: AbortSignal) => Promise<PageReply>;
}
const MAX_BYTES = 512 * 1024;
let active = 0;

/** Pin validated DNS to the actual TLS connection; never use ambient cookies/proxy or follow redirects implicitly. */
function pinnedPage(
  url: URL,
  address: Address,
  signal: AbortSignal,
  image = false,
): Promise<PageReply> {
  const byteLimit = image ? 8 * 1024 * 1024 : MAX_BYTES;
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: 'GET',
        agent: false,
        signal,
        headers: {
          'User-Agent': 'ASA-Lab/1.0',
          Accept: image ? 'image/png,image/jpeg,image/webp' : 'text/html,text/plain',
          'Accept-Encoding': 'identity',
        },
        lookup: (_host, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [address]);
          else callback(null, address.address, address.family);
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        const type = res.headers['content-type'] ?? '';
        if (status >= 300 && status < 400) {
          res.destroy();
          resolve({ status, type, location: res.headers.location, body: Buffer.alloc(0) });
          return;
        }
        if (
          status !== 200 ||
          !(image ? /^image\/(png|jpeg|webp)(?:;|$)/i : /^(text\/html|text\/plain)(?:;|$)/i).test(
            type,
          ) ||
          (res.headers['content-encoding'] && res.headers['content-encoding'] !== 'identity') ||
          Number(res.headers['content-length'] ?? 0) > byteLimit
        ) {
          res.destroy();
          reject(new Error('Page unavailable'));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > byteLimit) req.destroy(new Error('Resource too large'));
          else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status, type, body: Buffer.concat(chunks) }));
      },
    );
    req.on('error', reject);
    req.end();
  });
}

export async function readPublicPage(
  input: string,
  signal: AbortSignal,
  allowed: (url: string) => boolean,
  options: PageReaderOptions = {},
): Promise<string | null> {
  if (active >= 4 || signal.aborted) return null;
  active += 1;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(6000)]);
  let abort: (() => void) | undefined;
  try {
    const work = async () => {
      let next = input;
      for (let hop = 0; hop < 3; hop += 1) {
        deadline.throwIfAborted();
        const safe = publicWebUrl(next);
        if (!safe || !allowed(safe)) return null;
        const url = new URL(safe);
        const addresses = await (options.resolve ?? ((host) => lookup(host, { all: true })))(
          url.hostname,
        );
        deadline.throwIfAborted();
        if (
          !addresses.length ||
          addresses.length > 16 ||
          addresses.some((item) => !publicPageAddress(item.address))
        )
          return null;
        const reply = await (options.transport ?? pinnedPage)(url, addresses[0]!, deadline);
        if ([301, 302, 303, 307, 308].includes(reply.status) && reply.location) {
          next = new URL(reply.location, url).href;
          continue;
        }
        if (
          reply.status !== 200 ||
          reply.body.length > MAX_BYTES ||
          !/^text\/(?:html|plain)(?:;|$)/i.test(reply.type)
        )
          return null;
        const charset = /charset\s*=\s*["']?([\w-]+)/i.exec(reply.type)?.[1] ?? 'utf-8';
        const text = pageText(
          new TextDecoder(charset, { fatal: true }).decode(reply.body),
          options.textLimit,
        );
        return text.length >= 80 ? text : null;
      }
      return null;
    };
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        abort = () => resolve(null);
        deadline.addEventListener('abort', abort, { once: true });
        if (deadline.aborted) resolve(null);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (abort) deadline.removeEventListener('abort', abort);
    active -= 1;
  }
}

/** Exact source original selected from an owner-bound receipt, never a client URL. */
export async function readPublicImage(
  input: string,
  signal: AbortSignal,
  options: PageReaderOptions = {},
): Promise<Buffer | null> {
  if (active >= 4 || signal.aborted) return null;
  active += 1;
  const deadline = AbortSignal.any([signal, AbortSignal.timeout(12000)]);
  let abort: (() => void) | undefined;
  try {
    const work = async () => {
      let next = input;
      for (let hop = 0; hop < 3; hop += 1) {
        deadline.throwIfAborted();
        const safe = publicWebUrl(next);
        if (!safe) return null;
        const url = new URL(safe);
        const addresses = await (options.resolve ?? ((host) => lookup(host, { all: true })))(
          url.hostname,
        );
        deadline.throwIfAborted();
        if (
          !addresses.length ||
          addresses.length > 16 ||
          addresses.some((item) => !publicPageAddress(item.address))
        )
          return null;
        const reply = options.transport
          ? await options.transport(url, addresses[0]!, deadline)
          : await pinnedPage(url, addresses[0]!, deadline, true);
        if ([301, 302, 303, 307, 308].includes(reply.status) && reply.location) {
          next = new URL(reply.location, url).href;
          continue;
        }
        return reply.status === 200 &&
          reply.body.length > 0 &&
          reply.body.length <= 8 * 1024 * 1024 &&
          /^image\/(png|jpeg|webp)(?:;|$)/i.test(reply.type)
          ? reply.body
          : null;
      }
      return null;
    };
    return await Promise.race([
      work(),
      new Promise<null>((resolve) => {
        abort = () => resolve(null);
        deadline.addEventListener('abort', abort, { once: true });
        if (deadline.aborted) resolve(null);
      }),
    ]);
  } catch {
    return null;
  } finally {
    if (abort) deadline.removeEventListener('abort', abort);
    active -= 1;
  }
}
