import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The token a visitor carries from "this is my class code" to "I signed in".
 *
 * The browser must not be trusted with a classroom identifier: if it were, a
 * page could ask to join any class by editing storage. So the server answers
 * with an opaque, signed, short-lived token instead — it names the class only
 * to the server, expires on its own, and is bound to the code version it was
 * issued from, so a rotated or revoked code invalidates every intent taken
 * from it.
 *
 * The token grants nothing: no membership, no session, no roster.
 */
const PURPOSE = 'asa-lab.join-intent.v1';

export const JOIN_INTENT_TTL_SECONDS = 15 * 60;

export interface JoinIntentClaims {
  readonly classroomId: string;
  readonly codeVersion: number;
  readonly expiresAt: number;
}

function base64url(value: string): string {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function sign(payload: string, secret: string): string {
  return createHmac('sha256', secret).update(`${PURPOSE}.${payload}`).digest('base64url');
}

export function issueJoinIntentToken(
  claims: Omit<JoinIntentClaims, 'expiresAt'>,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): string {
  const payload = base64url(
    JSON.stringify({
      c: claims.classroomId,
      v: claims.codeVersion,
      e: nowSeconds + JOIN_INTENT_TTL_SECONDS,
    }),
  );
  return `${payload}.${sign(payload, secret)}`;
}

export type JoinIntentVerification =
  | { readonly ok: true; readonly claims: JoinIntentClaims }
  | { readonly ok: false; readonly reason: 'malformed' | 'signature' | 'expired' };

export function verifyJoinIntentToken(
  token: unknown,
  secret: string,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): JoinIntentVerification {
  if (typeof token !== 'string' || token.length > 512) {
    return { ok: false, reason: 'malformed' };
  }
  const [payload, signature] = token.split('.');
  if (!payload || !signature) {
    return { ok: false, reason: 'malformed' };
  }
  const expected = Buffer.from(sign(payload, secret));
  const provided = Buffer.from(signature);
  // Constant-time comparison: a forged token must not leak how close it was.
  if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) {
    return { ok: false, reason: 'signature' };
  }
  let parsed: { c?: unknown; v?: unknown; e?: unknown };
  try {
    parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (
    typeof parsed.c !== 'string' ||
    typeof parsed.v !== 'number' ||
    typeof parsed.e !== 'number'
  ) {
    return { ok: false, reason: 'malformed' };
  }
  if (parsed.e <= nowSeconds) {
    return { ok: false, reason: 'expired' };
  }
  return {
    ok: true,
    claims: { classroomId: parsed.c, codeVersion: parsed.v, expiresAt: parsed.e },
  };
}
