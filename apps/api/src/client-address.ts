import { BlockList, isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';

const PRIVATE_OR_PROXY = new BlockList();
for (const [address, prefix, type] of [
  ['0.0.0.0', 8, 'ipv4'],
  ['10.0.0.0', 8, 'ipv4'],
  ['100.64.0.0', 10, 'ipv4'],
  ['127.0.0.0', 8, 'ipv4'],
  ['169.254.0.0', 16, 'ipv4'],
  ['172.16.0.0', 12, 'ipv4'],
  ['192.168.0.0', 16, 'ipv4'],
  ['::1', 128, 'ipv6'],
  ['fc00::', 7, 'ipv6'],
  ['fe80::', 10, 'ipv6'],
] as const) {
  PRIVATE_OR_PROXY.addSubnet(address, prefix, type);
}

// Source: https://www.cloudflare.com/ips/ . These ranges are used only to
// decide whether CF-Connecting-IP is trustworthy; they do not control access.
const CLOUDFLARE = new BlockList();
for (const cidr of [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]) {
  const [address, rawPrefix] = cidr.split('/');
  const type = isIP(address ?? '') === 4 ? 'ipv4' : 'ipv6';
  CLOUDFLARE.addSubnet(address as string, Number(rawPrefix), type);
}

function normalizeIp(raw: string | undefined): string | null {
  if (!raw) return null;
  let value = raw.trim();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone >= 0) value = value.slice(0, zone);
  if (value.toLowerCase().startsWith('::ffff:')) {
    const mapped = value.slice(7);
    if (isIP(mapped) === 4) return mapped;
  }
  return isIP(value) === 0 ? null : value.toLowerCase();
}

function blockContains(block: BlockList, address: string): boolean {
  return block.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function forwardedChain(value: string | string[] | undefined): string[] {
  const raw = headerValue(value);
  if (!raw || raw.length > 2_048) return [];
  return raw
    .split(',')
    .slice(-8)
    .map((entry) => normalizeIp(entry))
    .filter((entry): entry is string => entry !== null);
}

/**
 * Address used for abuse controls.
 *
 * Fastify's request.ip is the TCP peer unless trustProxy is enabled. Blindly
 * enabling trustProxy would instead let a caller choose any X-Forwarded-For
 * value. Assolab listens on loopback, so forwarded headers are accepted only
 * from that local FRP hop and are read from right to left (the side proxies
 * append), ignoring attacker-controlled values farther left.
 */
export function clientAddress(request: FastifyRequest): string {
  const socketAddress = normalizeIp(request.raw.socket.remoteAddress) ?? 'unknown';
  if (socketAddress !== '127.0.0.1' && socketAddress !== '::1') {
    return socketAddress;
  }

  const chain = forwardedChain(request.headers['x-forwarded-for']);
  let nearestPublic: string | null = null;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index] as string;
    if (!blockContains(PRIVATE_OR_PROXY, candidate)) {
      nearestPublic = candidate;
      break;
    }
  }

  if (!nearestPublic) return chain.at(-1) ?? socketAddress;

  if (blockContains(CLOUDFLARE, nearestPublic)) {
    const cloudflareVisitor = normalizeIp(headerValue(request.headers['cf-connecting-ip']));
    if (cloudflareVisitor && !blockContains(PRIVATE_OR_PROXY, cloudflareVisitor)) {
      return cloudflareVisitor;
    }
  }
  return nearestPublic;
}
