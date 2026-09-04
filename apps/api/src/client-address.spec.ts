import { afterEach, describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientAddress, clientConnection } from './client-address.js';

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

  it('uses the nearest public address appended by the local proxy', () => {
    expect(
      clientAddress(
        request('127.0.0.1', {
          'x-forwarded-for': '1.2.3.4, 198.51.100.23, 10.0.0.5',
        }),
      ),
    ).toBe('198.51.100.23');
  });

  it('accepts CF-Connecting-IP only when the nearest public hop is Cloudflare', () => {
    expect(
      clientAddress(
        request('::1', {
          'x-forwarded-for': '162.158.10.20, 10.0.0.5',
          'cf-connecting-ip': '203.0.113.44',
        }),
      ),
    ).toBe('203.0.113.44');

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
      address: '127.0.0.1',
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
      address: '172.21.0.4',
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
});
