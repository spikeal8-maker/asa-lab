import { useEffect, useState } from 'react';

export function journalDestination(hash: string) {
  const query = new URLSearchParams(hash.split('?')[1] ?? '');
  const month = query.get('journalMonth') ?? '';
  const column = query.get('journalColumn') ?? '';
  return {
    month: /^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month) ? month : '',
    columnId: /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      column,
    )
      ? column
      : undefined,
  };
}
export function useJournalDestination() {
  const [hash, setHash] = useState(() =>
    typeof window === 'undefined' ? '' : window.location.hash,
  );
  useEffect(() => {
    const change = () => setHash(window.location.hash);
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  return journalDestination(hash);
}
