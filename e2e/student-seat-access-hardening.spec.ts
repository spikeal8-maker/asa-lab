import { expect, test } from '@playwright/test';

const ORIGIN = 'http://127.0.0.1:4612';

test.describe('E1-FIX-01 StudentSeat admission behind one NAT', () => {
  test('30 sequential, 30 parallel, and 30x4 typo recovery stay open for correct credentials', async ({
    page,
  }) => {
    test.setTimeout(90_000);

    const id = crypto.randomUUID().replaceAll('-', '');
    const register = await page.request.post('/api/auth/register', {
      headers: { origin: ORIGIN },
      data: {
        email: `${id}@student-seat-e1.test`,
        username: `seat_e1_${id.slice(0, 20)}`,
        displayName: 'StudentSeat E1 Teacher',
        password: `Safe-${id}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    });
    expect(register.status(), await register.text()).toBe(201);

    const attest = await page.request.post('/api/capabilities/educator/self-attest', {
      headers: { origin: ORIGIN },
      data: {},
    });
    expect(attest.status(), await attest.text()).toBe(201);

    const createClass = await page.request.post('/api/classrooms', {
      headers: {
        origin: ORIGIN,
        'idempotency-key': `student-seat-e1-${crypto.randomUUID()}`,
      },
      data: {
        title: 'StudentSeat E1 NAT',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      },
    });
    expect(createClass.status(), await createClass.text()).toBe(201);
    const classId = (await createClass.json()).classroom.id as string;

    const classView = await page.request.get(`/api/classrooms/${classId}`);
    expect(classView.status(), await classView.text()).toBe(200);
    const classCode = (await classView.json()).classroom.joinCode as string;

    const students: Array<{ id: string; studentCode: string }> = [];
    for (let index = 0; index < 30; index += 1) {
      const added = await page.request.post(`/api/classrooms/${classId}/seats`, {
        headers: { origin: ORIGIN },
        data: { displayLabel: `NAT Learner ${index + 1}`, safeMode: true },
      });
      expect(added.status(), await added.text()).toBe(201);
      students.push((await added.json()).student);
    }

    for (const student of students) {
      const resolved = await page.request.post('/api/class-join/resolve', {
        headers: { origin: ORIGIN },
        data: { code: classCode },
      });
      expect(resolved.status(), await resolved.text()).toBe(200);

      const signedIn = await page.request.post('/api/class-join/studentseat', {
        headers: { origin: ORIGIN },
        data: { code: classCode, studentCode: student.studentCode },
      });
      expect(signedIn.status(), await signedIn.text()).toBe(200);
    }

    const parallel = await Promise.all(
      students.map(async (student) => {
        const resolved = await page.request.post('/api/class-join/resolve', {
          headers: { origin: ORIGIN },
          data: { code: classCode },
        });
        const signedIn = await page.request.post('/api/class-join/studentseat', {
          headers: { origin: ORIGIN },
          data: { code: classCode, studentCode: student.studentCode },
        });
        return [resolved.status(), signedIn.status()];
      }),
    );
    expect(parallel).toEqual(Array.from({ length: 30 }, () => [200, 200]));

    for (const [learnerIndex, student] of students.entries()) {
      for (let attempt = 0; attempt < 4; attempt += 1) {
        const wrongCode =
          '0' + (learnerIndex * 4 + attempt).toString(36).toUpperCase().padStart(3, '0');
        const rejected = await page.request.post('/api/class-join/studentseat', {
          headers: { origin: ORIGIN },
          data: { code: classCode, studentCode: wrongCode },
        });
        expect(rejected.status(), await rejected.text()).toBe(401);
      }

      const recovered = await page.request.post('/api/class-join/studentseat', {
        headers: { origin: ORIGIN },
        data: { code: classCode, studentCode: student.studentCode },
      });
      expect(recovered.status(), await recovered.text()).toBe(200);
    }
  });
});
