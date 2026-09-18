import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { ClassroomStudentSeat } from '../api';
import { StudentAccessCards } from './StudentAccessCards';

const student: ClassroomStudentSeat = {
  id: '11111111-1111-4111-8111-111111111111',
  displayLabel: 'Синтетический ученик',
  studentCode: 'Ab7kQ2',
  loginHandle: 'Ab7kQ2',
  safeMode: true,
  status: 'issued',
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '2026-09-18T00:00:00.000Z',
};

describe('StudentAccessCards public join contract', () => {
  it('shows only asa-lab.ru while keeping the QR payload class-only on the production origin', () => {
    const html = renderToStaticMarkup(
      <StudentAccessCards
        classroomTitle="7А"
        classCode="ABC DEF 234"
        students={[student]}
        onClose={() => undefined}
      />,
    );
    const visibleText = html.replace(/<[^>]+>/g, ' ');

    expect(html).toContain('<span>asa-lab.ru</span>');
    expect(html).toContain(
      'data-qr-url="https://asa-lab.ru/#/join-class?code=ABC%20DEF%20234"',
    );
    expect(html).not.toContain('Asolab.ru');
    expect(html).not.toContain('https://asolab.ru');
    expect(visibleText).not.toContain('https://');
    expect(visibleText).not.toContain('/#/join-class');
    expect(
      html.match(/data-qr-url="([^"]+)"/)?.[1],
    ).toBe('https://asa-lab.ru/#/join-class?code=ABC%20DEF%20234');
    expect(html.match(/data-qr-url="([^"]+)"/)?.[1]).not.toContain(student.studentCode);
    expect(html.match(/data-qr-url="([^"]+)"/)?.[1]).not.toContain(student.id);
  });
});
