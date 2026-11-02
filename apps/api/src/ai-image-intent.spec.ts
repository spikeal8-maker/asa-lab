import { expect, it } from 'vitest';
import {
  artifactMutationRequested,
  imageGenerationRequested,
  imageGenerationForbidden,
} from './ai-native-tools';

it.each([
  'Создай мне сайт про котиков с картинками',
  'Добавь туда картинок из интернета или сгенерируй сам.',
  'Теперь доделай сайт.',
  'Find pictures online and add them to the website',
  'Build a website with beautiful photos',
  'Найди картинку, если не получится, сгенерируй',
])('requires search before generation: %s', (prompt) =>
  expect(imageGenerationRequested(prompt)).toBe(false),
);
it.each([
  'Создай картинку замка',
  'Сгенерируй изображение для сайта',
  'Нарисуй иллюстрацию',
  'Create a picture of a cat',
  'Build a website with a generated illustration',
  'Создай сайт, картинку сгенерируй сам, не используй поиск',
])('admits explicit generation: %s', (prompt) =>
  expect(imageGenerationRequested(prompt)).toBe(true),
);
it.each([
  'Теперь доделай сайт.',
  'Добавь в него картинки',
  'не вижу обновлений',
  'Update the website',
])('requires confirmed mutations: %s', (prompt) =>
  expect(artifactMutationRequested(prompt, true)).toBe(true),
);
it('retains explanation responses without requiring a write', () =>
  expect(artifactMutationRequested('Объясни как работает этот сайт', true)).toBe(false));
it('does not turn an unrelated arithmetic request into a file mutation', () =>
  expect(artifactMutationRequested('Добавь 2 к 3', true)).toBe(false));
it.each([
  'Создай картинку, не нужно генерировать',
  'Создай сайт с картинками без новой генерации',
  'Создай сайт с картинками. Не надо использовать генерацию',
  'Не следует снова генерировать новые изображения',
  'Не генерируй картинки',
  "Create a picture, don't automatically generate it",
  'Do not ever generate new images',
  'Create a site without new image generation',
])(
  'vetoes clear generation prohibitions before acquisition and after failed search: %s',
  (prompt) => {
    expect(imageGenerationForbidden(prompt)).toBe(true);
    expect(imageGenerationRequested(prompt)).toBe(false);
  },
);
