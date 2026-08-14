export type ChessPage = 'home' | 'play' | 'online' | 'puzzles' | 'learning' | 'bots' | 'review';

export type ChessPanelTab = 'game' | 'analysis' | 'versions';

export interface ChessRouteState {
  readonly page: ChessPage;
  readonly panelTab: ChessPanelTab;
}

const CHESS_PAGES = new Set<ChessPage>([
  'home',
  'play',
  'online',
  'puzzles',
  'learning',
  'bots',
  'review',
]);
const CHESS_PANEL_TABS = new Set<ChessPanelTab>(['game', 'analysis', 'versions']);

export const DEFAULT_CHESS_ROUTE: ChessRouteState = { page: 'home', panelTab: 'game' };

function decodeProjectId(value: string): string | null {
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

export function chessRouteFromHash(hash: string, projectId: string): ChessRouteState {
  const path = hash.replace(/^#/, '').split('?')[0] ?? '';
  const match = /^\/chess\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/.exec(path);
  if (!match || decodeProjectId(match[1] ?? '') !== projectId) return DEFAULT_CHESS_ROUTE;

  const page = match[2];
  if (!page || !CHESS_PAGES.has(page as ChessPage)) return DEFAULT_CHESS_ROUTE;
  if (page !== 'play') return { page: page as ChessPage, panelTab: 'game' };

  const panelTab = match[3];
  return {
    page: 'play',
    panelTab:
      panelTab && CHESS_PANEL_TABS.has(panelTab as ChessPanelTab)
        ? (panelTab as ChessPanelTab)
        : 'game',
  };
}

export function chessRouteToHash(projectId: string, route: ChessRouteState): string {
  const encodedProjectId = encodeURIComponent(projectId);
  return route.page === 'play'
    ? `#/chess/${encodedProjectId}/play/${route.panelTab}`
    : `#/chess/${encodedProjectId}/${route.page}`;
}
