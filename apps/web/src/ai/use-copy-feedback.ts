import { useCallback, useEffect, useRef, useState } from 'react';

/** Feedback is temporary; it never disables copying or reads the clipboard. */
export function useCopyFeedback(key: string) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const resetCopy = useCallback(() => {
    clearTimeout(timer.current);
    setCopied(false);
  }, []);
  const confirmCopy = useCallback(() => {
    clearTimeout(timer.current);
    setCopied(true);
    timer.current = setTimeout(() => setCopied(false), 3000);
  }, []);
  useEffect(() => {
    resetCopy();
    window.addEventListener('blur', resetCopy);
    document.addEventListener('visibilitychange', resetCopy);
    return () => {
      clearTimeout(timer.current);
      window.removeEventListener('blur', resetCopy);
      document.removeEventListener('visibilitychange', resetCopy);
    };
  }, [key, resetCopy]);
  return { copied, confirmCopy, resetCopy };
}
