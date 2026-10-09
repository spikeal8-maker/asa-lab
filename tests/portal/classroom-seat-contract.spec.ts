import { readFileSync } from 'node:fs';
import { parse } from 'yaml';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { describe, expect, it } from 'vitest';

const document = parse(readFileSync('schemas/openapi.yaml', 'utf8')) as {
  components: { schemas: { ClassroomStudentSeat: Record<string, unknown> } };
  paths: Record<
    string,
    {
      patch: {
        requestBody: { content: { 'application/json': { schema: Record<string, unknown> } } };
      };
    }
  >;
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
addFormats(ajv);
const validateSeat = ajv.compile(document.components.schemas.ClassroomStudentSeat);
const validateSettings = ajv.compile(
  document.paths['/api/classrooms/{classroomId}/seats/{seatId}']!.patch.requestBody.content[
    'application/json'
  ].schema,
);
const codeSeat = {
  id: '40000000-0000-4000-8000-000000000001',
  displayLabel: 'Проверочный ученик',
  loginMethod: 'student_code',
  studentCode: 'Ab7kQ2',
  loginHandle: 'Ab7kQ2',
  avatarKey: null,
  safeMode: true,
  status: 'active',
  lastActiveAt: null,
  createdAt: '2026-10-09T00:00:00.000Z',
  assignedCount: 1,
  submittedCount: 0,
  awaitingReview: 0,
};
describe('OpenAPI Seat admission contract', () => {
  it('accepts Account-only with null credentials and case-preserving Student Codes', () => {
    expect(validateSeat(codeSeat), JSON.stringify(validateSeat.errors)).toBe(true);
    expect(
      validateSeat({ ...codeSeat, loginMethod: 'account', studentCode: null, loginHandle: null }),
      JSON.stringify(validateSeat.errors),
    ).toBe(true);
  });
  it.each([
    { ...codeSeat, loginMethod: 'account' },
    { ...codeSeat, studentCode: null, loginHandle: null },
    {
      ...codeSeat,
      loginMethod: 'account',
      studentCode: 'acc:1234567890abcdef1234',
      loginHandle: 'acc:1234567890abcdef1234',
    },
    { ...codeSeat, loginMethod: 'unexpected' },
  ])('rejects incoherent or internal credentials', (row) => {
    expect(validateSeat(row)).toBe(false);
  });
  it('keeps settings separate from code issuance while allowing absent/null compatibility assertions', () => {
    const settings = {
      displayLabel: 'Новое имя',
      safeMode: false,
      status: 'active',
      avatarKey: null,
    };
    expect(validateSettings(settings)).toBe(true);
    expect(validateSettings({ ...settings, loginHandle: null })).toBe(true);
    expect(validateSettings({ ...settings, loginHandle: 'Ab7kQ2' })).toBe(true);
    expect(validateSettings({ ...settings, loginHandle: 'acc:1234567890abcdef1234' })).toBe(false);
    expect(validateSettings({ ...settings, studentCode: 'New123' })).toBe(false);
  });
});
