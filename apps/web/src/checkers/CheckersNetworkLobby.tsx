import type { CheckersNetworkMatch } from '@asa-lab/contracts';
import type { PublicUser } from '../api';
import { CasualNetworkLobby, type NetworkGameApi } from '../games/CasualNetworkLobby';
import { CheckersNetworkBoard } from './CheckersNetworkBoard';
import { checkersNetworkApi } from './checkers-network-api';
const api: NetworkGameApi = {
  ...checkersNetworkApi,
  action: (id, version, action, move) =>
    checkersNetworkApi.action(id, version, action, Array.isArray(move) ? move : undefined),
};
export function CheckersNetworkLobby(props: { user: PublicUser; onExit(): void; onHome(): void }) {
  return (
    <CasualNetworkLobby
      {...props}
      api={api}
      gameLabel="Шашки"
      title="Онлайн-шашки"
      renderBoard={({ match, disabled, onMove }) => (
        <CheckersNetworkBoard
          key={match.id}
          match={match as CheckersNetworkMatch}
          disabled={disabled}
          onMove={onMove}
        />
      )}
    />
  );
}
