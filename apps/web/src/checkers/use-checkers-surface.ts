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
function fromHash<T extends string>(id: string): T {
  const match = /^#\/checkers\/([^/]+)\/([^/?]+)/.exec(window.location.hash);
  try {
    return (
      match && decodeURIComponent(match[1]!) === id && surfaces.has(match[2]!) ? match[2]! : 'home'
    ) as T;
  } catch {
    return 'home' as T;
  }
}
export function useCheckersSurface<T extends string>(id: string): [T, Dispatch<SetStateAction<T>>] {
  const [surface, setSurface] = useState<T>(() => fromHash<T>(id));
  useEffect(() => {
    const sync = () => setSurface(fromHash<T>(id));
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
