import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StudentAccessCards } from '../StudentAccessCards';

const classCode = 'ABC DEF 234';
const studentCode = 'Ab7k';
const student = {
  id: '11111111-1111-4111-8111-111111111111',
  displayLabel: 'Синтетический ученик',
  studentCode,
  loginHandle: studentCode,
  safeMode: true,
  status: 'active' as const,
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '2026-09-18T00:00:00.000Z',
};

function renderAt(origin: string, protocol: string): string {
  vi.stubGlobal('window', { location: { origin, protocol } });
  return renderToStaticMarkup(
    createElement(StudentAccessCards, {
      classroomTitle: '7А',
      classCode,
      students: [student],
      onClose: vi.fn(),
    }),
  );
}

afterEach(() => vi.unstubAllGlobals());

describe('StudentAccessCards class-only QR contract', () => {
  it.each([
    ['local', 'http://127.0.0.1:4610', 'http:', '127.0.0.1:4610'],
    ['LAN', 'https://192.168.1.42:4610', 'https:', '192.168.1.42:4610'],
    ['public', 'https://portal.example.org', 'https:', 'portal.example.org'],
    [
      'long host',
      'https://classroom-really-long-installation-name.example.org',
      'https:',
      'classroom-really-long-installation-name.example.org',
    ],
  ])(
    'uses the actual %s portal entry for QR and printed instructions',
    (_, origin, protocol, label) => {
      const html = renderAt(origin, protocol);
      const qrUrl = html.match(/data-qr-url="([^"]+)"/)?.[1];
      expect(qrUrl).toBe(`${origin}/#/join-class?code=ABC%20DEF%20234`);
      expect(qrUrl).not.toContain(studentCode);
      expect(html).toContain(`<span>${label}</span>`);
      expect(html).toContain(`Вручную: ${label} → код класса → код ученика.`);
      expect(html).not.toContain('asa-lab.ru');

      const copyWithoutAttributes = html.replace(/<[^>]+>/g, ' ');
      expect(copyWithoutAttributes).not.toContain('https://');
      expect(copyWithoutAttributes).not.toContain('/#/join-class');
      expect(copyWithoutAttributes).not.toContain('?code=');
    },
  );

  it.each([
    ['file origin', 'null', 'file:'],
    ['noncanonical origin', 'https://portal.example.org/', 'https:'],
    ['protocol mismatch', 'https://portal.example.org', 'blob:'],
  ])('does not offer a QR or printing for %s', (_, origin, protocol) => {
    const html = renderAt(origin, protocol);
    expect(html).not.toContain('data-qr-url=');
    expect(html).toContain('Адрес входа в портал не определён');
    expect(html).toContain('disabled=""');
  });
});
