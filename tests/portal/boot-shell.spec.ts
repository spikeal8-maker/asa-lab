import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ModuleEditorHost } from '../../apps/web/src/modules/ModuleEditorHost';

const root = resolve(import.meta.dirname, '../..');

describe('ASA Lab first-frame shell', () => {
  it('covers the SEO fallback before the application bundle starts', () => {
    const html = readFileSync(resolve(root, 'apps/web/index.html'), 'utf8');
    const boot = html.indexOf('class="app-boot-shell-static"');
    const fallback = html.indexOf('class="seo-fallback"');
    const application = html.indexOf('src="/src/main.tsx"');

    expect(boot).toBeGreaterThan(0);
    expect(fallback).toBeGreaterThan(boot);
    expect(application).toBeGreaterThan(fallback);
    expect(html).toContain('#root > .app-boot-shell-static');
    const noScript = html.slice(
      html.indexOf('<noscript'),
      html.indexOf('<meta property="og:type"'),
    );
    expect(noScript).toContain('#root > .app-boot-shell-static');
    expect(noScript).toContain('display: none');
  });

  it('uses one branded shell for session and subject-editor loading', () => {
    const app = readFileSync(resolve(root, 'apps/web/src/App.tsx'), 'utf8');
    const host = readFileSync(resolve(root, 'apps/web/src/modules/ModuleEditorHost.tsx'), 'utf8');

    expect(app).toContain('return <AppBootShell />;');
    expect(host).toContain('<AppBootShell label="Открываем рабочую среду" />');
    expect(host).not.toContain('Загружаем среду проекта…');
    expect(host).not.toContain('Загружаем учебную среду…');
  });

  it.each([
    ['my-projects', 'Открываем проект'],
    ['games', 'Открываем игру'],
  ] as const)('keeps the branded first frame and correct loading label for %s', (kind, label) => {
    const html = renderToStaticMarkup(
      createElement(ModuleEditorHost, {
        projectId: 'saved-document',
        returnTo: { kind },
        user: { id: 'player', displayName: 'Игрок', email: 'player@example.test' },
        onBack: () => undefined,
      }),
    );
    expect(html).toContain('class="app-boot-shell"');
    expect(html).toContain('role="status"');
    expect(html).toContain(`aria-label="${label}"`);
    expect(html).not.toContain('seo-fallback');
  });

  it('uses a known route module without asking Project Core to resolve it again', () => {
    const host = readFileSync(resolve(root, 'apps/web/src/modules/ModuleEditorHost.tsx'), 'utf8');
    const knownModuleBranch = host.indexOf('if (props.moduleKey)');
    const projectLookup = host.indexOf('api.openProject(props.projectId)');

    expect(knownModuleBranch).toBeGreaterThan(0);
    expect(projectLookup).toBeGreaterThan(knownModuleBranch);
  });
});
