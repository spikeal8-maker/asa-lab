/**
 * Validation for the raster picture an editor uploads for a project card.
 *
 * These bytes come from a browser and are later served back to classmates and
 * teachers, so nothing here trusts a declared content type or a file name. The
 * format is decided by reading the container, and the dimensions are read from
 * the image header rather than from the request, because the header is what a
 * browser will believe when it decodes the file.
 *
 * Only PNG and WebP are accepted — the two formats a canvas produces. SVG is
 * not an image here but a document that can carry script and remote
 * references; the profile avatar column already refuses it for the same reason.
 */

export type SnapshotFormat = 'image/png' | 'image/webp';

export interface SnapshotImage {
  readonly bytes: Uint8Array;
  readonly contentType: SnapshotFormat;
  readonly width: number;
  readonly height: number;
}

export type SnapshotValidation =
  | { readonly ok: true; readonly image: SnapshotImage }
  | { readonly ok: false; readonly message: string };

/** A card is a thumbnail. Anything larger is a mistake, not a better picture. */
export const SNAPSHOT_MAX_BYTES = 262_144;
export const SNAPSHOT_MIN_BYTES = 64;
export const SNAPSHOT_MIN_EDGE = 16;
export const SNAPSHOT_MAX_EDGE = 2048;

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function invalid(message: string): { readonly ok: false; readonly message: string } {
  return { ok: false, message };
}

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(bytes[offset + index] ?? 0);
  }
  return text;
}

/** PNG carries its size in the IHDR chunk, which the format requires first. */
function readPngDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 33) return null;
  if (ascii(bytes, 12, 4) !== 'IHDR') return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
}

/**
 * WebP is a RIFF container with three possible image chunks, and each one
 * stores its size differently. Reading all three is the price of accepting the
 * format a canvas actually produces on any given browser.
 */
function readWebpDimensions(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 30) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The declared RIFF payload must match the bytes received, which rules out a
  // file with anything appended after the image.
  if (view.getUint32(4, true) !== bytes.length - 8) return null;

  const chunk = ascii(bytes, 12, 4);
  if (chunk === 'VP8 ') {
    // Lossy: a three-byte frame tag, then the sync code, then 14-bit sizes.
    if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return null;
    return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (bytes[20] !== 0x2f) return null;
    const bits = view.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
  }
  if (chunk === 'VP8X') {
    // Extended: the canvas size is stored as two 24-bit little-endian values.
    const width = (bytes[24] ?? 0) | ((bytes[25] ?? 0) << 8) | ((bytes[26] ?? 0) << 16);
    const height = (bytes[27] ?? 0) | ((bytes[28] ?? 0) << 8) | ((bytes[29] ?? 0) << 16);
    return { width: width + 1, height: height + 1 };
  }
  return null;
}

export function validateSnapshotImage(bytes: Uint8Array): SnapshotValidation {
  if (bytes.length < SNAPSHOT_MIN_BYTES) return invalid('snapshot is too small to be an image');
  if (bytes.length > SNAPSHOT_MAX_BYTES) {
    return invalid(`snapshot must not exceed ${SNAPSHOT_MAX_BYTES} bytes`);
  }

  let contentType: SnapshotFormat;
  let dimensions: { width: number; height: number } | null;
  if (startsWith(bytes, PNG_SIGNATURE)) {
    contentType = 'image/png';
    dimensions = readPngDimensions(bytes);
  } else if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') {
    contentType = 'image/webp';
    dimensions = readWebpDimensions(bytes);
  } else {
    return invalid('snapshot must be a PNG or WebP image');
  }

  if (!dimensions) return invalid('snapshot header is malformed');
  const { width, height } = dimensions;
  if (!Number.isInteger(width) || !Number.isInteger(height)) {
    return invalid('snapshot header is malformed');
  }
  if (
    width < SNAPSHOT_MIN_EDGE ||
    height < SNAPSHOT_MIN_EDGE ||
    width > SNAPSHOT_MAX_EDGE ||
    height > SNAPSHOT_MAX_EDGE
  ) {
    return invalid(
      `snapshot must be between ${SNAPSHOT_MIN_EDGE} and ${SNAPSHOT_MAX_EDGE} pixels on each side`,
    );
  }

  return { ok: true, image: { bytes, contentType, width, height } };
}

/**
 * Editors upload the picture as a data URL, the same shape profile avatars use.
 *
 * The media type written into the prefix is not evidence of anything — the
 * uploader wrote it. It is matched only to reject obvious nonsense early; what
 * the bytes actually are is decided afterwards by reading the container. The
 * base64 alphabet is checked explicitly because a decoder will otherwise skip
 * characters it does not recognise and hand back a shorter image than the one
 * that was validated.
 */
const SNAPSHOT_DATA_URL = /^data:image\/(?:png|webp);base64,(?:[A-Za-z0-9+/]+={0,2})$/;
const MAX_DATA_URL_LENGTH = Math.ceil((SNAPSHOT_MAX_BYTES * 4) / 3) + 64;

export type SnapshotDecoding =
  | { readonly ok: true; readonly bytes: Uint8Array }
  | { readonly ok: false; readonly message: string };

export function decodeSnapshotDataUrl(value: unknown): SnapshotDecoding {
  if (typeof value !== 'string' || value.length === 0) {
    return invalid('snapshot must be a base64 image data URL');
  }
  if (value.length > MAX_DATA_URL_LENGTH) {
    return invalid(`snapshot must not exceed ${SNAPSHOT_MAX_BYTES} bytes`);
  }
  if (!SNAPSHOT_DATA_URL.test(value)) {
    return invalid('snapshot must be a base64 data URL of a PNG or WebP image');
  }
  const base64 = value.slice(value.indexOf(',') + 1);
  return { ok: true, bytes: new Uint8Array(Buffer.from(base64, 'base64')) };
}

export interface ProjectSnapshot {
  readonly projectId: string;
  readonly contentType: SnapshotFormat;
  readonly width: number;
  readonly height: number;
  /** The draft revision the picture was taken from. */
  readonly sourceRevision: number;
  readonly capturedAt: string;
}

export interface ProjectSnapshotBytes extends ProjectSnapshot {
  readonly bytes: Uint8Array;
}
