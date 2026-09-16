import { randomBytes, randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { SignJWT, decodeJwt, decodeProtectedHeader } from 'jose';
import {
  BlocksRuntimeCapabilityService,
  type BlocksRuntimeBinding,
  type BlocksRuntimePermission,
} from './blocks-runtime-capability.js';

const ORIGIN = 'https://scratch.asa.example';
const START = 1700000000;
function fixture(mode: 'editor' | 'player' = 'editor') {
  let now = START;
  const key = randomBytes(32);
  const binding: BlocksRuntimeBinding = {
    tenantId: randomUUID(),
    principalId: randomUUID(),
    projectId: randomUUID(),
    mode,
    versionId: mode === 'editor' ? null : randomUUID(),
  };
  const allows = vi.fn(async () => true);
  const service = new BlocksRuntimeCapabilityService({
    key,
    runtimeOrigin: ORIGIN,
    authority: { allows },
    now: () => now,
  });
  const issue = async () => {
    const result = await service.issue(binding);
    if (!result.ok) throw new Error(`Fixture issuance failed: ${result.code}`);
    return result.value.token;
  };
  const verify = (token: string, permission: BlocksRuntimePermission = 'project:read') =>
    service.verify({ token, origin: ORIGIN, binding, permission });
  return {
    service,
    key,
    binding,
    allows,
    issue,
    verify,
    setNow: (value: number) => {
      now = value;
    },
  };
}
async function resign(
  token: string,
  key: Uint8Array,
  claims: Record<string, unknown> = {},
  header: { alg: string; typ: string; [key: string]: unknown } = {
    alg: 'HS256',
    typ: 'asa-blocks-runtime+jwt',
  },
) {
  return new SignJWT({ ...decodeJwt<Record<string, unknown>>(token), ...claims })
    .setProtectedHeader(header)
    .sign(key);
}
describe('Blocks runtime capability core (not HTTP/session wiring)', () => {
  it.each(['editor', 'player'] as const)(
    'signs and verifies the fixed %s profile with fresh authority',
    async (mode) => {
      const f = fixture(mode);
      const token = await f.issue();
      expect(decodeProtectedHeader(token)).toEqual({ alg: 'HS256', typ: 'asa-blocks-runtime+jwt' });
      expect(decodeJwt(token)).toMatchObject({
        iss: 'asa-lab',
        aud: 'asa-blocks-runtime',
        sub: f.binding.principalId,
        moduleKey: 'blocks',
        iat: START,
        nbf: START,
        exp: START + 600,
      });
      expect(token.length).toBeLessThanOrEqual(4096);
      const result = await f.verify(token);
      expect(result).toMatchObject({ ok: true, value: { ...f.binding, expiresAt: START + 600 } });
      expect(f.allows).toHaveBeenCalledTimes(2);
      expect(f.allows).toHaveBeenLastCalledWith({ ...f.binding, permissions: ['project:read'] });
      if (result.ok) {
        expect(Object.isFrozen(result.value)).toBe(true);
        expect(Object.isFrozen(result.value.permissions)).toBe(true);
      }
    },
  );
  it('checks every write permission for editor and denies all player writes before authority lookup', async () => {
    for (const permission of ['asset:write', 'draft:write', 'snapshot:write'] as const) {
      const editor = fixture();
      expect((await editor.verify(await editor.issue(), permission)).ok).toBe(true);
      const player = fixture('player');
      const token = await player.issue();
      player.allows.mockClear();
      expect(await player.verify(token, permission)).toEqual({
        ok: false,
        code: 'permission_denied',
      });
      expect(player.allows).not.toHaveBeenCalled();
    }
  });
  it('issues unique jti values; no default or cached authority', async () => {
    const f = fixture();
    const a = await f.issue();
    const b = await f.issue();
    expect(decodeJwt(a).jti).not.toBe(decodeJwt(b).jti);
    f.allows.mockResolvedValue(false);
    expect(await f.verify(a)).toEqual({ ok: false, code: 'authority_denied' });
    expect(await f.service.issue(f.binding)).toEqual({ ok: false, code: 'authority_denied' });
  });
  it.each([
    'https://portal.asa.example',
    ORIGIN + '/',
    'null',
    '*',
    '',
    'http://scratch.asa.example',
  ])('rejects non-exact Origin %s', async (origin) => {
    const f = fixture();
    const token = await f.issue();
    f.allows.mockClear();
    expect(
      await f.service.verify({ token, origin, binding: f.binding, permission: 'project:read' }),
    ).toEqual({ ok: false, code: 'forbidden_origin' });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it.each(['tenantId', 'principalId', 'projectId'] as const)(
    'rejects route %s mismatch',
    async (field) => {
      const f = fixture();
      const token = await f.issue();
      f.allows.mockClear();
      expect(
        await f.service.verify({
          token,
          origin: ORIGIN,
          binding: { ...f.binding, [field]: randomUUID() },
          permission: 'project:read',
        }),
      ).toEqual({ ok: false, code: 'binding_mismatch' });
      expect(f.allows).not.toHaveBeenCalled();
    },
  );
  it('binds player to one immutable version and forbids editor/player substitution', async () => {
    const f = fixture('player');
    const token = await f.issue();
    for (const binding of [
      { ...f.binding, versionId: randomUUID() },
      { ...f.binding, mode: 'editor' as const, versionId: null },
    ]) {
      expect(
        await f.service.verify({ token, origin: ORIGIN, binding, permission: 'project:read' }),
      ).toEqual({ ok: false, code: 'binding_mismatch' });
    }
  });
  it.each(['', 'x', 'a.b.c', 'a'.repeat(4097), 'abc.def.ghi=', ' abc.def.ghi'])(
    'rejects malformed/oversized tokens without authority lookup',
    async (token) => {
      const f = fixture();
      expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
      expect(f.allows).not.toHaveBeenCalled();
    },
  );
  it('rejects wrong signature and non-HS256 algorithm', async () => {
    const f = fixture();
    const original = await f.issue();
    f.allows.mockClear();
    for (const token of [
      await resign(original, randomBytes(32)),
      await resign(original, randomBytes(64), {}, { alg: 'HS512', typ: 'asa-blocks-runtime+jwt' }),
    ])
      expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it.each([
    { iss: 'other' },
    { aud: 'other' },
    { aud: ['asa-blocks-runtime', 'other'] },
    { moduleKey: 'electronics' },
    { admin: true },
    { sub: '' },
    { jti: 'bad' },
    { tenantId: 'BAD' },
    { projectId: null },
    { versionId: randomUUID() },
    { mode: 'other' },
    { permissions: ['project:read', 'admin:write'] },
    { permissions: ['project:read'] },
    {
      permissions: ['project:read', 'project:read', 'asset:write', 'draft:write', 'snapshot:write'],
    },
    { iat: START + 1 },
    { iat: START - 1 },
    { nbf: START + 1 },
    { exp: START + 601 },
    { iat: START + 0.5 },
    { exp: '1700000600' },
    { nbf: undefined },
    { permissions: null },
  ])('rejects signed but out-of-profile claims %#', async (claims) => {
    const f = fixture();
    const token = await resign(await f.issue(), f.key, claims);
    f.allows.mockClear();
    expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it.each([
    { typ: 'JWT' },
    { typ: 'ASA-BLOCKS-RUNTIME+JWT' },
    { kid: 'external' },
    { jku: 'https://untrusted.invalid/keys' },
    { extra: 'header' },
  ])('rejects signed but out-of-profile header %#', async (override) => {
    const f = fixture();
    const token = await resign(
      await f.issue(),
      f.key,
      {},
      { alg: 'HS256', typ: 'asa-blocks-runtime+jwt', ...override },
    );
    f.allows.mockClear();
    expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it('rejects a signed player capability with added write permission', async () => {
    const f = fixture('player');
    const token = await resign(await f.issue(), f.key, {
      permissions: ['project:read', 'asset:read', 'draft:write'],
    });
    expect(await f.verify(token, 'draft:write')).toEqual({ ok: false, code: 'invalid_token' });
  });
  it('accepts at iat and exp-1, denies at exp with zero tolerance', async () => {
    const f = fixture();
    const token = await f.issue();
    expect((await f.verify(token)).ok).toBe(true);
    f.setNow(START + 599);
    expect((await f.verify(token)).ok).toBe(true);
    f.setNow(START + 600);
    expect(await f.verify(token)).toEqual({ ok: false, code: 'expired_token' });
    f.setNow(START - 1);
    expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
  });
  it.each(['issue', 'verify'] as const)(
    'fails closed when token expires during %s authority check',
    async (operation) => {
      const f = fixture();
      const token = await f.issue();
      f.allows.mockImplementation(async () => {
        f.setNow(START + 600);
        return true;
      });
      expect(await (operation === 'issue' ? f.service.issue(f.binding) : f.verify(token))).toEqual({
        ok: false,
        code: 'expired_token',
      });
    },
  );
  it.each([NaN, Infinity, -1, 1.2, Number.MAX_SAFE_INTEGER])(
    'rejects invalid injected clock %s',
    async (now) => {
      const f = fixture();
      const token = await f.issue();
      f.setNow(now);
      expect(await f.service.issue(f.binding)).toEqual({
        ok: false,
        code: 'dependency_unavailable',
      });
      expect(await f.verify(token)).toEqual({ ok: false, code: 'dependency_unavailable' });
    },
  );
  it('fails closed on backward clock during asynchronous authority', async () => {
    const f = fixture();
    const token = await f.issue();
    f.allows.mockImplementation(async () => {
      f.setNow(START - 1);
      return true;
    });
    expect(await f.verify(token)).toEqual({ ok: false, code: 'dependency_unavailable' });
  });
  it('redacts dependency failures and never accepts truthy non-boolean authority', async () => {
    const f = fixture();
    const token = await f.issue();
    f.allows.mockRejectedValue(new Error(`private token ${token}`));
    expect(await f.verify(token)).toEqual({ ok: false, code: 'dependency_unavailable' });
    expect(await f.service.issue(f.binding)).toEqual({ ok: false, code: 'dependency_unavailable' });
    f.allows.mockResolvedValue('yes' as unknown as boolean);
    expect(await f.verify(token)).toEqual({ ok: false, code: 'authority_denied' });
    expect(JSON.stringify(f.service)).toBe('{}');
  });
  it('copies the signing key and snapshots caller binding before asynchronous work', async () => {
    const f = fixture();
    const input = { ...f.binding };
    const originalProject = input.projectId;
    const pending = f.service.issue(input);
    input.projectId = randomUUID();
    f.key.fill(0);
    const result = await pending;
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('issuance failed');
    expect(decodeJwt(result.value.token)['projectId']).toBe(originalProject);
    expect((await f.verify(result.value.token)).ok).toBe(true);
    const request = {
      token: result.value.token,
      origin: ORIGIN,
      binding: { ...f.binding },
      permission: 'project:read' as const,
    };
    const verification = f.service.verify(request);
    request.binding.projectId = randomUUID();
    expect((await verification).ok).toBe(true);
  });
  it('freezes authority inputs, including permissions', async () => {
    const f = fixture();
    const allows = vi.fn(async (input: unknown) => {
      expect(Object.isFrozen(input)).toBe(true);
      expect(Object.isFrozen((input as { permissions: unknown }).permissions)).toBe(true);
      return true;
    });
    const s = new BlocksRuntimeCapabilityService({
      key: f.key,
      runtimeOrigin: ORIGIN,
      authority: { allows },
    });
    expect((await s.issue(f.binding)).ok).toBe(true);
  });
  it.each([
    null,
    {},
    { permissions: ['admin'] },
    { mode: 'player', versionId: null },
    { tenantId: 'invalid' },
    { mode: 'editor', versionId: randomUUID() },
  ])('rejects malformed issuance input %# without authority lookup', async (override) => {
    const f = fixture();
    const input = override === null ? null : { ...f.binding, ...override };
    if (override && Object.keys(override).length === 0)
      delete (input as Record<string, unknown>).tenantId;
    expect(await f.service.issue(input as BlocksRuntimeBinding)).toEqual({
      ok: false,
      code: 'invalid_request',
    });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it.each([0, 16, 31, 33, 64])(
    'rejects signing key size %s with safe configuration error',
    (size) => {
      expect(
        () =>
          new BlocksRuntimeCapabilityService({
            key: randomBytes(size),
            runtimeOrigin: ORIGIN,
            authority: { allows: async () => true },
          }),
      ).toThrow('Invalid Blocks capability configuration');
    },
  );
  it.each([
    '',
    'null',
    '*',
    ORIGIN + '/',
    ORIGIN + '/path',
    'ftp://scratch.asa.example',
    'https://user:secret@scratch.asa.example',
    ORIGIN + '?key=secret',
    ORIGIN + '#secret',
  ])('rejects non-canonical configured origin %s', (runtimeOrigin) => {
    expect(
      () =>
        new BlocksRuntimeCapabilityService({
          key: randomBytes(32),
          runtimeOrigin,
          authority: { allows: async () => true },
        }),
    ).toThrow('Invalid Blocks capability configuration');
  });
  it('requires a current-authority port, with no permissive fallback', () => {
    expect(
      () =>
        new BlocksRuntimeCapabilityService({
          key: randomBytes(32),
          runtimeOrigin: ORIGIN,
          authority: undefined as never,
        }),
    ).toThrow('Invalid Blocks capability configuration');
  });
  it('keeps the original signing key after the caller changes its buffer', async () => {
    const f = fixture();
    const originalKey = Uint8Array.from(f.key);
    f.key.fill(0);
    const token = await f.issue();
    const { jwtVerify } = await import('jose');
    const result = await jwtVerify(token, originalKey, {
      algorithms: ['HS256'],
      issuer: 'asa-lab',
      audience: 'asa-blocks-runtime',
      currentDate: new Date(START * 1000),
    });
    expect(result.payload.sub).toBe(f.binding.principalId);
  });
  it('keeps the verification key after the caller changes its buffer', async () => {
    const f = fixture();
    const token = await f.issue();
    f.key.fill(0);
    expect((await f.verify(token)).ok).toBe(true);
  });
  it.each([
    'iss',
    'aud',
    'sub',
    'tenantId',
    'projectId',
    'moduleKey',
    'mode',
    'versionId',
    'permissions',
    'iat',
    'nbf',
    'exp',
    'jti',
  ])('requires the signed %s claim before consulting authority', async (claim) => {
    const f = fixture();
    const payload = decodeJwt<Record<string, unknown>>(await f.issue());
    delete payload[claim];
    const token = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'HS256', typ: 'asa-blocks-runtime+jwt' })
      .sign(f.key);
    f.allows.mockClear();
    expect(await f.verify(token)).toEqual({ ok: false, code: 'invalid_token' });
    expect(f.allows).not.toHaveBeenCalled();
  });
  it('snapshots every verification field before asynchronous work', async () => {
    const f = fixture();
    const token = await f.issue();
    f.allows.mockClear();
    const input = {
      token,
      origin: ORIGIN,
      binding: { ...f.binding },
      permission: 'project:read' as BlocksRuntimePermission,
    };
    const pending = f.service.verify(input);
    input.token = 'not-a-token';
    input.origin = 'https://other.example';
    input.binding.projectId = randomUUID();
    input.permission = 'draft:write';
    expect(await pending).toMatchObject({ ok: true, value: { ...f.binding } });
    expect(f.allows).toHaveBeenCalledExactlyOnceWith({
      ...f.binding,
      permissions: ['project:read'],
    });
  });
  it('keeps independent rejection responsive while an authority check is pending', async () => {
    const f = fixture();
    const token = await f.issue();
    let finishAuthority!: (value: boolean) => void;
    let markEntered!: () => void;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    f.allows.mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          finishAuthority = resolve;
          markEntered();
        }),
    );
    const pending = f.verify(token);
    await entered;
    try {
      const other = await f.service.verify({
        token,
        binding: f.binding,
        permission: 'project:read',
        origin: 'https://other.example',
      });
      expect(other).toEqual({ ok: false, code: 'forbidden_origin' });
    } finally {
      finishAuthority(false);
    }
    expect(await pending).toEqual({ ok: false, code: 'authority_denied' });
  });
});
