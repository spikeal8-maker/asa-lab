import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture, classId, origin } from './fixtures/classroom-owner';

const artifactDir = 'e2e/artifacts/owner-preview/classroom-feedback';
const sizes = [
  [1920, 1080],
  [1920, 900],
  [1440, 900],
  [1366, 768],
  [1024, 768],
  [390, 844],
  [320, 720],
] as const;
const selectors = [
  '.portal-header',
  '.classroom-head',
  '.classroom-tabbar',
  '.classroom-roster-row',
] as const;
const toast = (page: Page) => page.locator('.system-feedback-ribbon');
const dismiss = (page: Page) =>
  toast(page).getByRole('button', { name: 'Закрыть уведомление', exact: true });
const codeButton = (page: Page) =>
  page.locator('.classroom-roster-row').first().locator('.classroom-login-handle');

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
test.beforeAll(() => {
  mkdirSync(artifactDir, { recursive: true });
});

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}
async function geometry(page: Page) {
  await settle(page);
  return page.evaluate(
    (items) =>
      Object.fromEntries(
        items.map((selector) => {
          const element = document.querySelector(selector);
          if (!element) throw new Error('Missing geometry target: ' + selector);
          const rect = element.getBoundingClientRect();
          return [
            selector,
            { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height },
          ];
        }),
      ),
    selectors,
  );
}
type Geometry = Awaited<ReturnType<typeof geometry>>;
function unchanged(before: Geometry, after: Geometry) {
  for (const selector of selectors) {
    for (const key of ['x', 'y', 'width', 'height'] as const) {
      expect(
        Math.abs(after[selector]![key] - before[selector]![key]),
        selector + '.' + key,
      ).toBeLessThanOrEqual(0.5);
    }
  }
}
async function attach(info: TestInfo, value: unknown) {
  await info.attach('feedback-geometry', {
    body: JSON.stringify(value, null, 2),
    contentType: 'application/json',
  });
}
async function open(page: Page, sidebar: 'expanded' | 'collapsed' = 'expanded') {
  const state = await fixture(page, 24, { classes: 24, sidebar });
  await page.goto(origin + '/#/classrooms/' + classId);
  await expect(page.locator('.classroom-roster-row')).toHaveCount(24);
  await expect(codeButton(page)).toBeVisible();
  await settle(page);
  return state;
}
async function fitsHeader(page: Page) {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const header = document.querySelector('.portal-header')!.getBoundingClientRect();
        const ribbon = document.querySelector('.system-feedback-ribbon')!.getBoundingClientRect();
        return Math.abs(ribbon.top - header.bottom);
      }),
    )
    .toBeLessThanOrEqual(1);
  const box = await toast(page).boundingBox();
  expect(box).not.toBeNull();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(-0.5);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 0.5);
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height + 0.5);
  await expect(dismiss(page)).toBeVisible();
}

for (const sidebar of ['expanded', 'collapsed'] as const) {
  for (const [width, height] of sizes) {
    test(`copy feedback preserves geometry ${width}x${height} ${sidebar}`, async ({
      page,
      context,
    }, info) => {
      await page.setViewportSize({ width, height });
      await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
      const state = await open(page, sidebar);
      const before = await geometry(page);
      await page.screenshot({ path: `${artifactDir}/${width}x${height}-${sidebar}-before.png` });
      await codeButton(page).click();
      await expect(toast(page)).toHaveCount(1);
      await expect(toast(page)).toContainText('Код ученика скопирован.');
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(state.students()[0]!.studentCode);
      await expect(toast(page)).not.toContainText(state.students()[0]!.studentCode);
      await fitsHeader(page);
      const during = await geometry(page);
      await page.screenshot({ path: `${artifactDir}/${width}x${height}-${sidebar}-during.png` });
      await dismiss(page).focus();
      await page.keyboard.press('Enter');
      await expect(toast(page)).toHaveCount(0);
      const after = await geometry(page);
      await page.screenshot({ path: `${artifactDir}/${width}x${height}-${sidebar}-after.png` });
      await attach(info, { viewport: { width, height }, sidebar, before, during, after });
      unchanged(before, during);
      unchanged(before, after);
      expect(state.errors).toEqual([]);
      expect(state.mutations).toEqual([]);
    });
  }
}

test('repeated successful copy retains the focused close element', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  let completedCopies = 0;
  await page.exposeFunction('recordCompletedCopy', () => {
    completedCopies += 1;
  });
  await page.addInitScript(() => {
    const original = navigator.clipboard.writeText.bind(navigator.clipboard);
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: async (text: string) => {
        await original(text);
        await (
          window as unknown as { recordCompletedCopy: () => Promise<void> }
        ).recordCompletedCopy();
      },
    });
  });
  const state = await open(page);
  await codeButton(page).click();
  await expect(toast(page)).toContainText('Код ученика скопирован.');
  await expect.poll(() => completedCopies).toBe(1);
  const button = await dismiss(page).elementHandle();
  expect(button).not.toBeNull();
  await dismiss(page).focus();
  // DOM click invokes the real control and clipboard operation without moving focus.
  await codeButton(page).evaluate((element) => (element as HTMLElement).click());
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(state.students()[0]!.studentCode);
  await expect(toast(page)).toContainText('Код ученика скопирован.');
  await expect.poll(() => completedCopies).toBe(2);
  await settle(page);
  expect(
    await button!.evaluate((element) => element.isConnected && element === document.activeElement),
  ).toBe(true);
  await page.keyboard.press('Space');
  await expect(toast(page)).toHaveCount(0);
  await button!.dispose();
  expect(state.errors).toEqual([]);
});

test('clipboard rejection shows persistent error without false success, then route change clears it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      },
    });
  });
  const state = await open(page);
  await codeButton(page).click();
  await expect(toast(page)).toContainText('Не удалось скопировать код');
  await expect(toast(page)).not.toContainText('Код ученика скопирован.');
  await expect(toast(page)).not.toContainText(state.students()[0]!.studentCode);
  await fitsHeader(page);
  // Observe across the longest finite toast budget, without a fixed sleep.
  const start = Date.now();
  await expect
    .poll(
      async () => {
        await expect(toast(page)).toBeVisible();
        return Date.now() - start;
      },
      { timeout: 11_000, intervals: [250, 500] },
    )
    .toBeGreaterThanOrEqual(8000);
  await dismiss(page).focus();
  await page.keyboard.press('Enter');
  await expect(toast(page)).toHaveCount(0);
  await codeButton(page).click();
  await expect(toast(page)).toContainText('Не удалось скопировать код');
  await page.evaluate(() => {
    location.hash = '#/classrooms';
  });
  await expect(page).toHaveURL(/#\/classrooms$/);
  await expect(toast(page)).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('.classroom-roster-row')).toHaveCount(24);
  await expect(toast(page)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('long safe-mode API error wraps safely and leaves its close button accessible', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 720 });
  const state = await open(page, 'collapsed');
  const message =
    'Не удалось изменить безопасный режим. Проверьте доступ к классу и повторите действие после восстановления соединения. Дополнительная диагностика: <img src=x onerror=alert(1)>.';
  let denied = 0;
  await page.route(
    '**/api/classrooms/' + classId + '/seats/' + state.students()[0]!.id,
    async (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback();
      const body = route.request().postDataJSON() as Record<string, unknown>;
      expect(body.safeMode).toBe(false);
      denied += 1;
      await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message } } });
    },
  );
  const before = await geometry(page);
  await page
    .locator('.classroom-roster-row')
    .first()
    .locator('.classroom-seat-safe input[type="checkbox"]')
    .click();
  await expect.poll(() => denied).toBe(1);
  await expect(
    page
      .locator('.classroom-roster-row')
      .first()
      .locator('.classroom-seat-safe input[type="checkbox"]'),
  ).toBeChecked();
  await expect(toast(page)).toContainText(message);
  await expect(toast(page)).not.toContainText('Код ученика скопирован.');
  await expect(toast(page).locator('img')).toHaveCount(0);
  await fitsHeader(page);
  const during = await geometry(page);
  await page.screenshot({ path: `${artifactDir}/320-long-safe-mode-error.png` });
  await dismiss(page).focus();
  await expect(dismiss(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(toast(page)).toHaveCount(0);
  const after = await geometry(page);
  await attach(info, { before, during, after });
  unchanged(before, during);
  unchanged(before, after);
  expect(state.errors).toEqual([]);
});

test('sharing failures remain visible in the dialog and clear on reopening', async ({ page }) => {
  const state = await open(page);
  const message = 'Изменение кода сейчас недоступно.';
  let requests = 0;
  await page.route('**/api/classrooms/' + classId + '/join-code/rotate', async (route) => {
    expect(route.request().method()).toBe('POST');
    requests += 1;
    await route.fulfill({ status: 503, json: { error: { code: 'unavailable', message } } });
  });
  await page.getByRole('button', { name: 'Поделиться классом', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Вход в класс 7А Робототехника', exact: true });
  const code = await dialog.getByTestId('class-share-code').textContent();
  await dialog.getByRole('button', { name: 'Сменить код', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(dialog.getByRole('alert')).toContainText(message);
  await expect(dialog.getByTestId('class-share-code')).toHaveText(code ?? '');
  await expect(toast(page)).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Закрыть', exact: true }).click();
  await page.getByRole('button', { name: 'Поделиться классом', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

test('late clipboard completion cannot notify the next route', async ({ page }) => {
  await page.addInitScript(() => {
    const probe = window as unknown as { copyPending: boolean; completeCopy: () => void };
    probe.copyPending = false;
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: () =>
          new Promise<void>((resolve) => {
            probe.copyPending = true;
            probe.completeCopy = resolve;
          }),
      },
    });
  });
  const state = await open(page);
  await codeButton(page).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { copyPending: boolean }).copyPending))
    .toBe(true);
  await page.evaluate(() => {
    location.hash = '#/classrooms';
  });
  await expect(page.locator('.classroom-list-row')).toHaveCount(24);
  await page.evaluate(() => (window as unknown as { completeCopy: () => void }).completeCopy());
  await settle(page);
  await expect(toast(page)).toHaveCount(0);
  expect(state.errors).toEqual([]);
});

async function createSyntheticTeacherInvitation(page: Page) {
  let requests = 0;
  await page.route('**/api/classrooms/' + classId + '/teacher-invitations', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    requests += 1;
    await route.fulfill({
      status: 201,
      json: {
        invitation: {
          id: '11111111-1111-4111-8111-111111111111',
          classroomId: classId,
          invitePath: '/classroom-teacher-invite/synthetic-e2e-token',
          createdAt: '2026-11-11T09:00:00.000Z',
          expiresAt: '2026-11-18T09:00:00.000Z',
          acceptedAt: null,
          revokedAt: null,
        },
      },
    });
  });
  await page
    .locator('.classroom-tabbar')
    .getByRole('button', { name: 'Преподаватели', exact: true })
    .click();
  await page.getByRole('button', { name: 'Пригласить коллегу', exact: true }).click();
  await expect.poll(() => requests).toBe(1);
  await expect(
    page.getByRole('textbox', { name: 'Ссылка для приглашения преподавателя', exact: true }),
  ).toHaveValue(origin + '/classroom-teacher-invite/synthetic-e2e-token');
  await expect(toast(page)).toContainText('Ссылка для коллеги создана и действует 7 дней.');
  await settle(page);
}

async function teacherPaneGeometry(page: Page) {
  await settle(page);
  return page.locator('.classroom-teacher-panel').evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return { x: rect.x + scrollX, y: rect.y + scrollY, width: rect.width, height: rect.height };
  });
}

test('teacher invitation clipboard rejection shows a safe ribbon without shifting the teachers pane', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      },
    });
  });
  const state = await open(page);
  await createSyntheticTeacherInvitation(page);
  const before = await teacherPaneGeometry(page);
  await page
    .locator('.classroom-teacher-invite-link')
    .getByRole('button', { name: 'Копировать', exact: true })
    .click();
  await expect(toast(page)).toBeVisible();
  await expect(toast(page)).toContainText('Не удалось скопировать ссылку.');
  await expect(toast(page)).not.toContainText('Ссылка для коллеги скопирована.');
  await expect(toast(page)).not.toContainText('Ссылка для коллеги создана');
  await expect(toast(page)).not.toContainText('synthetic-e2e-token');
  await expect(toast(page)).not.toContainText('/classroom-teacher-invite/');
  await fitsHeader(page);
  const after = await teacherPaneGeometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after[key] - before[key]), 'teachers pane ' + key).toBeLessThanOrEqual(0.5);
  }
  expect(state.errors).toEqual([]);
});

for (const failure of ['classroom', 'participants'] as const) {
  test(`${failure} GET failure exposes only its local retry alert`, async ({ page }) => {
    const state = await fixture(page, 24);
    const message = 'Сервер недоступен';
    const path = '/api/classrooms/' + classId + (failure === 'participants' ? '/participants' : '');
    let requests = 0;
    let fail = true;
    await page.route('**' + path, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      requests += 1;
      if (!fail) return route.fallback();
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message } },
      });
    });
    await page.goto(origin + '/#/classrooms/' + classId);
    await expect.poll(() => requests).toBe(1);
    const alert = page.getByRole('alert');
    await expect(alert).toHaveCount(1);
    await expect(alert).toContainText(
      failure === 'classroom' ? 'Не удалось открыть класс. Повторите попытку.' : message,
    );
    await expect(alert.getByRole('button', { name: /Повтор/ })).toHaveCount(1);
    await expect(toast(page)).toHaveCount(0);
    await expect(page.locator('.system-feedback-announcement')).toHaveText(['', '']);
    if (failure === 'classroom') {
      await expect(page.locator('.classroom-roster-row')).toHaveCount(0);
      await expect(page.getByText(state.students()[0]!.studentCode, { exact: true })).toHaveCount(
        0,
      );
    }
    fail = false;
    await alert.getByRole('button', { name: /Повтор/ }).click();
    await expect.poll(() => requests).toBe(2);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(24);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await settle(page);
    await expect(toast(page)).toHaveCount(0);
    await expect(page.locator('.system-feedback-announcement')).toHaveText(['', '']);
    expect(requests).toBe(2);
    expect(state.errors).toEqual([]);
  });
}

for (const delayed of [false, true]) {
  test(`student-code access revocation clears clipboard feedback, delayed=${delayed}`, async ({
    page,
  }) => {
    await page.addInitScript((pending) => {
      const probe = window as unknown as {
        copyPending: boolean;
        rejectCopy: () => void;
        copyFinished: boolean;
      };
      probe.copyPending = false;
      probe.copyFinished = false;
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async () => {
            try {
              if (pending) {
                await new Promise<void>((_resolve, reject) => {
                  probe.copyPending = true;
                  probe.rejectCopy = () => reject(new DOMException('Denied', 'NotAllowedError'));
                });
              }
              throw new DOMException('Denied', 'NotAllowedError');
            } finally {
              probe.copyFinished = true;
            }
          },
        },
      });
    }, delayed);
    const state = await open(page);
    const oldCode = state.students()[0]!.studentCode;
    let denied = 0;
    let retries = 0;
    await page.route('**/api/classrooms/' + classId, async (route) => {
      if (route.request().method() === 'GET') retries += 1;
      return route.fallback();
    });
    await page.route('**/api/classrooms/' + classId + '/seats/seat-0/code', async (route) => {
      expect(route.request().method()).toBe('POST');
      denied += 1;
      await route.fulfill({
        status: 403,
        json: { error: { code: 'forbidden', message: 'Доступ к классу закрыт.' } },
      });
    });
    await codeButton(page).click();
    if (delayed) {
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { copyPending: boolean }).copyPending),
        )
        .toBe(true);
    } else {
      await expect(page.getByRole('alert')).toHaveCount(1);
      await expect(page.getByRole('alert')).toContainText('Не удалось скопировать код');
    }
    await codeButton(page).focus();
    await page.keyboard.press('F2');
    await page.getByRole('button', { name: 'Сгенерировать новый', exact: true }).click();
    await expect.poll(() => denied).toBe(1);
    await expect(page.getByRole('alert')).toHaveCount(1);
    await expect(page.getByRole('alert')).toContainText('Доступ к классу закрыт.');
    await expect(toast(page)).toHaveCount(0);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText(oldCode);
    expect(await page.locator('body').innerHTML()).not.toContain(oldCode);
    await expect(page.locator('.system-feedback-announcement')).toHaveText(['', '']);
    await page.getByRole('alert').getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect.poll(() => retries).toBe(1);
    await expect(page.locator('.classroom-roster-row')).toHaveCount(24);
    if (delayed) {
      await page.evaluate(() => (window as unknown as { rejectCopy: () => void }).rejectCopy());
      await expect
        .poll(() =>
          page.evaluate(() => (window as unknown as { copyFinished: boolean }).copyFinished),
        )
        .toBe(true);
    }
    await settle(page);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(toast(page)).toHaveCount(0);
    await expect(page.locator('.system-feedback-announcement')).toHaveText(['', '']);
    expect(denied).toBe(1);
    expect(retries).toBe(1);
    expect(state.errors).toEqual([]);
  });
}

test('teacher invitation copy writes the complete link to the granted clipboard', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const state = await open(page);
  await createSyntheticTeacherInvitation(page);
  const before = await teacherPaneGeometry(page);
  await page
    .locator('.classroom-teacher-invite-link')
    .getByRole('button', { name: 'Копировать', exact: true })
    .click();
  await expect(toast(page)).toContainText('Ссылка для коллеги скопирована.');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(origin + '/classroom-teacher-invite/synthetic-e2e-token');
  await expect(toast(page)).not.toContainText('Не удалось');
  await expect(toast(page)).not.toContainText('synthetic-e2e-token');
  await expect(toast(page)).not.toContainText('/classroom-teacher-invite/');
  const after = await teacherPaneGeometry(page);
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    expect(Math.abs(after[key] - before[key]), 'teachers pane ' + key).toBeLessThanOrEqual(0.5);
  }
  expect(state.errors).toEqual([]);
});
