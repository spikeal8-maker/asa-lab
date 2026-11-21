import { createHash } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import sharp from 'sharp';

const widths = [640, 1280] as const;
type PreviewWidth = (typeof widths)[number];
const previewCache = new Map<string, Buffer>();
const processing = new Map<string, Promise<Buffer | null>>();
const cacheBudget = 16 * 1024 * 1024;
let cachedBytes = 0;

export async function renderTaskImagePreview(bytes: Buffer, width: PreviewWidth): Promise<Buffer> {
  return sharp(bytes, { limitInputPixels: 64_000_000, failOn: 'warning' })
    .autoOrient()
    .resize({ width, height: width, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86, alphaQuality: 100, smartSubsample: true, effort: 2 })
    .timeout({ seconds: 5 })
    .toBuffer();
}

async function preview(bytes: Buffer, width: PreviewWidth): Promise<Buffer | null> {
  const hash = createHash('sha256').update(bytes).digest('hex');
  const key = hash + ':' + width;
  const saved = previewCache.get(key);
  if (saved) {
    previewCache.delete(key);
    previewCache.set(key, saved);
    return saved;
  }
  const pending = processing.get(key);
  if (pending) return pending;
  if (processing.size >= 2) return null;
  const work = renderTaskImagePreview(bytes, width)
    .then((image) => {
      previewCache.set(key, image);
      cachedBytes += image.length;
      while (cachedBytes > cacheBudget) {
        const oldest = previewCache.entries().next().value;
        if (!oldest) break;
        previewCache.delete(oldest[0]);
        cachedBytes -= oldest[1].length;
      }
      return image;
    })
    .catch(() => null)
    .finally(() => processing.delete(key));
  processing.set(key, work);
  return work;
}

/** Call only after the existing viewer and pinned-version checks have returned the original. */
export async function sendTaskImage(
  request: FastifyRequest,
  reply: FastifyReply,
  bytes: Buffer,
  contentType: string,
  originalHash?: string,
): Promise<void> {
  const requested = (request.query as { preview?: unknown } | undefined)?.preview;
  const width = widths.find((size) => String(size) === requested);
  const reduced = width ? await preview(bytes, width) : null;
  const image = reduced ?? bytes;
  const hash = reduced ? createHash('sha256').update(reduced).digest('hex') : originalHash;
  reply
    .header('content-type', reduced ? 'image/webp' : contentType)
    .header('cache-control', 'private, no-store')
    .header('x-content-type-options', 'nosniff');
  if (hash) reply.header('etag', '"' + hash + '"');
  reply.send(image);
}
