import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { fixture, classId, origin, seat } from './fixtures/classroom-owner';

const out = 'e2e/artifacts/owner-preview/classroom-rows';
const rowsSelector = '.classroom-list > .classroom-list-row';
const rosterSelector = '.classroom-roster-row';
const topSelectors = ['.portal-header', '.classroom-head', '.classroom-tabbar'];
const id = (i: number) =>
  i === 0 ? classId : `10000000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`;
const title = (i: number) => (i === 0 ? '7А Робототехника' : `${i + 1}Б — Робототехника`);
const winners = [12, 3, 20];
const unauthorizedId = '90000000-0000-4000-8000-000000000001';
type Box = { x: number; y: number; width: number; height: number };
type Mode = 'complete' | 'mixed' | 'incomplete';

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });
test.beforeAll(() => mkdirSync(out, { recursive: true }));

function summary(mode: Mode = 'complete') {
  const items = Array.from({ length: 24 }, (_, i) => ({
    classroomId: id(i),
    students: 15 + (i % 4),
    works: 7 + i * 3,
    assigned: 21 + i * 2,
    submitted: 9 + i,
    waiting: i % 5,
    notSubmitted: 2 + (i % 3),
    averageRating: i === 12 ? 99 : i === 3 ? 98 : i === 20 ? 97 : 40 + i,
    ratingParticipants: 15 + (i % 4),
    ratingPeriodDays: mode === 'mixed' && i === 3 ? 7 : 30,
  }));
  const totals = items.reduce(
    (a, r) => ({
      students: a.students + r.students,
      works: a.works + r.works,
      assigned: a.assigned + r.assigned,
      submitted: a.submitted + r.submitted,
      waiting: a.waiting + r.waiting,
      notSubmitted: a.notSubmitted + r.notSubmitted,
    }),
    { students: 0, works: 0, assigned: 0, submitted: 0, waiting: 0, notSubmitted: 0 },
  );
  // Preserve all 24 authorized IDs and count fields; omit one rating only.
  const authorized = items.map((r, i) =>
    mode === 'incomplete' && i === 3
      ? {
          ...r,
          averageRating: undefined,
          ratingParticipants: undefined,
          ratingPeriodDays: undefined,
        }
      : r,
  );
  return {
    items: [
      ...authorized,
      {
        ...items[0]!,
        classroomId: unauthorizedId,
        averageRating: 100,
      },
    ],
    totals,
  };
}

async function ratings(page: Page, mode: Mode = 'complete', hold?: Promise<void>) {
  await page.route('**/api/classrooms/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (!path.includes('observation') || !path.endsWith('/summary')) return route.fallback();
    if (hold) await hold;
    await route.fulfill({ json: summary(mode) });
  });
}

async function settle(page: Page) {
  await page.evaluate(async () => {
    await document.fonts.ready;
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
}

async function boxes(locator: Locator): Promise<Box[]> {
  return locator.evaluateAll((elements) =>
    elements.map((element) => {
      const r = element.getBoundingClientRect();
      return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
    }),
  );
}

function unchanged(before: Box[], after: Box[]) {
  expect(after).toHaveLength(before.length);
  before.forEach((box, i) => {
    for (const key of ['x', 'y', 'width', 'height'] as const)
      expect(Math.abs(after[i]![key] - box[key]), `${i}.${key}`).toBeLessThanOrEqual(0.5);
  });
}

function continuous(rects: Box[], maximum: number) {
  expect(rects).toHaveLength(24);
  for (const r of rects) {
    expect(r.height).toBeGreaterThan(0);
    expect(r.height).toBeLessThanOrEqual(maximum);
  }
  for (let i = 1; i < rects.length; i++)
    expect(Math.abs(rects[i]!.y - rects[i - 1]!.y - rects[i - 1]!.height)).toBeLessThanOrEqual(0.5);
}

async function frame(locator: Locator) {
  await expect(locator).toHaveCount(1);
  const borders = await locator.evaluate((element) => {
    const s = getComputedStyle(element);
    return [s.borderTopWidth, s.borderRightWidth, s.borderBottomWidth, s.borderLeftWidth].map(
      parseFloat,
    );
  });
  borders.forEach((width) => expect(width).toBeGreaterThan(0));
}

async function evidence(page: Page, info: TestInfo, name: string, geometry: unknown) {
  await info.attach(name + '-geometry', {
    body: JSON.stringify(geometry, null, 2),
    contentType: 'application/json',
  });
  const path = `${out}/${name}-${info.project.name.replace(/[^a-z0-9_-]/gi, '_')}-${info.retry}.png`;
  await page.screenshot({ path, fullPage: true });
  await info.attach(name, { path, contentType: 'image/png' });
}

async function loaded(page: Page) {
  await expect(page.locator(rowsSelector)).toHaveCount(24);
  await expect(page.locator('.classroom-row-works .classroom-stat-number').first()).not.toHaveText(
    '—',
  );
  await expect(page.locator('.classroom-row-medal')).toHaveCount(3);
  await settle(page);
}

async function badgeMap(page: Page) {
  const result: Record<string, string> = {};
  for (const i of winners) {
    const button = page.getByRole('button', { name: title(i), exact: true });
    await expect(button).toHaveCount(1);
    const row = page.locator(rowsSelector).filter({ has: button });
    const rank = winners.indexOf(i) + 1;
    await expect(row.locator(`.classroom-row-medal-${rank}`)).toHaveText(`◆${rank}`);
    const slot = await row.locator('.classroom-row-index').boundingBox();
    expect(slot).not.toBeNull();
    expect(Math.abs(slot!.width - 32)).toBeLessThanOrEqual(0.5);
    await expect(button).toHaveAccessibleName(title(i));
    await expect(button).toHaveAccessibleDescription(
      new RegExp(`${rank}-е место.*30 дней.*${100 - rank} из 100`),
    );
    const described = await button.getAttribute('aria-describedby');
    expect(described).toBeTruthy();
    for (const descriptionId of described!.split(/\s+/)) {
      const description = page.locator(`[id="${descriptionId}"]`);
      await expect(description).toHaveCount(1);
      expect(
        await description.evaluate((e) => {
          const r = e.getBoundingClientRect();
          const s = getComputedStyle(e);
          return (
            s.position === 'absolute' &&
            (r.width <= 1 || s.clip !== 'auto' || s.clipPath !== 'none')
          );
        }),
      ).toBe(true);
    }
    result[id(i)] = String(rank);
  }
  return result;
}

async function noOverflow(page: Page, width: number) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
    width + 1,
  );
}

async function hitVisible(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect(locator).toBeVisible();
  expect(
    await locator.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      return (
        r.width > 0 &&
        r.height > 0 &&
        x >= 0 &&
        x < innerWidth &&
        y >= 0 &&
        y < innerHeight &&
        !!hit &&
        (element.contains(hit) || hit.contains(element))
      );
    }),
  ).toBe(true);
}

for (const sidebar of ['expanded', 'collapsed'] as const) {
  test(`24 compact classes fit FHD, ${sidebar}`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    const state = await fixture(page, 24, { classes: 24, sidebar });
    await ratings(page);
    await page.goto('/#/classrooms', { waitUntil: 'domcontentloaded' });
    await loaded(page);
    expect(await page.evaluate(() => matchMedia('(pointer: fine)').matches)).toBe(true);
    const rects = await boxes(page.locator(rowsSelector));
    continuous(rects, 30.5);
    const visible = await page.locator(rowsSelector).evaluateAll(
      (elements) =>
        elements.filter((e) => {
          const r = e.getBoundingClientRect();
          return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth;
        }).length,
    );
    expect(visible).toBeGreaterThanOrEqual(24);
    await frame(page.locator('.classroom-list'));
    const sizes = await page
      .locator(rowsSelector)
      .first()
      .evaluate((row) => ({
        title: parseFloat(getComputedStyle(row.querySelector('.classroom-row-title')!).fontSize),
        numbers: Array.from(row.querySelectorAll('.classroom-stat-number')).map((e) =>
          parseFloat(getComputedStyle(e).fontSize),
        ),
      }));
    expect(sizes.title).toBeGreaterThanOrEqual(16);
    expect(sizes.numbers.length).toBeGreaterThan(0);
    sizes.numbers.forEach((size) => expect(size).toBeGreaterThanOrEqual(13));
    await badgeMap(page);
    await evidence(page, info, `classes-fhd-${sidebar}`, {
      first: rects[0],
      last: rects.at(-1),
      rects,
      fullyVisible: visible,
      sizes,
    });
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}

async function topBoxes(page: Page) {
  const result: Box[] = [];
  for (const selector of topSelectors) {
    await expect(page.locator(selector)).toHaveCount(1);
    result.push(...(await boxes(page.locator(selector))));
  }
  return result;
}

async function sortState(button: Locator) {
  return button.evaluate((element) => {
    const owner = element.closest('[aria-sort]');
    return {
      pressed: element.getAttribute('aria-pressed'),
      direction: element.getAttribute('aria-description'),
      sort: owner?.getAttribute('aria-sort') ?? null,
    };
  });
}

async function rosterGeometry(page: Page) {
  const rows = page.locator(rosterSelector);
  await expect(rows).toHaveCount(24);
  const rects = await boxes(rows);
  continuous(rects, 31);
  const styles = await rows.evaluateAll((elements) =>
    elements.map((row) => {
      const avatar = row.querySelector<HTMLElement>('.classroom-seat-avatar');
      const name = row.querySelector<HTMLElement>('.classroom-student-name strong');
      if (!avatar || !name)
        throw new Error('Roster avatar/name selector must match the actual production markup');
      const a = avatar.getBoundingClientRect();
      const s = getComputedStyle(row);
      return {
        avatarWidth: a.width,
        avatarHeight: a.height,
        name: parseFloat(getComputedStyle(name).fontSize),
        radius: [
          s.borderTopLeftRadius,
          s.borderTopRightRadius,
          s.borderBottomLeftRadius,
          s.borderBottomRightRadius,
        ].map(parseFloat),
      };
    }),
  );
  styles.forEach((s) => {
    expect(Math.abs(s.avatarWidth - 25)).toBeLessThanOrEqual(0.5);
    expect(Math.abs(s.avatarHeight - 25)).toBeLessThanOrEqual(0.5);
    expect(s.name).toBeGreaterThanOrEqual(16);
    s.radius.forEach((radius) => expect(radius).toBe(0));
  });
  // The frame must contain the actual roster rows, not a separate decorative element.
  const container = rows.first().locator('..');
  await frame(container);
  expect(await container.locator(rosterSelector).count()).toBe(24);
  return { rects, styles };
}

test('actual classroom roster stays continuous during sort and real code-copy feedback', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin });
  const state = await fixture(page, 24, { classes: 24, sidebar: 'expanded' });
  const pupils = Array.from({ length: 24 }, (_, i) => ({ ...seat(i), awaitingReview: i % 4 }));
  await page.route(`**/api/classrooms/${classId}/roster`, (route) =>
    route.fulfill({ json: { items: pupils } }),
  );
  await ratings(page);
  await page.goto(`/#/classrooms/${classId}`, { waitUntil: 'domcontentloaded' });
  await expect(page.locator(rosterSelector)).toHaveCount(24);
  await settle(page);
  const before = await rosterGeometry(page);
  const top = await topBoxes(page);
  const group = page.locator('.classroom-roster-sortgroup');
  await expect(group).toHaveCount(1);
  const submitted = group.getByRole('button', { name: /Сдано/i });
  const awaiting = group.getByRole('button', { name: /ждут/i });
  await expect(submitted).toBeVisible();
  await expect(awaiting).toBeVisible();
  const header = await boxes(group.getByRole('button'));
  expect(header.length).toBeGreaterThanOrEqual(2);
  header.forEach((r) => expect(Math.abs(r.y - header[0]!.y)).toBeLessThanOrEqual(1));
  for (const button of [submitted, awaiting]) {
    await button.click();
    await expect
      .poll(async () => {
        const s = await sortState(button);
        return s.pressed === 'true' || s.sort === 'ascending' || s.sort === 'descending';
      })
      .toBe(true);
    await expect(button).toHaveAttribute('aria-description', 'Текущая сортировка по убыванию');
    const firstState = await sortState(button);
    const firstOrder = await page
      .locator(`${rosterSelector} .classroom-student-name strong`)
      .allTextContents();
    const metric = button === submitted ? 'submittedCount' : 'awaitingReview';
    const expectedOrder = (direction: 1 | -1) =>
      [...pupils]
        .sort(
          (a, b) =>
            direction * (a[metric] - b[metric]) ||
            a.displayLabel.localeCompare(b.displayLabel, 'ru-RU', { numeric: true }),
        )
        .map((pupil) => pupil.displayLabel);
    expect(firstOrder).toEqual(expectedOrder(-1));
    await button.click();
    await expect.poll(() => sortState(button)).not.toEqual(firstState);
    await expect(button).toHaveAttribute('aria-description', 'Текущая сортировка по возрастанию');
    await expect
      .poll(() =>
        page.locator(`${rosterSelector} .classroom-student-name strong`).allTextContents(),
      )
      .toEqual(expectedOrder(1));
    await settle(page);
    unchanged(top, await topBoxes(page));
    unchanged(before.rects, (await rosterGeometry(page)).rects);
  }
  const firstPupilCode = page.locator(`${rosterSelector} .classroom-login-handle`).first();
  await firstPupilCode.click();
  const feedback = page.locator('.system-feedback-ribbon');
  await expect(feedback).toContainText('Код ученика скопирован.');
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(pupils[0]!.studentCode);
  await expect(feedback).toBeVisible();
  await expect(feedback).not.toContainText('ABC DEF 234');
  await settle(page);
  unchanged(top, await topBoxes(page));
  unchanged(before.rects, (await rosterGeometry(page)).rects);
  await evidence(page, info, 'roster-copy-feedback', {
    top,
    before,
    after: await rosterGeometry(page),
    header,
  });
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('late metrics preserve every row and title position; ranking uses the full authorized list', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1920, height: 900 });
  const state = await fixture(page, 24, { classes: 24, sidebar: 'expanded' });
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  await ratings(page, 'complete', held);
  try {
    await page.goto('/#/classrooms', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(rowsSelector)).toHaveCount(24);
    await settle(page);
    await expect(page.locator('.classroom-row-medal')).toHaveCount(0);
    const before = {
      rows: await boxes(page.locator(rowsSelector)),
      titles: await boxes(page.locator(`${rowsSelector} .classroom-row-title`)),
      text: await page
        .locator(`${rowsSelector} .classroom-row-title-text`)
        .evaluateAll((elements) =>
          elements.map((element) => {
            const range = document.createRange();
            const textNode = Array.from(element.childNodes).find(
              (node) => node.nodeType === Node.TEXT_NODE && node.textContent?.trim(),
            );
            if (!textNode) throw new Error('Expected a title text node for text-position evidence');
            range.selectNodeContents(textNode);
            const r = range.getBoundingClientRect();
            return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
          }),
        ),
    };
    release();
    await loaded(page);
    const after = {
      rows: await boxes(page.locator(rowsSelector)),
      titles: await boxes(page.locator(`${rowsSelector} .classroom-row-title`)),
    };
    unchanged(before.rows, after.rows);
    unchanged(before.titles, after.titles);
    const afterText = await page
      .locator(`${rowsSelector} .classroom-row-title-text`)
      .evaluateAll((elements) =>
        elements.map((element) => {
          const range = document.createRange();
          const node = Array.from(element.childNodes).find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim(),
          );
          if (!node) throw new Error('Expected title text node');
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          return { x: r.left + scrollX, y: r.top + scrollY, width: r.width, height: r.height };
        }),
      );
    unchanged(before.text, afterText);
    const ranks = await badgeMap(page);
    const search = page.getByRole('searchbox', { name: 'Поиск класса по названию' });
    await search.fill(title(20));
    await expect(page.locator(rowsSelector)).toHaveCount(1);
    await expect(page.locator('.classroom-row-medal-3')).toHaveText('◆3');
    await expect(page.locator('.classroom-row-medal-1')).toHaveCount(0);
    await search.clear();
    await expect(page.locator(rowsSelector)).toHaveCount(24);
    for (const selector of ['.classroom-head-title button', '.classroom-head-rating button']) {
      const sort = page.locator(selector);
      await expect(sort).toHaveCount(1);
      await sort.click();
      expect(await badgeMap(page)).toEqual(ranks);
    }
    await expect(page.locator('.classroom-row-medal')).toHaveCount(3);
    await evidence(page, info, 'late-summary', {
      before,
      after,
      afterText,
      ranks,
      unauthorizedMetric: unauthorizedId,
    });
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  } finally {
    release();
  }
});

for (const mode of ['mixed', 'incomplete'] as const) {
  test(`${mode} summary suppresses all medals without fabricating zero`, async ({ page }, info) => {
    await page.setViewportSize({ width: 1920, height: 900 });
    const state = await fixture(page, 24, { classes: 24 });
    await ratings(page, mode);
    await page.goto('/#/classrooms', { waitUntil: 'domcontentloaded' });
    await expect(page.locator(rowsSelector)).toHaveCount(24);
    const winner = page
      .locator(rowsSelector)
      .filter({ has: page.getByRole('button', { name: title(12), exact: true }) });
    await expect(winner.locator('.classroom-row-rating')).toContainText('99');
    await settle(page);
    await expect(page.locator('.classroom-row-medal')).toHaveCount(0);
    const affected = page
      .locator(rowsSelector)
      .filter({ has: page.getByRole('button', { name: title(3), exact: true }) });
    if (mode === 'incomplete') {
      await expect(affected.locator('.classroom-row-rating')).toContainText('—');
      await expect(affected.locator('.classroom-row-rating')).not.toHaveText(/^\s*0\s*%?\s*$/);
    } else await expect(affected.locator('.classroom-row-rating')).toContainText('98');
    await evidence(page, info, `summary-${mode}`, {
      ratings: await page.locator('.classroom-row-rating').allTextContents(),
    });
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}

const matrix = [320, 390, 1024, 1366].flatMap((width) =>
  (['expanded', 'collapsed'] as const).map((sidebar) => ({ width, sidebar })),
);
const longTitle = '7А — Робототехника и исследование электрических цепей';
const longPupil = 'Александра Константиновна Александрова';
for (const { width, sidebar } of matrix) {
  test(`responsive rows ${width} ${sidebar}`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page, 24, { classes: 24, sidebar, classroomTitle: longTitle });
    await ratings(page);
    await page.route(`**/api/classrooms/${classId}/roster`, (route) =>
      route.fulfill({
        json: {
          items: Array.from({ length: 24 }, (_, i) => seat(i, i === 0 ? longPupil : undefined)),
        },
      }),
    );
    await page.goto('/#/classrooms', { waitUntil: 'domcontentloaded' });
    await loaded(page);
    await noOverflow(page, width);
    const fullTitle = page.getByRole('button', { name: longTitle, exact: true });
    await hitVisible(fullTitle);
    expect(
      await fullTitle.evaluate(
        (e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
      ),
    ).toBe(true);
    if (width < 600) {
      expect((await fullTitle.boundingBox())!.height).toBeGreaterThanOrEqual(40);
      await expect(page.getByLabel('Порядок классов')).toBeVisible();
    } else {
      const rects = await boxes(page.locator(rowsSelector));
      for (let i = 1; i < rects.length; i++)
        expect(Math.abs(rects[i]!.y - rects[i - 1]!.y - rects[i - 1]!.height)).toBeLessThanOrEqual(
          0.5,
        );
      await frame(page.locator('.classroom-list'));
    }
    // Exercise an actual row menu, rather than only the toolbar menu.
    const row = page.locator(rowsSelector).filter({ has: fullTitle });
    const menuButton = row.getByRole('button', { name: /действия|меню|ещё/i });
    await expect(menuButton).toHaveCount(1);
    await hitVisible(menuButton);
    await menuButton.click();
    const menu = page.locator('.dropdown-menu:visible');
    await expect(menu).toHaveCount(1);
    const menuBox = await menu.boundingBox();
    expect(menuBox).not.toBeNull();
    expect(menuBox!.x).toBeGreaterThanOrEqual(0);
    expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width + 1);
    await hitVisible(menu);
    await noOverflow(page, width);
    await evidence(page, info, `classes-menu-${width}-${sidebar}`, {
      menuBox,
      rows: await boxes(page.locator(rowsSelector)),
    });
    await page.keyboard.press('Escape');
    await page.goto(`/#/classrooms/${classId}`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator(rosterSelector)).toHaveCount(24);
    await settle(page);
    await noOverflow(page, width);
    const pupil = page
      .locator(rosterSelector)
      .filter({ hasText: longPupil })
      .locator('.classroom-student-name strong');
    await expect(pupil).toHaveText(longPupil);
    await hitVisible(pupil);
    expect(
      await pupil.evaluate(
        (e) => e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1,
      ),
    ).toBe(true);
    if (width >= 1024) {
      const avatars = await boxes(page.locator(`${rosterSelector} .classroom-seat-avatar`));
      expect(avatars).toHaveLength(24);
      avatars.forEach((a) => {
        expect(Math.abs(a.width - 25)).toBeLessThanOrEqual(0.5);
        expect(Math.abs(a.height - 25)).toBeLessThanOrEqual(0.5);
      });
      const rects = await boxes(page.locator(rosterSelector));
      for (let i = 1; i < rects.length; i++)
        expect(Math.abs(rects[i]!.y - rects[i - 1]!.y - rects[i - 1]!.height)).toBeLessThanOrEqual(
          0.5,
        );
      await frame(page.locator(rosterSelector).first().locator('..'));
    }
    await evidence(page, info, `roster-${width}-${sidebar}`, {
      rows: await boxes(page.locator(rosterSelector)),
      longPupil,
    });
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}

for (const width of [390, 1920] as const) {
  test(`coarse pointer retains row targets and reachable menu edges at ${width}`, async ({
    browser,
  }, info) => {
    const context = await browser.newContext({
      baseURL: origin,
      viewport: { width, height: 900 },
      hasTouch: true,
      isMobile: width < 600,
      locale: 'ru-RU',
    });
    try {
      const page = await context.newPage();
      const state = await fixture(page, 24, { classes: 24, sidebar: 'collapsed' });
      await ratings(page);
      await page.goto(origin + '/#/classrooms');
      await loaded(page);
      expect(await page.evaluate(() => matchMedia('(pointer: coarse)').matches)).toBe(true);
      const rowBoxes = await boxes(page.locator(rowsSelector));
      rowBoxes.forEach((box) => expect(box.height).toBeGreaterThanOrEqual(38));
      const last = page.locator(rowsSelector).last();
      const opener = last.locator('.classroom-row-menu > summary');
      await opener.scrollIntoViewIfNeeded();
      await opener.tap();
      const menu = page.locator('.dropdown-menu:visible');
      await expect(menu).toHaveCount(1);
      const actions = menu.getByRole('button');
      expect(await actions.count()).toBeGreaterThan(0);
      await hitVisible(actions.first());
      await hitVisible(actions.last());
      await noOverflow(page, width);
      await evidence(page, info, `coarse-${width}`, { rows: rowBoxes });
      expect(state.errors).toEqual([]);
      expect(state.mutations).toEqual([]);
    } finally {
      await context.close();
    }
  });
}
