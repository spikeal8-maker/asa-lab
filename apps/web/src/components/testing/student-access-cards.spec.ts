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
  loginMethod: 'student_code' as const,
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
      expect(html).toContain(`<span class="student-access-site">${label}</span>`);
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

describe('twenty-card A4 pagination', () => {
  it('describes Account admission honestly alongside a real Student Code', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://portal.example.org', protocol: 'https:' },
    });
    const html = renderToStaticMarkup(
      createElement(StudentAccessCards, {
        classroomTitle: 'Смешанный класс',
        classCode,
        onClose: vi.fn(),
        students: [
          student,
          {
            ...student,
            id: 'account',
            loginMethod: 'account',
            studentCode: null,
            loginHandle: null,
          },
        ],
      }),
    );
    expect(html).toContain(studentCode);
    expect(html).toContain('Вход через аккаунт');
    expect(html).toContain('Войдите в свой аккаунт ASA Lab → Моё обучение → этот класс.');
    expect(html).not.toContain('acc:');
    expect(html.match(/data-qr-url=/g)).toHaveLength(2);
    expect(html.match(/data-card-count="2"/g)).toHaveLength(1);
  });
  it.each([
    [0, 0],
    [1, 1],
    [20, 1],
    [21, 2],
    [30, 2],
    [40, 2],
    [41, 3],
    [100, 5],
  ])('%i students use %i sheets', (count, pageCount) => {
    vi.stubGlobal('window', {
      location: { origin: 'https://portal.example.org', protocol: 'https:' },
    });
    const html = renderToStaticMarkup(
      createElement(StudentAccessCards, {
        classroomTitle: '7А',
        classCode,
        onClose: vi.fn(),
        students: Array.from({ length: count }, (_, index) => ({ ...student, id: String(index) })),
      }),
    );
    expect(html.match(/class="student-access-print-page"/g) ?? []).toHaveLength(pageCount);
    const pageSizes = [...html.matchAll(/data-card-count="(\d+)"/g)].map((m) => Number(m[1]));
    expect(pageSizes.reduce((a, b) => a + b, 0)).toBe(count);
    expect(pageSizes.every((size) => size <= 20)).toBe(true);
  });
  it('prints only newly selected active learners', () => {
    vi.stubGlobal('window', {
      location: { origin: 'https://portal.example.org', protocol: 'https:' },
    });
    const html = renderToStaticMarkup(
      createElement(StudentAccessCards, {
        classroomTitle: '7А',
        classCode,
        onClose: vi.fn(),
        initialStudentIds: ['new', 'suspended'],
        students: [
          { ...student, id: 'old' },
          { ...student, id: 'new' },
          { ...student, id: 'suspended', status: 'suspended' },
        ],
      }),
    );
    expect(html.match(/class="student-access-card"/g)).toHaveLength(1);
  });
});
