import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { request as httpsRequest } from 'node:https';
import { BlockList, isIP } from 'node:net';
import type { BotAuthProvider, ProviderReadinessCheck } from './auth-provider-availability.js';

const PROBE_TTL_MS = 10_000;
const MAX_RESPONSE_BYTES = 2048;
const MAX_PENDING = 16;
const BLOCKED = new BlockList();
for (const [address, prefix] of [
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
  BLOCKED.addSubnet(address, prefix, 'ipv4');
for (const [address, prefix] of [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
] as const)
  BLOCKED.addSubnet(address, prefix, 'ipv6');

export function isPublicIngressAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !BLOCKED.check(address, 'ipv4');
  // Global IPv6 unicast only. This also excludes IPv4-mapped, NAT64 and local addresses.
  return family === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !BLOCKED.check(address, 'ipv6');
}

export function providerWebhookUrl(
  raw: string,
  provider: BotAuthProvider,
  allowedOrigins: readonly string[],
): URL | null {
  try {
    const url = new URL(raw);
    const host = url.hostname.replace(/^\[|\]$/g, '');
    const port = url.port || '443';
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      !allowedOrigins.includes(url.origin) ||
      !(provider === 'max' ? port === '443' : ['443', '80', '88', '8443'].includes(port)) ||
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host.endsWith('.local') ||
      (isIP(host) !== 0 && !isPublicIngressAddress(host))
    )
      return null;
    return new URL(`/api/auth/${provider}/webhook`, url.origin);
  } catch {
    return null;
  }
}

export interface IngressContext {
  readonly provider: BotAuthProvider;
  readonly configurationVersion: number;
  readonly url: string;
  readonly key: Buffer;
}
interface Probe {
  readonly type: 'asa_ingress_probe';
  readonly protocol: 1;
  readonly instance: string;
  readonly provider: BotAuthProvider;
  readonly configurationVersion: number;
  readonly issuedAt: number;
  readonly nonce: string;
}
export interface IngressProbeResponse extends Probe {
  readonly proof: string;
}
export interface IngressRequest {
  readonly url: URL;
  readonly address: { readonly address: string; readonly family: number };
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string;
}
export interface IngressTransportResponse {
  readonly status: number;
  readonly body: string;
}
export interface IngressOptions {
  readonly now?: () => number;
  readonly resolve?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
  readonly request?: (
    input: IngressRequest,
    signal: AbortSignal,
  ) => Promise<IngressTransportResponse>;
  readonly registry?: IngressProbeRegistry;
}

/** Ephemeral process state is never copied with the database/settings key. */
export class IngressProbeRegistry {
  readonly instance = randomBytes(32).toString('base64url');
  readonly pending = new Map<string, { probe: Probe; url: string; signature: string }>();
}
const PROCESS_REGISTRY = new IngressProbeRegistry();

function equal(left: unknown, right: string): boolean {
  if (typeof left !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(left)) return false;
  return timingSafeEqual(Buffer.from(left), Buffer.from(right));
}
function signature(
  context: IngressContext,
  probe: Probe,
  direction: 'request' | 'response',
): string {
  return createHmac('sha256', context.key)
    .update(
      JSON.stringify([
        'asa-provider-ingress-v1',
        direction,
        'POST',
        context.url,
        probe.instance,
        probe.provider,
        probe.configurationVersion,
        probe.issuedAt,
        probe.nonce,
      ]),
    )
    .digest('base64url');
}
export function providerSecretHeader(provider: BotAuthProvider): string {
  return provider === 'max' ? 'x-max-bot-api-secret' : 'x-telegram-bot-api-secret-token';
}

/** Direct pinned HTTPS; no redirect, ambient proxy, second DNS lookup or token. */
function pinnedRequest(
  input: IngressRequest,
  signal: AbortSignal,
): Promise<IngressTransportResponse> {
  return new Promise((resolve, reject) => {
    const request = httpsRequest(
      input.url,
      {
        method: 'POST',
        agent: false,
        signal,
        headers: input.headers,
        lookup: (_hostname, options, callback) => {
          if (typeof options === 'object' && options.all) callback(null, [input.address]);
          else callback(null, input.address.address, input.address.family);
        },
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('ingress response too large'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () =>
          resolve({
            status: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    request.on('error', reject);
    request.end(input.body);
  });
}

function withinDeadline<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error('ingress deadline'));
    if (signal.aborted) return aborted();
    signal.addEventListener('abort', aborted, { once: true });
    operation.then(resolve, reject).finally(() => signal.removeEventListener('abort', aborted));
  });
}

export class BotProviderIngress {
  private readonly now: () => number;
  private readonly registry: IngressProbeRegistry;
  private readonly resolve: NonNullable<IngressOptions['resolve']>;
  private readonly request: NonNullable<IngressOptions['request']>;
  constructor(options: IngressOptions = {}) {
    this.now = options.now ?? Date.now;
    this.registry = options.registry ?? PROCESS_REGISTRY;
    this.resolve = options.resolve ?? ((hostname) => lookup(hostname, { all: true }));
    this.request = options.request ?? pinnedRequest;
  }

  accepts(body: unknown): boolean {
    return (
      !!body &&
      typeof body === 'object' &&
      (body as { type?: unknown }).type === 'asa_ingress_probe'
    );
  }

  answer(
    context: IngressContext,
    suppliedSignature: unknown,
    body: unknown,
  ): IngressProbeResponse | null {
    if (!this.accepts(body)) return null;
    const probe = body as Probe;
    const pending = this.registry.pending.get(probe.nonce);
    if (
      !pending ||
      probe.instance !== this.registry.instance ||
      probe.protocol !== 1 ||
      probe.provider !== context.provider ||
      probe.configurationVersion !== context.configurationVersion ||
      !Number.isSafeInteger(probe.issuedAt) ||
      probe.issuedAt > this.now() ||
      this.now() - probe.issuedAt > PROBE_TTL_MS ||
      pending.url !== context.url ||
      JSON.stringify(pending.probe) !== JSON.stringify(probe) ||
      !equal(suppliedSignature, pending.signature) ||
      !equal(suppliedSignature, signature(context, probe, 'request'))
    )
      return null;
    this.registry.pending.delete(probe.nonce);
    return { ...probe, proof: signature(context, probe, 'response') };
  }

  async check(context: IngressContext, signal: AbortSignal): Promise<ProviderReadinessCheck> {
    const failed = (reason: ProviderReadinessCheck['reason']): ProviderReadinessCheck => ({
      state: 'failed',
      reason,
      checkedAt: new Date(this.now()).toISOString(),
    });
    const url = new URL(context.url);
    const hostname = url.hostname.replace(/^\[|\]$/g, '');
    let addresses: Array<{ address: string; family: number }>;
    try {
      addresses = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await withinDeadline(this.resolve(hostname), signal);
    } catch {
      return failed('ingress_dns_unavailable');
    }
    if (!addresses.length || addresses.some((item) => !isPublicIngressAddress(item.address)))
      return failed('ingress_invalid_url');
    for (const [nonce, pending] of this.registry.pending)
      if (this.now() - pending.probe.issuedAt > PROBE_TTL_MS) this.registry.pending.delete(nonce);
    if (signal.aborted || this.registry.pending.size >= MAX_PENDING)
      return failed('ingress_network_unavailable');
    const probe: Probe = {
      type: 'asa_ingress_probe',
      protocol: 1,
      instance: this.registry.instance,
      provider: context.provider,
      configurationVersion: context.configurationVersion,
      issuedAt: this.now(),
      nonce: randomBytes(32).toString('base64url'),
    };
    const proof = signature(context, probe, 'request');
    // Register BEFORE any network request. A clone with the same key cannot answer.
    this.registry.pending.set(probe.nonce, { probe, url: context.url, signature: proof });
    try {
      const response = await withinDeadline(
        this.request(
          {
            url,
            address: addresses[0]!,
            body: JSON.stringify(probe),
            headers: {
              'content-type': 'application/json',
              [providerSecretHeader(context.provider)]: proof,
            },
          },
          signal,
        ),
        signal,
      );
      if (response.status !== 200 || Buffer.byteLength(response.body) > MAX_RESPONSE_BYTES)
        return failed('ingress_invalid_response');
      let value: IngressProbeResponse;
      try {
        value = JSON.parse(response.body) as IngressProbeResponse;
      } catch {
        return failed('ingress_invalid_response');
      }
      if (!value || typeof value !== 'object') return failed('ingress_invalid_response');
      const { proof: responseProof, ...echo } = value;
      if (
        JSON.stringify(echo) !== JSON.stringify(probe) ||
        !equal(responseProof, signature(context, probe, 'response')) ||
        this.registry.pending.has(probe.nonce)
      )
        return failed('ingress_invalid_response');
      return { state: 'ok', reason: null, checkedAt: new Date(this.now()).toISOString() };
    } catch {
      return failed('ingress_network_unavailable');
    } finally {
      this.registry.pending.delete(probe.nonce);
    }
  }
}
