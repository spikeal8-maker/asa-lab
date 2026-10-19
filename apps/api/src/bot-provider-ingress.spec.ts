import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  BotProviderIngress,
  IngressProbeRegistry,
  isPublicIngressAddress,
  providerSecretHeader,
  providerWebhookUrl,
  type IngressContext,
  type IngressRequest,
  type IngressTransportResponse,
} from './bot-provider-ingress.js';

const KEY = Buffer.alloc(32, 23);
const NOW = 1_800_000_000_000;
const CONTEXT: IngressContext = {
  provider: 'telegram',
  configurationVersion: 7,
  url: 'https://asa.example/api/auth/telegram/webhook',
  key: KEY,
};
const publicAddress = { address: '8.8.8.8', family: 4 };
function fixture(
  transform?: (
    input: IngressRequest,
    receiver: BotProviderIngress,
  ) => Promise<IngressTransportResponse>,
) {
  const registry = new IngressProbeRegistry();
  let ingress: BotProviderIngress;
  const request = vi.fn(async (input: IngressRequest) => {
    if (transform) return transform(input, ingress);
    const result = ingress.answer(
      CONTEXT,
      input.headers[providerSecretHeader('telegram')],
      JSON.parse(input.body),
    );
    return { status: result ? 200 : 401, body: JSON.stringify(result) };
  });
  const resolve = vi.fn(async () => [publicAddress]);
  ingress = new BotProviderIngress({ registry, now: () => NOW, resolve, request });
  return { ingress, registry, request, resolve };
}

describe('public native ingress proof', () => {
  it('registers this process challenge before HTTPS and consumes it exactly once', async () => {
    const { ingress, registry, request, resolve } = fixture(async (input, receiver) => {
      const body = JSON.parse(input.body);
      expect(registry.pending.has(body.nonce)).toBe(true);
      expect(body.instance).toBe(registry.instance);
      const signature = input.headers[providerSecretHeader('telegram')];
      const response = receiver.answer(CONTEXT, signature, body);
      expect(response).toBeTruthy();
      expect(receiver.answer(CONTEXT, signature, body)).toBeNull();
      return { status: 200, body: JSON.stringify(response) };
    });
    await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
      state: 'ok',
      reason: null,
    });
    expect(resolve).toHaveBeenCalledWith('asa.example');
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0]![0].address).toEqual(publicAddress);
    expect(registry.pending.size).toBe(0);
    expect(request.mock.calls[0]![0].headers).not.toHaveProperty('authorization');
    expect(JSON.stringify(request.mock.calls)).not.toContain(KEY.toString('base64url'));
  });

  it('rejects a cloned database and key served by another process registry', async () => {
    const clone = new BotProviderIngress({ now: () => NOW, registry: new IngressProbeRegistry() });
    const { ingress, registry } = fixture(async (input) => {
      const response = clone.answer(
        CONTEXT,
        input.headers[providerSecretHeader('telegram')],
        JSON.parse(input.body),
      );
      expect(response).toBeNull();
      return { status: 401, body: '{}' };
    });
    await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
      state: 'failed',
      reason: 'ingress_invalid_response',
    });
    expect(registry.pending.size).toBe(0);
  });

  it('does not accept even a correctly signed clone response without local challenge consumption', async () => {
    const { ingress } = fixture(async (input) => {
      const body = JSON.parse(input.body);
      const proof = createHmac('sha256', KEY)
        .update(
          JSON.stringify([
            'asa-provider-ingress-v1',
            'response',
            'POST',
            CONTEXT.url,
            body.instance,
            body.provider,
            body.configurationVersion,
            body.issuedAt,
            body.nonce,
          ]),
        )
        .digest('base64url');
      return { status: 200, body: JSON.stringify({ ...body, proof }) };
    });
    await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
      state: 'failed',
      reason: 'ingress_invalid_response',
    });
  });

  it.each(['signature', 'version', 'url', 'future', 'unregistered'] as const)(
    'rejects %s mismatch at the actual receiver',
    async (problem) => {
      const { ingress, registry } = fixture(async (input, receiver) => {
        const body = JSON.parse(input.body);
        if (problem === 'future') body.issuedAt = NOW + 1;
        if (problem === 'unregistered') registry.pending.clear();
        const context = {
          ...CONTEXT,
          ...(problem === 'version' ? { configurationVersion: 8 } : {}),
          ...(problem === 'url' ? { url: 'https://other.example/api/auth/telegram/webhook' } : {}),
        };
        expect(
          receiver.answer(
            context,
            problem === 'signature'
              ? 'x'.repeat(43)
              : input.headers[providerSecretHeader('telegram')],
            body,
          ),
        ).toBeNull();
        return { status: 401, body: '{}' };
      });
      await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
        state: 'failed',
      });
    },
  );

  it.each(['redirect', 'html', 'large', 'reflection'] as const)(
    'fails closed on a %s response without another network hop',
    async (problem) => {
      const { ingress, request } = fixture(async (input) => ({
        status: problem === 'redirect' ? 302 : 200,
        body:
          problem === 'html'
            ? '<html>SPA fallback</html>'
            : problem === 'large'
              ? 'x'.repeat(2049)
              : problem === 'reflection'
                ? JSON.stringify({
                    ...JSON.parse(input.body),
                    proof: input.headers[providerSecretHeader('telegram')],
                  })
                : '{}',
      }));
      await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
        state: 'failed',
        reason: 'ingress_invalid_response',
      });
      expect(request).toHaveBeenCalledTimes(1);
    },
  );

  it('bounds a DNS resolver and transport that ignore the AbortSignal', async () => {
    const hung = () => new Promise<never>(() => undefined);
    const ingress = new BotProviderIngress({ resolve: hung, request: vi.fn() });
    await expect(ingress.check(CONTEXT, AbortSignal.timeout(20))).resolves.toMatchObject({
      reason: 'ingress_dns_unavailable',
    });
    const transport = new BotProviderIngress({
      resolve: async () => [publicAddress],
      request: hung,
    });
    await expect(transport.check(CONTEXT, AbortSignal.timeout(20))).resolves.toMatchObject({
      reason: 'ingress_network_unavailable',
    });
  });

  it('rejects a mixed public/private DNS response before issuing any HTTPS request', async () => {
    const request = vi.fn();
    const ingress = new BotProviderIngress({
      resolve: async () => [publicAddress, { address: '127.0.0.1', family: 4 }],
      request,
    });
    await expect(ingress.check(CONTEXT, AbortSignal.timeout(100))).resolves.toMatchObject({
      reason: 'ingress_invalid_url',
    });
    expect(request).not.toHaveBeenCalled();
  });
});

describe('provider URL and public address boundary', () => {
  it.each([
    '127.0.0.1',
    '10.0.0.1',
    '192.168.1.1',
    '172.16.0.1',
    '169.254.169.254',
    '100.64.0.1',
    '0.0.0.0',
    '224.1.1.1',
    '192.0.2.1',
    '::1',
    '::ffff:8.8.8.8',
    'fc00::1',
    'fe80::1',
    '64:ff9b::a00:1',
    '2001:db8::1',
    '2002:7f00:1::1',
  ])('does not send a probe to %s', (address) => {
    expect(isPublicIngressAddress(address)).toBe(false);
  });
  it.each(['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'])('permits global address %s', (address) =>
    expect(isPublicIngressAddress(address)).toBe(true),
  );
  it('requires a persisted allowlisted HTTPS origin and provider-specific port', () => {
    expect(
      providerWebhookUrl('https://asa.example/max-login', 'max', ['https://asa.example'])?.href,
    ).toBe('https://asa.example/api/auth/max/webhook');
    expect(
      providerWebhookUrl('https://asa.example:8443/start', 'telegram', ['https://asa.example:8443'])
        ?.port,
    ).toBe('8443');
    for (const url of [
      'http://asa.example',
      'https://asa.example:8443',
      'https://user:password@asa.example',
      'https://127.1',
      'https://2130706433',
      'https://[::1]',
      'https://evil.example',
    ]) {
      expect(providerWebhookUrl(url, 'max', ['https://asa.example'])).toBeNull();
    }
    expect(providerWebhookUrl('https://asa.example', 'telegram', [])).toBeNull();
  });
});
