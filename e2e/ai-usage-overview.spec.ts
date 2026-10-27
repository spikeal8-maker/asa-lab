import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type pg from 'pg';
import { e2eAdminPool } from './seed';
import { openAiUsageNativeZoom } from './ai-usage-native-zoom';

const ORIGIN = 'http://127.0.0.1:4612';
const ENDPOINT = '/api/admin/v1/ai/usage-overview';
const BASELINE = process.env.ASA_AI_OVERVIEW_BASELINE === 'true';
const COUNTS = [1, 0, 2, 1, 3, 0, 2];

interface Overview {
  schemaVersion: 1;
  period: { from: string; to: string; timeZone: 'UTC'; days: 7 };
  generatedAt: string;
  requests: number;
  inputTokens: { known: string | null; knownOperations: number; unknownOperations: number };
  outputTokens: { known: string | null; knownOperations: number; unknownOperations: number };
  daily: { date: string; requests: number }[];
  state: 'empty' | 'partial' | 'complete';
}

async function registerAdministrator(page: Page, db: pg.Pool) {
  const unique = randomUUID().replaceAll('-', '');
  await page.goto('/#/explore');
  const registration = await page.request.post('/api/auth/register', {
    headers: { origin: ORIGIN },
    data: {
      email: `ai-overview-${unique}@isolated.test`,
      username: `ai_${unique.slice(0, 25)}`,
      displayName: 'Администратор проверки ИИ',
      password: `Overview-${unique}-Password`,
      birthDate: '1990-01-01',
      country: 'RU',
    },
  });
  expect(registration.status()).toBe(201);
  const session = await registration.json();
  expect(session.authenticated).toBe(true);
  const accountId: string = session.user.id;
  // This privileged setup is permitted only inside e2eAdminPool's explicit
  // disposable *_test database. The browser then uses real session cookies.
  await db.query(
    `INSERT INTO capability_grants
       (account_id,capability,state,policy_version,granted_by)
     VALUES ($1,'platform_admin','verified','asa-lab-2026-07','migration')`,
    [accountId],
  );
  await db.query("UPDATE accounts SET email_verification_state='verified' WHERE id=$1", [
    accountId,
  ]);
  const authenticated = await page.request.get('/api/auth/me');
  expect(authenticated.status()).toBe(200);
  const checkedSession = await authenticated.json();
  expect(checkedSession.verification?.required).toBe(false);
  expect(checkedSession.capabilities).toContainEqual({
    capability: 'platform_admin',
    state: 'verified',
  });
  const profile = await page.request.get('/api/admin/v1/me');
  expect(profile.status()).toBe(200);
  expect((await profile.json()).scopes).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: 'platform', role: 'platform_admin' })]),
  );
  const principal = await db.query<{ id: string }>(
    'SELECT id FROM principals WHERE account_id=$1',
    [accountId],
  );
  expect(principal.rows).toHaveLength(1);
  return { accountId, principalId: principal.rows[0]!.id };
}

async function versions(page: Page) {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  expect(revision).toMatch(/^[a-f0-9]{40}$/);
  expect(process.env.ASA_BUILD_REVISION).toBe(revision);
  expect(process.env.VITE_ASA_BUILD_REVISION).toBe(revision);
  const response = await page.request.get('/api/version');
  expect(response.status()).toBe(200);
  const api = await response.json();
  expect(api.revision).toBe(revision);
  const served = await page.request.get('/build-metadata.json');
  expect(served.status()).toBe(200);
  const web = await served.json();
  expect(web.revision).toBe(revision);
  const built = JSON.parse(readFileSync('apps/web/dist/build-metadata.json', 'utf8'));
  expect(built).toEqual(web);
  return { revision, apiVersion: api, webVersion: web };
}

async function overview(page: Page): Promise<Overview> {
  const response = await page.request.get(ENDPOINT);
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store');
  return response.json();
}

async function screenshot(page: Page, name: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await Promise.all(
      (document.querySelector('.skip-link')?.getAnimations() ?? []).map((animation) =>
        animation.finished.catch(() => undefined),
      ),
    );
  });
  await page.screenshot({ path: test.info().outputPath(`${name}.png`), fullPage: true });
}

async function assertLayout(page: Page, width: number) {
  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('.asa-ai-admin-workspace');
    const bounds = workspace?.getBoundingClientRect();
    return {
      width: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      workspaceLeft: bounds?.left,
      workspaceRight: bounds?.right,
    };
  });
  expect(layout.width).toBe(width);
  expect(layout.scrollWidth).toBeLessThanOrEqual(width);
  expect(layout.workspaceLeft).toBeGreaterThanOrEqual(0);
  expect(layout.workspaceRight).toBeLessThanOrEqual(width + 1);
}

async function assertMetricContent(page: Page) {
  const cards = await page.locator('.asa-ai-usage-card').evaluateAll((elements) =>
    elements.map((card) => {
      const bounds = card.getBoundingClientRect();
      const value = card.querySelector('.asa-ai-usage-value bdi');
      const blocks = Array.from(card.querySelectorAll('h3, p')).map((element) =>
        element.getBoundingClientRect(),
      );
      return {
        inside: Array.from(value?.getClientRects() ?? []).every(
          (rect) => rect.left >= bounds.left && rect.right <= bounds.right,
        ),
        noOverlap: blocks.every(
          (rect, index) => index === 0 || blocks[index - 1]!.bottom <= rect.top + 1,
        ),
        textOverflow: value ? getComputedStyle(value).textOverflow : 'missing',
      };
    }),
  );
  expect(cards).toHaveLength(3);
  for (const card of cards) {
    expect(card.inside).toBe(true);
    expect(card.noOverlap).toBe(true);
    expect(card.textOverflow).not.toBe('ellipsis');
  }
}

async function verifyKeyboardAndTouch(page: Page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light' });
  const overviewTab = page.getByRole('tab', { name: 'Обзор', exact: true });
  const settingsTab = page.getByRole('tab', { name: 'Настройки', exact: true });
  const lastTab = page.getByRole('tab', { name: 'Изображения', exact: true });
  await overviewTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(settingsTab).toBeFocused();
  await expect(settingsTab).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(lastTab).toBeFocused();
  await page.keyboard.press('Home');
  await expect(overviewTab).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(lastTab).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(overviewTab).toBeFocused();
  await assertMetrics(page);
  const refresh = page.getByRole('button', { name: 'Обновить данные', exact: true });
  await page.keyboard.press('Tab');
  await expect(refresh).toBeFocused();
  const focus = await refresh.evaluate((button) => {
    const style = getComputedStyle(button);
    return {
      visible: button.matches(':focus-visible'),
      outlineStyle: style.outlineStyle,
      outlineWidth: Number.parseFloat(style.outlineWidth),
    };
  });
  expect(focus.visible).toBe(true);
  expect(focus.outlineStyle).not.toBe('none');
  expect(focus.outlineWidth).toBeGreaterThanOrEqual(2);
  const targets = await page
    .locator(
      '.asa-ai-admin-tabs > button, .asa-ai-usage-refresh, .asa-ai-usage-table-details summary',
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { label: element.textContent?.trim(), width: rect.width, height: rect.height };
      }),
    );
  expect(targets).toHaveLength(8);
  for (const target of targets) {
    expect(target.width, target.label).toBeGreaterThanOrEqual(44);
    expect(target.height, target.label).toBeGreaterThanOrEqual(44);
  }
  // Preserve the actual keyboard focus ring; the ordinary screenshot helper
  // deliberately blurs focus and therefore cannot serve as this evidence.
  await page.screenshot({
    path: test.info().outputPath('keyboard-focus-390-light.png'),
    fullPage: true,
  });
  writeFileSync(
    test.info().outputPath('safe-keyboard-touch.json'),
    JSON.stringify(
      {
        keys: ['ArrowRight', 'End', 'Home', 'ArrowLeft', 'ArrowRight', 'Tab'],
        focus,
        targets,
        mobileKeyboard: 'No text input belongs to this read-only overview.',
      },
      null,
      2,
    ),
  );
}

async function verifyNativeZoom(sourcePage: Page) {
  const zoom = await openAiUsageNativeZoom(sourcePage);
  let failure: { error: unknown } | undefined;
  let evidence: unknown;
  try {
    await zoom.page.goto('/#/admin/ai?section=overview');
    await assertMetrics(zoom.page);
    const geometry = () =>
      zoom.page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        outerWidth,
        outerHeight,
        ratio: devicePixelRatio,
        visualScale: visualViewport?.scale,
        cssZoom: getComputedStyle(document.documentElement).zoom,
        scrollWidth: document.documentElement.scrollWidth,
        scrollY,
      }));
    const before = await geometry();
    expect(before.width).toBe(1440);
    const applied = await zoom.setZoom(2);
    expect(applied).toMatchObject({ factor: 2, settings: { mode: 'automatic', scope: 'per-tab' } });
    await expect.poll(() => zoom.page.evaluate(() => innerWidth)).toBeLessThan(before.width);
    const after = await geometry();
    expect(before.width / after.width).toBeCloseTo(2, 1);
    expect(after.ratio / before.ratio).toBe(2);
    expect(after.outerWidth).toBe(before.outerWidth);
    expect(after.cssZoom).toBe('1');
    expect(after.visualScale).toBe(1);
    const screenshots: unknown[] = [];
    async function nativeViewport(name: string, selector?: string) {
      if (selector)
        await zoom.page.locator(selector).evaluate((element) => {
          element.scrollIntoView({ block: 'center' });
        });
      else await zoom.page.evaluate(() => window.scrollTo(0, 0));
      await zoom.page.evaluate(async () => {
        if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
        await document.fonts.ready;
        await new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        );
      });
      // Playwright's CSS-sized fullPage clip crops a natively zoomed window.
      // Capture Chromium's actual viewport with no clip, resize or CSS scaling.
      const capture = await zoom.page.context().newCDPSession(zoom.page);
      let png: Buffer;
      try {
        const result = await capture.send('Page.captureScreenshot', {
          format: 'png',
          fromSurface: true,
          captureBeyondViewport: false,
        });
        png = Buffer.from(result.data, 'base64');
      } finally {
        await capture.detach();
      }
      expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      const pixels = { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
      expect(pixels.width).toBe(1440);
      expect(pixels.width).toBe(Math.round(after.width * after.ratio));
      const viewport = await geometry();
      expect(pixels.height).toBe(Math.round(viewport.height * viewport.ratio));
      const target = selector
        ? await zoom.page.locator(selector).evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const header = document.querySelector('.portal-header')?.getBoundingClientRect();
            return {
              x: rect.x,
              y: rect.y,
              width: rect.width,
              height: rect.height,
              headerBottom: header?.bottom ?? 0,
            };
          })
        : null;
      if (target) {
        expect(target.x).toBeGreaterThanOrEqual(0);
        expect(target.x + target.width).toBeLessThanOrEqual(viewport.width + 1);
        expect(target.y).toBeGreaterThanOrEqual(Math.max(0, target.headerBottom));
        expect(target.y + target.height).toBeLessThanOrEqual(viewport.height + 1);
      }
      writeFileSync(test.info().outputPath(`${name}.png`), png);
      screenshots.push({ name, pixels, viewport, target });
    }
    for (const colorScheme of ['light', 'dark'] as const) {
      await zoom.page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await assertMetrics(zoom.page);
      await assertLayout(zoom.page, after.width);
      await assertMetricContent(zoom.page);
      await nativeViewport(`native-200-percent-${colorScheme}`);
      for (const metric of ['requests', 'input', 'output'])
        await nativeViewport(
          `native-200-percent-${colorScheme}-${metric}`,
          `[data-testid="ai-usage-${metric}"]`,
        );
      await nativeViewport(`native-200-percent-${colorScheme}-chart`, '.asa-ai-usage-chart-card');
    }
    const reset = await zoom.setZoom(1);
    expect(reset.factor).toBe(1);
    evidence = {
      method: 'Chromium tabs.setZoom, automatic per-tab, viewport:null',
      before,
      applied,
      after,
      screenshots,
      reset,
      trace: 'off',
    };
  } catch (error) {
    failure = { error };
  } finally {
    await zoom.close(failure);
  }
  writeFileSync(test.info().outputPath('safe-native-zoom.json'), JSON.stringify(evidence, null, 2));
}

async function darkContrast(page: Page, includeCollapse: boolean) {
  const selectors = [
    { label: 'Profile name', selector: '.portal-sidebar-profile strong', minimum: 4.5 },
    { label: 'Administration navigation', selector: '.portal-admin-subnav-item', minimum: 4.5 },
    { label: 'Administration scope', selector: '.admin-scope-select select', minimum: 4.5 },
    ...(includeCollapse
      ? [{ label: 'Collapse control', selector: '.portal-sidebar-collapse-visual', minimum: 3 }]
      : [{ label: 'Mobile menu close', selector: '.portal-menu-close', minimum: 4.5 }]),
  ];
  const checks = await page.evaluate((rules) => {
    function color(value: string): [number, number, number, number] {
      const rgb = /^rgba?\(([^)]+)\)$/.exec(value);
      if (!rgb) throw new Error(`Unsupported computed color in contrast evidence: ${value}`);
      const numbers = rgb[1]!
        .split(/[\s,/]+/)
        .filter(Boolean)
        .map(Number);
      if (numbers.length < 3 || numbers.some((n) => !Number.isFinite(n)))
        throw new Error('Invalid computed color in contrast evidence');
      return [numbers[0]!, numbers[1]!, numbers[2]!, numbers[3] ?? 1];
    }
    const composite = (front: number[], back: number[]) =>
      front.slice(0, 3).map((n, i) => n * front[3]! + back[i]! * (1 - front[3]!));
    function background(element: Element): number[] {
      const layers: number[][] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement)
        layers.push(color(getComputedStyle(ancestor).backgroundColor));
      return layers.reverse().reduce((back, front) => composite(front, back), [255, 255, 255]);
    }
    const luminance = (rgb: number[]) =>
      rgb
        .map((n) => {
          const channel = n / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        })
        .reduce((sum, n, i) => sum + n * [0.2126, 0.7152, 0.0722][i]!, 0);
    return rules.map((rule) => {
      const elements = Array.from(document.querySelectorAll(rule.selector)).filter(
        (element) => element.getClientRects().length > 0,
      );
      return {
        label: rule.label,
        minimum: rule.minimum,
        values: elements.map((element) => {
          const back = background(element);
          const front = composite(color(getComputedStyle(element).color), back);
          const a = luminance(front),
            b = luminance(back);
          return {
            foreground: front,
            background: back,
            contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
          };
        }),
      };
    });
  }, selectors);
  for (const check of checks) {
    expect(check.values.length, check.label).toBeGreaterThan(0);
    for (const value of check.values)
      expect(value.contrast, check.label).toBeGreaterThanOrEqual(check.minimum);
  }
  return checks;
}

async function verifyDarkScopes(page: Page, db: pg.Pool, accountId: string) {
  const tenant = await db.query<{ id: string }>(
    'INSERT INTO tenants(title,workspace_slug) VALUES($1,$2) RETURNING id',
    ['Школа проверки обзора ИИ', `ai-overview-${randomUUID()}`],
  );
  const workspace = await db.query<{ id: string }>(
    "INSERT INTO workspaces(tenant_id,kind,title) VALUES($1,'organization',$2) RETURNING id",
    [tenant.rows[0]!.id, 'Школа проверки обзора ИИ'],
  );
  await db.query(
    "INSERT INTO workspace_memberships(account_id,workspace_id,role) VALUES($1,$2,'school_admin')",
    [accountId, workspace.rows[0]!.id],
  );
  const profile = await page.request.get('/api/admin/v1/me');
  expect(profile.status()).toBe(200);
  const scopes = (await profile.json()).scopes;
  expect(scopes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'platform', role: 'platform_admin' }),
      expect.objectContaining({ kind: 'organization', role: 'school_admin' }),
    ]),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.reload();
  await assertMetrics(page);
  await expect(
    page.getByRole('combobox', { name: 'Область управления', exact: true }),
  ).toBeVisible();
  const desktop = await darkContrast(page, true);
  await assertLayout(page, 1440);
  await screenshot(page, 'dark-multiple-scopes-1440');
  await page.setViewportSize({ width: 390, height: 844 });
  await assertLayout(page, 390);
  await screenshot(page, 'dark-multiple-scopes-390');
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  const menu = page.getByRole('dialog', { name: 'Основная навигация', exact: true });
  await expect(menu).toBeVisible();
  await menu.evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations({ subtree: true })
        .map((animation) => animation.finished.catch(() => undefined)),
    );
  });
  const mobile = await darkContrast(page, false);
  await screenshot(page, 'dark-mobile-menu-390');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  writeFileSync(
    test.info().outputPath('safe-dark-contrast.json'),
    JSON.stringify({ scopeCount: scopes.length, desktop, mobile }, null, 2),
  );
}

async function seedUsage(db: pg.Pool, actor: { principalId: string; accountId: string }) {
  const clock = await db.query<{ now: Date }>('SELECT statement_timestamp() AS now');
  const today = new Date(clock.rows[0]!.now);
  today.setUTCHours(0, 0, 0, 0);
  const start = new Date(today);
  start.setUTCDate(start.getUTCDate() - 6);
  const rows: { requestId: string; admittedAt: string; input: number; output: number }[] = [];
  const daily = COUNTS.map((requests, index) => {
    const day = new Date(start);
    day.setUTCDate(day.getUTCDate() + index);
    for (let count = 0; count < requests; count += 1) {
      const ordinal = rows.length + 1;
      rows.push({
        requestId: randomUUID(),
        admittedAt: day.toISOString(),
        input: ordinal * 100,
        output: ordinal * 10,
      });
    }
    return { date: day.toISOString().slice(0, 10), requests };
  });
  const insert = `INSERT INTO ai_usage_journal
    (owner_principal_id,request_id,account_id,admitted_at,status,operation,input_tokens,output_tokens)
    VALUES ($1,$2,$3,$4,'succeeded',$5,$6,$7) ON CONFLICT DO NOTHING`;
  for (const [index, row] of rows.entries()) {
    await db.query(insert, [
      actor.principalId,
      row.requestId,
      actor.accountId,
      row.admittedAt,
      index === rows.length - 1 ? 'regeneration' : 'chat',
      row.input,
      row.output,
    ]);
  }
  // Re-inserting an already recorded operation must not duplicate the request.
  await db.query(insert, [
    actor.principalId,
    rows[0]!.requestId,
    actor.accountId,
    rows[0]!.admittedAt,
    'chat',
    rows[0]!.input,
    rows[0]!.output,
  ]);
  // Both lower and upper boundaries are observed with real journal records.
  for (const admittedAt of [
    new Date(start.getTime() - 1).toISOString(),
    new Date(today.getTime() + 86400000).toISOString(),
  ]) {
    await db.query(insert, [
      actor.principalId,
      randomUUID(),
      actor.accountId,
      admittedAt,
      'chat',
      90000,
      90000,
    ]);
  }
  return { rows, daily, from: start.toISOString(), requests: 9, input: '4500', output: '450' };
}

async function assertMetrics(page: Page, input = '4500', output = '450') {
  for (const [testId, expected] of [
    ['ai-usage-requests', '9'],
    ['ai-usage-input', input],
    ['ai-usage-output', output],
  ]) {
    await expect
      .poll(async () =>
        (await page.getByTestId(testId!).locator('.asa-ai-usage-value bdi').innerText()).replace(
          /\s/g,
          '',
        ),
      )
      .toBe(expected);
  }
}

test(
  BASELINE
    ? 'ASAI-01 pristine source baseline snapshots'
    : 'ASAI-01 real usage overview and owner journey',
  async ({ page }) => {
    const db = e2eAdminPool();
    try {
      // This dedicated job must not reuse another suite's journal or a working DB.
      const emptyJournal = await db.query<{ count: string }>(
        'SELECT count(*) AS count FROM ai_usage_journal',
      );
      expect(emptyJournal.rows[0]!.count).toBe('0');
      const actor = await registerAdministrator(page, db);
      const provenance = await versions(page);
      const tabs = page.getByRole('tablist', { name: 'Разделы ИИ' });
      await page.goto('/#/admin/ai');
      await page.reload();

      if (BASELINE) {
        await expect(tabs.getByRole('tab').first()).toHaveText('Подключения');
        await expect(page.locator('#ai-panel-connections')).toBeVisible();
        const fixture = await seedUsage(db, actor);
        for (const width of [1440, 390]) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
            await screenshot(page, `baseline-source-${width}-${colorScheme}`);
          }
        }
        writeFileSync(
          test.info().outputPath('safe-baseline-summary.json'),
          JSON.stringify(
            {
              kind: 'pristine-source-baseline-rendered-in-this-ci-run',
              note: 'Source baseline snapshot, not a claim of chronological pre-edit capture. The previous admin UI has no dark theme.',
              ...provenance,
              source: 'ai_usage_journal in an isolated disposable PostgreSQL database',
              expected: {
                requests: fixture.requests,
                input: fixture.input,
                output: fixture.output,
                daily: fixture.daily,
              },
            },
            null,
            2,
          ),
        );
        return;
      }

      await expect(tabs.getByRole('tab').nth(0)).toHaveText('Обзор');
      await expect(tabs.getByRole('tab').nth(1)).toHaveText('Настройки');
      await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(page.getByRole('heading', { name: 'Обзор использования ИИ' })).toBeVisible();
      await expect(page.getByText('Данных за период нет', { exact: true })).toBeVisible();
      const initial = await overview(page);
      expect(initial).toMatchObject({
        schemaVersion: 1,
        state: 'empty',
        requests: 0,
        inputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
        outputTokens: { known: '0', knownOperations: 0, unknownOperations: 0 },
      });
      expect(initial.daily).toHaveLength(7);
      expect(initial.daily.every((day) => day.requests === 0)).toBe(true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
      await screenshot(page, 'empty-1440-light');

      const fixture = await seedUsage(db, actor);
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await assertMetrics(page);
      const received = await overview(page);
      expect(received).toMatchObject({
        schemaVersion: 1,
        period: { timeZone: 'UTC', days: 7 },
        requests: fixture.requests,
        state: 'complete',
        inputTokens: { known: fixture.input, knownOperations: 9, unknownOperations: 0 },
        outputTokens: { known: fixture.output, knownOperations: 9, unknownOperations: 0 },
        daily: fixture.daily,
      });
      expect(Date.parse(received.period.from)).toBe(Date.parse(fixture.from));
      const sql = await db.query(
        `SELECT count(*)::integer AS requests, sum(input_tokens)::text AS input,
              sum(output_tokens)::text AS output
         FROM ai_usage_journal WHERE admitted_at >= $1 AND admitted_at < $2`,
        [received.period.from, received.period.to],
      );
      expect(sql.rows).toEqual([{ requests: 9, input: '4500', output: '450' }]);
      writeFileSync(
        test.info().outputPath('safe-control-summary.json'),
        JSON.stringify(
          { kind: 'real-built-api-web-postgresql', ...provenance, sql: sql.rows[0], api: received },
          null,
          2,
        ),
      );

      for (const width of [1440, 390, 320, 768, 1024, 1920]) {
        for (const colorScheme of ['light', 'dark'] as const) {
          await page.setViewportSize({ width, height: 1000 });
          await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
          await page.reload();
          await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
            'aria-selected',
            'true',
          );
          await assertMetrics(page);
          await expect(
            page.getByRole('img', { name: 'Количество запросов по дням за семь дней' }),
          ).toBeVisible();
          await assertLayout(page, width);
          await assertMetricContent(page);
          await screenshot(page, `overview-${width}-${colorScheme}`);
        }
      }
      await page.getByText('Данные по дням', { exact: true }).click();
      const table = page.getByRole('table', { name: 'Запросы по дням' });
      await expect(table).toBeVisible();
      await expect(table.locator('tbody tr')).toHaveCount(7);
      for (const [index, requests] of COUNTS.entries()) {
        await expect(table.locator('tbody tr').nth(index).getByRole('cell').last()).toHaveText(
          String(requests),
        );
      }

      await page.getByRole('tab', { name: 'Настройки', exact: true }).click();
      await expect(page.locator('#ai-panel-settings')).toBeVisible();
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Настройки', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.goto('/#/admin/ai/?section=settings&provider=openai');
      await expect(page.getByRole('tab', { name: 'Настройки', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
      await expect(page).toHaveURL(/#\/admin\/ai\?section=overview&provider=openai$/);
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Обзор', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await assertMetrics(page);
      await page.goto('/#/admin/ai?section=connections&provider=openai');
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await expect(
        page.getByRole('button', { name: /OpenAI/ }).filter({ has: page.locator('strong') }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.goto('/#/explore');
      await page.goto('/#/admin/ai');
      await expect(page.getByRole('tab', { name: 'Подключения', exact: true })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await page.getByRole('tab', { name: 'Обзор', exact: true }).click();
      await assertMetrics(page);

      await verifyKeyboardAndTouch(page);
      await verifyNativeZoom(page);
      await verifyDarkScopes(page, db, actor.accountId);

      // Real PostgreSQL SUM(bigint) exceeds JavaScript's safe integer range.
      // Validate exact rendered decimal strings and wrapping on narrow phones.
      const perOperation = '9007199254740991';
      const largeTotal = (BigInt(perOperation) * 9n).toString();
      await db.query(
        'UPDATE ai_usage_journal SET input_tokens=$2::bigint,output_tokens=$2::bigint WHERE owner_principal_id=$1',
        [actor.principalId, perOperation],
      );
      try {
        await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
        await assertMetrics(page, largeTotal, largeTotal);
        const large = await overview(page);
        expect(large.inputTokens.known).toBe(largeTotal);
        expect(large.outputTokens.known).toBe(largeTotal);
        const groupLayouts: unknown[] = [];
        for (const width of [320, 390]) {
          for (const colorScheme of ['light', 'dark'] as const) {
            await page.setViewportSize({ width, height: 1000 });
            await page.emulateMedia({ colorScheme });
            await assertLayout(page, width);
            await assertMetricContent(page);
            const values = await page
              .locator(
                '[data-testid="ai-usage-input"] .asa-ai-usage-value bdi, ' +
                  '[data-testid="ai-usage-output"] .asa-ai-usage-value bdi',
              )
              .evaluateAll((elements) =>
                elements.map((element) => {
                  const node = element.firstChild;
                  if (!(node instanceof Text) || element.childNodes.length !== 1)
                    throw new Error('Expected one text node containing the formatted token count');
                  const groups = Array.from(node.data.matchAll(/\d+/g), (match) => {
                    const range = document.createRange();
                    range.setStart(node, match.index!);
                    range.setEnd(node, match.index! + match[0].length);
                    return {
                      digits: match[0],
                      rects: Array.from(range.getClientRects(), (rect) => ({
                        x: rect.x,
                        y: rect.y,
                        width: rect.width,
                        height: rect.height,
                      })),
                    };
                  });
                  return { text: node.data, groups };
                }),
              );
            expect(values).toHaveLength(2);
            for (const value of values) {
              expect(value.text.replace(/\D/g, '')).toBe(largeTotal);
              for (const group of value.groups) expect(group.rects, group.digits).toHaveLength(1);
              if (width === 320)
                expect(
                  new Set(value.groups.map((group) => group.rects[0]!.y)).size,
                ).toBeGreaterThan(1);
            }
            groupLayouts.push({ width, colorScheme, values });
            await screenshot(page, `long-token-counts-${width}-${colorScheme}`);
          }
        }
        writeFileSync(
          test.info().outputPath('safe-large-token-summary.json'),
          JSON.stringify({ expectedTotal: largeTotal, api: large, groupLayouts }, null, 2),
        );
      } finally {
        for (const row of fixture.rows) {
          await db.query(
            'UPDATE ai_usage_journal SET input_tokens=$3,output_tokens=$4 WHERE owner_principal_id=$1 AND request_id=$2',
            [actor.principalId, row.requestId, row.input, row.output],
          );
        }
      }
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await assertMetrics(page);

      await page.setViewportSize({ width: 390, height: 844 });
      await page.emulateMedia({ colorScheme: 'light' });
      const blocker = await db.connect();
      try {
        // A short transaction on this dedicated disposable database delays the
        // real source read. There is no browser routing or fake successful API.
        await blocker.query('BEGIN');
        await blocker.query('LOCK TABLE ai_usage_journal IN ACCESS EXCLUSIVE MODE');
        await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
        await expect(page.getByText('Загружаем данные…', { exact: true })).toBeVisible();
        await screenshot(page, 'loading-390-light');
      } finally {
        try {
          await blocker.query('ROLLBACK');
        } finally {
          blocker.release();
        }
      }
      await assertMetrics(page);

      const available = await db.query<{ exists: boolean; spare: boolean }>(
        "SELECT to_regprocedure('public.ai_usage_overview(uuid,timestamptz)') IS NOT NULL AS exists, to_regprocedure('public.asai_overview_fixture_unavailable(uuid,timestamptz)') IS NULL AS spare",
      );
      expect(available.rows[0]).toEqual({ exists: true, spare: true });
      try {
        // The whole database belongs to this disposable CI job. Temporarily
        // unavailable SQL proves a real 503 and retry; preserve the function and
        // its privileges by restoring its name in finally, without replacing it.
        await db.query(
          'ALTER FUNCTION public.ai_usage_overview(uuid,timestamptz) RENAME TO asai_overview_fixture_unavailable',
        );
        const failure = await page.request.get(ENDPOINT);
        expect(failure.status()).toBe(503);
        expect((await failure.json()).error.code).toBe('ai_usage_unavailable');
        await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
        await expect(
          page.getByRole('heading', { name: 'Не удалось загрузить данные', exact: true }),
        ).toBeVisible();
        await expect(page.getByText('Данных за период нет', { exact: true })).toHaveCount(0);
        await screenshot(page, 'source-error-390-light');
      } finally {
        await db.query(
          'ALTER FUNCTION public.asai_overview_fixture_unavailable(uuid,timestamptz) RENAME TO ai_usage_overview',
        );
      }
      await page.getByRole('button', { name: 'Повторить загрузку', exact: true }).click();
      await assertMetrics(page);

      await db.query(
        'UPDATE ai_usage_journal SET input_tokens=NULL WHERE owner_principal_id=$1 AND request_id=$2',
        [actor.principalId, fixture.rows[0]!.requestId],
      );
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await expect(page.getByText('Расход известен не полностью', { exact: true })).toBeVisible();
      await assertMetrics(page, '4400');
      expect(await overview(page)).toMatchObject({
        state: 'partial',
        requests: 9,
        inputTokens: { known: '4400', knownOperations: 8, unknownOperations: 1 },
        outputTokens: { known: '450', knownOperations: 9, unknownOperations: 0 },
      });
      await screenshot(page, 'partial-390-light');
      await db.query(
        'UPDATE ai_usage_journal SET input_tokens=NULL,output_tokens=NULL WHERE owner_principal_id=$1',
        [actor.principalId],
      );
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      expect(await overview(page)).toMatchObject({
        state: 'partial',
        inputTokens: { known: null, knownOperations: 0, unknownOperations: 9 },
        outputTokens: { known: null, knownOperations: 0, unknownOperations: 9 },
      });
      await expect(
        page.getByTestId('ai-usage-input').locator('.asa-ai-usage-value bdi'),
      ).toHaveText('Неизвестно');
      await expect(
        page.getByTestId('ai-usage-output').locator('.asa-ai-usage-value bdi'),
      ).toHaveText('Неизвестно');
      await screenshot(page, 'unknown-tokens-390-light');
      // Remove only this fixture's records; an empty response must remain distinct
      // from both the previous partial state and the genuine source error.
      await db.query('DELETE FROM ai_usage_journal WHERE owner_principal_id=$1', [
        actor.principalId,
      ]);
      await page.getByRole('button', { name: 'Обновить данные', exact: true }).click();
      await expect(page.getByText('Данных за период нет', { exact: true })).toBeVisible();
      expect((await overview(page)).state).toBe('empty');
    } finally {
      await db.end();
    }
  },
);
