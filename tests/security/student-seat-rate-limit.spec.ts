import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { classroomCodeHash } from '../../contexts/classroom/dist/index.js';
import { buildTestApp, inject, type NestApp } from '../portal/app';

const CLASS_A_CODE = 'AAA BBB 222';
const CLASS_B_CODE = 'CCC DDD 333';
const CLASS_A_ID = '11111111-1111-4111-8111-111111111111';
const CLASS_B_ID = '22222222-2222-4222-8222-222222222222';
const CLASS_A_HASH = classroomCodeHash(CLASS_A_CODE);
const CLASS_B_HASH = classroomCodeHash(CLASS_B_CODE);
const TEN_MINUTES_SECONDS = 10 * 60;

interface SeatFixture {
  id: string;
  classId: string;
  code: string;
  displayLabel: string;
}

function sourceHeaders(address: string) {
  return { 'x-forwarded-for': address, 'user-agent': 'student-seat-rate-limit-test' };
}

function candidate(index: number, salt = ''): string {
  return `0${salt}${index.toString(36).toUpperCase().padStart(4, '0')}`.slice(0, 10);
}

describe('E1-FIX-01 StudentSeat admission anti-abuse', () => {
  let app: NestApp;
  const seats: SeatFixture[] = [];
  const sessions = new Map<string, SeatFixture>();

  beforeAll(async () => {
    for (let index = 0; index < 30; index += 1) {
      seats.push({
        id: `seat-a-${index}`,
        classId: CLASS_A_ID,
        code: `A${index.toString(36).toUpperCase().padStart(3, '2')}k`,
        displayLabel: `Learner ${index + 1}`,
      });
    }
    seats.push({
      id: 'seat-a-case',
      classId: CLASS_A_ID,
      code: 'Ab7k',
      displayLabel: 'Case Sensitive Learner',
    });
    seats.push({
      id: 'seat-b-0',
      classId: CLASS_B_ID,
      code: 'B7kQ2',
      displayLabel: 'Second Class Learner',
    });

    const pool = {
      end: vi.fn(async () => undefined),
      query: vi.fn(async (sql: string, params: unknown[] = []) => {
        if (sql.includes('classroom_public_resolve_join_code')) {
          const hash = String(params[0] ?? '');
          if (hash === CLASS_A_HASH) {
            return {
              rows: [
                {
                  tenant_id: 'tenant-a',
                  classroom_id: CLASS_A_ID,
                  classroom_title: 'Class A',
                  teacher_display_name: 'Teacher',
                  safe_mode_default: true,
                },
              ],
            };
          }
          if (hash === CLASS_B_HASH) {
            return {
              rows: [
                {
                  tenant_id: 'tenant-b',
                  classroom_id: CLASS_B_ID,
                  classroom_title: 'Class B',
                  teacher_display_name: 'Teacher',
                  safe_mode_default: true,
                },
              ],
            };
          }
          return { rows: [] };
        }

        if (sql.includes('classroom_student_seat_sign_in')) {
          const classHash = String(params[0] ?? '');
          const studentCode = String(params[1] ?? '');
          const sessionHash = String(params[3] ?? '');
          const classId =
            classHash === CLASS_A_HASH
              ? CLASS_A_ID
              : classHash === CLASS_B_HASH
                ? CLASS_B_ID
                : null;
          const seat = classId
            ? seats.find((entry) => entry.classId === classId && entry.code === studentCode)
            : undefined;
          if (!seat) return { rows: [] };
          sessions.set(sessionHash, seat);
          return {
            rows: [
              {
                seat_id: seat.id,
                classroom_id: seat.classId,
                classroom_title: seat.classId === CLASS_A_ID ? 'Class A' : 'Class B',
                display_label: seat.displayLabel,
                teacher_display_name: 'Teacher',
                safe_mode: true,
                avatar_key: null,
                expires_at: new Date('2026-09-19T00:00:00.000Z'),
              },
            ],
          };
        }

        if (sql.includes('classroom_student_session_context')) {
          const seat = sessions.get(String(params[0] ?? ''));
          return {
            rows: seat
              ? [
                  {
                    seat_id: seat.id,
                    classroom_id: seat.classId,
                    display_label: seat.displayLabel,
                    safe_mode: true,
                  },
                ]
              : [],
          };
        }

        if (sql.includes('student_seat_principal')) {
          const seat = seats.find((entry) => entry.id === String(params[0] ?? ''));
          return {
            rows: seat
              ? [
                  {
                    principal_id: `principal-${seat.id}`,
                    tenant_id: seat.classId === CLASS_A_ID ? 'tenant-a' : 'tenant-b',
                    classroom_id: seat.classId,
                  },
                ]
              : [],
          };
        }

        if (sql.includes('classroom_activity_record') || sql.includes('analytics_record_event')) {
          return { rows: [{ ok: true }] };
        }

        throw new Error(`Unexpected SQL in StudentSeat limiter test: ${sql}`);
      }),
    } as unknown as pg.Pool;

    app = await buildTestApp(pool);
  });

  afterEach(() => {
    delete process.env.ASA_TRUSTED_PROXY_CIDRS;
  });

  afterAll(async () => {
    await app.close();
  });

  async function resolve(code: string, source: string, extra: Record<string, unknown> = {}) {
    return inject(app, {
      method: 'POST',
      url: '/api/class-join/resolve',
      headers: sourceHeaders(source),
      payload: { code },
      ...extra,
    });
  }

  async function signIn(
    classCode: string,
    studentCode: string,
    source: string,
    extra: Record<string, unknown> = {},
  ) {
    return inject(app, {
      method: 'POST',
      url: '/api/class-join/studentseat',
      headers: sourceHeaders(source),
      payload: { code: classCode, studentCode },
      ...extra,
    });
  }

  it('allows 30 sequential correct two-step StudentSeat entries behind one NAT', async () => {
    const source = '203.0.113.10';
    for (const seat of seats.slice(0, 30)) {
      const resolved = await resolve(CLASS_A_CODE, source);
      expect(resolved.statusCode, resolved.body).toBe(200);
      const signedIn = await signIn(CLASS_A_CODE, seat.code, source);
      expect(signedIn.statusCode, signedIn.body).toBe(200);
    }
  });

  it('allows 30 parallel correct two-step StudentSeat entries behind one NAT', async () => {
    const source = '203.0.113.11';
    const results = await Promise.all(
      seats.slice(0, 30).map(async (seat) => {
        const resolved = await resolve(CLASS_A_CODE, source);
        const signedIn = await signIn(CLASS_A_CODE, seat.code, source);
        return [resolved.statusCode, signedIn.statusCode];
      }),
    );
    expect(results).toEqual(Array.from({ length: 30 }, () => [200, 200]));
  });

  it('allows every correct credential after 30 learners make four ordinary mistakes', async () => {
    const source = '203.0.113.12';
    for (const [learnerIndex, seat] of seats.slice(0, 30).entries()) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const wrong = candidate(learnerIndex * 4 + attempt, 'T');
        const rejected = await signIn(CLASS_A_CODE, wrong, source);
        expect(rejected.statusCode, rejected.body).toBe(401);
      }
      const accepted = await signIn(CLASS_A_CODE, seat.code, source);
      expect(accepted.statusCode, accepted.body).toBe(200);
    }
  });

  it('keeps successful resolves outside the invalid resolve budget and returns dynamic Retry-After', async () => {
    const source = '203.0.113.13';
    for (let index = 0; index < 90; index += 1) {
      const accepted = await resolve(CLASS_A_CODE, source);
      expect(accepted.statusCode, accepted.body).toBe(200);
    }
    for (let index = 0; index < 60; index += 1) {
      const rejected = await resolve('ZZZ ZZZ 999', source);
      expect(rejected.statusCode, rejected.body).toBe(404);
    }
    const blocked = await resolve('ZZZ ZZZ 999', source);
    expect(blocked.statusCode, blocked.body).toBe(429);
    const retryAfter = Number(blocked.headers['retry-after']);
    expect(retryAfter).toBeGreaterThanOrEqual(1);
    expect(retryAfter).toBeLessThanOrEqual(TEN_MINUTES_SECONDS);
    expect(blocked.json().error.retryAfterSeconds).toBe(retryAfter);

    const correctAfterExhaustion = await resolve(CLASS_A_CODE, source);
    expect(correctAfterExhaustion.statusCode, correctAfterExhaustion.body).toBe(200);
  });

  it('limits the sixth invalid exact class/candidate attempt without blocking another correct code', async () => {
    const source = '203.0.113.14';
    for (let index = 0; index < 5; index += 1) {
      const rejected = await signIn(CLASS_A_CODE, '0000', source);
      expect(rejected.statusCode, rejected.body).toBe(401);
    }
    const blocked = await signIn(CLASS_A_CODE, '0000', source);
    expect(blocked.statusCode, blocked.body).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);

    const correct = await signIn(CLASS_A_CODE, seats[0].code, source);
    expect(correct.statusCode, correct.body).toBe(200);
  });

  it('limits the 181st invalid source+class attempt while a correct class credential still passes', async () => {
    const source = '203.0.113.15';
    for (let index = 0; index < 180; index += 1) {
      const rejected = await signIn(CLASS_A_CODE, candidate(index, 'C'), source);
      expect(rejected.statusCode, `attempt=${index} ${rejected.body}`).toBe(401);
    }
    const blocked = await signIn(CLASS_A_CODE, candidate(180, 'C'), source);
    expect(blocked.statusCode, blocked.body).toBe(429);

    const correct = await signIn(CLASS_A_CODE, seats[1].code, source);
    expect(correct.statusCode, correct.body).toBe(200);
  });

  it('limits the 301st invalid source-global attempt without turning a correct credential into 429', async () => {
    const source = '203.0.113.16';

    for (let index = 0; index < 30; index += 1) {
      const accepted = await signIn(CLASS_A_CODE, seats[index].code, source);
      expect(accepted.statusCode, accepted.body).toBe(200);
    }

    for (let index = 0; index < 150; index += 1) {
      const rejected = await signIn(CLASS_A_CODE, candidate(index, 'G'), source);
      expect(rejected.statusCode, `classA attempt=${index} ${rejected.body}`).toBe(401);
    }
    for (let index = 0; index < 150; index += 1) {
      const rejected = await signIn(CLASS_B_CODE, candidate(index, 'H'), source);
      expect(rejected.statusCode, `classB attempt=${index} ${rejected.body}`).toBe(401);
    }

    const blocked = await signIn(CLASS_A_CODE, candidate(151, 'I'), source);
    expect(blocked.statusCode, blocked.body).toBe(429);

    const correct = await signIn(CLASS_A_CODE, seats[2].code, source);
    expect(correct.statusCode, correct.body).toBe(200);
  });

  it('does not let an untrusted peer rotate source buckets with X-Forwarded-For', async () => {
    const remoteAddress = '198.51.100.77';
    for (let index = 0; index < 60; index += 1) {
      const rejected = await inject(app, {
        method: 'POST',
        url: '/api/class-join/resolve',
        remoteAddress,
        headers: { 'x-forwarded-for': `203.0.113.${(index % 200) + 1}` },
        payload: { code: 'ZZZ ZZZ 999' },
      });
      expect(rejected.statusCode, rejected.body).toBe(404);
    }
    const blocked = await inject(app, {
      method: 'POST',
      url: '/api/class-join/resolve',
      remoteAddress,
      headers: { 'x-forwarded-for': '192.0.2.200' },
      payload: { code: 'ZZZ ZZZ 999' },
    });
    expect(blocked.statusCode, blocked.body).toBe(429);
  });

  it('accepts forwarded source only from an explicitly trusted ingress range', async () => {
    process.env.ASA_TRUSTED_PROXY_CIDRS = '172.16.0.0/12';
    const remoteAddress = '172.21.0.4';
    for (let index = 0; index < 60; index += 1) {
      const rejected = await inject(app, {
        method: 'POST',
        url: '/api/class-join/resolve',
        remoteAddress,
        headers: { 'x-forwarded-for': '203.0.113.201' },
        payload: { code: 'ZZZ ZZZ 999' },
      });
      expect(rejected.statusCode, rejected.body).toBe(404);
    }
    const blocked = await inject(app, {
      method: 'POST',
      url: '/api/class-join/resolve',
      remoteAddress,
      headers: { 'x-forwarded-for': '203.0.113.201' },
      payload: { code: 'ZZZ ZZZ 999' },
    });
    expect(blocked.statusCode, blocked.body).toBe(429);

    const separateTrustedVisitor = await inject(app, {
      method: 'POST',
      url: '/api/class-join/resolve',
      remoteAddress,
      headers: { 'x-forwarded-for': '203.0.113.202' },
      payload: { code: 'ZZZ ZZZ 999' },
    });
    expect(separateTrustedVisitor.statusCode, separateTrustedVisitor.body).toBe(404);
  });

  it('keeps invalid StudentSeat errors generic and Student Codes case-sensitive', async () => {
    const source = '203.0.113.17';
    const nonexistent = await signIn(CLASS_A_CODE, 'Z000', source);
    const otherClassSeat = await signIn(CLASS_A_CODE, 'B7kQ2', source);
    expect(nonexistent.statusCode, nonexistent.body).toBe(401);
    expect(otherClassSeat.statusCode, otherClassSeat.body).toBe(401);
    expect(otherClassSeat.json()).toEqual(nonexistent.json());

    const wrongCase = await signIn(CLASS_A_CODE, 'ab7k', source);
    expect(wrongCase.statusCode, wrongCase.body).toBe(401);
    const exactCase = await signIn(CLASS_A_CODE, ' Ab7k ', source);
    expect(exactCase.statusCode, exactCase.body).toBe(200);
  });
});
