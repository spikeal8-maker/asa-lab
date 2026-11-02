import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import type { AiGeneratedImage } from '@asa-lab/contracts';
import { generatedImagePath, readGeneratedImage } from './read-generated-image';
import { useEffect, useState } from 'react';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';
import { readWebEvidence } from './ai-web-evidence';

export type PreviewImages = ReadonlyMap<string, string>;
const EMPTY: PreviewImages = new Map();
const IMAGE_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 6 * 1024 * 1024;
export interface GeneratedPreviewAssets {
  readonly threadId: string;
  readonly images: readonly AiGeneratedImage[];
}
interface PreviewImageCandidate {
  path: string;
  refs: string[];
  generated?: { image: AiGeneratedImage; threadId: string };
}

/** Generated HTML selects only from typed evidence; it never supplies a fetch URL. */
export function previewImageCandidates(
  code: string,
  evidence: readonly unknown[],
  generated?: GeneratedPreviewAssets,
): PreviewImageCandidate[] {
  if (code.length > 200_000) return [];
  const references = new Set<string>();
  let nodes = 0;
  function visit(node: DefaultTreeAdapterMap['node'], depth: number): void {
    if (++nodes > 10_000 || depth > 64) return;
    if ('tagName' in node && node.tagName === 'img') {
      const src = node.attrs.find((a) => a.name === 'src' && !a.namespace)?.value;
      if (src) references.add(src);
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, depth + 1);
  }
  visit(parse(code), 0);
  const seen = new Set<string>();
  const candidates: PreviewImageCandidate[] = evidence
    .slice(-20)
    .flatMap((item) => readWebEvidence(item)?.images ?? [])
    .flatMap((image) => {
      const refs = [image.originalUrl, image.thumbnailUrl].filter(
        (url): url is string => !!url && references.has(url),
      );
      if (!refs.length || seen.has(image.thumbnailUrl)) return [];
      seen.add(image.thumbnailUrl);
      return [{ path: image.thumbnailUrl, refs }];
    })
    .slice(0, 5);
  // Only exact receipts from this selected thread may introduce private assets.
  // Never fetch a URL invented by generated code, including other thread paths.
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (generated && uuid.test(generated.threadId)) {
    for (const image of generated.images.slice(-20)) {
      if (
        !uuid.test(image.requestId) ||
        image.mimeType !== 'image/png' ||
        !Number.isSafeInteger(image.sizeBytes) ||
        image.sizeBytes < 1 ||
        image.sizeBytes > 4 * 1024 * 1024
      )
        continue;
      const path = generatedImagePath(generated.threadId, image.requestId);
      if (image.downloadUrl !== path || !references.has(path) || seen.has(path)) continue;
      seen.add(path);
      candidates.push({ path, refs: [path], generated: { image, threadId: generated.threadId } });
    }
  }
  return candidates.slice(0, 5);
}

/** Explicit downloads retain original HTML behavior and embed only validated assets. */
export function embedPreviewImages(code: string, images: PreviewImages): string {
  if (code.length > 200_000) throw new Error('image_limit');
  const document = parse(code);
  let total = 0;
  function visit(node: DefaultTreeAdapterMap['node'], depth: number): void {
    if (depth > 64) throw new Error('image_limit');
    if ('tagName' in node && node.tagName === 'img') {
      const src = node.attrs.find((a) => a.name === 'src' && !a.namespace);
      const data = src && images.get(src.value);
      if (src?.value.startsWith('/api/ai/') && !data) throw new Error('image_unavailable');
      if (src && data && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(data)) {
        total += data.length;
        if (total > TOTAL_LIMIT) throw new Error('image_limit');
        src.value = data;
        node.attrs = node.attrs.filter((a) => a.name !== 'srcset');
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) visit(child, depth + 1);
  }
  visit(document, 0);
  return serialize(document);
}

export async function loadPreviewImages(
  candidates: ReturnType<typeof previewImageCandidates>,
  seatId: string | undefined,
  signal: AbortSignal,
  fetchImpl: (path: string, init?: RequestInit) => Promise<Response> = fetchWithSessionRefresh,
): Promise<PreviewImages> {
  const images = new Map<string, string>();
  let total = 0;
  // Sequential, bounded requests to the existing owner-bound raster proxy only.
  for (const candidate of candidates.slice(0, 5)) {
    signal.throwIfAborted();
    try {
      const response = candidate.generated
        ? new Response(
            await readGeneratedImage(
              candidate.generated.image,
              candidate.generated.threadId,
              seatId,
              signal,
            ),
            { headers: { 'content-type': 'image/png' } },
          )
        : await fetchImpl(candidate.path, {
            headers: aiScopeHeaders(seatId),
            signal,
            redirect: 'error',
          });
      const type = response.headers.get('content-type')?.split(';')[0]?.trim();
      if (
        !response.ok ||
        !type ||
        !['image/png', 'image/jpeg', 'image/webp'].includes(type) ||
        !response.body
      ) {
        await response.body?.cancel();
        continue;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          signal.throwIfAborted();
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (
            size > (candidate.generated ? 4 * 1024 * 1024 : IMAGE_LIMIT) ||
            total + size > TOTAL_LIMIT
          )
            throw new Error('image_limit');
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel().catch(() => undefined);
        reader.releaseLock();
      }
      if (!size) continue;
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.length;
      }
      // The proxy validates full containers; also reject MIME/byte disagreement here.
      const signature =
        type === 'image/png'
          ? [137, 80, 78, 71, 13, 10, 26, 10].every((b, i) => bytes[i] === b)
          : type === 'image/jpeg'
            ? bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255
            : String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
              String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
      if (!signature) continue;
      let binary = '';
      for (let start = 0; start < bytes.length; start += 8192)
        binary += String.fromCharCode(...bytes.subarray(start, start + 8192));
      signal.throwIfAborted();
      total += size;
      const data = `data:${type};base64,${btoa(binary)}`;
      for (const reference of candidate.refs) images.set(reference, data);
    } catch {
      signal.throwIfAborted();
      // One missing image does not remove the rest of the artifact.
    }
  }
  return images;
}

export function usePreviewImages(
  code: string,
  evidence: readonly unknown[],
  seatId?: string,
  generated?: GeneratedPreviewAssets,
): PreviewImages {
  const key = JSON.stringify([seatId, previewImageCandidates(code, evidence, generated)]);
  const [state, setState] = useState<{ key: string; images: PreviewImages }>();
  useEffect(() => {
    const controller = new AbortController();
    const candidates = JSON.parse(key)[1] as ReturnType<typeof previewImageCandidates>;
    if (candidates.length)
      void loadPreviewImages(candidates, seatId, controller.signal)
        .then((images) => {
          if (!controller.signal.aborted) setState({ key, images });
        })
        .catch(() => undefined);
    return () => controller.abort();
  }, [key, seatId]);
  // Clear stale bytes during render, before the replacement effect runs.
  return state?.key === key ? state.images : EMPTY;
}
