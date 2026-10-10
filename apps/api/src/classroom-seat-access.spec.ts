import { describe, expect, it } from 'vitest';
import { classroomSeatAccess } from './classroom-seat-access';

describe('Seat credential projection', () => {
  it('projects the reserved Account-only database handle without exposing it as a credential', () => {
    expect(classroomSeatAccess('acc:1234567890abcdef1234')).toEqual({
      loginMethod: 'account',
      studentCode: null,
      loginHandle: null,
    });
  });
  it.each(['Ab7k', 'Aa2346', 'Qwerty1234'])(
    'keeps the exact %s code, including on Account-linked Seats',
    (code) => {
      expect(classroomSeatAccess(code)).toEqual({
        loginMethod: 'student_code',
        studentCode: code,
        loginHandle: code,
      });
    },
  );
});
