import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { classId, fixture } from './fixtures/classroom-owner';

const out = 'e2e/artifacts/owner-preview/portal-header-adaptive';
const widths = [
  320, 360, 390, 430, 540, 600, 601, 680, 768, 820, 900, 1023, 1024, 1097, 1250, 1440, 1920, 2560,
  3840,
] as const;

test.use({ locale: 'ru-RU', timezoneId: 'Europe/Moscow' });

test('shared portal header stays on one row with useful labels and 4K scaling', async ({
  page,
}) => {
  test.setTimeout(120_000);
  mkdirSync(out, { recursive: true });
  const state = await fixture(page, 15, { classes: 23, sidebar: 'expanded' });
  await page.goto('/#/classrooms');
  await expect(page.getByRole('navigation', { name: 'Разделы ASA Lab' })).toBeVisible();
  // The same owner-approved brain glyph must appear in the desktop top AI link.
  const aiBrain = page
    .locator('.portal-global-nav')
    .getByRole('link', { name: 'ИИ', exact: true })
    .locator('.portal-ai-glyph svg');
  await expect(aiBrain).toHaveCount(1);
  await expect(aiBrain).toHaveAttribute('viewBox', '0 0 24 24');
  await expect(aiBrain).toHaveAttribute('width', '20');
  await expect(aiBrain).toHaveAttribute('height', '20');
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect(aiBrain, width + ': brain glyph rendered width').toHaveCSS('width', '20px');
    await expect(aiBrain, width + ': brain glyph rendered height').toHaveCSS('height', '20px');
    const result = await page.evaluate(() => {
      const box = (selector: string) => {
        const element = document.querySelector<HTMLElement>(selector);
        if (!element) throw new Error('Missing header element: ' + selector);
        const rect = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        return {
          x: rect.left,
          right: rect.right,
          y: rect.top,
          h: rect.height,
          w: rect.width,
          display: computed.display,
          fontSize: parseFloat(computed.fontSize),
        };
      };
      const navItems = [
        ...document.querySelectorAll<HTMLElement>('.portal-header .portal-global-nav a'),
      ];
      return {
        width: innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        header: box('.portal-shell .portal-header'),
        brand: box('.portal-header .portal-brand'),
        create: box('.portal-header .portal-quick-create'),
        account: box('.portal-header .portal-account'),
        menu: box('.portal-header .portal-menu-toggle'),
        nav: box('.portal-header .portal-global-nav'),
        navLabels: navItems.map((item) => {
          const label = item.querySelector<HTMLElement>('span')!;
          return {
            text: label.textContent,
            width: label.getBoundingClientRect().width,
            clipped: getComputedStyle(label).clipPath === 'inset(50%)',
            accessible: item.getAttribute('aria-label'),
            box: item.getBoundingClientRect().toJSON(),
            labelBox: label.getBoundingClientRect().toJSON(),
          };
        }),
        viewportScrollbar: getComputedStyle(document.documentElement).scrollbarWidth,
      };
    });
    const expectedHeight = width > 1920 ? Math.min(72, Math.max(56, 40 + width / 120)) : 56;
    expect(result.header.h, width + ': single-row header').toBeCloseTo(expectedHeight, 1);
    expect(result.pageWidth, width + ': no page horizontal overflow').toBeLessThanOrEqual(
      width + 1,
    );
    const items = [result.brand, result.nav, result.create, result.account];
    if (width <= 1023) items.push(result.menu);
    for (const item of items) {
      expect(item.y, width + ': child top').toBeGreaterThanOrEqual(-1);
      expect(item.y + item.h, width + ': child bottom').toBeLessThanOrEqual(result.header.h + 1);
      expect(item.x, width + ': child left').toBeGreaterThanOrEqual(-1);
      expect(item.right, width + ': child right').toBeLessThanOrEqual(width + 1);
    }
    // No visual overlaps: testing outer grid cells alone missed the case where
    // 44px icon hitboxes contained full labels wider than the cell at 768px.
    expect(result.brand.right, width + ': brand vs nav').toBeLessThanOrEqual(result.nav.x - 1);
    expect(result.nav.right, width + ': nav vs create').toBeLessThanOrEqual(result.create.x - 1);
    expect(result.create.right, width + ': create vs avatar').toBeLessThanOrEqual(
      result.account.x - 1,
    );
    for (const target of [result.brand, result.create, result.account]) {
      expect(target.w, width + ': 44px header target width').toBeGreaterThanOrEqual(44);
      expect(target.h, width + ': 44px header target height').toBeGreaterThanOrEqual(44);
    }
    if (width <= 1023) {
      expect(result.menu.w, width + ': 44px menu width').toBeGreaterThanOrEqual(44);
      expect(result.menu.h, width + ': 44px menu height').toBeGreaterThanOrEqual(44);
    }
    if (width <= 600) {
      expect(result.nav.w, width + ': three mobile navigation targets').toBe(132);
    }
    for (let index = 0; index < result.navLabels.length; index++) {
      const link = result.navLabels[index]!;
      expect(link.box.left, width + ': nav link left').toBeGreaterThanOrEqual(result.nav.x - 1);
      expect(link.box.right, width + ': nav link right').toBeLessThanOrEqual(result.nav.right + 1);
      if (width >= 601) {
        expect(link.labelBox.left, width + ': text left').toBeGreaterThanOrEqual(link.box.left - 1);
        expect(link.labelBox.right, width + ': text right').toBeLessThanOrEqual(link.box.right + 1);
      }
      if (index > 0) {
        expect(
          result.navLabels[index - 1]!.box.right,
          width + ': links overlap',
        ).toBeLessThanOrEqual(link.box.left);
      }
    }
    expect(result.navLabels.map((x) => x.accessible)).toEqual(['Проекты', 'Знания', 'ИИ']);
    for (const link of result.navLabels) {
      expect(link.box.width, width + ': 44px navigation target').toBeGreaterThanOrEqual(44);
      expect(link.box.height, width + ': 44px navigation target').toBeGreaterThanOrEqual(44);
    }
    if (width >= 601) {
      expect(
        result.navLabels.every(
          (item) => item.width > (item.accessible === 'ИИ' ? 15 : 35) && !item.clipped,
        ),
        width + ': visible text',
      ).toBe(true);
    } else {
      expect(
        result.navLabels.every((item) => item.clipped),
        width + ': accessible icons',
      ).toBe(true);
    }
    expect(result.menu.display === 'none', width + ': drawer trigger').toBe(width > 1023);
    expect(result.viewportScrollbar, width + ': decorative page scrollbar hidden').toBe('none');
    if ([320, 390, 540, 768, 900, 1023, 1024, 1097, 1440, 1920, 2560, 3840].includes(width)) {
      await page.screenshot({ path: out + '/portal-header-' + width + '.png', fullPage: false });
    }
    if (width <= 560) {
      await expect(page.locator('.portal-header-create > span:first-child')).toBeVisible();
      await expect(page.locator('.portal-header-create-label')).toBeHidden();
    }
    if ([320, 390, 560].includes(width)) {
      await page.locator('.portal-quick-create > summary').click();
      const popup = page.locator('.portal-header .portal-create-options');
      await expect(popup).toBeVisible();
      const bounding = await popup.boundingBox();
      expect(bounding).not.toBeNull();
      expect(bounding!.x, width + ': create popup left').toBeGreaterThanOrEqual(-1);
      expect(bounding!.x + bounding!.width, width + ': create popup right').toBeLessThanOrEqual(
        width + 1,
      );
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
    if (width === 1920) expect(result.navLabels[0]!.box.height).toBeGreaterThanOrEqual(40);
    if (width === 3840) expect(result.navLabels[0]!.box.height).toBeGreaterThanOrEqual(50);
  }
  expect(state.errors).toEqual([]);
  expect(state.mutations).toEqual([]);
});

test('header remains pinned on scroll and on other portal routes', async ({ page }) => {
  test.setTimeout(100_000);
  const state = await fixture(page, 15, { classes: 23 });
  const header = page.getByRole('banner');
  const navigation = header.getByRole('navigation', { name: 'Разделы ASA Lab', exact: true });
  const projectsLink = navigation.getByRole('link', { name: 'Проекты', exact: true });
  for (const route of ['/#/classrooms', '/#/explore', '/#/gallery', '/#/knowledge']) {
    await page.setViewportSize({ width: 768, height: 650 });
    await page.goto(route);
    await expect(header).toBeVisible();
    await expect(projectsLink).toBeVisible();
    await expect(projectsLink).toHaveAttribute('href', '/#/explore');
    await expect(navigation.getByRole('link', { name: 'Знания', exact: true })).toBeVisible();
    await expect(header).toHaveCSS('height', '56px');
    if (route === '/#/explore' || route === '/#/gallery') {
      await expect(page).toHaveURL(/#\/explore$/);
    }
  }
  await page.setViewportSize({ width: 390, height: 650 });
  await page.goto('/#/classrooms');
  await page.getByRole('button', { name: 'Открыть меню' }).click();
  await expect(page.locator('.portal-sidebar.mobile-open')).toBeVisible();
  await expect(page.locator('.portal-sidebar.mobile-open .portal-mobile-public')).toBeVisible();
  await expect(
    page.locator('.portal-mobile-public').getByRole('link', { name: 'ИИ', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.portal-sidebar.mobile-open')).toHaveCount(0);
  await page.setViewportSize({ width: 768, height: 650 });
  await page.goto('/#/classrooms');
  await page.locator('.classroom-list-row').first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 700));
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  const y = await page
    .locator('.portal-header')
    .evaluate((element) => element.getBoundingClientRect().top);
  expect(y).toBe(0);
  expect(state.mutations).toEqual([]);
});

for (const account of [false, true]) {
  for (const sidebar of ['expanded', 'collapsed'] as const) {
    const actor = account ? 'account' : 'teacher';
    test(`AI sidebar preserves ${sidebar} preference for ${actor}`, async ({ page }) => {
      const state = await fixture(page, 0, { account, sidebar });
      const aiMethods: string[] = [];
      // This journey checks the portal layout even when chat access is denied.
      await page.route('**/api/ai/**', (route) => {
        const request = route.request();
        aiMethods.push(request.method());
        if (new URL(request.url()).pathname === '/api/ai/scopes' && request.method() === 'GET')
          return route.fulfill({ json: { personal: true, items: [] } });
        return route.fulfill({
          status: 403,
          json: { error: { code: 'forbidden', message: 'Доступ закрыт' } },
        });
      });
      await page.setViewportSize({ width: 1024, height: 900 });
      await page.goto('/#/knowledge');
      const globalSidebar = page.locator('#portal-sidebar');
      await expect(globalSidebar).toBeVisible();
      await expect(globalSidebar).toHaveClass(
        sidebar === 'collapsed' ? /\bcollapsed\b/ : /^portal-sidebar$/,
      );
      await expect(globalSidebar.locator('a[href="/#/ai"]')).toBeHidden();
      await page
        .locator('.portal-global-nav')
        .getByRole('link', { name: 'ИИ', exact: true })
        .click();
      await expect(globalSidebar).toHaveClass(/\bcollapsed\b/);
      await expect(globalSidebar).toHaveCSS('width', '72px');
      await expect(page.locator('.asa-ai-layout')).toBeVisible();
      await expect(page.getByRole('alert').filter({ hasText: 'Доступ закрыт' })).toBeVisible();
      await page.locator('.portal-global-nav').getByRole('link', { name: 'Знания' }).click();
      await expect(globalSidebar).toHaveClass(
        sidebar === 'collapsed' ? /\bcollapsed\b/ : /^portal-sidebar$/,
      );
      // Hash restoration also receives the layout override, without a header click.
      await page.evaluate(() => {
        location.hash = '#/ai';
      });
      await expect(globalSidebar).toHaveClass(/\bcollapsed\b/);
      await expect(page.locator('.asa-ai-layout')).toBeVisible();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.getByRole('button', { name: 'Открыть меню' }).click();
      await page.locator('.portal-mobile-public').getByRole('link', { name: 'Знания' }).click();
      await page.getByRole('button', { name: 'Открыть меню' }).click();
      await page
        .locator('.portal-mobile-public')
        .getByRole('link', { name: 'ИИ', exact: true })
        .click();
      await expect(globalSidebar).toBeHidden();
      await expect(page.locator('.portal-sidebar.mobile-open')).toHaveCount(0);
      // The new edge-to-edge GPT layout intentionally removes the old 12px mobile frame.
      await expect(page.locator('.asa-ai-layout')).toHaveCSS('margin-left', '0px');
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        391,
      );
      expect(state.mutations).toEqual([]);
      expect(new Set(aiMethods)).toEqual(new Set(['GET']));
      expect(state.errors).toEqual([]);
    });
  }
}

test('class seat discovers AI in the top bar and drawer with read-only school access', async ({
  page,
}) => {
  const state = await fixture(page);
  const seatId = '40000000-0000-4000-8000-000000000001';
  const allowedAiReads = [
    { path: '/api/ai/scopes', method: 'GET', seat: null },
    { path: '/api/ai/status', method: 'GET', seat: seatId },
    { path: '/api/ai/threads', method: 'GET', seat: seatId },
    // Monthly budgets are read-only and strictly scoped to this same StudentSeat.
    { path: '/api/ai/token-budgets', method: 'GET', seat: seatId },
    // Capability discovery cannot grant generation; still requires this Seat ID.
    { path: '/api/ai/image-generation/status', method: 'GET', seat: seatId },
    { path: '/api/ai/web-search/status', method: 'GET', seat: seatId },
  ];
  const aiRequests: Array<{ path: string; method: string; seat: string | null }> = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/ai/'))
      aiRequests.push({
        path: url.pathname + url.search,
        method: request.method(),
        seat: request.headers()['x-asa-ai-seat'] ?? null,
      });
  });
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: false } }));
  await page.route('**/api/class-join/me', (route) =>
    route.fulfill({
      json: {
        authenticated: true,
        student: { seatId, displayName: 'Ученик', safeMode: true, avatarKey: null },
        classroom: { id: classId, title: 'Класс', teacherDisplayName: 'Педагог' },
        expiresAt: '2030-01-01T00:00:00Z',
      },
    }),
  );
  const aiReplies: Record<string, unknown> = {
    '/api/ai/scopes': {
      personal: false,
      items: [{ seatId, classroomId: classId, classroomTitle: 'Класс', displayName: 'Ученик' }],
    },
    '/api/ai/status': {
      enabled: false,
      providerEnabled: true,
      canGenerate: false,
      reason: 'ai_teacher_permission_required',
      provider: 'openai',
      model: 'gpt-5-mini',
      availableModels: ['gpt-5-mini'],
    },
    '/api/ai/threads': { items: [], nextCursor: null },
    '/api/ai/token-budgets': { models: [] },
    '/api/ai/image-generation/status': {
      enabled: false,
      ready: false,
      sizes: [1024],
      dailyLimit: 0,
      remainingToday: 0,
    },
    '/api/ai/web-search/status': {
      schemaVersion: 1,
      provider: 'searxng',
      weatherConfigured: false,
      configured: false,
      enabled: false,
    },
  };
  await page.route('**/api/ai/**', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const read = allowedAiReads.find((candidate) => candidate.path === url.pathname + url.search);
    if (
      !read ||
      request.method() !== read.method ||
      (request.headers()['x-asa-ai-seat'] ?? null) !== read.seat
    )
      return route.fulfill({
        status: 403,
        json: {
          error: { code: 'unexpected_ai_request', message: 'Разрешено только чтение своего чата' },
        },
      });
    return route.fulfill({ json: aiReplies[read.path] });
  });
  for (const width of [320, 390, 600, 601, 1023, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/gallery');
    const topAi = page.locator('.portal-global-nav').getByRole('link', { name: 'ИИ', exact: true });
    await expect(topAi).toBeVisible();
    if (width <= 1023) {
      await page.getByRole('button', { name: 'Открыть меню' }).click();
      await page
        .locator('.portal-mobile-public')
        .getByRole('link', { name: 'ИИ', exact: true })
        .click();
      await expect(page.locator('.portal-sidebar.mobile-open')).toHaveCount(0);
      await expect(page.locator('.portal-header')).not.toHaveAttribute('inert');
    } else {
      await expect(page.locator('#portal-sidebar a[href="/#/ai"]')).toBeHidden();
      await topAi.click();
      await expect(page.locator('#portal-sidebar')).toHaveCSS('width', '72px');
    }
    await expect(page.getByRole('region', { name: 'ИИ-помощник ASA Lab' })).toBeVisible();
    await expect(page.getByText('Школьный чат', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Преподаватель пока не разрешил ИИ-чат для этого учебного места.', {
        exact: false,
      }),
    ).toBeVisible();
    await expect(page.getByText('Доступ закрыт', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Сообщение ИИ' })).toBeDisabled();
    await expect(page.getByRole('button', { name: 'Отправить сообщение' })).toBeDisabled();
    await expect(page.getByText(/Для чата нужен вход в личный аккаунт/)).toHaveCount(0);
    await expect(page.locator('.asa-ai-layout')).toBeVisible();
    await expect(topAi).toHaveAttribute('aria-current', 'page');
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      width + 1,
    );
  }
  for (const read of allowedAiReads) expect(aiRequests).toContainEqual(read);
  for (const request of aiRequests) expect(allowedAiReads).toContainEqual(request);
  expect(state.mutations).toEqual([]);
  expect(state.errors).toEqual([]);
});

for (const sidebar of ['expanded', 'collapsed'] as const) {
  test(`VK community links remain accessible in the ${sidebar} sidebar, profile menu, and mobile drawer`, async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const state = await fixture(page, 0, { sidebar });
    const sidebarVk = page.locator('#portal-sidebar a.portal-sidebar-vk');
    const menuVk = page.locator('.portal-account-menu a.portal-account-vk');
    const destination = 'https://vk.ru/asalabru';

    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto('/#/home');
      if (width <= 1023) {
        await page.getByRole('button', { name: 'Открыть меню' }).click();
        await expect(page.locator('#portal-sidebar.mobile-open')).toBeVisible();
      }
      await expect(sidebarVk).toBeVisible();
      await expect(sidebarVk).toHaveAttribute('href', destination);
      await expect(sidebarVk).toHaveAttribute('target', '_blank');
      await expect(sidebarVk).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(sidebarVk.locator('.portal-vk-glyph')).toHaveCSS('fill', 'rgb(0, 119, 255)');
      const helpBox = await page.locator('.portal-sidebar-help-row .portal-nav-item').boundingBox();
      const vkBox = await sidebarVk.boundingBox();
      expect(helpBox).not.toBeNull();
      expect(vkBox).not.toBeNull();
      expect(vkBox!.width).toBeGreaterThanOrEqual(44);
      expect(vkBox!.height).toBeGreaterThanOrEqual(44);
      if (width >= 1024 && sidebar === 'collapsed') {
        expect(vkBox!.y).toBeGreaterThanOrEqual(helpBox!.y + helpBox!.height - 1);
      } else {
        expect(vkBox!.x).toBeGreaterThanOrEqual(helpBox!.x + helpBox!.width - 1);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
        width + 1,
      );
      if (width <= 1023) {
        await page.keyboard.press('Escape');
        await expect(page.locator('#portal-sidebar.mobile-open')).toHaveCount(0);
      }

      await page.locator('.portal-account > summary').click();
      await expect(menuVk).toBeVisible();
      await expect(menuVk).toContainText('ASA Lab ВКонтакте');
      await expect(menuVk).toHaveAttribute('href', destination);
      await expect(menuVk).toHaveAttribute('target', '_blank');
      await expect(menuVk).toHaveAttribute('rel', 'noopener noreferrer');
      await expect(menuVk.locator('.portal-vk-glyph')).toHaveCSS('fill', 'rgb(0, 119, 255)');
      const menuBox = await page.locator('.portal-account-menu').boundingBox();
      expect(menuBox).not.toBeNull();
      expect(menuBox!.x).toBeGreaterThanOrEqual(0);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(width + 1);
      await menuVk.focus();
      await expect(menuVk).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(menuVk).toBeHidden();
    }
    expect(state.errors).toEqual([]);
    expect(state.mutations).toEqual([]);
  });
}
