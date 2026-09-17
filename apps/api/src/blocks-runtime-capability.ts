import { randomUUID } from 'node:crypto';
import type { JWTPayload } from 'jose';

const ISSUER = 'asa-lab';
const AUDIENCE = 'asa-blocks-runtime';
const TYPE = 'asa-blocks-runtime+jwt';
const TTL = 600;
const MAX_TOKEN_LENGTH = 4096;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const EDITOR = [
  'project:read',
  'asset:read',
  'asset:write',
  'draft:write',
  'snapshot:write',
] as const;
const PLAYER = ['project:read', 'asset:read'] as const;
export type BlocksRuntimePermission = (typeof EDITOR)[number];
export interface BlocksRuntimeBinding {
  readonly tenantId: string;
  readonly principalId: string;
  readonly projectId: string;
  readonly mode: 'editor' | 'player';
  readonly versionId: string | null;
}
export interface BlocksRuntimeAuthorityPort {
  /** Production wiring must re-read current Account/StudentSeat and Project Core authority. */
  allows(
    input: Readonly<
      BlocksRuntimeBinding & {
        permissions: readonly BlocksRuntimePermission[];
      }
    >,
  ): Promise<boolean>;
}
export type BlocksCapabilityError =
  | 'invalid_request'
  | 'forbidden_origin'
  | 'invalid_token'
  | 'expired_token'
  | 'binding_mismatch'
  | 'permission_denied'
  | 'authority_denied'
  | 'dependency_unavailable';
export type BlocksCapabilityResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly code: BlocksCapabilityError };
export interface BlocksRuntimeGrant extends BlocksRuntimeBinding {
  readonly permissions: readonly BlocksRuntimePermission[];
  readonly issuedAt: number;
  readonly expiresAt: number;
  readonly tokenId: string;
}
interface VerifyInput {
  readonly token: string;
  readonly origin: string;
  readonly binding: BlocksRuntimeBinding;
  readonly permission: BlocksRuntimePermission;
}
const BINDING_KEYS = ['tenantId', 'principalId', 'projectId', 'mode', 'versionId'];
const CLAIM_KEYS = [
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
];
function record(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
  );
}
function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((k) => Object.hasOwn(value, k));
}
function uuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
function bindingOf(value: unknown): Readonly<BlocksRuntimeBinding> | null {
  if (!record(value) || !exactKeys(value, BINDING_KEYS)) return null;
  const { tenantId, principalId, projectId, mode, versionId } = value;
  if (!uuid(tenantId) || !uuid(principalId) || !uuid(projectId)) return null;
  if (mode !== 'editor' && mode !== 'player') return null;
  if (mode === 'editor' ? versionId !== null : !uuid(versionId)) return null;
  return Object.freeze({
    tenantId,
    principalId,
    projectId,
    mode,
    versionId: versionId as string | null,
  });
}
function profile(mode: BlocksRuntimeBinding['mode']): readonly BlocksRuntimePermission[] {
  return mode === 'editor' ? EDITOR : PLAYER;
}
function denied(code: BlocksCapabilityError): {
  readonly ok: false;
  readonly code: BlocksCapabilityError;
} {
  return { ok: false, code };
}
function validTime(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8640000000000
  );
}
function grantOf(payload: JWTPayload): Readonly<BlocksRuntimeGrant> | null {
  if (
    !exactKeys(payload, CLAIM_KEYS) ||
    payload.iss !== ISSUER ||
    payload.aud !== AUDIENCE ||
    payload['moduleKey'] !== 'blocks'
  )
    return null;
  const binding = bindingOf({
    tenantId: payload['tenantId'],
    principalId: payload.sub,
    projectId: payload['projectId'],
    mode: payload['mode'],
    versionId: payload['versionId'],
  });
  if (
    !binding ||
    !uuid(payload.jti) ||
    !validTime(payload.iat) ||
    !validTime(payload.exp) ||
    payload.nbf !== payload.iat ||
    payload.exp - payload.iat !== TTL
  )
    return null;
  const permissions = payload['permissions'];
  const expected = profile(binding.mode);
  if (
    !Array.isArray(permissions) ||
    permissions.length !== expected.length ||
    !expected.every((p, i) => permissions[i] === p)
  )
    return null;
  return Object.freeze({
    ...binding,
    permissions: Object.freeze([...expected]),
    issuedAt: payload.iat,
    expiresAt: payload.exp,
    tokenId: payload.jti,
  });
}

/** Non-exposed M1-003A core. No controller, DI registration, cookie or environment access. */
export class BlocksRuntimeCapabilityService {
  readonly #key: Uint8Array;
  readonly #runtimeOrigin: string;
  readonly #clock: () => number;
  readonly #allows: BlocksRuntimeAuthorityPort['allows'];
  constructor(options: {
    key: Uint8Array;
    runtimeOrigin: string;
    authority: BlocksRuntimeAuthorityPort;
    now?: () => number;
  }) {
    try {
      if (
        !(options.key instanceof Uint8Array) ||
        options.key.byteLength !== 32 ||
        typeof options.authority?.allows !== 'function' ||
        (options.now !== undefined && typeof options.now !== 'function')
      )
        throw new Error();
      const origin = new URL(options.runtimeOrigin);
      if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== options.runtimeOrigin)
        throw new Error();
      this.#key = Uint8Array.from(options.key);
      this.#runtimeOrigin = origin.origin;
      this.#clock = options.now ?? (() => Math.floor(Date.now() / 1000));
      this.#allows = options.authority.allows.bind(options.authority);
    } catch {
      throw new Error('Invalid Blocks capability configuration');
    }
  }
  #now(): number {
    const now = this.#clock();
    if (!validTime(now) || now > 8640000000000 - TTL) throw new Error('Invalid server clock');
    return now;
  }
  async #authorize(
    binding: BlocksRuntimeBinding,
    permissions: readonly BlocksRuntimePermission[],
  ): Promise<boolean> {
    return (
      (await this.#allows(
        Object.freeze({ ...binding, permissions: Object.freeze([...permissions]) }),
      )) === true
    );
  }
  async issue(input: BlocksRuntimeBinding): Promise<
    BlocksCapabilityResult<{
      readonly token: string;
      readonly expiresAt: number;
    }>
  > {
    try {
      const binding = bindingOf(input);
      if (!binding) return denied('invalid_request');
      const issuedAt = this.#now();
      const expiresAt = issuedAt + TTL;
      if (!(await this.#authorize(binding, profile(binding.mode))))
        return denied('authority_denied');
      const afterAuthority = this.#now();
      if (afterAuthority < issuedAt) return denied('dependency_unavailable');
      if (afterAuthority >= expiresAt) return denied('expired_token');
      const { SignJWT } = await import('jose');
      const token = await new SignJWT({
        tenantId: binding.tenantId,
        projectId: binding.projectId,
        moduleKey: 'blocks',
        mode: binding.mode,
        versionId: binding.versionId,
        permissions: [...profile(binding.mode)],
      })
        .setProtectedHeader({ alg: 'HS256', typ: TYPE })
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setSubject(binding.principalId)
        .setJti(randomUUID())
        .setIssuedAt(issuedAt)
        .setNotBefore(issuedAt)
        .setExpirationTime(expiresAt)
        .sign(this.#key);
      const finished = this.#now();
      if (finished < afterAuthority) return denied('dependency_unavailable');
      if (finished >= expiresAt) return denied('expired_token');
      if (token.length > MAX_TOKEN_LENGTH) return denied('dependency_unavailable');
      return { ok: true, value: Object.freeze({ token, expiresAt }) };
    } catch {
      return denied('dependency_unavailable');
    }
  }
  async verify(input: VerifyInput): Promise<BlocksCapabilityResult<Readonly<BlocksRuntimeGrant>>> {
    try {
      if (!record(input) || !exactKeys(input, ['token', 'origin', 'binding', 'permission']))
        return denied('invalid_request');
      // Snapshot everything before the first await. Caller mutations cannot change the decision.
      const { token, origin, permission } = input;
      const binding = bindingOf(input.binding);
      if (!binding || !EDITOR.some((p) => p === permission)) return denied('invalid_request');
      if (origin !== this.#runtimeOrigin) return denied('forbidden_origin');
      if (
        typeof token !== 'string' ||
        token.length > MAX_TOKEN_LENGTH ||
        !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)
      )
        return denied('invalid_token');
      const startedAt = this.#now();
      const { jwtVerify } = await import('jose');
      let payload: JWTPayload;
      try {
        const result = await jwtVerify(token, this.#key, {
          algorithms: ['HS256'],
          issuer: ISSUER,
          audience: AUDIENCE,
          typ: TYPE,
          requiredClaims: [...CLAIM_KEYS],
          clockTolerance: 0,
          currentDate: new Date(startedAt * 1000),
        });
        if (
          !exactKeys(result.protectedHeader, ['alg', 'typ']) ||
          result.protectedHeader.alg !== 'HS256' ||
          result.protectedHeader.typ !== TYPE
        )
          return denied('invalid_token');
        payload = result.payload;
      } catch (problem) {
        return denied(
          problem instanceof Error && 'code' in problem && problem.code === 'ERR_JWT_EXPIRED'
            ? 'expired_token'
            : 'invalid_token',
        );
      }
      const grant = grantOf(payload);
      if (!grant || grant.issuedAt > startedAt) return denied('invalid_token');
      if (
        BINDING_KEYS.some(
          (k) =>
            grant[k as keyof BlocksRuntimeBinding] !== binding[k as keyof BlocksRuntimeBinding],
        )
      )
        return denied('binding_mismatch');
      if (!grant.permissions.includes(permission)) return denied('permission_denied');
      if (!(await this.#authorize(binding, [permission]))) return denied('authority_denied');
      const finished = this.#now();
      if (finished < startedAt) return denied('dependency_unavailable');
      if (finished >= grant.expiresAt) return denied('expired_token');
      return { ok: true, value: grant };
    } catch {
      return denied('dependency_unavailable');
    }
  }
}
