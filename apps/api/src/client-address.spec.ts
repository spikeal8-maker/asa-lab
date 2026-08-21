import { describe, expect, it } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { clientAddress } from './client-address.js';

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
    expect(clientAddress(request('127.0.0.1', { 'x-forwarded-for': 'not-an-ip' }))).toBe(
      '127.0.0.1',
    );
  });
});
