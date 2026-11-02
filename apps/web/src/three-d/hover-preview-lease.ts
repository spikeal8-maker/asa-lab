let current: { token: symbol; stop: () => void } | null = null;
/** One live hover preview per document; release synchronously before replacing it. */
export function acquireHoverPreview(stop: () => void): () => void {
  current?.stop();
  const token = Symbol('three-d-hover');
  current = { token, stop };
  return () => {
    if (current?.token === token) current = null;
  };
}
