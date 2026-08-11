import {
  EditorHeader,
  type EditorHeaderItem,
  type EditorSaveKind,
} from '../components/editor-chrome/EditorHeader';

export type ChessEditorPanel = 'game' | 'analysis' | 'versions';

const SAVE_COPY: Readonly<Record<EditorSaveKind, string>> = {
  saved: 'Сохранено',
  dirty: 'Есть изменения',
  saving: 'Сохранение…',
  error: 'Ошибка сохранения',
};

export function chessAvatarText(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts
    .slice(0, 2)
    .map((part) => part.slice(0, 1).toLocaleUpperCase('ru-RU'))
    .join('');
}

export function ChessEditorHeader({
  projectTitle,
  persistedProjectTitle,
  onProjectTitleChange,
  onProjectTitleCommit,
  saveStatus,
  statusDetail,
  busy,
  activePanel,
  onPanelChange,
  onBack,
  onNewGame,
  onCheckpoint,
  onSave,
  userDisplayName,
}: {
  readonly projectTitle: string;
  readonly persistedProjectTitle: string;
  readonly onProjectTitleChange: (value: string) => void;
  readonly onProjectTitleCommit: () => void | Promise<void>;
  readonly saveStatus: EditorSaveKind;
  readonly statusDetail: string;
  readonly busy: boolean;
  readonly activePanel: ChessEditorPanel;
  readonly onPanelChange: (panel: ChessEditorPanel) => void;
  readonly onBack: () => void;
  readonly onNewGame: () => void;
  readonly onCheckpoint: () => void;
  readonly onSave: () => void;
  readonly userDisplayName: string;
}): JSX.Element {
  const navigationItems: readonly EditorHeaderItem[] = [
    {
      id: 'game',
      label: 'Партия',
      selected: activePanel === 'game',
      onActivate: () => onPanelChange('game'),
    },
    {
      id: 'analysis',
      label: 'Анализ',
      selected: activePanel === 'analysis',
      onActivate: () => onPanelChange('analysis'),
    },
    {
      id: 'versions',
      label: 'Версии',
      selected: activePanel === 'versions',
      onActivate: () => onPanelChange('versions'),
    },
  ];
  const actions: readonly EditorHeaderItem[] = [
    {
      id: 'new-game',
      label: 'Новая',
      visibility: 'wide',
      onActivate: onNewGame,
    },
    {
      id: 'checkpoint',
      label: 'Версия',
      visibility: 'wide',
      disabled: busy,
      onActivate: onCheckpoint,
    },
    {
      id: 'save',
      label: 'Сохранить',
      emphasis: 'primary',
      disabled: busy,
      onActivate: onSave,
    },
  ];

  return (
    <EditorHeader
      moduleId="chess"
      onExit={onBack}
      exitLabel="Вернуться к проектам"
      title={{
        kind: 'editable',
        value: projectTitle,
        ariaLabel: 'Название проекта',
        maxLength: 160,
        onChange: onProjectTitleChange,
        onCommit: onProjectTitleCommit,
        onCancel: () => onProjectTitleChange(persistedProjectTitle),
      }}
      status={{ kind: saveStatus, label: SAVE_COPY[saveStatus], detail: statusDetail }}
      navigation={{
        ariaLabel: 'Панель шахматного проекта',
        items: navigationItems,
      }}
      actions={actions}
      avatar={{
        label: `Пользователь ${userDisplayName}`,
        text: chessAvatarText(userDisplayName),
        title: userDisplayName,
      }}
    />
  );
}
