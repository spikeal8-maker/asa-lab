import { randomUUID } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import { expect, it, vi } from 'vitest';
import { authorizeAdmin, type AdminSubject } from '@asa-lab/authz';
import { AiOwnQualityController } from './ai-own-quality.controller';
import { AiOwnQualityService, maskOwnQualityText } from './ai-own-quality';
import type { AdminControlPlaneService } from './admin-control-plane.service';
function subject(state = 'verified'): AdminSubject {
  return {
    principalId: randomUUID(),
    accountId: randomUUID(),
    workspaces: [],
    capabilities: [
      { capability: 'platform_admin', state: 'verified' },
      { capability: 'ai_quality_review_own', state },
    ],
  };
}
it('does not inherit content access from the ordinary platform role', () => {
  const s = subject();
  const request = {
    permission: 'administration.ai.quality.own.read' as const,
    scope: { kind: 'platform' as const, id: null },
  };
  expect(authorizeAdmin({ ...s, capabilities: s.capabilities.slice(0, 1) }, request).allowed).toBe(
    false,
  );
  for (const state of ['provisional', 'revoked', 'suspended'])
    expect(authorizeAdmin(subject(state), request).allowed).toBe(false);
  expect(authorizeAdmin(s, request).allowed).toBe(true);
  expect(authorizeAdmin({ ...s, capabilities: s.capabilities.slice(1) }, request).allowed).toBe(
    false,
  );
});
it('rejects browser owner/school selectors, missing content grant and cross-origin writes', async () => {
  const s = subject(),
    quality = { list: vi.fn(), save: vi.fn() };
  const admin = {
    resolveAccess: vi.fn(async () => ({
      subject: s,
      scopes: [{ kind: 'platform', role: 'platform_admin' }],
    })),
    authorize: vi.fn(() => false),
  };
  const controller = new AiOwnQualityController(
    {
      resolve: vi.fn(async () => ({ principalId: s.principalId })),
    } as unknown as ActiveContextUseCase,
    admin as unknown as AdminControlPlaneService,
    quality as unknown as AiOwnQualityService,
  );
  const req = {
    cookies: {},
    query: {},
    headers: { host: 'asa.test', origin: 'https://asa.test', 'content-type': 'application/json' },
  } as unknown as FastifyRequest;
  await expect(controller.list(req)).rejects.toMatchObject({ status: 403 });
  expect(quality.list).not.toHaveBeenCalled();
  await expect(
    controller.list({ ...req, query: { owner: randomUUID() } } as FastifyRequest),
  ).rejects.toMatchObject({ status: 400 });
  await expect(
    controller.save(
      { ...req, headers: { ...req.headers, origin: 'https://evil.test' } } as FastifyRequest,
      {},
    ),
  ).rejects.toMatchObject({ status: 403 });
  expect(quality.save).not.toHaveBeenCalled();
});
it('masks supported secret/contact formats without treating markup as executable', () => {
  const raw =
    'sk-12345678secret ghp_12345678secret Bearer abcdefghijklmn API_KEY=privateKey123 password="secret123" mail@example.org +7 (999) 123-45-67 <img src=x onerror=alert(1)>';
  const result = maskOwnQualityText(raw);
  expect(result.masked).toBe(true);
  expect(result.text).not.toMatch(
    /12345678secret|abcdefghijklmn|privateKey123|secret123|mail@example|999/,
  );
  expect(result.text).toContain('<img');
});
