import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import type { SaveDraftUseCase } from '@asa-lab/projects';
import { BlocksRuntimeSessionIssuer } from './blocks-runtime-session-issuer.js';
import { BlocksRuntimePersistenceService } from './blocks-runtime-persistence.service.js';

const state = vi.hoisted(() => ({
  allowed: true,
  document: {
    schemaVersion: 1,
    format: 'scratch-3',
    projectJson: { targets: [], monitors: [], extensions: [] },
    assets: [],
  },
}));
const TENANT = '11111111-1111-4111-8111-111111111111';
const PRINCIPAL = '22222222-2222-4222-8222-222222222222';
const PROJECT = '44444444-4444-4444-8444-444444444444';
vi.mock('@asa-lab/projects', () => ({
  PgProjectRepository: class {
    async authorize(tenantId: string, projectId: string) {
      return state.allowed ? { tenantId, projectId, moduleKey: 'blocks', userId: null } : null;
    }
    async load() {
      return {
        project: { moduleKey: 'blocks', status: 'active' },
        draft: { document: state.document, revision: 1 },
      };
    }
  },
}));

describe('same-entry Scratch production wiring', () => {
  it('issues and verifies independent origin-bound tokens and retains authority revocation', async () => {
    const env = {
      ASA_BLOCKS_SAME_ORIGIN: 'true',
      ASA_BLOCKS_RUNTIME_SIGNING_KEY: 'ab'.repeat(32),
      ASA_BLOCKS_RUNTIME_ORIGIN: 'https://old.example.test',
      ASA_PUBLIC_WEB_ORIGINS: 'https://192.168.1.115:4610,https://asa-lab.ru',
      ASA_PUBLIC_WEB_ORIGIN_PATTERNS: 'https://*.asa-lab.ru',
    };
    const pool = {} as pg.Pool;
    const issuer = new BlocksRuntimeSessionIssuer(pool, env);
    const persistence = new BlocksRuntimePersistenceService(pool, {} as SaveDraftUseCase, env);
    state.allowed = true;
    for (const origin of [
      'https://asa-lab.ru',
      'https://192.168.1.115:4610',
      'https://future.pretest.asa-lab.ru',
    ]) {
      const session = await issuer.issueEditor(
        { tenantId: TENANT, principalId: PRINCIPAL, userId: null },
        PROJECT,
        origin,
      );
      expect(session.ok).toBe(true);
      if (!session.ok) throw new Error(session.code);
      expect(session.value.runtimeOrigin).toBe(origin);
      const request = {
        authorization: `Bearer ${session.value.runtimeToken}`,
        origin,
        projectId: PROJECT,
        permission: 'draft:write' as const,
      };
      expect((await persistence.authorize(request)).ok).toBe(true);
      expect(
        (
          await persistence.authorize({
            ...request,
            origin:
              origin === 'https://asa-lab.ru' ? 'https://192.168.1.115:4610' : 'https://asa-lab.ru',
          })
        ).ok,
      ).toBe(false);
      expect(await persistence.authorize({ ...request, origin: 'https://evil.test' })).toEqual({
        ok: false,
        code: 'forbidden_origin',
      });
      state.allowed = false;
      expect((await persistence.authorize(request)).ok).toBe(false);
      state.allowed = true;
    }
    expect(
      await issuer.issueEditor(
        { tenantId: TENANT, principalId: PRINCIPAL, userId: null },
        PROJECT,
        'https://evil.test',
      ),
    ).toEqual({ ok: false, code: 'forbidden_origin' });
  });
});
