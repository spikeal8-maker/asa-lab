import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const component = readFileSync(
  resolve(process.cwd(), 'apps/web/src/components/BotCheck.tsx'),
  'utf8',
);
const styles = readFileSync(resolve(process.cwd(), 'apps/web/src/styles.css'), 'utf8');

describe('BotCheck presentation', () => {
  it('shows only the requested label and no explanatory status copy', () => {
    expect(component).toContain('<span>Я не робот</span>');
    expect(component).not.toContain('Проверка выполняется');
    expect(component).not.toContain('Проверяем браузер');
    expect(component).not.toContain('Проверка пройдена');
    expect(component).not.toContain('Не удалось проверить');
  });

  it('requires trusted, changing pointer movement and renders a progress ring', () => {
    expect(component).toContain("window.addEventListener('pointermove'");
    expect(component).toContain('event.isTrusted');
    expect(component).toContain('REQUIRED_TURNS');
    expect(component).toContain('bot-check-progress');
    expect(styles).toContain('conic-gradient(');
    expect(styles).toContain('--bot-check-progress');
  });
});
