// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationLike } from './PublicationLike';
import { publicProjectsApi, type PublicProject, type PublicationLikeState } from './api';
import { setTelemetryContext } from '../telemetry-context';
const publication: PublicProject = {
  publicationId: 'publication',
  revisionId: 'revision',
  revisionNo: 1,
  versionNo: 1,
  title: 'Work',
  summary: null,
  description: null,
  tags: [],
  license: 'reserved',
  moduleKey: 'electronics',
  authorLabel: 'Author',
  featured: false,
  pinned: false,
  publishedAt: '2026-10-30T00:00:00Z',
  preview: null,
  capabilities: { viewer: 'static', canCopy: false, downloadFormats: [] },
  likeCount: 4,
};
const state: PublicationLikeState = {
  publicationId: 'publication',
  revisionId: 'revision',
  liked: false,
  canLike: true,
  canUnlike: false,
  reactionsEnabled: true,
  likeCount: 4,
  reason: null,
};
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  setTelemetryContext(null, true, 'public');
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const button = () => host.querySelector('button')!;
it('blocks double click, waits for authoritative count and sends explicit boolean intent', async () => {
  vi.spyOn(publicProjectsApi, 'likeState')
    .mockResolvedValueOnce({ ok: true, status: 200, data: state })
    .mockResolvedValue({
      ok: true,
      status: 200,
      data: { ...state, liked: true, canUnlike: true, likeCount: 5 },
    });
  let finish!: (value: { ok: true; status: number; data: { liked: boolean } }) => void;
  const write = vi.spyOn(publicProjectsApi, 'like').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(PublicationLike, { publication })));
  await act(async () => {
    button().click();
    button().click();
  });
  expect(write).toHaveBeenCalledTimes(1);
  expect(button().disabled).toBe(true);
  expect(host.textContent).toContain('4');
  await act(async () => finish({ ok: true, status: 200, data: { liked: true } }));
  expect(button().getAttribute('aria-pressed')).toBe('true');
  expect(host.textContent).toContain('5');
  expect(write).toHaveBeenCalledWith('publication', 'revision', true, expect.any(AbortSignal));
});
it('allows removing an existing like when admin disabled reactions; own work is disabled', async () => {
  vi.spyOn(publicProjectsApi, 'likeState').mockResolvedValue({
    ok: true,
    status: 200,
    data: { ...state, liked: true, canLike: false, canUnlike: true, reactionsEnabled: false },
  });
  const write = vi
    .spyOn(publicProjectsApi, 'like')
    .mockResolvedValue({ ok: true, status: 200, data: { liked: false } });
  await act(async () => root.render(createElement(PublicationLike, { publication })));
  expect(button().disabled).toBe(false);
  await act(async () => button().click());
  expect(write).toHaveBeenCalledWith('publication', 'revision', false, expect.any(AbortSignal));
});
it('retires late private responses after session identity changes', async () => {
  let finish!: (value: { ok: true; status: number; data: PublicationLikeState }) => void;
  vi.spyOn(publicProjectsApi, 'likeState').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await act(async () => root.render(createElement(PublicationLike, { publication })));
  await act(async () => setTelemetryContext(null, false, 'public'));
  await act(async () =>
    finish({ ok: true, status: 200, data: { ...state, liked: true, likeCount: 999 } }),
  );
  expect(button().disabled).toBe(true);
  expect(button().getAttribute('aria-pressed')).toBe('false');
  expect(host.textContent).not.toContain('999');
});
