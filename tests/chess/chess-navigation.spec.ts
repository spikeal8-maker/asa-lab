import { describe, expect, it } from 'vitest';
import {
  chessRouteFromHash,
  chessRouteToHash,
  type ChessPage,
  type ChessPanelTab,
} from '../../apps/web/src/chess/chess-navigation';
import { creatorViewFromHash } from '../../apps/web/src/creator-portal/navigation';

describe('independent subject routes', () => {
  it('gives every visible Chess page its own reloadable address', () => {
    const projectId = 'chess-project-1';
    const pages: readonly ChessPage[] = [
      'home',
      'play',
      'online',
      'puzzles',
      'learning',
      'bots',
      'review',
    ];
    const addresses = pages.map((page) => chessRouteToHash(projectId, { page, panelTab: 'game' }));

    expect(new Set(addresses).size).toBe(pages.length);
    for (const [index, address] of addresses.entries()) {
      expect(chessRouteFromHash(address, projectId).page).toBe(pages[index]);
    }
  });

  it('keeps game, analysis and versions as independent board pages', () => {
    const projectId = 'chess-project-2';
    const tabs: readonly ChessPanelTab[] = ['game', 'analysis', 'versions'];

    for (const panelTab of tabs) {
      const address = chessRouteToHash(projectId, { page: 'play', panelTab });
      expect(address).toBe(`#/chess/${projectId}/play/${panelTab}`);
      expect(chessRouteFromHash(address, projectId)).toEqual({ page: 'play', panelTab });
    }
  });

  it('routes direct 3D and Chess addresses into a full-page editor host', () => {
    expect(creatorViewFromHash('#/3d/three-d-project')).toEqual({
      kind: 'editor',
      moduleKey: 'three-d',
      projectId: 'three-d-project',
      returnTo: { kind: 'my-projects' },
    });
    expect(creatorViewFromHash('#/chess/chess-project/review')).toEqual({
      kind: 'editor',
      moduleKey: 'chess',
      projectId: 'chess-project',
      returnTo: { kind: 'my-projects' },
    });
  });

  it('does not reuse a Chess address for another project', () => {
    expect(chessRouteFromHash('#/chess/project-a/online', 'project-b')).toEqual({
      page: 'home',
      panelTab: 'game',
    });
  });
});
