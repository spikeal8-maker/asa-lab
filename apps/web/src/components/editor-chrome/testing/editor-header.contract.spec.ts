import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { EditorHeader, editorHeaderTitleKeyAction, type EditorHeaderProps } from '../EditorHeader';

const chromeRoot = resolve(process.cwd(), 'apps/web/src/components/editor-chrome');
const componentSource = readFileSync(resolve(chromeRoot, 'EditorHeader.tsx'), 'utf8');
const cssSource = readFileSync(resolve(chromeRoot, 'editor-header.css'), 'utf8');

function editableProps(): EditorHeaderProps {
  return {
    moduleId: 'contract-fixture',
    onExit: vi.fn(),
    exitLabel: 'Назад к проектам',
    title: {
      kind: 'editable',
      value: 'Учебный проект',
      ariaLabel: 'Название проекта',
      maxLength: 160,
      onChange: vi.fn(),
      onCommit: vi.fn(),
      onCancel: vi.fn(),
    },
    status: {
      kind: 'error',
      label: 'Ошибка сохранения',
      detail: 'Сервер временно недоступен',
    },
    navigation: {
      ariaLabel: 'Представления проекта',
      items: [
        { id: 'first', label: 'Первое', selected: true, onActivate: vi.fn() },
        { id: 'second', label: 'Второе', onActivate: vi.fn() },
      ],
    },
    actions: [
      {
        id: 'wide',
        label: 'Широкое действие',
        visibility: 'wide',
        onActivate: vi.fn(),
      },
      {
        id: 'save',
        label: 'Сохранить',
        emphasis: 'primary',
        disabled: true,
        onActivate: vi.fn(),
      },
    ],
    avatar: { label: 'Пользователь Анна', text: 'АИ', title: 'Анна Иванова' },
  };
}

describe('neutral editor header contract', () => {
  it('renders ASA identity, editable title, full live status and an avatar last', () => {
    const html = renderToStaticMarkup(createElement(EditorHeader, editableProps()));

    expect(html).toContain('src="/asa-lab-mark.svg"');
    expect(html).toContain('ASA Lab');
    expect(html).toContain('aria-label="Название проекта"');
    expect(html).toContain('value="Учебный проект"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('title="Сервер временно недоступен"');
    expect(html).toContain('aria-label="Ошибка сохранения: Сервер временно недоступен"');
    expect(html.indexOf('editor-header-avatar')).toBeGreaterThan(
      html.indexOf('editor-header-actions'),
    );
  });

  it('renders readonly titles, selected navigation and disabled actions accessibly', () => {
    const props = editableProps();
    const html = renderToStaticMarkup(
      createElement(EditorHeader, {
        ...props,
        title: { kind: 'readonly', text: 'Только чтение' },
      }),
    );

    expect(html).toContain('editor-header-title-readonly');
    expect(html).toContain('Только чтение');
    expect(html).toMatch(/aria-pressed="true"[^>]*>\s*<span>Первое<\/span>/);
    expect(html).toMatch(/disabled=""[^>]*>\s*<span>Сохранить<\/span>/);
  });

  it('maps Enter to commit and Escape to persisted-title cancellation', () => {
    expect(editorHeaderTitleKeyAction('Enter')).toBe('commit');
    expect(editorHeaderTitleKeyAction('Escape')).toBe('cancel');
    expect(editorHeaderTitleKeyAction('Tab')).toBeNull();
    expect(componentSource).toContain("if (action === 'commit') void title.onCommit()");
    expect(componentSource).toContain('else title.onCancel()');
    expect(componentSource).toContain('skipNextTitleBlur.current = true');
  });

  it('keeps the Electronics-characterized row geometry and the 1024 wide-action rule', () => {
    expect(cssSource).toMatch(/\.editor-header\s*\{[^}]*height:\s*48px;[^}]*min-height:\s*48px;/s);
    expect(cssSource).toMatch(
      /\.editor-header-brand-mark\s*\{[^}]*width:\s*30px;[^}]*height:\s*30px;/s,
    );
    expect(cssSource).toMatch(/\.editor-header-item\s*\{[^}]*height:\s*38px;/s);
    expect(cssSource).toMatch(
      /\.editor-header-avatar\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s,
    );
    expect(cssSource).toMatch(
      /@media \(max-width: 1024px\)\s*\{[^}]*\.editor-header-item\[data-visibility='wide'\][^}]*display:\s*none;/s,
    );
    expect(cssSource).not.toContain(".editor-header-item[data-visibility='always']");
  });

  it('has no subject imports or account-model dependency', () => {
    expect(componentSource).not.toMatch(/from ['"].*(chess|checkers|electronics|three-d)/i);
    expect(componentSource).not.toContain('PublicUser');
    expect(componentSource).not.toContain('Controller');
  });
});
