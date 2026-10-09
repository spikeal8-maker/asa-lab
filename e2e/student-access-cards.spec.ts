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
  for (let index = 0; index < 20; index += 1) {
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
  await expect(cards.locator('.student-access-card')).toHaveCount(20);
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
  // substitutes a representative portable ingress host while keeping the twenty-card grid.
  await page.emulateMedia({ media: 'print' });
  await page.evaluate(() => document.body.classList.add('student-access-printing'));
  // Print removes the dialog from the accessibility tree, not the visible sheet.
  const printedFirstQr = page
    .locator('.student-access-print-sheet .student-access-card')
    .filter({ hasText: students[0]!.studentCode })
    .first()
    .getByTestId('class-join-qr');
  await expect(printedFirstQr).toBeVisible();
  expect(await decodeRenderedQr(printedFirstQr)).toBe(decodedA);
  for (const host of [
    new URL(portalOrigin).host,
    'classroom-really-long-installation-name.example.org',
  ]) {
    const layout = await page.evaluate((printedHost) => {
      const sheet = document.querySelector<HTMLElement>('.student-access-print-sheet')!;
      const cards = Array.from(sheet.querySelectorAll<HTMLElement>('.student-access-card'));
      for (const card of cards) {
        card.classList.toggle('is-long-site', printedHost.length > 22);
        card.querySelector<HTMLElement>('.student-access-site')!.textContent = printedHost;
        card.querySelector<HTMLElement>('.student-access-instruction')!.textContent =
          `Вручную: ${printedHost} → код класса → код ученика.`;
      }
      const sheetBounds = sheet.getBoundingClientRect();
      return {
        sheetWidth: sheetBounds.width,
        gridColumns: getComputedStyle(
          sheet.querySelector('.student-access-print-page')!,
        ).gridTemplateColumns.split(' ').length,
        cards: cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const copy = card.querySelector<HTMLElement>('.student-access-card-copy')!;
          const instruction = card.querySelector<HTMLElement>('.student-access-instruction')!;
          const hostLabel = card.querySelector<HTMLElement>('.student-access-site')!;
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
    expect(layout.cards, `${host}: twenty printable cards`).toHaveLength(20);
    expect(layout.gridColumns, `${host}: two print columns`).toBe(2);
    expect(layout.sheetWidth, `${host}: A4 printable width`).toBeLessThanOrEqual(196 * mm + 2);
    for (let row = 0; row < 10; row += 1) {
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
      layout.cards[19]!.bottom - layout.cards[0]!.top,
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
      card.classList.toggle('is-long-site', host.length > 22);
      card.querySelector<HTMLElement>('.student-access-site')!.textContent = host;
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
    const style = getComputedStyle(sheet.querySelector('.student-access-print-page')!);
    return {
      columns: style.gridTemplateColumns,
      boxes,
      sheetWidth: sheet.getBoundingClientRect().width,
    };
  });
  expect(printGeometry.boxes).toHaveLength(20);
  expect(printGeometry.columns.trim().split(/\s+/)).toHaveLength(2);
  expect(new Set(printGeometry.boxes.map((box) => Math.round(box.x))).size).toBe(2);
  expect(new Set(printGeometry.boxes.map((box) => Math.round(box.y))).size).toBe(10);
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
  await page.pdf({
    path: `${evidence}/cards-20-a4.pdf`,
    format: 'A4',
    preferCSSPageSize: true,
    printBackground: true,
  });
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

  // Exercise the UI rotation path repeatedly: new actual server-generated codes,
  // production-rendered SVG pixels, ordinary and monochrome decoding at screen
  // and print sizes. No encoder matrix or data-qr-url is used as decoder input.
  const decodedRotations = [decodedA, decodedB];
  let currentCode = classCodeB;
  for (let rotation = 0; rotation < 3; rotation += 1) {
    await cards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();
    await page.getByRole('button', { name: 'Поделиться классом', exact: true }).click();
    const share = page.getByRole('dialog', { name: /^Вход в класс/ });
    const rotating = page.waitForResponse((response) =>
      response.url().endsWith(`/api/classrooms/${classroomId}/join-code/rotate`),
    );
    await share.getByRole('button', { name: 'Сменить код', exact: true }).click();
    const rotatedResponse = await rotating;
    expect(rotatedResponse.status(), await rotatedResponse.text()).toBe(201);
    const nextCode = (await rotatedResponse.json()).classroom.joinCode as string;
    expect(nextCode).not.toBe(currentCode);
    cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
    await expect(cards).toBeVisible();
    const square = cards.getByTestId('class-join-qr').first();
    await expect(square).toBeVisible();
    const decoded = await decodeRenderedQr(square, `${evidence}/qr-rotation-${rotation}.png`);
    const parsed = new URL(decoded);
    expect(parsed.origin).toBe(portalOrigin);
    expect(parsed.hash.split('?')[0]).toBe('#/join-class');
    expect(new URLSearchParams(parsed.hash.split('?')[1] ?? '').get('code')).toBe(nextCode);
    expect(decodedRotations).not.toContain(decoded);
    for (const student of students) expect(decoded).not.toContain(student.studentCode);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.body.classList.add('student-access-printing'));
    const printedSquare = page
      .locator('.student-access-print-sheet')
      .getByTestId('class-join-qr')
      .first();
    await expect(printedSquare).toBeVisible();
    expect(await decodeRenderedQr(printedSquare)).toBe(decoded);
    await page.evaluate(() => document.body.classList.remove('student-access-printing'));
    await page.emulateMedia({ media: 'screen' });
    const obsolete = await page.request.post('/api/class-join/resolve', {
      headers: { origin },
      data: { code: currentCode },
    });
    expect(obsolete.status()).toBe(404);
    decodedRotations.push(decoded);
    currentCode = nextCode;
  }

  writeFileSync(
    `${evidence}/decoded-urls.json`,
    JSON.stringify({ classCodeA, decodedA, classCodeB, decodedB, decodedRotations }, null, 2),
  );
});

test('classroom settings refuse failed saves, recover busy and retry through the real API', async ({
  page,
}) => {
  await registerTeacher(page);
  const created = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      title: 'Класс проверки отказов настроек',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const classroom = (await created.json()).classroom as { id: string; title: string };
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/#/classrooms/${classroom.id}`);
  await page.getByLabel('Раздел класса', { exact: true }).selectOption('settings');
  const safeMode = page.getByRole('checkbox', { name: 'Безопасный режим для всех', exact: true });
  await expect(safeMode).toBeChecked();
  let policyAttempts = 0;
  await page.route(`**/api/classrooms/${classroom.id}/policies`, async (route) => {
    policyAttempts += 1;
    // Deliberate browser failure injection; the successful retry reaches the real API.
    if (policyAttempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'temporary_refusal', message: 'Безопасный режим не сохранён.' } },
      });
    if (policyAttempts === 2) return route.abort('failed');
    return route.continue();
  });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await safeMode.click();
    await expect(page.getByRole('alert').filter({ hasText: /Повторите попытку/ })).toBeVisible();
    await expect(safeMode).toBeEnabled();
    await expect(safeMode).toBeChecked();
    const state = await page.request.get(`/api/classrooms/${classroom.id}`);
    expect(state.status(), await state.text()).toBe(200);
    expect((await state.json()).classroom.safeModeDefault).toBe(true);
  }
  await safeMode.click();
  await expect(safeMode).not.toBeChecked();
  await expect(safeMode).toBeEnabled();
  await expect(page.getByRole('alert').filter({ hasText: /Повторите попытку/ })).toHaveCount(0);
  expect(policyAttempts).toBe(3);
  expect(
    (await (await page.request.get(`/api/classrooms/${classroom.id}`)).json()).classroom
      .safeModeDefault,
  ).toBe(false);

  let propertyAttempts = 0;
  await page.route(`**/api/classrooms/${classroom.id}`, async (route) => {
    if (route.request().method() !== 'PATCH') return route.continue();
    propertyAttempts += 1;
    if (propertyAttempts === 1)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'temporary_refusal', message: 'Свойства класса не сохранены.' } },
      });
    if (propertyAttempts === 2) return route.abort('failed');
    return route.continue();
  });
  await page.getByRole('button', { name: 'Название и свойства класса', exact: true }).click();
  const properties = page.getByRole('dialog', { name: 'Свойства класса', exact: true });
  const title = properties.getByLabel('Название класса', { exact: true });
  const save = properties.getByRole('button', { name: 'Сохранить', exact: true });
  await title.fill('Подтверждённое сервером новое название');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await save.click();
    await expect(properties.getByRole('alert')).toBeVisible();
    await expect(save).toBeEnabled();
    await expect(title).toHaveValue('Подтверждённое сервером новое название');
    expect(
      (await (await page.request.get(`/api/classrooms/${classroom.id}`)).json()).classroom.title,
    ).toBe(classroom.title);
    await expect(page.locator('.classroom-head')).toContainText(classroom.title);
  }
  await save.click();
  await expect(properties).toHaveCount(0);
  await expect(page.locator('.classroom-head')).toContainText(
    'Подтверждённое сервером новое название',
  );
  expect(propertyAttempts).toBe(3);
  expect(
    (await (await page.request.get(`/api/classrooms/${classroom.id}`)).json()).classroom.title,
  ).toBe('Подтверждённое сервером новое название');
  expect(errors).toEqual([]);
});

test('classroom hash navigation isolates credentials on failure, retries B and ignores a late A roster', async ({
  page,
}) => {
  await registerTeacher(page);
  async function createClass(title: string) {
    const created = await page.request.post('/api/classrooms', {
      headers: { origin, 'idempotency-key': crypto.randomUUID() },
      data: { title, ageBand: 'mixed', topicKeys: [], safeModeDefault: true },
    });
    expect(created.status(), await created.text()).toBe(201);
    const classroom = (await created.json()).classroom as {
      id: string;
      title: string;
      joinCode: string;
    };
    const added = await page.request.post(`/api/classrooms/${classroom.id}/seats`, {
      headers: { origin },
      data: { displayLabel: `${title} — личное имя`, safeMode: true },
    });
    expect(added.status(), await added.text()).toBe(201);
    return {
      classroom,
      student: (await added.json()).student as { displayLabel: string; studentCode: string },
    };
  }
  const a = await createClass('Класс A с отдельными данными');
  const b = await createClass('Класс B после перехода');
  await openCards(page, a.classroom.id);
  await page.evaluate(() => {
    (window as unknown as { classroomNavigationMarker: string }).classroomNavigationMarker =
      'same-document';
  });
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (
      request.url().includes(`/api/classrooms/${b.classroom.id}`) &&
      ['POST', 'PATCH', 'DELETE'].includes(request.method())
    )
      mutations.push(request.url());
  });
  let attemptsB = 0;
  await page.route(`**/api/classrooms/${b.classroom.id}/roster`, async (route) => {
    attemptsB += 1;
    if (attemptsB === 1)
      return route.fulfill({
        status: 503,
        json: { error: { code: 'temporary_unavailable', message: 'Реестр класса B недоступен.' } },
      });
    return route.continue();
  });
  await page.evaluate((id) => {
    window.location.hash = `/classrooms/${id}`;
  }, b.classroom.id);
  await expect(page.getByRole('alert')).toContainText('Не удалось открыть класс');
  for (const privateValue of [
    a.classroom.title,
    a.classroom.joinCode,
    a.student.displayLabel,
    a.student.studentCode,
  ]) {
    await expect(page.locator('body')).not.toContainText(privateValue);
  }
  await expect(page.locator('.student-access-dialog')).toHaveCount(0);
  await expect(page.locator('.classroom-head')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(mutations).toEqual([]);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.locator('.classroom-head')).toContainText(b.classroom.title);
  await expect(page.locator('.classroom-roster-table')).toContainText(b.student.studentCode);
  expect(attemptsB).toBe(2);
  expect(
    (await (await page.request.get(`/api/classrooms/${b.classroom.id}`)).json()).classroom
      .safeModeDefault,
  ).toBe(true);

  let releaseA!: () => void;
  const heldA = new Promise<void>((done) => {
    releaseA = done;
  });
  let receivedA = false;
  await page.route(`**/api/classrooms/${a.classroom.id}/roster`, async (route) => {
    const response = await route.fetch();
    receivedA = true;
    await heldA;
    await route.fulfill({ response });
  });
  await page.evaluate((id) => {
    window.location.hash = `/classrooms/${id}`;
  }, a.classroom.id);
  await expect.poll(() => receivedA).toBe(true);
  await page.evaluate((id) => {
    window.location.hash = `/classrooms/${id}`;
  }, b.classroom.id);
  await expect(page.locator('.classroom-head')).toContainText(b.classroom.title);
  const lateA = page.waitForResponse((response) =>
    response.url().endsWith(`/api/classrooms/${a.classroom.id}/roster`),
  );
  releaseA();
  expect((await lateA).status()).toBe(200);
  await page.evaluate(
    () =>
      new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
  await expect(page.locator('.classroom-roster-table')).toContainText(b.student.studentCode);
  for (const privateValue of [
    a.classroom.title,
    a.classroom.joinCode,
    a.student.displayLabel,
    a.student.studentCode,
  ]) {
    await expect(page.locator('body')).not.toContainText(privateValue);
  }
  expect(
    await page.evaluate(
      () => (window as unknown as { classroomNavigationMarker: string }).classroomNavigationMarker,
    ),
  ).toBe('same-document');
  expect(mutations).toEqual([]);
});

test('confirmed Student Code rotation survives a failed roster reload in copy and printed cards', async ({
  page,
}) => {
  await registerTeacher(page);
  const created = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': crypto.randomUUID() },
    data: {
      title: 'Класс смены кода при отказе загрузки',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: false,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const classroom = (await created.json()).classroom as { id: string; joinCode: string };
  const students: Array<{ id: string; displayLabel: string; studentCode: string }> = [];
  for (const displayLabel of ['Ученик с новым кодом', 'Ученик с прежним действующим кодом']) {
    const added = await page.request.post(`/api/classrooms/${classroom.id}/seats`, {
      headers: { origin },
      data: { displayLabel, safeMode: true },
    });
    expect(added.status(), await added.text()).toBe(201);
    students.push((await added.json()).student);
  }
  const [target, other] = students as [(typeof students)[number], (typeof students)[number]];
  await page.goto(`/#/classrooms/${classroom.id}`);
  const row = page.locator('.classroom-roster-row').filter({ hasText: target.displayLabel });
  await expect(row.locator('.classroom-login-handle')).toHaveText(target.studentCode);
  const copyLog: string[] = [];
  await page.exposeFunction('captureRotatedCode', (code: string) => copyLog.push(code));
  await page.evaluate(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (code: string) =>
          (
            window as unknown as { captureRotatedCode(code: string): Promise<void> }
          ).captureRotatedCode(code),
      },
    });
    window.print = () => undefined;
  });
  await page.route(`**/api/classrooms/${classroom.id}/roster`, (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'temporary_unavailable', message: 'Реестр временно недоступен.' } },
    }),
  );
  await row.locator('.classroom-row-menu summary').click();
  await row.getByRole('button', { name: 'Изменить код ученика', exact: true }).click();
  const changing = page.waitForResponse((response) =>
    response.url().endsWith(`/api/classrooms/${classroom.id}/seats/${target.id}/code`),
  );
  await page.getByRole('button', { name: 'Сгенерировать новый', exact: true }).click();
  const changed = await changing;
  expect(changed.status(), await changed.text()).toBe(201);
  const newCode = (await changed.json()).studentCode as string;
  expect(newCode).not.toBe(target.studentCode);
  await expect(page.locator('.student-code-dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Не удалось обновить данные класса');
  await expect(page.locator('body')).not.toContainText(
    'Не удалось получить подтверждение смены кода',
  );
  await expect(row.locator('.classroom-login-handle')).toHaveText(newCode);
  await expect(page.locator('.classroom-roster-table')).not.toContainText(target.studentCode);
  await expect(page.locator('.classroom-roster-table')).toContainText(other.studentCode);
  await row.locator('.classroom-login-handle').click();
  await expect.poll(() => copyLog).toEqual([newCode]);
  await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
  const cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
  await expect(cards).toContainText(newCode);
  await expect(cards).toContainText(other.studentCode);
  await expect(cards).not.toContainText(target.studentCode);
  await expect(cards.getByTestId('class-join-qr').first()).toBeVisible();
  expect(await decodeRenderedQr(cards.getByTestId('class-join-qr').first())).toBe(
    `${origin}/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`,
  );
  await cards.getByRole('button', { name: 'Распечатать (2)', exact: true }).click();
  await page.emulateMedia({ media: 'print' });
  const sheet = cards.locator('.student-access-print-sheet');
  await expect(sheet).toContainText(newCode);
  await expect(sheet).not.toContainText(target.studentCode);
  expect(
    await page.evaluate(() => document.body.classList.contains('student-access-printing')),
  ).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await page.emulateMedia({ media: 'screen' });
  const oldLogin = await page.request.post('/api/class-join/studentseat', {
    headers: { origin },
    data: { code: classroom.joinCode, studentCode: target.studentCode },
  });
  expect(oldLogin.status(), await oldLogin.text()).toBe(401);
  const persisted = await page.request.get(`/api/classrooms/${classroom.id}/roster`);
  expect(persisted.status(), await persisted.text()).toBe(200);
  expect(
    (await persisted.json()).items.find((student: { id: string }) => student.id === target.id),
  ).toMatchObject({ studentCode: newCode, loginHandle: newCode, loginMethod: 'student_code' });
  expect(copyLog).toEqual([newCode]);
});

test('owner classroom flow: one-click batch, exact retry and existing Account approval', async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await registerTeacher(page);
  const created = await page.request.post('/api/classrooms', {
    headers: { origin, 'idempotency-key': `owner-class-${crypto.randomUUID()}` },
    data: {
      title: 'Класс для проверки списка и заявок',
      ageBand: 'mixed',
      topicKeys: [],
      safeModeDefault: true,
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const classroom = (await created.json()).classroom as { id: string; joinCode: string };
  const batchWrites: Array<{
    requestId: string;
    students: Array<{ displayLabel: string; safeMode: boolean }>;
  }> = [];
  page.on('request', (request) => {
    if (
      new URL(request.url()).pathname === `/api/classrooms/${classroom.id}/seats/batch` &&
      request.method() === 'POST'
    ) {
      batchWrites.push(request.postDataJSON());
    }
  });
  await page.goto(`/#/classrooms/${classroom.id}`);
  await page.getByRole('button', { name: 'Добавить списком', exact: true }).click();
  const batchDialog = page.getByRole('dialog', { name: 'Добавить список учеников' });
  await batchDialog
    .getByLabel('Ученики', { exact: true })
    .fill(Array.from({ length: 30 }, (_, index) => `Проверочный ученик ${index + 1}`).join('\n'));
  await batchDialog.getByRole('button', { name: 'Добавить', exact: true }).click();
  const cards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
  await expect(cards).toBeVisible();
  await expect(cards.locator('.student-access-card')).toHaveCount(30);
  await expect(cards.locator('.student-access-print-page')).toHaveCount(2);
  expect(batchWrites).toHaveLength(1);
  const before = await (await page.request.get(`/api/classrooms/${classroom.id}/roster`)).json();
  expect(before.items).toHaveLength(30);
  const retry = await page.request.post(`/api/classrooms/${classroom.id}/seats/batch`, {
    headers: { origin },
    data: batchWrites[0],
  });
  expect(retry.ok(), await retry.text()).toBe(true);
  expect((await retry.json()).reused).toBe(true);
  const after = await (await page.request.get(`/api/classrooms/${classroom.id}/roster`)).json();
  expect(after).toEqual(before);
  await cards.getByRole('button', { name: 'Закрыть', exact: true }).last().click();

  const accountContext = await browser.newContext({ baseURL: origin });
  try {
    const accountPage = await accountContext.newPage();
    const id = crypto.randomUUID().replaceAll('-', '');
    const registered = await accountPage.request.post('/api/auth/register', {
      headers: { origin },
      data: {
        email: `${id}@classroom-owner.test`,
        username: `co_${id.slice(0, 20)}`,
        displayName: 'Участник по существующему аккаунту',
        password: `Safe-${id}-Password`,
        birthDate: '1990-04-12',
        country: 'RU',
      },
    });
    expect(registered.status(), await registered.text()).toBe(201);
    const initialAccount = await (await accountPage.request.get('/api/auth/me')).json();
    await accountPage.goto(`/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`);
    await expect(
      accountPage.getByRole('heading', { name: 'Присоединиться к классу', exact: true }),
    ).toBeVisible();
    await expect(accountPage.getByLabel('Код ученика', { exact: true })).toHaveCount(0);
    await accountPage.getByRole('button', { name: 'Отправить заявку', exact: true }).click();
    await expect(
      accountPage.getByRole('heading', { name: 'Заявка отправлена', exact: true }),
    ).toBeVisible();
    await page
      .getByRole('navigation', { name: 'Разделы класса' })
      .getByRole('button', { name: 'Заявки', exact: true })
      .click();
    const requestRow = page
      .locator('.learning-join-requests li')
      .filter({ hasText: 'Участник по существующему аккаунту' });
    await expect(requestRow).toBeVisible();
    await requestRow.getByRole('button', { name: 'Принять заявку', exact: true }).click();
    await expect(requestRow).toContainText('Принята');
    const approvedRoster = await (
      await page.request.get(`/api/classrooms/${classroom.id}/roster`)
    ).json();
    expect(approvedRoster.items).toHaveLength(31);
    expect(
      approvedRoster.items.filter(
        (item: { displayLabel: string }) =>
          item.displayLabel === 'Участник по существующему аккаунту',
      ),
    ).toHaveLength(1);
    const finalAccount = await (await accountPage.request.get('/api/auth/me')).json();
    expect(finalAccount.authenticated).toBe(true);
    expect(finalAccount.account.id).toBe(initialAccount.account.id);
    const attended = await accountPage.request.get('/api/class-join/account/classes');
    expect(attended.status(), await attended.text()).toBe(200);
    expect(
      (await attended.json()).items.some(
        (item: { classroomId: string }) => item.classroomId === classroom.id,
      ),
    ).toBe(true);

    // Real Account-only admission and real StudentSeat codes in the same class.
    // Account settings use the stored DB identity without transporting its handle.
    const accountSeat = approvedRoster.items.find(
      (item: { loginMethod: string }) => item.loginMethod === 'account',
    );
    expect(accountSeat).toBeDefined();
    expect(accountSeat).toMatchObject({ studentCode: null, loginHandle: null });
    const stored = await admin.query(
      'SELECT login_handle FROM classroom_student_seats WHERE id=$1',
      [accountSeat.id],
    );
    expect(stored.rows[0].login_handle).toMatch(/^acc:/);
    const longAccountName = 'Александра Константиновна Иванова-Петрова — участник через аккаунт';
    const updated = await page.request.patch(
      `/api/classrooms/${classroom.id}/seats/${accountSeat.id}`,
      {
        headers: { origin },
        data: { displayLabel: longAccountName, safeMode: false, status: 'active', avatarKey: null },
      },
    );
    expect(updated.status(), await updated.text()).toBe(200);
    expect((await updated.json()).student).toMatchObject({
      loginMethod: 'account',
      studentCode: null,
      loginHandle: null,
      displayLabel: longAccountName,
    });
    const mixed = await (await page.request.get(`/api/classrooms/${classroom.id}/roster`)).json();
    expect(mixed.items).toHaveLength(31);
    expect(
      mixed.items.filter((item: { loginMethod: string }) => item.loginMethod === 'student_code'),
    ).toHaveLength(30);
    expect(JSON.stringify(mixed)).not.toContain('acc:');
    const longCodeSeat = mixed.items.find(
      (item: { loginMethod: string }) => item.loginMethod === 'student_code',
    );
    const renamed = await page.request.patch(
      `/api/classrooms/${classroom.id}/seats/${longCodeSeat.id}`,
      {
        headers: { origin },
        data: {
          displayLabel: 'Константин Александрович Очень-Длинная-Составная-Фамилия',
          safeMode: true,
          status: 'active',
          avatarKey: null,
        },
      },
    );
    expect(renamed.status(), await renamed.text()).toBe(200);
    expect((await renamed.json()).student.studentCode).toBe(longCodeSeat.studentCode);
    await page.goto(`/#/classrooms/${classroom.id}`);
    const copyLog: string[] = [];
    await page.exposeFunction('captureClassroomCopy', (value: string) => copyLog.push(value));
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: (value: string) =>
            (
              window as unknown as { captureClassroomCopy(value: string): Promise<void> }
            ).captureClassroomCopy(value),
        },
      });
    });
    const accountRow = page.locator('.classroom-roster-row').filter({ hasText: longAccountName });
    await expect(accountRow).toContainText('Вход через аккаунт');
    await expect(accountRow.locator('.classroom-login-handle')).toHaveCount(0);
    await accountRow.getByText('Вход через аккаунт', { exact: true }).click();
    expect(copyLog).toEqual([]);
    const codeRow = page
      .locator('.classroom-roster-row')
      .filter({ hasText: longCodeSeat.studentCode });
    await codeRow.locator('.classroom-login-handle').click();
    await expect.poll(() => copyLog).toEqual([longCodeSeat.studentCode]);
    await expect(page.locator('.classroom-roster-table')).not.toContainText('acc:');
    await page.getByRole('button', { name: 'Карточки доступа', exact: true }).click();
    const mixedCards = page.getByRole('dialog', { name: 'Карточки доступа', exact: true });
    await mixedCards.locator('.student-access-selection summary').click();
    const accountCard = mixedCards.locator('.student-access-card.is-account-entry');
    await expect(accountCard).toHaveCount(1);
    await expect(accountCard).toContainText('Вход через аккаунт');
    await expect(accountCard.locator('.student-access-student-code code')).toHaveCount(0);
    await expect(accountCard).toContainText(
      'Войдите в свой аккаунт ASA Lab → Моё обучение → этот класс.',
    );
    await expect(mixedCards.locator('.student-access-selector')).toContainText(
      'Вход через аккаунт',
    );
    await expect(mixedCards).not.toContainText('acc:');
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => document.fonts.ready);
      const geometry = await mixedCards.evaluate((dialog) => {
        const bounds = dialog.getBoundingClientRect();
        return {
          left: bounds.left,
          right: bounds.right,
          overflow: dialog.scrollWidth - dialog.clientWidth,
          escaped: [...dialog.querySelectorAll<HTMLElement>('*')]
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.left < bounds.left - 1 || box.right > bounds.right + 1;
            })
            .map((element) => element.className || element.tagName),
        };
      });
      expect(geometry.left).toBeGreaterThanOrEqual(0);
      expect(geometry.right).toBeLessThanOrEqual(width);
      expect(geometry.overflow).toBeLessThanOrEqual(1);
      expect(geometry.escaped).toEqual([]);
      await expect(accountCard.locator('.student-access-instruction')).toBeVisible();
      for (const card of [
        accountCard,
        mixedCards.locator('.student-access-card').filter({ hasText: longCodeSeat.studentCode }),
      ]) {
        const decoded = await decodeRenderedQr(card.getByTestId('class-join-qr'));
        expect(decoded).toBe(
          `${origin}/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`,
        );
        expect(decoded).not.toContain(longCodeSeat.studentCode);
        expect(decoded).not.toContain('acc:');
      }
    }
    const beforePrint = await classState(classroom.id);
    await page.emulateMedia({ media: 'print' });
    await page.evaluate(() => document.body.classList.add('student-access-printing'));
    await expect(mixedCards.locator('.student-access-print-page')).toHaveCount(2);
    expect(
      await mixedCards
        .locator('.student-access-print-page')
        .evaluateAll((pages) =>
          pages.map((sheet) => sheet.querySelectorAll('.student-access-card').length),
        ),
    ).toEqual([20, 11]);
    const accountPrint = await accountCard.evaluate((card) => ({
      overflowX: card.scrollWidth - card.clientWidth,
      overflowY: card.scrollHeight - card.clientHeight,
      instructionDisplay: getComputedStyle(card.querySelector('.student-access-instruction')!)
        .display,
      text: card.textContent,
    }));
    expect(accountPrint.overflowX).toBeLessThanOrEqual(1);
    expect(accountPrint.overflowY).toBeLessThanOrEqual(1);
    expect(accountPrint.instructionDisplay).not.toBe('none');
    expect(accountPrint.text).toContain('Вход через аккаунт');
    expect(accountPrint.text).not.toContain('acc:');
    expect(await decodeRenderedQr(accountCard.getByTestId('class-join-qr'))).toBe(
      `${origin}/#/join-class?code=${encodeURIComponent(classroom.joinCode)}`,
    );
    await page.evaluate(() => document.body.classList.remove('student-access-printing'));
    await page.emulateMedia({ media: 'screen' });
    expect(await classState(classroom.id)).toEqual(beforePrint);
    expect(copyLog).toEqual([longCodeSeat.studentCode]);
  } finally {
    await accountContext.close();
  }
});
