import type { ChessNetworkMatch } from '@asa-lab/contracts';
import type { PublicUser } from '../api';
import { CasualNetworkLobby, type NetworkGameApi } from '../games/CasualNetworkLobby';
import { ChessNetworkBoard } from './ChessNetworkBoard';
import { ChessSectionHeader } from './ChessSectionHeader';
import { chessNetworkApi } from './chess-network-api';
export { networkResultPresentation, isNewNetworkVictory } from '../games/CasualNetworkLobby';
const api: NetworkGameApi = {
  ...chessNetworkApi,
  action: (id, version, action, move) =>
    chessNetworkApi.action(id, version, action, typeof move === 'string' ? move : undefined),
};
export function ChessNetworkLobby(props: { user: PublicUser; onExit(): void; onHome(): void }) {
  return (
    <CasualNetworkLobby
      {...props}
      api={api}
      gameLabel="Шахматы"
      title="Онлайн-шахматы"
      renderBoard={({ match, disabled, onMove }) => (
        <ChessNetworkBoard match={match as ChessNetworkMatch} disabled={disabled} onMove={onMove} />
      )}
      renderMatchHeader={({ title, loading, connected, onExit, onHome }) => (
        <ChessSectionHeader
          user={props.user}
          title={title}
          status={{
            kind: loading ? 'saving' : connected ? 'saved' : 'error',
            label: loading ? 'Подключаемся' : connected ? 'Подключено' : 'Восстанавливаем связь',
          }}
          onExit={onExit}
          onHome={onHome}
        />
      )}
    />
  );
}
