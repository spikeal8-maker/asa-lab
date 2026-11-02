// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationArtifact } from './PublicationArtifact';
import { publicProjectsApi, type PublicProject } from './api';
import type { PublicThreeDArtifact } from '@asa-lab/contracts';
vi.mock('./PublicThreeDViewer', () => ({
  PublicThreeDViewer: () => createElement('div', { 'data-testid': 'live-three-d' }),
}));
let host: HTMLDivElement, root: Root;
const onUnavailable = vi.fn();
const publication: PublicProject = {
  publicationId: '123e4567-e89b-42d3-a456-426614174001',
  revisionId: '123e4567-e89b-42d3-a456-426614174002',
  revisionNo: 1,
  versionNo: 1,
  title: 'Модель',
  summary: null,
  description: null,
  tags: [],
  license: 'reserved',
  moduleKey: 'three-d',
  authorLabel: 'Автор',
  publishedAt: '2026-11-02T00:00:00Z',
  preview: null,
  featured: false,
  pinned: false,
  capabilities: { viewer: 'static', canCopy: false, downloadFormats: [] },
};
const artifact: PublicThreeDArtifact = {
  schemaVersion: 4,
  status: 'display',
  viewerFamily: 'three-d',
  units: 'mm',
  nodes: [],
  provenance: { publicationId: publication.publicationId, revisionNumber: 1 },
  capabilities: { readOnly: true, interactive: true, download: false },
};
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onUnavailable.mockClear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render(value: PublicThreeDArtifact) {
  vi.spyOn(publicProjectsApi, 'artifact').mockResolvedValue({
    ok: true,
    status: 200,
    data: { artifact: value },
  });
  await act(async () => {
    root.render(createElement(PublicationArtifact, { publication, onUnavailable }));
  });
}
it('admits the 3D viewer only for the exact publication revision', async () => {
  await render(artifact);
  expect(onUnavailable).not.toHaveBeenCalled();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.querySelector('[data-testid="live-three-d"]')).not.toBeNull();
});
it.each([
  { publicationId: '123e4567-e89b-42d3-a456-426614174099', revisionNumber: 1 },
  { publicationId: publication.publicationId, revisionNumber: 2 },
])('rejects mismatched 3D provenance before mounting geometry', async (provenance) => {
  await render({ ...artifact, provenance });
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="live-three-d"]')).toBeNull();
});
