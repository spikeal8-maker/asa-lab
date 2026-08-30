import { describe, expect, it } from 'vitest';
import { componentHelpSections } from '../component-help-content';

describe('button and switch help content', () => {
  it('explains the four-pin momentary button without implying a latching state', () => {
    const text = componentHelpSections('button', 'Кнопка', 'button-tactile-6mm')
      .map((section) => section.text)
      .join(' ');

    expect(text).toContain('четырьмя физическими выводами');
    expect(text).toContain('После отпускания цепь снова размыкается');
    expect(text).toContain('не создаёт сохранение проекта');
  });

  it('explains that an SPDT selects exactly one throw', () => {
    const text = componentHelpSections('switch', 'Переключатель', 'switch-spdt')
      .map((section) => section.text)
      .join(' ');

    expect(text).toContain('ровно с одним выводом');
    expect(text).toContain('одновременного соединения обоих выводов модель не создаёт');
    expect(text).toContain('без изменения проводов');
  });
});
