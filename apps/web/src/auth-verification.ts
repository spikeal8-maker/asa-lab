const VERIFICATION_REQUIRED_EVENT = 'asa-account-verification-required';

/** A denied API request only asks the shell to read fresh server policy. */
export function notifyAccountVerificationRequired(): void {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new Event(VERIFICATION_REQUIRED_EVENT));
  }
}

export function onAccountVerificationRequired(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener(VERIFICATION_REQUIRED_EVENT, listener);
  return () => window.removeEventListener(VERIFICATION_REQUIRED_EVENT, listener);
}
