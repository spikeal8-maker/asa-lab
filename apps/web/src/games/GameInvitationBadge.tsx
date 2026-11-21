import './game-notifications.css';

export function GameInvitationBadge({
  count,
  pulse,
}: {
  count: number;
  pulse: number;
}): JSX.Element | null {
  if (!count) return null;
  return (
    <span
      key={pulse}
      className="game-invitation-badge"
      data-pulse={pulse > 0 ? 'new' : 'idle'}
      aria-label={`Приглашений в игру: ${count}`}
    >
      {count > 9 ? '9+' : count}
    </span>
  );
}
