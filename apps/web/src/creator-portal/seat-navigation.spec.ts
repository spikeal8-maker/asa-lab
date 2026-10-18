import { describe, expect, it } from 'vitest';
import {
  creatorViewFromLocation,
  creatorViewToHash,
  portalNavigation,
  sectionForView,
} from './navigation';

describe('Seat navigation', () => {
  it.each([false, true])('keeps learner links even with canTeach=%s', (canTeach) => {
    expect(
      portalNavigation(canTeach, { seat: true, classes: true, contentAuthoring: true }),
    ).toEqual([
      { section: 'home', label: 'Главная' },
      { section: 'learning', label: 'Моё обучение' },
      { section: 'projects', label: 'Мои проекты' },
      { section: 'games', label: 'Игры' },
      { section: 'help', label: 'Помощь' },
      { section: 'account', label: 'Настройки учебного профиля' },
    ]);
  });

  it('preserves Account and linked Account navigation', () => {
    expect(portalNavigation(false)).toEqual([
      { section: 'home', label: 'Главная' },
      { section: 'projects', label: 'Мои проекты' },
      { section: 'games', label: 'Игры' },
      { section: 'ai', label: 'ИИ' },
      { section: 'collections', label: 'Сохранённое' },
      { section: 'learning', label: 'Моё обучение' },
      { section: 'help', label: 'Справка' },
      { section: 'account', label: 'Настройки' },
    ]);
    expect(portalNavigation(true, { classes: true, contentAuthoring: true })).toEqual(
      expect.arrayContaining([
        { section: 'classes', label: 'Классы' },
        { section: 'challenges', label: 'Курсы и задания' },
      ]),
    );
  });

  it.each([
    ['#/projects', 'my-projects', 'projects'],
    ['#/games', 'games', 'games'],
  ] as const)('restores %s and its selected navigation after refresh', (hash, kind, section) => {
    const view = creatorViewFromLocation({ pathname: '/', search: '', hash });
    expect(view).toEqual({ kind });
    expect(creatorViewToHash(view)).toBe(hash);
    expect(sectionForView(view, false)).toBe(section);
  });
});
