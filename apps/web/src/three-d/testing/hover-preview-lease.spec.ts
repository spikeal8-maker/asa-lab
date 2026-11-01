import { expect, it, vi } from 'vitest';
import { acquireHoverPreview } from '../hover-preview-lease';
it('disposes the previous preview synchronously, without a stale release stopping its replacement', () => {
  const stop1 = vi.fn(),
    stop2 = vi.fn(),
    stop3 = vi.fn();
  const release1 = acquireHoverPreview(stop1),
    release2 = acquireHoverPreview(stop2);
  expect(stop1).toHaveBeenCalledOnce();
  release1();
  const release3 = acquireHoverPreview(stop3);
  expect(stop2).toHaveBeenCalledOnce();
  release2();
  release3();
  const last = acquireHoverPreview(vi.fn());
  expect(stop3).not.toHaveBeenCalled();
  last();
});
