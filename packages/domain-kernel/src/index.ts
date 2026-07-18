/** Foundation surface for the domain-kernel package: framework-independent
 * primitives shared by Classroom Core bounded contexts. */
export const PACKAGE_NAME = '@asa-lab/domain-kernel';

export type Result<T, E = string> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
