import type { PublicUser } from '../api';
import {
  EditorHeader,
  type EditorHeaderItem,
  type EditorSaveKind,
} from '../components/editor-chrome/EditorHeader';
import { chessAvatarText } from './ChessEditorHeader';

interface ChessSectionHeaderProps {
  readonly user: PublicUser;
  readonly title: string;
  readonly status: {
    readonly kind: EditorSaveKind;
    readonly label: string;
    readonly detail?: string;
  };
  readonly onExit: () => void;
  readonly onHome: () => void;
  readonly actions?: readonly EditorHeaderItem[];
}

/** Shared ASA Lab chrome for Chess pages outside the main board editor. */
export function ChessSectionHeader(props: ChessSectionHeaderProps): JSX.Element {
  return (
    <>
      <EditorHeader
        moduleId="chess"
        onExit={props.onExit}
        exitLabel="Вернуться ко всем проектам"
        title={{ kind: 'readonly', text: props.title }}
        status={props.status}
        navigation={{
          ariaLabel: 'Навигация ASA Chess',
          items: [
            {
              id: 'chess-home',
              label: 'Главная',
              onActivate: props.onHome,
            },
          ],
        }}
        {...(props.actions ? { actions: props.actions } : {})}
        avatar={{
          label: `Пользователь ${props.user.displayName}`,
          text: chessAvatarText(props.user.displayName),
          title: props.user.displayName,
        }}
      />
      <h1 className="sr-only">{props.title}</h1>
    </>
  );
}
