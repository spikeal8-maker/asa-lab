import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import { AdminLogsPage } from '../AdminLogsPage';

vi.mock('../admin-api', () => ({ call: vi.fn() }));

describe('administrative log editor filter', () => {
  it('renders selectable values and labels for all five editors in the actual page', () => {
    const html = renderToStaticMarkup(createElement(AdminLogsPage, { onAccessDenied: vi.fn() }));
    const moduleSelect = /Модуль<select[^>]*>(.*?)<\/select>/s.exec(html)?.[1];
    expect(moduleSelect).toBeDefined();
    for (const [value, label] of [
      ['scratch', 'Scratch'],
      ['electronics', 'Электроника'],
      ['three-d', '3D'],
      ['chess', 'Шахматы'],
      ['checkers', 'Шашки'],
    ]) {
      expect(moduleSelect).toContain(`<option value="${value}">${label}</option>`);
    }
    if (process.env['OBS015_RENDER_PATH']) {
      const css = readFileSync('apps/web/src/admin/admin-logs.css', 'utf8');
      writeFileSync(
        process.env['OBS015_RENDER_PATH'],
        `<!doctype html><html lang="ru"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box}body{margin:16px;font:16px system-ui}button,input,select{font:inherit}${css}</style><body>${html}</body></html>`,
      );
    }
  });
});
