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
  if (isIP(value) === 0) return null;
  if (isIP(value) === 4) return value;
  value = new URL(`http://[${value}]/`).hostname.slice(1, -1).toLowerCase();
  const mapped = /^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/.exec(value);
  if (mapped) {
    const high = parseInt(mapped[1]!, 16),
      low = parseInt(mapped[2]!, 16);
    return `${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`;
  }
  return value;
}

function blockContains(block: BlockList, address: string): boolean {
  return block.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
}

function forwardedChain(value: string | string[] | undefined): string[] {
  if (typeof value !== 'string' || !value || value.length > 2_048 || value.includes('%')) return [];
  const entries = value.split(',');
  if (entries.length > 16) return [];
  const normalized = entries.map((entry) => normalizeIp(entry));
  // Dropping an invalid middle hop would let a caller cross the trust boundary.
  return normalized.every((entry) => entry !== null) ? (normalized as string[]) : [];
}

let cachedRaw: string | undefined;
let cachedProxies = new BlockList();

function parseTrustedProxies(raw: string): BlockList | null {
  const block = new BlockList();
  if (!raw) return block;
  if (raw.length > 2_048) return null;

  const values = raw.split(',');
  if (values.length > 16) return null;
  for (const value of values) {
    const [rawAddress, rawPrefix, ...extra] = value.trim().split('/');
    const address = normalizeIp(rawAddress);
    const version = address ? isIP(address) : 0;
    const prefix = Number(rawPrefix);
    const maximum = version === 4 ? 32 : 128;
    if (
      !address ||
      !/^[a-fA-F0-9:.]+$/.test(rawAddress ?? '') ||
      version === 0 ||
      extra.length > 0 ||
      !Number.isInteger(prefix) ||
      rawPrefix === undefined ||
      !/^\d+$/.test(rawPrefix) ||
      prefix <= 0 ||
      prefix > maximum
    ) {
      return null;
    }
    block.addSubnet(address, prefix, version === 4 ? 'ipv4' : 'ipv6');
  }
  return block;
}

function configuredTrustedProxies(): BlockList {
  const raw = process.env.ASA_TRUSTED_PROXY_CIDRS?.trim() ?? '';
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedProxies = parseTrustedProxies(raw) ?? new BlockList();
  }
  return cachedProxies;
}

export function assertTrustedProxyConfiguration(): void {
  if (parseTrustedProxies(process.env.ASA_TRUSTED_PROXY_CIDRS?.trim() ?? '') === null)
    throw new Error('Invalid ASA_TRUSTED_PROXY_CIDRS: use 1..16 explicit nonzero CIDRs.');
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
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const candidate = chain[index] as string;
    if (!trustedProxy(candidate)) {
      return { address: candidate, networkKind: networkKindForAddress(candidate) };
    }
  }
  // A proxy/gateway is infrastructure, not evidence of the visitor's address.
  return { address: 'unknown', networkKind: 'proxy' };
}

export function clientAddress(request: FastifyRequest): string {
  return clientConnection(request).address;
}
