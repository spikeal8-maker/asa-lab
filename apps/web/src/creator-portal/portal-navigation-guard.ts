import {
  hasSettingsDraft,
  historyEntryIndex,
  isSettingsNavigationPending,
  requestSettingsNavigation,
} from '../components/settings-navigation';

/** Learning approval is read-only; do it before Settings can save or discard. */
export function requestPortalNavigation(mayLeave: () => boolean, proceed: () => void): void {
  if (isSettingsNavigationPending()) return;
  if (mayLeave()) requestSettingsNavigation(proceed);
}

interface AcceptedHistory {
  readonly location: { current: string };
  readonly index: { current: number };
}

export function createPortalHistoryGuard({
  accepted,
  needsLearningDecision,
  mayLeaveLearning,
  applyLocation,
}: {
  readonly accepted: AcceptedHistory;
  readonly needsLearningDecision: (destination: string) => boolean;
  readonly mayLeaveLearning: () => boolean;
  readonly applyLocation: () => void;
}) {
  if (window.history.state?.asaRouteIndex === undefined)
    window.history.replaceState(
      { ...window.history.state, asaRouteIndex: 0 },
      '',
      window.location.href,
    );
  let observedLocation = window.location.href;
  let observedIndex = historyEntryIndex();
  let observedAcceptedLocation = accepted.location.current;
  let observedAcceptedIndex = accepted.index.current;
  let allowedTraversal: { href: string; index: number } | null = null;
  let restoredDecision: (() => void) | null = null;

  const accept = () => {
    accepted.location.current = window.location.href;
    accepted.index.current = historyEntryIndex() ?? accepted.index.current;
    observedLocation = accepted.location.current;
    observedIndex = accepted.index.current;
    observedAcceptedLocation = accepted.location.current;
    observedAcceptedIndex = accepted.index.current;
  };
  const sync = (): void => {
    let destination = window.location.href;
    let destinationIndex = historyEntryIndex();
    if (destinationIndex === null) {
      destinationIndex = accepted.index.current + 1;
      window.history.replaceState(
        { ...window.history.state, asaRouteIndex: destinationIndex },
        '',
        destination,
      );
    }
    if (
      allowedTraversal !== null &&
      destinationIndex === allowedTraversal.index &&
      destination !== allowedTraversal.href
    ) {
      // A hash edit while the dialog is open may replace the requested entry.
      window.history.replaceState(window.history.state, '', allowedTraversal.href);
      destination = window.location.href;
    }
    if (
      observedAcceptedLocation !== accepted.location.current ||
      observedAcceptedIndex !== accepted.index.current
    ) {
      observedLocation = accepted.location.current;
      observedIndex = accepted.index.current;
      observedAcceptedLocation = accepted.location.current;
      observedAcceptedIndex = accepted.index.current;
    }
    // Back/hash emits two events for one entry, including restoration events.
    if (destination === observedLocation && destinationIndex === observedIndex) return;
    observedLocation = destination;
    observedIndex = destinationIndex;
    if (destination === accepted.location.current && destinationIndex === accepted.index.current) {
      const decide = restoredDecision;
      restoredDecision = null;
      decide?.();
      return;
    }
    const delta = accepted.index.current - destinationIndex;
    if (isSettingsNavigationPending() || restoredDecision !== null) {
      // Retain the first destination; undo additional Back/Forward requests.
      if (delta !== 0) window.history.go(delta);
      else window.history.back();
      return;
    }
    const apply = () => {
      accepted.location.current = destination;
      accepted.index.current = destinationIndex;
      applyLocation();
      window.dispatchEvent(new Event('settings-route'));
    };
    if (allowedTraversal?.href === destination && allowedTraversal.index === destinationIndex) {
      allowedTraversal = null;
      apply();
      return;
    }
    if (!hasSettingsDraft() && !needsLearningDecision(destination)) {
      apply();
      return;
    }
    // The browser already moved. Restore its accepted entry BEFORE a synchronous
    // Learning confirm or the Settings dialog, without pushing/truncating history.
    restoredDecision = () =>
      requestPortalNavigation(mayLeaveLearning, () => {
        allowedTraversal = { href: destination, index: destinationIndex };
        if (delta !== 0) window.history.go(-delta);
        else window.history.forward();
      });
    if (delta !== 0) window.history.go(delta);
    else window.history.back();
  };
  return { sync, accept };
}
