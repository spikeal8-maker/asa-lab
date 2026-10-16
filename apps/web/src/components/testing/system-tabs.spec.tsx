import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SystemTabs } from '../SystemTabs';

describe('shared ASA Lab section tabs', () => {
  const items = [
    { id: 'students', label: 'Ученики' },
    { id: 'journal', label: 'Журнал' },
    { id: 'settings', label: 'Настройки', disabled: true },
  ] as const;

  it('preserves real nav buttons and one selected section', () => {
    const html = renderToStaticMarkup(
      <SystemTabs
        items={items}
        active="journal"
        onChange={() => undefined}
        label="Разделы класса"
      />,
    );
    expect(html).toContain('aria-label="Разделы класса"');
    expect(html).toContain('class="asa-system-tabs"');
    expect(html).toMatch(/aria-current="page"[^>]*>Журнал/);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toContain('disabled=""');
    expect(html.match(/type="button"/g)).toHaveLength(3);
  });

  it('shows short mobile copy with full accessible label', () => {
    const html = renderToStaticMarkup(
      <SystemTabs
        items={[{ id: 'co', label: 'Совместное преподавание', compactLabel: 'Совместно' }]}
        active="co"
        onChange={() => undefined}
        label="Роли в классах"
      />,
    );
    expect(html).toContain('aria-label="Совместное преподавание"');
    expect(html).toContain('asa-system-tab-compact');
    expect(html).toContain('>Совместно</span>');
  });

  it('supports a vertical presentation without changing the semantics', () => {
    const html = renderToStaticMarkup(
      <SystemTabs
        items={items}
        active="students"
        onChange={() => undefined}
        label="Разделы настроек"
        vertical
      />,
    );
    expect(html).toContain('asa-system-tabs--vertical');
    expect(html).toMatch(/aria-current="page"[^>]*>Ученики/);
  });
});
