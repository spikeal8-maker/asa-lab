import { parse, type DefaultTreeAdapterMap } from 'parse5';
import { useEffect, useState } from 'react';
import { fetchWithSessionRefresh } from '../session-fetch';
import { aiScopeHeaders } from './ai-scope-api';
import { readWebEvidence } from './ai-web-evidence';

export type PreviewImages = ReadonlyMap<string, string>;
const EMPTY: PreviewImages = new Map();
const IMAGE_LIMIT = 2 * 1024 * 1024;
const TOTAL_LIMIT = 6 * 1024 * 1024;

/** Generated HTML selects only from typed evidence; it never supplies a fetch URL. */
export function previewImageCandidates(code: string, evidence: readonly unknown[]) {
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
  return evidence
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
      const response = await fetchImpl(candidate.path, {
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
          if (size > IMAGE_LIMIT || total + size > TOTAL_LIMIT) throw new Error('image_limit');
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
): PreviewImages {
  const key = JSON.stringify([seatId, previewImageCandidates(code, evidence)]);
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
