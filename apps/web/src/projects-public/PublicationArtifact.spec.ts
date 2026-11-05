// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PublicationArtifact } from './PublicationArtifact';
import { publicProjectsApi, type PublicProject } from './api';
import type { PublicProjectDisplayArtifact, PublicThreeDArtifact } from '@asa-lab/contracts';
import { createRoboticsWorldDocument } from '@asa-lab/robotics/world-document';
vi.mock('./PublicThreeDViewer', () => ({
  PublicThreeDViewer: () => createElement('div', { 'data-testid': 'live-three-d' }),
}));
vi.mock('./PublicRoboticsViewer', () => ({
  PublicRoboticsViewer: () => createElement('div', { 'data-testid': 'published-robotics' }),
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
async function render(value: PublicProjectDisplayArtifact, moduleKey = 'three-d') {
  vi.spyOn(publicProjectsApi, 'artifact').mockResolvedValue({
    ok: true,
    status: 200,
    data: { artifact: value },
  });
  await act(async () => {
    root.render(
      createElement(PublicationArtifact, {
        publication: { ...publication, moduleKey },
        onUnavailable,
      }),
    );
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

function roboticsArtifact(): PublicProjectDisplayArtifact {
  const { field, robot, initialPose } = createRoboticsWorldDocument();
  return {
    schemaVersion: 5,
    status: 'display',
    viewerFamily: 'robotics',
    provenance: artifact.provenance,
    capabilities: artifact.capabilities,
    world: { field, robot, initialPose },
  };
}
it('admits the Robotics viewer only for the requested frozen revision and family', async () => {
  await render(roboticsArtifact(), 'robotics');
  expect(publicProjectsApi.artifact).toHaveBeenCalledWith(
    publication.publicationId,
    publication.revisionId,
    expect.any(AbortSignal),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  expect(host.querySelector('[data-testid="published-robotics"]')).not.toBeNull();
  expect(onUnavailable).not.toHaveBeenCalled();
});
it.each([
  { publicationId: '123e4567-e89b-42d3-a456-426614174099', revisionNumber: 1 },
  { publicationId: publication.publicationId, revisionNumber: 2 },
])('rejects mismatched Robotics provenance before mounting the viewer', async (provenance) => {
  await render({ ...roboticsArtifact(), provenance }, 'robotics');
  expect(onUnavailable).toHaveBeenCalledOnce();
  expect(host.querySelector('[data-testid="published-robotics"]')).toBeNull();
});
it('keeps a cover fallback when a different module family arrives for Robotics', async () => {
  await render(artifact, 'robotics');
  expect(host.querySelector('[data-testid="public-artifact-fallback"]')).not.toBeNull();
  expect(
    host.querySelector('[data-testid="published-robotics"], [data-testid="live-three-d"]'),
  ).toBeNull();
});
