import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import {
  assertTrustedProxyConfiguration,
  clientAddress,
  clientConnection,
} from './client-address.js';

function request(
  remoteAddress: string,
  headers: Record<string, string | undefined> = {},
): FastifyRequest {
  return {
    raw: { socket: { remoteAddress } },
    headers,
  } as unknown as FastifyRequest;
}

describe('clientAddress', () => {
  afterEach(() => {
    delete process.env.ASA_TRUSTED_PROXY_CIDRS;
  });

  it('ignores forwarded headers from a non-loopback peer', () => {
    expect(clientAddress(request('198.51.100.7', { 'x-forwarded-for': '203.0.113.9' }))).toBe(
      '198.51.100.7',
    );
  });

  it('stops at the nearest untrusted hop, including a private visitor', () => {
    expect(
      clientAddress(
        request('127.0.0.1', {
          'x-forwarded-for': '1.2.3.4, 198.51.100.23, 10.0.0.5',
        }),
      ),
    ).toBe('10.0.0.5');
  });

  it('never grants implicit trust to Cloudflare or its alternate header', () => {
    expect(
      clientAddress(
        request('::1', {
          'x-forwarded-for': '162.158.10.20, 10.0.0.5',
          'cf-connecting-ip': '203.0.113.44',
        }),
      ),
    ).toBe('10.0.0.5');

    expect(
      clientAddress(
        request('::1', {
          'x-forwarded-for': '198.51.100.23',
          'cf-connecting-ip': '203.0.113.44',
        }),
      ),
    ).toBe('198.51.100.23');
  });

  it('falls back safely when forwarded values are malformed', () => {
    expect(clientConnection(request('127.0.0.1', { 'x-forwarded-for': 'not-an-ip' }))).toEqual({
      address: 'unknown',
      networkKind: 'proxy',
    });
  });

  it('accepts forwarding only from an explicitly trusted Docker proxy range', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    expect(
      clientConnection(
        request('172.21.0.4', {
          'x-forwarded-for': '203.0.113.51',
        }),
      ),
    ).toEqual({ address: '203.0.113.51', networkKind: 'public' });
  });

  it('classifies a private forwarded visitor as local, not as a school', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    expect(
      clientConnection(
        request('172.21.0.4', {
          'x-forwarded-for': '192.168.1.42',
        }),
      ),
    ).toEqual({ address: '192.168.1.42', networkKind: 'local_network' });
  });

  it('does not count a trusted proxy itself as a visitor', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    expect(clientConnection(request('172.21.0.4'))).toEqual({
      address: 'unknown',
      networkKind: 'proxy',
    });
  });

  it('ignores malformed trusted proxy ranges and fails closed', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/99,not-a-cidr';
    expect(clientConnection(request('172.21.0.4', { 'x-forwarded-for': '203.0.113.51' }))).toEqual({
      address: '172.21.0.4',
      networkKind: 'local_network',
    });
  });

  it('walks only explicitly trusted hops from right to left and ignores spoofed left values', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12,10.0.0.5/32';
    expect(
      clientAddress(
        request('172.21.0.4', {
          'x-forwarded-for': '1.2.3.4, 198.51.100.23, 10.0.0.5',
        }),
      ),
    ).toBe('198.51.100.23');
    expect(clientConnection(request('172.21.0.4', { 'x-forwarded-for': '172.21.0.1' }))).toEqual({
      address: 'unknown',
      networkKind: 'proxy',
    });
  });

  it('does not skip a malformed, duplicate or oversized chain', () => {
    for (const header of [
      '203.0.113.3, invalid, 127.0.0.1',
      ',203.0.113.3',
      '203.0.113.3,'.repeat(17),
      '203.0.113.3%forged-zone',
      'x'.repeat(2049),
      ['203.0.113.3', '203.0.113.4'],
    ]) {
      const candidate = request('127.0.0.1');
      candidate.headers['x-forwarded-for'] = header;
      expect(clientConnection(candidate)).toEqual({ address: 'unknown', networkKind: 'proxy' });
    }
  });

  it('normalizes IPv6, mapped IPv4 and direct LAN connections consistently', () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = 'fd00::/64';
    expect(clientAddress(request('fd00::2', { 'x-forwarded-for': '2001:DB8:0:0::7' }))).toBe(
      '2001:db8::7',
    );
    expect(
      clientAddress(request('::ffff:127.0.0.1', { 'x-forwarded-for': '::ffff:c000:201' })),
    ).toBe('192.0.2.1');
    expect(clientConnection(request('192.168.1.3', { 'x-forwarded-for': '203.0.113.9' }))).toEqual({
      address: '192.168.1.3',
      networkKind: 'local_network',
    });
  });

  it('does not trust all sources or partly malformed configuration', () => {
    for (const value of ['0.0.0.0/0', '172.16.0.0/12,invalid', '172.16.0.0/', '::/0']) {
      process.env.ASA_TRUSTED_PROXY_CIDRS = value;
      expect(() => assertTrustedProxyConfiguration()).toThrow('ASA_TRUSTED_PROXY_CIDRS');
      expect(clientAddress(request('172.21.0.4', { 'x-forwarded-for': '203.0.113.9' }))).toBe(
        '172.21.0.4',
      );
    }
  });
});
