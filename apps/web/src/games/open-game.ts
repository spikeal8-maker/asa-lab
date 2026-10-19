import { api, type Project } from '../api';
import { GAMES, type GameKey } from './game-catalog';
import { gameAccessApi, gameAccessMessage } from './game-access-api';

export function latestGameSave(items: readonly Project[], game: GameKey): Project | undefined {
  return items
    .filter(
      (item) => item.moduleKey === game && item.scope === 'personal' && item.status === 'active',
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id))[0];
}

export async function openGame(game: GameKey): Promise<Project> {
  // Always refresh before resume/create. The server independently enforces this
  // again on list, direct open and every mutation, including idempotent retries.
  const admission = await gameAccessApi.read(game);
  if (!admission.ok) throw new Error('Не удалось проверить доступ к играм. Повторите проверку.');
  if (!admission.data.granted) throw new Error(gameAccessMessage(admission.data));
  const listed = await api.listProjects({
    scope: 'personal',
    status: 'active',
    module: game,
    includeGames: true,
  });
  if (!listed.ok)
    throw new Error(
      listed.error.code === 'games_access_denied'
        ? listed.error.message
        : 'Не удалось загрузить игры. Попробуйте ещё раз.',
    );
  const existing = latestGameSave(listed.data.items, game);
  if (existing) return existing;

  // Project Core scopes this key to the authenticated owner in the database.
  // A retry or two browser tabs therefore opens the same first save, not copies.
  const created = await api.createProject({
    scope: 'personal',
    module: game,
    title: GAMES.find((entry) => entry.key === game)!.title,
    idempotencyKey: `games-entry-v1-${game}`,
  });
  if (!created.ok) throw new Error(created.error.message || 'Не удалось начать игру.');
  if (created.data.project.status !== 'active') {
    throw new Error(
      'Сохранённая игра находится в архиве. Обратитесь к администратору для восстановления.',
    );
  }
  return created.data.project;
}
