import { test, expect } from '@playwright/test';

// Production pinned Scratch GUI/VM + shipping BlocksEditor, with the existing
// persistence fixture and mocked telemetry responses. PostgreSQL/rating proof
// is separate: tests/portal/classroom-scratch-time.pg.spec.ts.
test('real Scratch input reaches bounded analytics while heartbeat/idle do not; minute save still persists', async () => {
  const { createProtocolFixture, installMinuteAutosaveClock, advanceMinuteAutosave } =
    await import('../tools/blocks/browser/fixture.mjs');
  const { parentOrigin, projectId } = await import('../tools/blocks/browser/protocol.mjs');
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  const telemetry: { path: string; body: Record<string, unknown> }[] = [];
  await page.route('**/api/analytics/v1/module-session/*', async (route) => {
    const body = route.request().postDataJSON() as Record<string, unknown>;
    const path = new URL(route.request().url()).pathname;
    telemetry.push({ path, body });
    await route.fulfill({
      status: 202,
      contentType: 'application/json',
      body: JSON.stringify({
        accepted: true,
        ...(path.endsWith('/start') ? { sessionId: body['sessionId'] } : {}),
      }),
    });
  });
  try {
    await installMinuteAutosaveClock(page);
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45_000 },
    );
    const start = () => telemetry.filter((e) => e.path.endsWith('/start'));
    const touches = () => telemetry.filter((e) => e.path.endsWith('/touch'));
    await page.clock.runFor(66_000);
    expect(start()).toHaveLength(0); // Includes several genuine health heartbeats.
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
    });
    await page.clock.runFor(2000);
    expect(start()).toHaveLength(0); // Synthetic DOM input is not trusted.

    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    await expect.poll(() => start().length).toBe(1);
    expect(start()[0]?.body).toEqual({
      sessionId: expect.any(String),
      projectId,
      moduleKey: 'blocks',
    });
    await advanceMinuteAutosave(page);
    await expect
      .poll(() => fixture.runtimeDraftEvidence.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const saved = fixture.runtimeDraftEvidence.at(-1)?.body?.document?.projectJson as {
      targets: Array<{ name: string }>;
    };
    expect(saved.targets.some((t) => t.name === 'Abby')).toBe(true);
    expect(touches().some((e) => e.body['closed'] === true)).toBe(true);
    const closedCount = telemetry.length;
    await page.clock.runFor(120_000);
    expect(telemetry).toHaveLength(closedCount);
    // Reopen with actual trusted input after idle, using a fresh client UUID.
    await frame.getByPlaceholder('Name', { exact: true }).fill('Abby active again');
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    await expect.poll(() => start().length).toBe(2);
    expect(start()[1]?.body['sessionId']).not.toBe(start()[0]?.body['sessionId']);
    await page.goto('about:blank');
    await expect.poll(() => touches().filter((e) => e.body['closed'] === true).length).toBe(2);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('telemetry rejection leaves the real Scratch minute save and controlled exit working', async () => {
  const { createProtocolFixture, installMinuteAutosaveClock, advanceMinuteAutosave } =
    await import('../tools/blocks/browser/fixture.mjs');
  const { parentOrigin } = await import('../tools/blocks/browser/protocol.mjs');
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route('**/api/analytics/v1/module-session/*', (route) =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        error: { code: 'unauthorized', message: 'telemetry fixture rejected' },
      }),
    }),
  );
  try {
    await installMinuteAutosaveClock(page);
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45_000 },
    );
    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    await advanceMinuteAutosave(page);
    await expect
      .poll(() => fixture.runtimeDraftEvidence.length, { timeout: 30_000 })
      .toBeGreaterThan(0);
    const before = fixture.getServerRevision();
    await frame.getByPlaceholder('Name', { exact: true }).fill('Saved despite telemetry');
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    await page.clock.runFor(1000);
    await frame.locator('img[src$="asa-lab-scratch-wordmark.svg"]').click();
    await expect(page.getByTestId('asa-projects-fixture')).toBeVisible({ timeout: 30_000 });
    expect(fixture.getServerRevision()).toBeGreaterThan(before);
    const saved = fixture.runtimeDraftEvidence.at(-1)?.body?.document?.projectJson as {
      targets: Array<{ name: string }>;
    };
    expect(saved.targets.some((t) => t.name === 'Saved despite telemetry')).toBe(true);
    expect(requests.some((url) => url.endsWith('/api/auth/refresh'))).toBe(false);
    expect(requests.some((url) => url.includes('/api/analytics/v1/module-session/start'))).toBe(
      true,
    );
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});
