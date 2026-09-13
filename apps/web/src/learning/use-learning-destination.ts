import { useEffect, useState } from 'react';

/** A focus hint only. Every destination still loads through its authorized read API. */
export function useLearningDestination() {
  const [query, setQuery] = useState(() => window.location.hash.split('?')[1] ?? '');
  useEffect(() => {
    const sync = () => setQuery(window.location.hash.split('?')[1] ?? '');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  const params = new URLSearchParams(query);
  return {
    assignment: params.get('assignment'),
    seat: params.get('learner'),
    attempt: params.get('attempt'),
    courseRun: params.get('courseRun'),
    joinRequest: params.get('joinRequest'),
  };
}
