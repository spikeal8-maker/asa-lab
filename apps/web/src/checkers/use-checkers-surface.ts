import { useEffect, useState, type Dispatch, type SetStateAction } from 'react';

const surfaces = new Set([
  'home',
  'play',
  'network',
  'bots',
  'bot-campaign',
  'local',
  'learning',
  'review',
  'class',
  'teacher',
]);
export function checkersSurfaceRoute(id: string, hash: string): string | null {
  const match = /^#\/checkers\/([^/]+)\/([^/?]+)/.exec(hash);
  try {
    return match && decodeURIComponent(match[1]!) === id && surfaces.has(match[2]!)
      ? match[2]!
      : null;
  } catch {
    return null;
  }
}
export function useCheckersSurface<T extends string>(id: string): [T, Dispatch<SetStateAction<T>>] {
  const [surface, setSurface] = useState<T>(
    () => (checkersSurfaceRoute(id, window.location.hash) ?? 'home') as T,
  );
  useEffect(() => {
    const sync = () => setSurface((checkersSurfaceRoute(id, window.location.hash) ?? 'home') as T);
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
    };
  }, [id]);
  useEffect(() => {
    const hash = `#/checkers/${encodeURIComponent(id)}/${surface}`;
    if (window.location.hash !== hash) window.history.replaceState(null, '', hash);
  }, [id, surface]);
  return [surface, setSurface];
}
