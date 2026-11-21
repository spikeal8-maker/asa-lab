import { describe, expect, it } from 'vitest';
import { requestsImageCreation } from './image-generation-intent';

describe('explicit image creation in Auto mode', () => {
  it('recognizes direct creation requests', () => {
    for (const prompt of [
      'Нарисуй кота',
      'Хочу изображение гор',
      'Мне нужна картинка с роботом',
      'Сгенерируй мне изображение робота',
      'Создай картинку леса',
      'Please generate an image of a robot',
    ])
      expect(requestsImageCreation(prompt), prompt).toBe(true);
  });
  it('does not run a GPU job for discussion, negation or ordinary chat', () => {
    for (const prompt of [
      'Как нарисовать кота?',
      'Не создавай картинку',
      'Объясни команду «создай картинку»',
      'Какая погода в Москве?',
    ])
      expect(requestsImageCreation(prompt), prompt).toBe(false);
  });
});
