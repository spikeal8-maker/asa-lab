export const GAMES = [
  {
    key: 'chess',
    title: 'Шахматы',
    description: 'Продумайте ход, сыграйте партию, найдите свою стратегию.',
  },
  {
    key: 'checkers',
    title: 'Шашки',
    description: 'Знакомая доска, неожиданные комбинации. Ваш ход.',
  },
] as const;

export type GameKey = (typeof GAMES)[number]['key'];

export function isGameModule(key: string | undefined): key is GameKey {
  return key === 'chess' || key === 'checkers';
}

/** Games keep their existing saved documents, but are not workshop projects. */
export function projectEntries<T extends { readonly moduleKey: string }>(items: readonly T[]): T[] {
  return items.filter((item) => !isGameModule(item.moduleKey));
}
