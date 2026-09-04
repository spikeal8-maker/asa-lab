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

const LOOPBACK = new BlockList();
LOOPBACK.addSubnet('127.0.0.0', 8, 'ipv4');
LOOPBACK.addSubnet('::1', 128, 'ipv6');

export type ClientNetworkKind = 'public' | 'local_network' | 'local_device' | 'proxy' | 'unknown';

export interface ClientConnectionInfo {
  readonly address: string;
  readonly networkKind: ClientNetworkKind;
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

function configuredTrustedProxies(): BlockList {
  const block = new BlockList();
  const raw = process.env.ASA_TRUSTED_PROXY_CIDRS?.trim() ?? '';
  if (!raw || raw.length > 2_048) return block;

  for (const value of raw.split(',').slice(0, 16)) {
    const [rawAddress, rawPrefix, ...extra] = value.trim().split('/');
    const address = normalizeIp(rawAddress);
    const version = address ? isIP(address) : 0;
    const prefix = Number(rawPrefix);
    const maximum = version === 4 ? 32 : 128;
    if (
      !address ||
      version === 0 ||
      extra.length > 0 ||
      !Number.isInteger(prefix) ||
      prefix < 0 ||
      prefix > maximum
    ) {
      continue;
    }
    block.addSubnet(address, prefix, version === 4 ? 'ipv4' : 'ipv6');
  }
  return block;
}

function trustedProxy(address: string): boolean {
  return blockContains(LOOPBACK, address) || blockContains(configuredTrustedProxies(), address);
}

function networkKindForAddress(address: string): ClientNetworkKind {
  if (blockContains(LOOPBACK, address)) return 'local_device';
  return blockContains(PRIVATE_OR_PROXY, address) ? 'local_network' : 'public';
}

/**
 * Address used for abuse controls.
 *
 * Fastify's request.ip is the TCP peer unless trustProxy is enabled. Blindly
 * enabling trustProxy would instead let a caller choose any X-Forwarded-For
 * value. ASA Lab accepts forwarded headers only from loopback or explicitly
 * configured Docker/reverse-proxy networks and reads the chain from right to
 * left, ignoring attacker-controlled values farther left.
 */
export function clientConnection(request: FastifyRequest): ClientConnectionInfo {
  const socketAddress = normalizeIp(request.raw.socket.remoteAddress);
  if (!socketAddress) {
    return { address: 'unknown', networkKind: 'unknown' };
  }
  if (!trustedProxy(socketAddress)) {
    return { address: socketAddress, networkKind: networkKindForAddress(socketAddress) };
  }

  const chain = forwardedChain(request.headers['x-forwarded-for']);
  if (chain.length === 0) {
    return { address: socketAddress, networkKind: 'proxy' };
  }
  let nearestPublic: string | null = null;
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index] as string;
    if (!blockContains(PRIVATE_OR_PROXY, candidate)) {
      nearestPublic = candidate;
      break;
    }
  }

  if (!nearestPublic) {
    const visitor = chain.at(-1) as string;
    return { address: visitor, networkKind: networkKindForAddress(visitor) };
  }

  if (blockContains(CLOUDFLARE, nearestPublic)) {
    const cloudflareVisitor = normalizeIp(headerValue(request.headers['cf-connecting-ip']));
    if (cloudflareVisitor) {
      return {
        address: cloudflareVisitor,
        networkKind: networkKindForAddress(cloudflareVisitor),
      };
    }
  }
  return { address: nearestPublic, networkKind: networkKindForAddress(nearestPublic) };
}

export function clientAddress(request: FastifyRequest): string {
  return clientConnection(request).address;
}
