import { sha256Bytes } from '../components/sha256';

/**
 * Returns the same UUID for the same logical draft write.
 *
 * A request can reach PostgreSQL while its response is lost. Retrying with a
 * random UUID would then look like a different mutation and produce either a
 * false revision conflict or a second revision. Deriving the UUID from the
 * project, base revision and exact JSON payload makes retries stable across
 * queues, reloads and browser tabs without storing another copy of the draft.
 */
export async function projectDraftMutationId(
  projectId: string,
  baseRevision: number,
  document: unknown,
): Promise<string> {
  const payload = JSON.stringify([projectId, baseRevision, document]);
  const encoded = new TextEncoder().encode(payload);
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest('SHA-256', encoded))
    : sha256Bytes(encoded);
  const bytes = digest.slice(0, 16);
  // RFC 4122 UUID v4 shape. The remaining bits still come from SHA-256, so two
  // different logical writes have a cryptographically negligible collision
  // probability while the server can keep its strict UUID-v4 validation.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(
    16,
    20,
  )}-${hex.slice(20)}`;
}
