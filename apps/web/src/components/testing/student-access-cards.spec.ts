import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { StudentAccessCards } from '../StudentAccessCards';

describe('StudentAccessCards production class-only QR contract', () => {
  it('shows only asa-lab.ru while carrying the exact current Class Code in the QR URL', () => {
    const classCode = 'ABC DEF 234';
    const studentCode = 'Ab7k';
    const html = renderToStaticMarkup(
      createElement(StudentAccessCards, {
        classroomTitle: '7А',
        classCode,
        students: [
          {
            id: '11111111-1111-4111-8111-111111111111',
            displayLabel: 'Синтетический ученик',
            studentCode,
            loginHandle: studentCode,
            safeMode: true,
            status: 'active',
            avatarKey: null,
            lastActiveAt: null,
            createdAt: '2026-09-18T00:00:00.000Z',
          },
        ],
        onClose: vi.fn(),
      }),
    );

    expect(html).toContain('asa-lab.ru');
    expect(html).not.toContain('Asolab.ru');

    const qrUrl = html.match(/data-qr-url="([^"]+)"/)?.[1];
    expect(qrUrl).toBe('https://asa-lab.ru/#/join-class?code=ABC%20DEF%20234');
    expect(qrUrl).not.toContain(studentCode);

    const copyWithoutAttributes = html.replace(/<[^>]+>/g, ' ');
    expect(copyWithoutAttributes).not.toContain('https://');
    expect(copyWithoutAttributes).not.toContain('/#/join-class');
    expect(copyWithoutAttributes).not.toContain('?code=');
  });
});
