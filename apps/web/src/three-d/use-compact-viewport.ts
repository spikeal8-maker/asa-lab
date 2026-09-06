import { useSyncExternalStore } from 'react';

const query = '(max-width: 760px), (max-width: 1100px) and (max-height: 500px)';
function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(query);
  media.addEventListener('change', onChange);
  return () => media.removeEventListener('change', onChange);
}

export function useCompactViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
