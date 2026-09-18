import { expect, test, type Locator, type Page } from '@playwright/test';
import jsQR from 'jsqr';
import { mkdirSync, writeFileSync } from 'node:fs';
import { e2eAdminPool } from './seed';

const origin = 'http://127.0.0.1:4612';
const evidence = 'e2e/artifacts/owner-preview/e1-fix-03/after';

async function renderedPixels(page: Page, locator: Locator) {
  const png = await locator.screenshot();
  const base64 = png.toString('base64');
  const image = await page.evaluate(async (encoded) => {
    const element = new Image();
    element.src = `data:image/png;base64,${encoded}`;
    await element.decode();
    const canvas = document.createElement('canvas');
    canvas.width = element.naturalWidth;
    canvas.height = element.naturalHeight;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('2D canvas unavailable');
    context.drawImage(element, 0, 0);
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    return { width: canvas.width, height: canvas.height, data: Array.from(data) };
  }, base64);
  return { ...image, png };
}

function decodePixels(
  image: { width: number; height: number; data: number[] },
  monochrome = false,
): string {
  const pixels = Uint8ClampedArray.from(image.data);
  if (monochrome) {
    for (let index = 0; index < pixels.length; index += 4) {
      const luminance =
        pixels[index] * 0.299 + pixels[index + 1] * 0.587 + pixels[index + 2] * 0.114;
      const value = luminance >= 128 ? 255 : 0;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  const decoded = jsQR(pixels, image.width, image.height, { inversionAttempts: 'attemptBoth' });
  expect(decoded, 'independent jsQR decoder must read rendered QR pixels').not.toBeNull();
  return decoded!.data;
}

function expectQuietZone(image: { width: number; height: number; data: number[] }) {
  const pixels = image.data;
  const sample = (x: number, y: number) => {
    const offset = (y * image.width + x) * 4;
    return pixels.slice(offset, offset + 3);
  };
  for (let x = 0; x < image.width; x += 1) {
    for (const y of [0, 1, image.height - 2, image.height - 1]) {
      expect(sample(x, y).every((value) => value >= 245)).toBe(true);
    }
  }
  for (let y = 0; y < image.height; y += 1) {
    for (const x of [0, 1, image.width - 2, image.width - 1]) {
      expect(sample(x, y).every((value) => value >= 245)).toBe(true);
    }
  }
}

async function snapshot(classId: string) {
  const admin = e2eAdminPool();
  try {
    const seats = await admin.query(
      `SELECT seat.id, seat.login_handle AS student_code, seat.status,
              credential.version AS credential_version,
              link.learner_identity_id,
              (SELECT count(*)::int
                 FROM classroom_student_sessions session
                WHERE session.seat_id=seat.id AND session.revoked_at IS NULL) AS active_sessions
         FROM classroom_student_seats seat
         LEFT JOIN classroom_seat_credentials credential ON credential.seat_id=seat.id
         LEFT JOIN learner_identity_links link ON link.seat_id=seat.id AND link.status='active'
        WHERE seat.classroom_id=$1
        ORDER BY seat.id`,
      [classId],
    );
    const history = await admin.query(
      `WITH seat_ids AS (
           SELECT id FROM classroom_student_seats WHERE classroom_id=$1
         ), learner_ids AS (
           SELECT learner_identity_id FROM learner_identity_links
            WHERE seat_id IN (SELECT id FROM seat_ids) AND status='active'
         ), attempt_ids AS (
           SELECT id FROM learning_attempts WHERE seat_id IN (SELECT id FROM seat_ids)
         )
         SELECT
           (SELECT count(*)::int FROM course_enrollments
             WHERE learner_identity_id IN (SELECT learner_identity_id FROM learner_ids)) AS enrollments,
           (SELECT count(*)::int FROM activity_participations
             WHERE learner_identity_id IN (SELECT learner_identity_id FROM learner_ids)) AS participations,
           (SELECT count(*)::int FROM learning_attempts
             WHERE id IN (SELECT id FROM attempt_ids)) AS attempts,
           (SELECT count(*)::int FROM learning_submissions
             WHERE attempt_id IN (SELECT id FROM attempt_ids)) AS submissions,
           (SELECT count(*)::int FROM assessment_results
             WHERE attempt_id IN (SELECT id FROM attempt_ids)) AS results`,
      [classId],
    );
    return { seats: seats.rows, history: history.rows[0] };
  } finally {
    await admin.end();
  }
}

test('E1-FIX-03 class-only QR survives deep-link, print, reprint and rotation', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  mkdirSync(evidence, { recursive: true });
  const id = crypto.randomUUID().replaceAll('-', '');
  const teacherEmail = `${id}@e1fix03.test`;

  const registered = await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      email: teacherEmail,
      username: `qr_fix_${id.slice(0, 18)}`,
      displayName: 'QR E1-FIX-03 Teacher',
      password: `Safe-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(registered.status(), await registered.text()).toBe(201);
  const teacherAccountId = (await registered.json()).user.id as string;
  expect(
    (
      await page.request.post('/api/capabilities/educator/self-attest', {
        headers: { origin },
        data: {},
      })
    ).status(),
  ).toBe(201);

  const classTitle = '7А — Очень длинное название синтетического класса для проверки печати';
  const created = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': `e1fix03-${crypto.randomUUID()}` },
    data: { title: classTitle, ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
  });
  expect(created.status(), await created.text()).toBe(201);
  const classId = (await created.json()).classroom.id as string;
  const classView = await page.request.get(`/api/classrooms/${classId}`);
  expect(classView.status(), await classView.text()).toBe(200);
  const classCodeA = (await classView.json()).classroom.joinCode as string;

  const students: Array<{ id: string; studentCode: string }> = [];
  for (let index = 0; index < 10; index += 1) {
    const seat = await page.request.post(`/api/classrooms/${classId}/seats`, {
      headers: { origin },
      data: {
        displayLabel:
          index === 0
            ? 'Александра Очень-Длинная-Фамилия-Составная Для Проверки Карточки'
            : `Синтетический ученик ${index + 1}`,
        safeMode: true,
      },
    });
    expect(seat.status(), await seat.text()).toBe(201);
    students.push((await seat.json()).student);
  }

  const learnerContext = await browser.newContext();
  const activeSession = await learnerContext.request.post(`${origin}/api/class-join/studentseat`, {
    headers: { origin },
    data: { code: classCodeA, studentCode: students[0].studentCode },
  });
  expect(activeSession.status(), await activeSession.text()).toBe(200);

  const stateBefore = await snapshot(classId);
  expect(stateBefore.seats.some((seat) => Number(seat.active_sessions) === 1)).toBe(true);
  const rosterBeforeResponse = await page.request.get(`/api/classrooms/${classId}/roster`);
  expect(rosterBeforeResponse.status(), await rosterBeforeResponse.text()).toBe(200);
  const rosterBefore = await rosterBeforeResponse.json();

  await page.setViewportSize({ width: 1440, height: 1000 });
  const openCards = async () => {
    await page.goto(`${origin}/#/classrooms/${classId}`);
    await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Карточки доступа' });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('.student-access-card')).toHaveCount(10);
    return dialog;
  };

  let dialog = await openCards();
  await expect(dialog).toContainText('asa-lab.ru');
  await expect(dialog).not.toContainText('Asolab.ru');
  await expect(dialog.getByText('/#/join-class', { exact: false })).toHaveCount(0);
  await expect(dialog.getByText('https://', { exact: false })).toHaveCount(0);
  await dialog.screenshot({ path: `${evidence}/dialog.png` });

  const firstCard = dialog.locator('.student-access-card').first();
  await firstCard.screenshot({ path: `${evidence}/card.png` });
  const firstQr = firstCard.getByTestId('class-join-qr');
  const renderedA = await renderedPixels(page, firstQr);
  const decodedA = decodePixels(renderedA);
  expectQuietZone(renderedA);
  expect(decodePixels(renderedA, true)).toBe(decodedA);
  writeFileSync(`${evidence}/qr-a.png`, renderedA.png);

  const parsedA = new URL(decodedA);
  expect(parsedA.protocol).toBe('https:');
  expect(parsedA.host).toBe('asa-lab.ru');
  expect(parsedA.origin).toBe('https://asa-lab.ru');
  expect(parsedA.hash.startsWith('#/join-class?')).toBe(true);
  expect(new URLSearchParams(parsedA.hash.split('?')[1]).get('code')).toBe(classCodeA);
  expect(decodedA).toBe(
    `https://asa-lab.ru/#/join-class?code=${encodeURIComponent(classCodeA)}`,
  );
  expect(decodedA).not.toContain(teacherEmail);
  expect(decodedA).not.toContain(teacherAccountId);
  for (const student of students) {
    expect(decodedA).not.toContain(student.id);
    expect(decodedA).not.toContain(student.studentCode);
  }

  const deepContext = await browser.newContext();
  const deepPage = await deepContext.newPage();
  await deepPage.goto(`${origin}/${parsedA.hash}`);
  await expect(deepPage.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await expect(deepPage.getByLabel('Код класса', { exact: true })).toHaveCount(0);
  await expect(deepPage.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
  await expect(deepPage.getByText(classTitle, { exact: true })).toBeVisible();
  await deepPage.getByLabel('Код ученика', { exact: true }).fill(students[1].studentCode);
  const deepLogin = deepPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/class-join/studentseat') &&
      response.request().method() === 'POST',
  );
  await deepPage.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await deepLogin).status()).toBe(200);
  await deepPage.screenshot({ path: `${evidence}/deep-link-signed-in.png`, fullPage: true });
  await deepContext.close();

  const manualContext = await browser.newContext();
  const manualPage = await manualContext.newPage();
  await manualPage.goto(`${origin}/#/join-class`);
  await expect(manualPage.getByLabel('Код класса', { exact: true })).toBeVisible();
  await manualPage.getByLabel('Код класса', { exact: true }).fill(classCodeA);
  await manualPage.getByRole('button', { name: 'Продолжить', exact: true }).click();
  await expect(manualPage.getByLabel('Код ученика', { exact: true })).toBeVisible();
  await manualPage.getByLabel('Код ученика', { exact: true }).fill(students[2].studentCode);
  const manualLogin = manualPage.waitForResponse(
    (response) =>
      response.url().endsWith('/api/class-join/studentseat') &&
      response.request().method() === 'POST',
  );
  await manualPage.getByRole('button', { name: 'Войти', exact: true }).click();
  expect((await manualLogin).status()).toBe(200);
  await manualContext.close();

  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  dialog = await openCards();
  await page.evaluate(() => {
    Object.defineProperty(window, 'print', {
      configurable: true,
      value: () => {
        const current = (window as Window & { __e1PrintCalls?: number }).__e1PrintCalls ?? 0;
        (window as Window & { __e1PrintCalls?: number }).__e1PrintCalls = current + 1;
      },
    });
  });
  await dialog.getByRole('button', { name: /^Распечатать/ }).click();
  await expect
    .poll(() =>
      page.evaluate(() => (window as Window & { __e1PrintCalls?: number }).__e1PrintCalls ?? 0),
    )
    .toBe(1);
  await page.waitForTimeout(1600);

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('student-access-printing'));
  const printSheet = page.locator('.student-access-print-sheet');
  const geometry = await printSheet.evaluate((sheet) => {
    const cards = Array.from(sheet.querySelectorAll<HTMLElement>('.student-access-card'));
    const rows = new Map<number, number>();
    const rects = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const y = Math.round(rect.y);
      rows.set(y, (rows.get(y) ?? 0) + 1);
      return {
        breakInside: getComputedStyle(card).breakInside,
        borderStyle: getComputedStyle(card).borderStyle,
        overflowX: card.scrollWidth - card.clientWidth,
        overflowY: card.scrollHeight - card.clientHeight,
      };
    });
    const first = cards[0];
    const copy = first.querySelector<HTMLElement>('.student-access-card-copy')!;
    const qr = first.querySelector<HTMLElement>('.student-access-qr')!;
    const codes = first.querySelectorAll<HTMLElement>('.student-access-codes code');
    const stylesheetText = Array.from(document.styleSheets)
      .map((stylesheet) => {
        try {
          return Array.from(stylesheet.cssRules)
            .map((rule) => rule.cssText)
            .join('\n');
        } catch {
          return '';
        }
      })
      .join('\n')
      .toLowerCase();
    return {
      rows: [...rows.values()],
      rects,
      qrRightOfCopy: qr.getBoundingClientRect().left >= copy.getBoundingClientRect().right - 1,
      classCodeFont: Number.parseFloat(getComputedStyle(codes[0]).fontSize),
      studentCodeFont: Number.parseFloat(getComputedStyle(codes[1]).fontSize),
      stylesheetText,
    };
  });
  expect(geometry.rows).toEqual([2, 2, 2, 2, 2]);
  expect(geometry.rects.every((rect) => rect.breakInside === 'avoid')).toBe(true);
  expect(geometry.rects.every((rect) => rect.borderStyle === 'dashed')).toBe(true);
  expect(geometry.rects.every((rect) => rect.overflowX <= 0 && rect.overflowY <= 1)).toBe(true);
  expect(geometry.qrRightOfCopy).toBe(true);
  expect(geometry.studentCodeFont).toBeGreaterThan(geometry.classCodeFont);
  expect(geometry.stylesheetText).toContain('@page');
  expect(geometry.stylesheetText).toContain('size: a4 portrait');
  const printQr = await renderedPixels(page, firstQr);
  expect(decodePixels(printQr, true)).toBe(decodedA);
  writeFileSync(`${evidence}/print-qr.png`, printQr.png);
  await page.screenshot({ path: `${evidence}/print-sheet.png`, fullPage: true });

  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => document.body.classList.remove('student-access-printing'));
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  expect(await snapshot(classId)).toEqual(stateBefore);
  const rosterAfterPrint = await page.request.get(`/api/classrooms/${classId}/roster`);
  expect(await rosterAfterPrint.json()).toEqual(rosterBefore);

  const rotated = await page.request.post(`/api/classrooms/${classId}/join-code/rotate`, {
    headers: { origin },
  });
  expect(rotated.status(), await rotated.text()).toBe(201);
  const classCodeB = (await rotated.json()).classroom.joinCode as string;
  expect(classCodeB).not.toBe(classCodeA);
  const oldResolve = await page.request.post('/api/class-join/resolve', {
    headers: { origin },
    data: { code: classCodeA },
  });
  expect(oldResolve.status(), await oldResolve.text()).toBe(404);
  const newResolve = await page.request.post('/api/class-join/resolve', {
    headers: { origin },
    data: { code: classCodeB },
  });
  expect(newResolve.status(), await newResolve.text()).toBe(200);

  dialog = await openCards();
  const rotatedCard = dialog.locator('.student-access-card').first();
  const renderedB = await renderedPixels(page, rotatedCard.getByTestId('class-join-qr'));
  const decodedB = decodePixels(renderedB);
  expect(decodedB).toBe(
    `https://asa-lab.ru/#/join-class?code=${encodeURIComponent(classCodeB)}`,
  );
  expect(decodedB).not.toBe(decodedA);
  for (const student of students) expect(decodedB).not.toContain(student.studentCode);
  await rotatedCard.screenshot({ path: `${evidence}/rotated-card.png` });
  writeFileSync(`${evidence}/qr-b.png`, renderedB.png);

  const rosterAfterRotation = await page.request.get(`/api/classrooms/${classId}/roster`);
  const rotatedRoster = await rosterAfterRotation.json();
  expect(
    rotatedRoster.students.map((student: { id: string; studentCode: string }) => ({
      id: student.id,
      studentCode: student.studentCode,
    })),
  ).toEqual(
    rosterBefore.students.map((student: { id: string; studentCode: string }) => ({
      id: student.id,
      studentCode: student.studentCode,
    })),
  );
  expect(await snapshot(classId)).toEqual(stateBefore);

  writeFileSync(
    `${evidence}/evidence.json`,
    JSON.stringify(
      {
        decoder: 'jsqr@1.4.0 over Playwright-rendered QR pixels',
        classCodeA,
        decodedA,
        classCodeB,
        decodedB,
        deepLink: 'PASS',
        manualPath: 'PASS',
        reprintNonMutation: 'PASS',
        printRows: geometry.rows,
        cameraScan: 'not_run',
      },
      null,
      2,
    ),
  );
  await learnerContext.close();
});
