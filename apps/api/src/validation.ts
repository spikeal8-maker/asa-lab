/** Strict runtime body validation for the composition root: bodies must be
 * plain JSON objects with exactly the allowed properties. */

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type BodyCheck =
  | { readonly ok: true; readonly body: Record<string, unknown> }
  | { readonly ok: false; readonly message: string };

export function checkBodyShape(value: unknown, allowedKeys: readonly string[]): BodyCheck {
  if (!isPlainObject(value)) {
    return { ok: false, message: 'request body must be a JSON object' };
  }
  const extra = Object.keys(value).filter((key) => !allowedKeys.includes(key));
  if (extra.length > 0) {
    return { ok: false, message: `unknown properties: ${extra.join(', ')}` };
  }
  return { ok: true, body: value };
}

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/** Mandatory Idempotency-Key: 1..128 chars from a safe set; never truncated. */
export function checkIdempotencyKey(
  value: unknown,
): { readonly ok: true; readonly key: string } | { readonly ok: false; readonly message: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { ok: false, message: 'Idempotency-Key header is required' };
  }
  const key = value.trim();
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    return {
      ok: false,
      message: 'Idempotency-Key must be 1..128 characters of A-Za-z0-9._:-',
    };
  }
  return { ok: true, key };
}
