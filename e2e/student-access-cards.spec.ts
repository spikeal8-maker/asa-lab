import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import jsQR from 'jsqr';
import { PNG } from 'pngjs';
import { e2eAdminPool } from './seed';

const origin = 'http://127.0.0.1:4612';
const evidence = 'e2e/artifacts/owner-preview/e1-fix-03/after';
const admin = e2eAdminPool();

test.describe.configure({ mode: 'serial' });
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
test.afterAll(async () => {
  await admin.end();
});

async function decodeRenderedQr(qr: Locator, path?: string): Promise<string> {
  const pngBytes = await qr.screenshot(path ? { path } : undefined);
  const png = PNG.sync.read(pngBytes);
  const rgba = new Uint8ClampedArray(png.data.buffer, png.data.byteOffset, png.data.byteLength);
  const decoded = jsQR(rgba, png.width, png.height, { inversionAttempts: 'dontInvert' });
  expect(decoded, 'rendered QR must decode independently from qrcode-generator').not.toBeNull();

  // The rendered SVG owns a white quiet zone. Prove it survived rasterization
  // instead of trusting the encoder's module matrix or React props.
  const border = Math.min(4, Math.floor(Math.min(png.width, png.height) / 8));
  let quietZoneIntact = true;
  for (let y = 0; y < png.height && quietZoneIntact; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      if (x >= border && x < png.width - border && y >= border && y < png.height - border) continue;
      const offset = (y * png.width + x) * 4;
      if (rgba[offset]! < 245 || rgba[offset + 1]! < 245 || rgba[offset + 2]! < 245) {
        quietZoneIntact = false;
        break;
      }
    }
  }
  expect(quietZoneIntact, 'rendered QR quiet zone must not be cropped').toBe(true);

  // Print acceptance is monochrome. Threshold the rendered pixels to strict
  // black/white and independently decode again.
  const monochrome = new Uint8ClampedArray(rgba.length);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const luminance =
      rgba[offset]! * 0.2126 + rgba[offset + 1]! * 0.7152 + rgba[offset + 2]! * 0.0722;
    const value = luminance < 160 ? 0 : 255;
    monochrome[offset] = value;
    monochrome[offset + 1] = value;
    monochrome[offset + 2] = value;
    monochrome[offset + 3] = 255;
  }
  const monochromeDecoded = jsQR(monochrome, png.width, png.height, {
    inversionAttempts: 'dontInvert',
  });
  expect(monochromeDecoded?.data, 'monochrome rendered QR must remain decodable').toBe(
    decoded!.data,
  );
  return decoded!.data;
}

async function registerTeacher(page: Page): Promise<void> {
  const id = crypto.randomUUID().replaceAll('-', '');
  const response = await page.request.post('/api/auth/register', {
    headers: { origin },
    data: {
      email: `${id}@e1fix03.test`,
      username: `e1fix03_${id.slice(0, 20)}`,
      displayName: 'E1 FIX 03 Teacher',
      password: `Safe-${id}-Password`,
      birthDate: '1990-04-12',
      country: 'RU',
    },
  });
  expect(response.status(), await response.text()).toBe(201);

  const attest = await page.request.post('/api/capabilities/educator/self-attest', {
    headers: { origin },
    data: {},
  });
  expect(attest.status(), await attest.text()).toBe(201);
}

async function classState(classroomId: string) {
  const result = await admin.query(
    `SELECT
       COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'seatId', s.id,
             'studentCode', s.login_handle,
             'status', s.status,
             'credentialVersion', cred.version
           )
           ORDER BY s.id
         )
         FROM classroom_student_seats s
         JOIN classroom_seat_credentials cred ON cred.seat_id=s.id
         WHERE s.classroom_id=$1
       ), '[]'::jsonb) AS seat_credentials,
       COALESCE((
         SELECT jsonb_agg(
           jsonb_build_object(
             'seatId', link.seat_id,
             'learnerIdentityId', link.learner_identity_id,
             'status', link.status
           )
           ORDER BY link.seat_id
         )
         FROM learner_identity_links link
         JOIN classroom_student_seats s ON s.id=link.seat_id
         WHERE s.classroom_id=$1
       ), '[]'::jsonb) AS learner_identities,
       (
         SELECT count(*)::int
         FROM classroom_student_sessions session
         JOIN classroom_student_seats s ON s.id=session.seat_id
         WHERE s.classroom_id=$1 AND session.revoked_at IS NULL AND session.expires_at > now()
       ) AS active_sessions,
       (
         SELECT count(*)::int
         FROM course_enrollments enrollment
         JOIN learner_identity_links link ON link.learner_identity_id=enrollment.learner_identity_id
         JOIN classroom_student_seats s ON s.id=link.seat_id
         WHERE s.classroom_id=$1
       ) AS enrollments,
       (
         SELECT count(*)::int FROM learning_attempts attempt WHERE attempt.classroom_id=$1
       ) AS attempts,
       (
         SELECT count(*)::int
         FROM learning_submissions submission
         JOIN learning_attempts attempt ON attempt.id=submission.attempt_id
         WHERE attempt.classroom_id=$1
       ) AS submissions,
       (
         SELECT count(*)::int
         FROM assessment_results result
         JOIN learning_attempts attempt ON attempt.id=result.attempt_id
         WHERE attempt.classroom_id=$1
       ) AS results`,
    [classroomId],
  );
  return result.rows[0];
}

async function openCards(page: Page, classroomId: string) {
  await page.goto(`/#/classrooms/${classroomId}`);
  await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Карточки доступа' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId('class-join-qr').first()).toBeVisible();
  return dialog;
}

async function signInFromRoute(
  browser: Browser,
  route: string,
  classCode: string,
  studentCode: string,
  manual: boolean,
): Promise<void> {
  const context = await browser.newContext({ baseURL: origin });
  try {
    const page = await context.newPage();
    await page.goto(route);

    if (manual) {
      await expect(page.getByLabel('Код класса', { exact: true })).toBeVisible();
      await page.getByLabel('Код класса', { exact: true }).fill(classCode);
      await page.getByRole('button', { name: 'Продолжить', exact: true }).click();
    } else {
      await expect(page.getByLabel('Код класса', { exact: true })).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Продолжить', exact: true })).toHaveCount(0);
    }

    await expect(page.getByLabel('Код ученика', { exact: true })).toBeVisible();
    await page.getByLabel('Код ученика', { exact: true }).fill(studentCode);
    const loginResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/class-join/studentseat') &&
        response.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    expect((await loginResponse).status()).toBe(200);
  } finally {
    await context.close();
  }
}

test('Issue #272: class-only QR decodes independently, deep-links, rotates and reprints read-only', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await registerTeacher(page);

  const createClass = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': `e1fix03-${crypto.randomUUID()}` },
    data: {
      title: '7А — Очень длинное название синтетического класса для проверки печати',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(createClass.status(), await createClass.text()).toBe(201);
  const classroomId = (await createClass.json()).classroom.id as string;

  const initialClass = await page.request.get(`/api/classrooms/${classroomId}`);
  expect(initialClass.status(), await initialClass.text()).toBe(200);
  const classCodeA = (await initialClass.json()).classroom.joinCode as string;

  const students: Array<{ id: string; studentCode: string }> = [];
  for (let index = 0; index < 10; index += 1) {
    const seat = await page.request.post(`/api/classrooms/${classroomId}/seats`, {
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

  await page.setViewportSize({ width: 1440, height: 1000 });
  let cards = await openCards(page, classroomId);
  const portalOrigin = await page.evaluate(() => window.location.origin);
  await expect(cards.locator('.student-access-card')).toHaveCount(10);
  await expect(cards).toContainText(new URL(portalOrigin).host);
  await expect(cards).not.toContainText('asa-lab.ru');
  await expect(cards.getByText('https://', { exact: false })).toHaveCount(0);
  await expect(cards.getByText('/#/join-class', { exact: false })).toHaveCount(0);

  const firstCard = cards
    .locator('.student-access-card')
    .filter({ hasText: students[0]!.studentCode })
    .first();
  const decodedA = await decodeRenderedQr(
    firstCard.getByTestId('class-join-qr'),
    `${evidence}/qr-a.png`,
  );
  const urlA = new URL(decodedA);
  expect(urlA.origin).toBe(portalOrigin);
  expect(urlA.hash.split('?')[0]).toBe('#/join-class');
  expect(new URLSearchParams(urlA.hash.split('?')[1] ?? '').get('code')).toBe(classCodeA);
  for (const student of students) expect(decodedA).not.toContain(student.studentCode);

  await cards.screenshot({ path: `${evidence}/dialog.png` });
  await firstCard.screenshot({ path: `${evidence}/card.png` });

  // Exercise the live card DOM with the actual print stylesheet. The second case
  // substitutes a representative portable ingress host while keeping the ten-card grid.
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('student-access-printing'));
  for (const host of [
    new URL(portalOrigin).host,
    'classroom-really-long-installation-name.example.org',
  ]) {
    const layout = await page.evaluate((printedHost) => {
      const sheet = document.querySelector<HTMLElement>('.student-access-print-sheet')!;
      const cards = Array.from(sheet.querySelectorAll<HTMLElement>('.student-access-card'));
      for (const card of cards) {
        card.querySelector<HTMLElement>('.student-access-card-copy > header span')!.textContent =
          printedHost;
        card.querySelector<HTMLElement>('.student-access-instruction')!.textContent =
          `Вручную: ${printedHost} → код класса → код ученика.`;
      }
      const sheetBounds = sheet.getBoundingClientRect();
      return {
        sheetWidth: sheetBounds.width,
        gridColumns: getComputedStyle(sheet).gridTemplateColumns.split(' ').length,
        cards: cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const copy = card.querySelector<HTMLElement>('.student-access-card-copy')!;
          const instruction = card.querySelector<HTMLElement>('.student-access-instruction')!;
          const hostLabel = card.querySelector<HTMLElement>(
            '.student-access-card-copy > header span',
          )!;
          const qr = card.querySelector<HTMLElement>('.class-qr')!;
          return {
            left: bounds.left,
            right: bounds.right,
            top: bounds.top,
            bottom: bounds.bottom,
            verticalOverflow: card.scrollHeight - card.clientHeight,
            copyBottom: copy.getBoundingClientRect().bottom,
            instructionBottom: instruction.getBoundingClientRect().bottom,
            hostOverflow: hostLabel.scrollWidth - hostLabel.clientWidth,
            qrBottom: qr.getBoundingClientRect().bottom,
          };
        }),
      };
    }, host);
    const mm = 96 / 25.4;
    expect(layout.cards, `${host}: ten printable cards`).toHaveLength(10);
    expect(layout.gridColumns, `${host}: two print columns`).toBe(2);
    expect(layout.sheetWidth, `${host}: A4 printable width`).toBeLessThanOrEqual(196 * mm + 2);
    for (let row = 0; row < 5; row += 1) {
      const left = layout.cards[row * 2]!;
      const right = layout.cards[row * 2 + 1]!;
      expect(left.left, `${host}: row ${row} left card`).toBeLessThan(right.left);
      expect(Math.abs(left.top - right.top), `${host}: row ${row} alignment`).toBeLessThanOrEqual(
        1,
      );
      if (row > 0) {
        expect(left.top, `${host}: row ${row} follows previous row`).toBeGreaterThanOrEqual(
          layout.cards[(row - 1) * 2]!.bottom,
        );
      }
    }
    expect(
      layout.cards[9]!.bottom - layout.cards[0]!.top,
      `${host}: A4 portrait height`,
    ).toBeLessThanOrEqual(283 * mm);
    for (const [index, card] of layout.cards.entries()) {
      expect(
        card.verticalOverflow,
        `${host}: card ${index} vertical overflow ${JSON.stringify(card)}`,
      ).toBeLessThanOrEqual(1);
      expect(card.copyBottom, `${host}: card ${index} copy containment`).toBeLessThanOrEqual(
        card.bottom - 1,
      );
      expect(
        card.instructionBottom,
        `${host}: card ${index} instruction containment`,
      ).toBeLessThanOrEqual(card.bottom - 1);
      expect(card.qrBottom, `${host}: card ${index} QR containment`).toBeLessThanOrEqual(
        card.bottom - 1,
      );
      expect(card.hostOverflow, `${host}: card ${index} complete host`).toBeLessThanOrEqual(1);
    }
    if (host.startsWith('classroom-really')) {
      await page
        .locator('.student-access-card')
        .first()
        .screenshot({ path: `${evidence}/card-print-long-host.png` });
    }
  }
  await page.evaluate((host) => {
    for (const card of document.querySelectorAll<HTMLElement>('.student-access-card')) {
      card.querySelector<HTMLElement>('.student-access-card-copy > header span')!.textContent =
        host;
      card.querySelector<HTMLElement>('.student-access-instruction')!.textContent =
        `Вручную: ${host} → код класса → код ученика.`;
    }
    document.body.classList.remove('student-access-printing');
  }, new URL(portalOrigin).host);
  await page.emulateMedia({ media: 'screen' });

  // Exact current portal origin is proven by independent decode above. Route behavior
  // is then exercised against the isolated local test server using that exact hash.
  await signInFromRoute(
    browser,
    `${origin}/${urlA.hash}`,
    classCodeA,
    students[0]!.studentCode,
    false,
  );
  await signInFromRoute(
    browser,
    `${origin}/#/join-class`,
    classCodeA,
    students[1]!.studentCode,
    true,
  );

  const stateBeforeReprint = await classState(classroomId);
  const rosterBefore = await (
    await page.request.get(`/api/classrooms/${classroomId}/roster`)
  ).json();

  await cards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
  cards = await openCards(page, classroomId);
  await page.evaluate(() => {
    window.print = () => undefined;
  });
  await cards.getByRole('button', { name: /^Распечатать/ }).click();

  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('student-access-printing'));
  const printGeometry = await page.locator('.student-access-print-sheet').evaluate((sheet) => {
    const cards = Array.from(sheet.querySelectorAll<HTMLElement>('.student-access-card'));
    const boxes = cards.map((card) => {
      const rect = card.getBoundingClientRect();
      const qr = card.querySelector<HTMLElement>('.student-access-qr')?.getBoundingClientRect();
      const heading = card.querySelector<HTMLElement>('h3');
      const classCode = card.querySelector<HTMLElement>(
        '.student-access-codes > div:not(.student-access-student-code) code',
      );
      const studentCode = card.querySelector<HTMLElement>('.student-access-student-code code');
      const cardStyle = getComputedStyle(card);
      return {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
        breakInside: cardStyle.breakInside,
        borderStyle: cardStyle.borderStyle,
        qrX: qr?.x ?? 0,
        headingFits: heading ? heading.scrollWidth <= heading.clientWidth : false,
        classCodeFontSize: classCode ? Number.parseFloat(getComputedStyle(classCode).fontSize) : 0,
        studentCodeFontSize: studentCode
          ? Number.parseFloat(getComputedStyle(studentCode).fontSize)
          : 0,
      };
    });
    const style = getComputedStyle(sheet);
    return {
      columns: style.gridTemplateColumns,
      boxes,
      sheetWidth: sheet.getBoundingClientRect().width,
    };
  });
  expect(printGeometry.boxes).toHaveLength(10);
  expect(printGeometry.columns.trim().split(/\s+/)).toHaveLength(2);
  expect(new Set(printGeometry.boxes.map((box) => Math.round(box.x))).size).toBe(2);
  expect(new Set(printGeometry.boxes.map((box) => Math.round(box.y))).size).toBe(5);
  expect(printGeometry.boxes.every((box) => box.breakInside === 'avoid')).toBe(true);
  expect(printGeometry.boxes.every((box) => box.borderStyle === 'dashed')).toBe(true);
  expect(
    printGeometry.boxes.every(
      (box) =>
        box.qrX > box.x + box.width / 2 &&
        box.headingFits &&
        box.studentCodeFontSize > box.classCodeFontSize,
    ),
  ).toBe(true);
  await page.screenshot({ path: `${evidence}/print-sheet.png`, fullPage: true });
  await page.evaluate(() => document.body.classList.remove('student-access-printing'));
  await page.emulateMedia({ media: 'screen' });

  const rosterAfter = await (
    await page.request.get(`/api/classrooms/${classroomId}/roster`)
  ).json();
  const stateAfterReprint = await classState(classroomId);
  expect(rosterAfter).toEqual(rosterBefore);
  expect(stateAfterReprint).toEqual(stateBeforeReprint);

  await cards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();

  const rotate = await page.request.post(`/api/classrooms/${classroomId}/join-code/rotate`, {
    headers: { origin },
    data: {},
  });
  expect(rotate.status(), await rotate.text()).toBe(201);
  const classCodeB = (await rotate.json()).classroom.joinCode as string;
  expect(classCodeB).not.toBe(classCodeA);

  const oldResolve = await page.request.post('/api/class-join/resolve', {
    headers: { origin },
    data: { code: classCodeA },
  });
  expect(oldResolve.status()).toBe(404);
  const newResolve = await page.request.post('/api/class-join/resolve', {
    headers: { origin },
    data: { code: classCodeB },
  });
  expect(newResolve.status(), await newResolve.text()).toBe(200);

  const stateAfterRotation = await classState(classroomId);
  expect(stateAfterRotation.seat_credentials).toEqual(stateAfterReprint.seat_credentials);
  expect(stateAfterRotation.learner_identities).toEqual(stateAfterReprint.learner_identities);
  expect(stateAfterRotation.active_sessions).toBe(stateAfterReprint.active_sessions);
  expect(stateAfterRotation.enrollments).toBe(stateAfterReprint.enrollments);
  expect(stateAfterRotation.attempts).toBe(stateAfterReprint.attempts);
  expect(stateAfterRotation.submissions).toBe(stateAfterReprint.submissions);
  expect(stateAfterRotation.results).toBe(stateAfterReprint.results);

  await page.reload();
  cards = await openCards(page, classroomId);
  const decodedB = await decodeRenderedQr(
    cards.getByTestId('class-join-qr').first(),
    `${evidence}/qr-b.png`,
  );
  const urlB = new URL(decodedB);
  expect(urlB.origin).toBe(portalOrigin);
  expect(new URLSearchParams(urlB.hash.split('?')[1] ?? '').get('code')).toBe(classCodeB);
  expect(decodedB).not.toBe(decodedA);
  for (const student of students) expect(decodedB).not.toContain(student.studentCode);

  writeFileSync(
    `${evidence}/decoded-urls.json`,
    JSON.stringify({ classCodeA, decodedA, classCodeB, decodedB }, null, 2),
  );
});
