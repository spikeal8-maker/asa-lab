import { test, expect, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import type { LearningNotification } from '../apps/web/src/api';

const evidence = 'e2e/artifacts/owner-preview/access-a-ui';
const r3Evidence = 'reports/playwright/portal-compact-settings-r3-20261008';
const r3Visual = `${r3Evidence}/candidate-final-own-fix`;
test.beforeAll(() => mkdirSync(evidence, { recursive: true }));
async function serveBuiltApp(page: Page) {
  const dist = resolve('apps/web/dist');
  // Serve only committed-build artifacts inside dist; no real API or server is
  // contacted. The fixture's more-specific API handler is installed afterwards.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4612' || url.pathname.startsWith('/api/'))
      return route.abort();
    const file = resolve(
      dist,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (!file.startsWith(`${dist}${sep}`) || !existsSync(file)) return route.abort();
    return route.fulfill({ path: file });
  });
}
test.beforeEach(async ({ page }) => serveBuiltApp(page));

for (const width of [1440, 390, 320]) {
  test(`R3 compact settings first surfaces at ${width}`, async ({ page }) => {
    mkdirSync(r3Visual, { recursive: true });
    await page.setViewportSize({ width, height: 568 });
    await fixture(page, { educator: true, organization: true, presentationLongContent: true });
    for (const panel of ['profile', 'interface', 'security']) {
      await page.goto(`/#/account/${panel}`);
      await expect(page.getByRole('heading', { name: 'Настройки', exact: true })).toBeVisible();
      await expect(
        page.getByLabel(
          panel === 'profile'
            ? 'Имя пользователя'
            : panel === 'interface'
              ? 'Анимация'
              : 'Новый пароль',
          { exact: true },
        ),
      ).toBeVisible();
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        .toBe(true);
      await page.screenshot({
        path: `${r3Visual}/early-account-${panel}-${width}.png`,
        fullPage: true,
      });
      await page.screenshot({ path: `${r3Visual}/early-account-${panel}-${width}-viewport.png` });
    }
  });
}

for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true])
    for (const enlarged of [false, true])
      test(`R3 ${seat ? 'Seat' : 'Account'} compact composition ${width}px ${enlarged ? 'font150' : 'normal'}`, async ({
        page,
      }) => {
        mkdirSync(r3Visual, { recursive: true });
        await page.setViewportSize({ width, height: 568 });
        const state = await fixture(page, {
          seat,
          educator: !seat,
          organization: !seat,
          presentationLongContent: true,
        });
        const panels = seat
          ? ['profile', 'interface', 'notifications']
          : ['profile', 'interface', 'notifications', 'security', 'capabilities', 'school'];
        for (const panelId of panels) {
          await page.goto(`/#/account/${panelId}`);
          const main = page.locator('main.account-settings-page');
          await expect(main.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
          await expect(
            main.locator('.account-settings-section').filter({ visible: true }).first(),
          ).toBeVisible();
          if (panelId === 'interface')
            await expect(main.getByLabel('Анимация', { exact: true })).toBeEnabled();
          if (panelId === 'notifications')
            await expect(main.getByLabel('Получать учебные оповещения')).toBeVisible();
          if (enlarged) {
            await main.evaluate((element) => {
              for (const node of element.querySelectorAll<HTMLElement>('[style]'))
                node.style.removeProperty('font-size');
              const sizes = [
                ...element.querySelectorAll<HTMLElement>(
                  'h1,h2,h3,h4,p,label,input,textarea,select,button,a,strong,small,legend,span:not(.info-hint-trigger > span)',
                ),
              ]
                .filter((node) => !node.classList.contains('info-hint-trigger'))
                .map((node) => [node, parseFloat(getComputedStyle(node).fontSize) * 1.5] as const);
              for (const [node, size] of sizes) node.style.fontSize = `${size}px`;
            });
          }
          const geometry = await page.evaluate(() => ({
            viewport: innerWidth,
            width: document.documentElement.scrollWidth,
            offenders: [...document.querySelectorAll<HTMLElement>('main.account-settings-page *')]
              .filter((element) => element.getBoundingClientRect().right > innerWidth)
              .map((element) => ({
                tag: element.tagName,
                class: element.className,
                text: element.textContent?.slice(0, 80),
                right: element.getBoundingClientRect().right,
                width: element.getBoundingClientRect().width,
              })),
          }));
          if (geometry.width > geometry.viewport) {
            await page.screenshot({
              path: `${r3Visual}/overflow-${seat ? 'seat' : 'account'}-${panelId}-${width}.png`,
              fullPage: true,
            });
          }
          expect(
            geometry.width,
            `${panelId} overflow: ${JSON.stringify(geometry)}`,
          ).toBeLessThanOrEqual(geometry.viewport);
          await expect(main.locator('label .info-hint-trigger')).toHaveCount(0);
          await expect(
            main.locator(
              '.account-settings-group, .account-profile-preview, .account-settings-information',
            ),
          ).toHaveCount(0);
          const picker = main.getByLabel('Выбрать раздел настроек');
          if (width <= 900) {
            await expect(picker).toBeVisible();
            await expect(main.getByLabel('Разделы настроек')).toBeHidden();
          } else {
            await expect(picker).toBeHidden();
            await expect(main.getByLabel('Разделы настроек').getByRole('button')).toHaveCount(
              seat ? 3 : 6,
            );
          }
          for (const hint of await main.locator('.info-hint-trigger:visible').all()) {
            const bounds = (await hint.boundingBox())!;
            expect(bounds.width).toBeGreaterThanOrEqual(44);
            expect(bounds.height).toBeGreaterThanOrEqual(44);
          }
          if (panelId === 'security') {
            const facts = await main
              .locator('.account-private-facts > div')
              .evaluateAll((elements) =>
                elements.map((e) => ({
                  x: e.getBoundingClientRect().x,
                  y: e.getBoundingClientRect().y,
                })),
              );
            expect(facts).toHaveLength(4);
            expect(new Set(facts.map((fact) => fact.x)).size).toBe(
              width === 1440 ? 4 : width === 1024 ? 2 : 1,
            );
            const current = (await main.getByLabel('Текущий пароль').boundingBox())!;
            const next = (await main.getByLabel('Новый пароль', { exact: true }).boundingBox())!;
            const confirm = (await main.getByLabel('Повторите новый пароль').boundingBox())!;
            expect(current.y + current.height).toBeLessThan(next.y);
            expect(current.width).toBeLessThanOrEqual(600);
            if (width > 560) expect(next.y).toBe(confirm.y);
            else expect(next.y + next.height).toBeLessThan(confirm.y);
          }
          if (panelId === 'notifications') {
            const prefs = main.getByRole('region', {
              name: 'Учебные оповещения — только для меня',
              exact: true,
            });
            await expect(
              prefs.getByRole('region', { name: 'По классам', exact: true }),
            ).toBeVisible();
            await expect(prefs.locator('details')).toHaveCount(0);
            for (const row of await prefs.locator('.notification-setting-row').all()) {
              const label = (await row.locator('label').boundingBox())!;
              const hint = (await row.locator('.info-hint-trigger').boundingBox())!;
              expect(hint.x - label.x - label.width).toBeLessThanOrEqual(8);
              expect(hint.x - label.x - label.width).toBeGreaterThanOrEqual(-1);
            }
            expect(
              (await prefs.getByLabel('Мои оповещения об этом классе').boundingBox())!.width,
            ).toBeLessThanOrEqual(420);
            const saveMetrics = await prefs
              .getByRole('button', { name: 'Сохранить оповещения', exact: true })
              .evaluate((button) => {
                const style = getComputedStyle(button);
                const bounds = button.getBoundingClientRect();
                const parent = button.parentElement!;
                const parentBounds = parent.getBoundingClientRect();
                const parentStyle = getComputedStyle(parent);
                const chrome =
                  parseFloat(style.paddingLeft) +
                  parseFloat(style.paddingRight) +
                  parseFloat(style.borderLeftWidth) +
                  parseFloat(style.borderRightWidth);
                const contentLeft =
                  parentBounds.left +
                  parseFloat(parentStyle.borderLeftWidth) +
                  parseFloat(parentStyle.paddingLeft);
                const contentRight =
                  parentBounds.right -
                  parseFloat(parentStyle.borderRightWidth) -
                  parseFloat(parentStyle.paddingRight);
                const text = document.createRange();
                text.selectNodeContents(button);
                const textWidths = [...text.getClientRects()].map((rect) => rect.width);
                // Measure the same rendered font without the parent's wrapping
                // constraint. Only the hidden probe receives measurement styles.
                const probe = button.cloneNode(true) as HTMLElement;
                probe.removeAttribute('id');
                probe.style.cssText +=
                  ';position:fixed;visibility:hidden;pointer-events:none;display:inline-block;' +
                  'width:max-content;min-width:0;max-width:none;white-space:nowrap;margin:0;';
                parent.append(probe);
                try {
                  const unwrapped = document.createRange();
                  unwrapped.selectNodeContents(probe);
                  const textWidth = unwrapped.getBoundingClientRect().width;
                  return {
                    width: bounds.width,
                    height: bounds.height,
                    left: bounds.left,
                    right: bounds.right,
                    contentLeft,
                    contentRight,
                    contentWidth: contentRight - contentLeft,
                    chrome,
                    textWidth,
                    naturalWidth: textWidth + chrome,
                    probeWidth: probe.getBoundingClientRect().width,
                    textWidths,
                    scrollWidth: button.scrollWidth,
                    clientWidth: button.clientWidth,
                    font: style.font,
                  };
                } finally {
                  probe.remove();
                }
              });
            expect(Math.abs(saveMetrics.probeWidth - saveMetrics.naturalWidth)).toBeLessThanOrEqual(
              1,
            );
            expect(
              Math.abs(
                saveMetrics.width - Math.min(saveMetrics.naturalWidth, saveMetrics.contentWidth),
              ),
            ).toBeLessThanOrEqual(1);
            expect(saveMetrics.height).toBeGreaterThanOrEqual(44);
            expect(saveMetrics.left).toBeGreaterThanOrEqual(saveMetrics.contentLeft - 1);
            expect(saveMetrics.right).toBeLessThanOrEqual(saveMetrics.contentRight + 1);
            expect(saveMetrics.scrollWidth).toBeLessThanOrEqual(saveMetrics.clientWidth + 1);
            for (const textWidth of saveMetrics.textWidths)
              expect(textWidth).toBeLessThanOrEqual(saveMetrics.width - saveMetrics.chrome + 1);
            if (!enlarged) expect(saveMetrics.width).toBeLessThanOrEqual(260);
            mkdirSync(test.info().outputDir, { recursive: true });
            writeFileSync(
              test
                .info()
                .outputPath(
                  `notification-save-${seat ? 'seat' : 'account'}-${width}-${enlarged ? 'font150' : 'normal'}.json`,
                ),
              JSON.stringify(saveMetrics, null, 2),
            );
          }
          if (panelId === 'school') {
            expect(
              (await main
                .getByRole('button', { name: 'Создать школу', exact: true })
                .boundingBox())!.width,
            ).toBeLessThanOrEqual(260);
          }
          await page.screenshot({
            path: `${r3Visual}/${seat ? 'seat' : 'account'}-${panelId}-${width}-${enlarged ? 'font150' : 'normal'}.png`,
            fullPage: true,
          });
        }
        expect(state.mutations).toEqual([]);
      });

test('R3 stationary pointer after avatar modal close cannot obstruct reopening the avatar', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await fixture(page);
  await page.goto('/#/account');
  const opener = page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
  const publicNameInfo = page.getByRole('button', { name: 'О публичном имени', exact: true });
  const anchor = (await publicNameInfo.boundingBox())!;
  await page.mouse.move(anchor.x + anchor.width / 2, anchor.y + anchor.height / 2);
  await page.keyboard.press('Escape');
  await expect(opener).toBeFocused();
  await expect(publicNameInfo).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  const hit = await opener.evaluate((button) => {
    const bounds = button.getBoundingClientRect();
    const x = bounds.x + bounds.width / 2;
    const y = bounds.y + bounds.height / 2;
    return {
      x,
      y,
      visible: bounds.top >= 0 && bounds.bottom <= innerHeight,
      nativeHit: button.contains(document.elementFromPoint(x, y)),
    };
  });
  expect(hit.visible).toBe(true);
  expect(hit.nativeHit).toBe(true);
  await page.mouse.click(hit.x, hit.y);
  await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
  await expect(page.locator('body > .info-hint-popup')).toHaveCount(0);
  await page.keyboard.press('Escape');
  expect(state.mutations).toHaveLength(0);
});

test('R3 organization membership is visible without educator actions or redundant class dashboard reads', async ({
  page,
}) => {
  const state = await fixture(page, { organization: true });
  const classReads: string[] = [];
  page.on('request', (request) => {
    if (new URL(request.url()).pathname === '/api/classrooms') classReads.push(request.url());
  });
  await page.goto('/#/account/school');
  await expect(
    page
      .locator('.account-school-memberships')
      .getByText('Организация с длинным названием для проверки списка доступов', { exact: true }),
  ).toBeVisible();
  await expect(
    page.locator('.account-school-memberships').getByText('Администратор школы', { exact: true }),
  ).toBeVisible();
  await expect(page.locator('.account-school-memberships').getByRole('button')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Создать школу', exact: true })).toHaveCount(0);
  await expect(page.locator('.account-school-memberships')).not.toContainText(
    'Личное пространство',
  );
  await expect(
    page.getByRole('link', { name: 'Моё обучение с преподавателем', exact: true }),
  ).toBeVisible();
  expect(classReads).toEqual([]);
  expect(state.mutations).toEqual([]);
});

for (const touch of [false, true])
  test(`R3 adjacent hints coordinate ${touch ? 'touch' : 'pointer and focus'} without toggling preferences`, async ({
    page,
    browser,
  }) => {
    const context = touch
      ? await browser.newContext({
          baseURL: 'http://127.0.0.1:4612',
          hasTouch: true,
          viewport: { width: 390, height: 568 },
        })
      : null;
    const target = context ? await context.newPage() : page;
    if (context) await serveBuiltApp(target);
    try {
      const state = await fixture(target);
      await target.goto('/#/account/notifications');
      const prefs = target.getByRole('region', {
        name: 'Учебные оповещения — только для меня',
        exact: true,
      });
      const first = prefs.getByRole('button', {
        name: 'О категории «Назначения и условия»',
        exact: true,
      });
      const second = prefs.getByRole('button', {
        name: 'О категории «Проверка и результаты»',
        exact: true,
      });
      const activate = async (hint: ReturnType<Page['getByRole']>) =>
        touch ? hint.tap() : hint.click();
      await activate(first);
      await expect(target.getByRole('tooltip')).toHaveCount(1);
      if (touch) await activate(second);
      else await second.hover();
      await expect(target.getByRole('tooltip')).toHaveCount(1);
      await expect(target.getByRole('tooltip')).toContainText('Оценки и комментарии');
      if (!touch) {
        await target.getByRole('tooltip').hover();
        await expect(target.getByRole('tooltip')).toHaveCount(1);
        await second.focus();
        await expect(target.getByRole('tooltip')).toContainText('Оценки и комментарии');
        await first.focus();
        await expect(target.getByRole('tooltip')).toHaveCount(1);
        await expect(target.getByRole('tooltip')).toContainText('Новые назначения');
      }
      const popup = (await target.getByRole('tooltip').boundingBox())!;
      expect(popup.x).toBeGreaterThanOrEqual(0);
      expect(popup.x + popup.width).toBeLessThanOrEqual(target.viewportSize()!.width);
      expect(popup.y + popup.height).toBeLessThanOrEqual(target.viewportSize()!.height);
      await expect(prefs.getByLabel('Назначения и условия', { exact: true })).toBeChecked();
      await expect(prefs.getByLabel('Проверка и результаты', { exact: true })).toBeChecked();
      await target.keyboard.press('Escape');
      await expect(target.getByRole('tooltip')).toHaveCount(0);
      await activate(first);
      await target.getByRole('heading', { name: 'Настройки', exact: true }).click();
      await expect(target.getByRole('tooltip')).toHaveCount(0);
      expect(state.mutations).toEqual([]);
    } finally {
      await context?.close();
    }
  });

for (const trustedMax of [false, true])
  test(`R3 password flow trusts only existing server allowance ${trustedMax}`, async ({ page }) => {
    await fixture(page);
    const writes: unknown[] = [];
    let release!: () => void;
    const pending = new Promise<void>((resolvePending) => {
      release = resolvePending;
    });
    let fail = true;
    await page.route('**/api/account/password', async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { configured: true, canResetWithoutCurrent: trustedMax } });
      writes.push(route.request().postDataJSON());
      if (fail) {
        await pending;
        return route.fulfill({
          status: 400,
          json: { error: { code: 'current_password_invalid', message: 'Wrong current password' } },
        });
      }
      return route.fulfill({ json: { changed: true } });
    });
    await page.goto('/#/account/security');
    const current = page.getByLabel('Текущий пароль');
    await expect(current).toHaveCount(trustedMax ? 0 : 1);
    const next = page.getByLabel('Новый пароль', { exact: true });
    const confirm = page.getByLabel('Повторите новый пароль');
    await expect(next).toHaveAttribute('autocomplete', 'new-password');
    await expect(next).toHaveAttribute('minlength', '10');
    await expect(next).toHaveAttribute('maxlength', '200');
    const save = page.getByRole('button', { name: 'Сохранить пароль', exact: true });
    await next.fill('short');
    await confirm.fill('short');
    await expect(save).toBeDisabled();
    await next.fill('new-password-strong');
    await confirm.fill('different-password');
    await expect(save).toBeDisabled();
    await confirm.fill('new-password-strong');
    if (!trustedMax) {
      await expect(save).toBeDisabled();
      await current.fill('wrong-password');
      await expect(current).toHaveAttribute('autocomplete', 'current-password');
    }
    await save.click();
    await expect(page.getByRole('button', { name: 'Сохраняем…', exact: true })).toBeDisabled();
    await expect.poll(() => writes.length).toBe(1);
    expect(writes).toEqual([
      { currentPassword: trustedMax ? '' : 'wrong-password', newPassword: 'new-password-strong' },
    ]);
    release();
    await expect(page.getByRole('alert')).toContainText('Текущий пароль указан неверно.');
    await expect(next).toHaveValue('new-password-strong');
    fail = false;
    await save.click();
    await expect(
      page.getByRole('status').filter({ hasText: 'Пароль изменён. Остальные входы завершены.' }),
    ).toBeVisible();
    await expect(next).toHaveValue('');
    await expect(confirm).toHaveValue('');
    await expect(current).toHaveCount(1);
    expect(writes).toHaveLength(2);
  });

for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true])
    test(`R3 ${seat ? 'Seat' : 'Account'} visible notification loading busy error and class scope at ${width}px`, async ({
      page,
    }) => {
      mkdirSync(r3Visual, { recursive: true });
      const state = await fixture(page, { seat });
      await page.setViewportSize({ width, height: 568 });
      let releaseLoad!: () => void, releaseSave!: () => void;
      const loading = new Promise<void>((resolveLoad) => {
        releaseLoad = resolveLoad;
      });
      const saving = new Promise<void>((resolveSave) => {
        releaseSave = resolveSave;
      });
      let holdLoad = true,
        failSave = true;
      const writes: {
        categories: Record<string, boolean>;
        classOverrides: Record<string, { mode: string; categories?: Record<string, string> }>;
      }[] = [];
      await page.route('**/api/learning/notifications/preferences', async (route) => {
        if (route.request().method() === 'GET') {
          if (holdLoad) await loading;
          return route.fallback();
        }
        writes.push(route.request().postDataJSON());
        if (failSave) {
          await saving;
          return route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'Доставка временно недоступна.' } },
          });
        }
        return route.fallback();
      });
      await page.goto('/#/account/notifications');
      const prefs = page.getByRole('region', {
        name: 'Учебные оповещения — только для меня',
        exact: true,
      });
      await expect(prefs.getByText('Загружаем настройки…')).toBeVisible();
      await page.screenshot({
        path: `${r3Visual}/notifications-${seat ? 'seat' : 'account'}-${width}-loading.png`,
        fullPage: true,
      });
      holdLoad = false;
      releaseLoad();
      await expect(prefs.getByLabel('Скоро срок', { exact: true })).toBeChecked();
      await expect(prefs.getByLabel('Работы на проверку', { exact: true })).toHaveCount(0);
      if (seat)
        await expect(prefs.getByLabel('Заявки и приглашения', { exact: true })).toHaveCount(0);
      const search = prefs.getByLabel('Найти класс');
      await search.fill('не существующий класс');
      await expect(prefs.getByText('Классы не найдены.', { exact: true })).toBeVisible();
      await search.fill('Длинное название');
      const mode = prefs.getByLabel('Мои оповещения об этом классе');
      await mode.selectOption('off');
      await expect(mode).toHaveValue('off');
      await mode.selectOption('custom');
      await prefs
        .getByRole('combobox', { name: 'Назначения и условия', exact: true })
        .selectOption('off');
      await prefs.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
      await expect(prefs.getByRole('status')).toHaveText('Сохраняем оповещения…');
      await expect(mode).toBeDisabled();
      await expect.poll(() => writes.length).toBe(1);
      expect(writes[0]!.categories.NC02).toBe(true);
      expect(writes[0]!.categories.NC08).toBe(true);
      expect(writes[0]!.classOverrides['class-1']).toEqual({
        mode: 'custom',
        categories: { NC01: 'off' },
      });
      await page.screenshot({
        path: `${r3Visual}/notifications-${seat ? 'seat' : 'account'}-${width}-busy.png`,
        fullPage: true,
      });
      releaseSave();
      await expect(prefs.getByRole('alert')).toContainText('Доставка временно недоступна.');
      await expect(mode).toHaveValue('custom');
      await expect(
        prefs.getByRole('combobox', { name: 'Назначения и условия', exact: true }),
      ).toHaveValue('off');
      await page.screenshot({
        path: `${r3Visual}/notifications-${seat ? 'seat' : 'account'}-${width}-error.png`,
        fullPage: true,
      });
      await prefs.getByRole('button', { name: 'Сбросить для класса', exact: true }).click();
      await expect(mode).toHaveValue('inherit');
      failSave = false;
      await prefs.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
      await expect(prefs.getByRole('status')).toHaveText('Настройки сохранены.');
      expect(writes[1]!.classOverrides).toEqual({});
      expect(state.mutations).toContain('/api/learning/notifications/preferences');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
    });

async function fixture(
  page: Page,
  options: {
    profileFailure?: boolean;
    secondaryFailure?: boolean;
    educator?: boolean;
    author?: boolean;
    seat?: boolean;
    awardsFailure?: boolean;
    notificationFailure?: boolean;
    organization?: boolean;
    platformAdmin?: boolean;
    presentationFailure?: boolean;
    presentationSaveFailure?: boolean;
    presentationLongContent?: boolean;
    unreadCount?: number;
    inboxItems?: LearningNotification[];
  } = {},
) {
  const mutations: string[] = [];
  let failing = options.profileFailure ?? false;
  let secondaryFailure = options.secondaryFailure ?? false;
  let educator = options.educator ?? false;
  let awardsFailure = options.awardsFailure ?? false;
  let notificationFailure = options.notificationFailure ?? false;
  let inboxFailure = false;
  let unreadCount = options.unreadCount ?? 0;
  let inboxItems = options.inboxItems ?? [];
  const notificationReads: { ids: string[] | null; asOf: string }[] = [];
  let presentationFailure = options.presentationFailure ?? false;
  let presentationSaveFailure = options.presentationSaveFailure ?? false;
  let presentationActorChanged = false;
  let avatarDataUrl: string | null = null;
  let seatAvatarKey: string | null = null;
  let timeZone = 'Europe/Moscow';
  let presentation = { motion: 'system', sidebar: 'expanded', revision: 0 };
  let preferences = {
    revision: 0,
    masterEnabled: true,
    categories: {
      NC01: true,
      NC02: true,
      NC03: true,
      NC04: true,
      NC05: true,
      NC06: true,
      NC08: true,
    },
    classOverrides: {},
    classes: [
      {
        id: 'class-1',
        title: 'Длинное название класса для проверки переносов и настроек уведомлений',
      },
    ],
  };
  const workspaces = [
    {
      workspaceId: '10000000-0000-4000-8000-000000000001',
      kind: 'personal',
      title: options.presentationLongContent
        ? 'Личное пространство для создания проектов, материалов и независимого обучения в нескольких организациях'
        : 'Личное пространство',
      role: 'owner',
    },
  ];
  if (options.organization)
    workspaces.push({
      workspaceId: '10000000-0000-4000-8000-000000000002',
      kind: 'organization',
      title: 'Организация с длинным названием для проверки списка доступов',
      role: 'school_admin',
    });
  let profile = {
    username: 'access.preview',
    displayName: options.presentationLongContent
      ? 'Проверочный профиль с очень длинным отображаемым именем и несколькими учебными обязанностями'
      : 'Проверочный профиль',
    bio: '',
    email: 'access@example.test',
    birthDate: '1990-01-01',
    country: 'RU',
    emailVerificationState: 'unverified',
  };
  const capabilities = () => [
    { capability: 'creator', state: 'verified' },
    ...(options.author ? [{ capability: 'content_author', state: 'verified' }] : []),
    ...(educator ? [{ capability: 'educator', state: 'provisional' }] : []),
    ...(options.platformAdmin ? [{ capability: 'platform_admin', state: 'verified' }] : []),
  ];
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const method = request.method();
    const reply = (data: unknown, status = 200) => route.fulfill({ json: data, status });
    if (!['GET', 'HEAD'].includes(method)) mutations.push(path);
    if (path === '/api/account/presentation') {
      if (presentationFailure)
        return reply({ error: { code: 'not_found', message: 'old backend' } }, 404);
      if (method === 'PUT' && presentationSaveFailure)
        return reply({ error: { code: 'unavailable', message: 'offline' } }, 503);
      if (options.seat)
        return reply({ error: { code: 'unauthorized', message: 'Account required' } }, 401);
      expect(request.headers()['x-asa-presentation-account']).toBe(
        '20000000-0000-4000-8000-000000000001',
      );
      if (presentationActorChanged)
        return reply({ error: { code: 'actor_changed', message: 'Account changed' } }, 409);
      if (method === 'PUT') {
        const input = request.postDataJSON();
        if (input.revision !== presentation.revision)
          return reply({ error: { code: 'conflict', message: 'changed' } }, 409);
        presentation = {
          motion: input.motion,
          sidebar: input.sidebar,
          revision: presentation.revision + 1,
        };
      }
      return reply(presentation);
    }
    if (path === '/api/admin/v1/dashboard')
      return reply(
        { error: { code: 'unavailable', message: 'Dashboard fixture unavailable' } },
        503,
      );
    if (path === '/api/admin/v1/me')
      return options.platformAdmin
        ? reply({
            administrator: true,
            principalId: 'admin-1',
            accountId: '20000000-0000-4000-8000-000000000001',
            displayName: profile.displayName,
            activeWorkspaceId: workspaces[0].workspaceId,
            scopes: [
              {
                kind: 'platform',
                id: null,
                title: 'ASA Lab',
                role: 'platform_admin',
                permissions: ['administration.open'],
              },
            ],
          })
        : reply({ error: { code: 'forbidden', message: 'Forbidden' } }, 403);
    if (path === '/api/class-join/me')
      return reply(
        options.seat
          ? {
              authenticated: true,
              student: {
                seatId: 'seat-1',
                displayName: 'Ученик с длинным именем',
                safeMode: true,
                avatarKey: seatAvatarKey,
              },
              classroom: {
                id: 'class-1',
                title: 'Учебный класс',
                teacherDisplayName: 'Преподаватель',
              },
              expiresAt: '2030-01-01T00:00:00Z',
            }
          : { authenticated: false },
      );
    if (path === '/api/class-join/me/avatar') {
      seatAvatarKey = request.postDataJSON().avatarKey;
      return reply({
        authenticated: true,
        student: {
          seatId: 'seat-1',
          displayName: 'Ученик с длинным именем',
          safeMode: true,
          avatarKey: seatAvatarKey,
        },
        classroom: { id: 'class-1', title: 'Учебный класс', teacherDisplayName: 'Преподаватель' },
        expiresAt: '2030-01-01T00:00:00Z',
      });
    }
    if (path === '/api/class-join/me/awards')
      return awardsFailure
        ? reply({ error: { code: 'unavailable', message: 'Unavailable' } }, 503)
        : reply({ items: [] });
    if (path === '/api/class-join/account/classes')
      return reply({
        items: [
          {
            seatId: 'seat-1',
            classroomId: 'class-1',
            classroomTitle: 'Учебный класс',
            teacherDisplayName: 'Преподаватель',
            openCount: 0,
            unfinishedCount: 0,
          },
        ],
      });
    if (path === '/api/classrooms/class-1')
      return reply({
        classroom: {
          id: 'class-1',
          title: 'Учебный класс',
          status: 'active',
          ageBand: 'mixed',
          topicKeys: [],
          safeModeDefault: true,
          studentCount: 0,
          joinCodeVersion: null,
          joinCodeStatus: null,
          joinCode: null,
          teacherRole: 'owner',
          workspaceKind: 'personal',
          workspaceTitle: 'Личное пространство',
          createdAt: '2026-01-01T00:00:00Z',
          archivedAt: null,
        },
      });
    if (path === '/api/learning/notifications/classes/class-1/reminders')
      return reply({ revision: 0, due: true, overdue: true });
    if (path === '/api/learning/notifications/read') {
      const input = request.postDataJSON();
      notificationReads.push(input);
      let count = 0;
      inboxItems = inboxItems.map((item) => {
        if (item.readAt || (input.ids && !input.ids.includes(item.id))) return item;
        count += 1;
        return { ...item, readAt: input.asOf };
      });
      unreadCount = input.ids === null ? 0 : Math.max(0, unreadCount - count);
      return reply({ count });
    }
    if (path === '/api/learning/notifications' && inboxFailure)
      return reply(
        {
          error: {
            code: 'unavailable',
            message:
              'Оповещения временно недоступны — повторите проверку позже или обратитесь к преподавателю.',
          },
        },
        503,
      );
    if (path === '/api/learning/notifications')
      return reply({
        items: inboxItems,
        snapshot: '2026-01-01T00:00:00Z',
        unread: unreadCount,
      });
    if (path === '/api/learning/notifications/preferences') {
      if (notificationFailure)
        return reply(
          { error: { code: 'unavailable', message: 'Настройки временно недоступны' } },
          503,
        );
      if (method === 'POST')
        preferences = {
          ...preferences,
          ...request.postDataJSON(),
          revision: preferences.revision + 1,
        };
      return reply(preferences);
    }
    if (path === '/api/account/time-zone') {
      timeZone = request.postDataJSON().timeZone;
      return reply({ timeZone });
    }
    if (path === '/api/auth/me' && options.seat) return reply({ authenticated: false });
    if (path === '/api/auth/me')
      return reply({
        authenticated: true,
        user: {
          id: '20000000-0000-4000-8000-000000000001',
          email: profile.email,
          displayName: profile.displayName,
        },
        account: {
          id: '20000000-0000-4000-8000-000000000001',
          email: profile.email,
          displayName: profile.displayName,
        },
        capabilities: capabilities(),
        workspaces,
        activeWorkspace: { workspaceId: workspaces[0].workspaceId, kind: 'personal' },
        navigation: {
          classes: educator,
          classroomManagement: educator,
          contentAuthoring: educator || options.author === true,
        },
        timeZone,
      });
    if (path === '/api/account/profile') {
      if (failing) return reply({ error: { code: 'unavailable', message: 'test failure' } }, 503);
      if (method === 'PATCH') profile = { ...profile, ...request.postDataJSON() };
      return reply({ ...profile, capabilities: capabilities(), workspaces });
    }
    if (path === '/api/account/avatar') {
      if (secondaryFailure)
        return reply({ error: { code: 'unavailable', message: 'avatar unavailable' } }, 503);
      if (method === 'PATCH') avatarDataUrl = request.postDataJSON().avatarDataUrl;
      return reply({ avatarDataUrl });
    }
    if (path === '/api/account/sessions')
      return secondaryFailure
        ? reply({ error: { code: 'unavailable', message: 'sessions unavailable' } }, 503)
        : reply({ items: [] });
    if (path === '/api/auth/max/status')
      return secondaryFailure
        ? reply({ error: { code: 'unavailable', message: 'MAX unavailable' } }, 503)
        : reply({
            linked: false,
            verifiedAt: null,
            firstAuthenticatedAt: null,
            promptDue: false,
            promptDismissedUntil: null,
            available: false,
          });
    if (path === '/api/auth/max/config') return reply({ enabled: false, launchUrl: null });
    if (path === '/api/account/password')
      return reply({ configured: true, canResetWithoutCurrent: false });
    if (path === '/api/capabilities/educator/self-attest') {
      educator = true;
      return reply({ capability: 'educator', state: 'provisional', created: true });
    }
    if (path === '/api/classrooms/teacher-home-attention')
      return reply({
        reviews: [
          {
            key: 'review-1',
            classroomId: 'class-1',
            classroomTitle: 'Класс с длинным названием',
            assignmentId: 'assignment-1',
            assignmentTitle: 'Учебная работа, ожидающая проверки преподавателем',
            seatId: 'seat-1',
            learnerName: 'Ученик с длинным именем',
            attemptId: null,
          },
        ],
        joinRequests: [],
        classrooms: [{ id: 'class-1', title: 'Класс с длинным названием' }],
        joinRequestsMayBeLimited: false,
      });
    if (path === '/api/classrooms/awaiting-review') return reply({ total: 0 });
    // Read-only empty fixture data, never forwarded to a real API.
    if (method === 'GET') return reply({ items: [], meta: { total: 0 } });
    return reply({ error: { code: 'unexpected_mutation', message: path } }, 400);
  });
  return {
    mutations,
    notificationReads,
    setInboxUnread: (count: number) => {
      unreadCount = count;
    },
    failInbox: (fail: boolean) => {
      inboxFailure = fail;
    },
    changePresentationActor: () => {
      presentationActorChanged = true;
    },
    recoverPresentation: () => {
      presentationFailure = false;
      presentationSaveFailure = false;
    },
    externalPresentation: () => {
      presentation = {
        motion: 'system',
        sidebar: 'collapsed',
        revision: presentation.revision + 1,
      };
    },
    recoverProfile: () => {
      failing = false;
    },
    recoverSecondary: () => {
      secondaryFailure = false;
    },
    recoverAwards: () => {
      awardsFailure = false;
    },
    recoverNotifications: () => {
      notificationFailure = false;
    },
  };
}

const panel = (page: Page, name: string) =>
  page.getByLabel('Разделы настроек').getByRole('button', { name, exact: true });

const r2Evidence = 'reports/playwright/portal-compact-shell-r2-20261008';
const inboxEvidence = `${r2Evidence}/events`;
const inboxItems: LearningNotification[] = [
  {
    id: 'notification-1',
    kind: 'NF01',
    category: 'NC01',
    classroomId: 'class-1',
    classroomTitle: 'Класс с очень длинным названием для проверки учебных оповещений',
    title: 'Назначена работа с длинным названием и подробным описанием учебной задачи',
    assignmentId: 'assignment-1',
    seatId: 'seat-1',
    attemptId: null,
    courseRunId: null,
    joinRequestId: null,
    recipientKind: 'learner',
    createdAt: '2026-01-01T00:00:00Z',
    readAt: null,
  },
  {
    id: 'notification-2',
    kind: 'NF06',
    category: 'NC08',
    classroomId: 'class-2',
    classroomTitle: 'Другой учебный класс с длинным названием',
    title: 'Заявка на доступ к классу',
    assignmentId: null,
    seatId: null,
    attemptId: null,
    courseRunId: null,
    joinRequestId: 'join-1',
    recipientKind: 'teacher',
    createdAt: '2026-01-01T00:00:00Z',
    readAt: null,
  },
];
async function stressInboxFont(page: Page) {
  await page.addStyleTag({
    content: `.learning-inbox-events, .learning-inbox-events * { font-size: 24px !important; }`,
  });
}
async function assertInboxGeometry(page: Page, width: number, name: string) {
  const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
  await expect(page.locator('.learning-inbox-button, .learning-inbox-dialog')).toHaveCount(0);
  const metrics = await events.evaluate((element) => {
    const r = element.getBoundingClientRect();
    return {
      x: r.x,
      right: r.right,
      width: r.width,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth,
      controls: [...element.querySelectorAll('button, select, a')].map((control) => {
        const b = control.getBoundingClientRect();
        return { name: control.textContent, x: b.x, right: b.right, height: b.height };
      }),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(metrics.x).toBeGreaterThanOrEqual(0);
  expect(metrics.right).toBeLessThanOrEqual(width);
  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth);
  expect(metrics.overflow).toBe(false);
  for (const control of metrics.controls) {
    expect(control.x, control.name ?? '').toBeGreaterThanOrEqual(metrics.x);
    expect(control.right, control.name ?? '').toBeLessThanOrEqual(metrics.right);
    expect(control.height, control.name ?? '').toBeGreaterThanOrEqual(44);
  }
  writeFileSync(`${inboxEvidence}/${name}-${width}.json`, JSON.stringify(metrics));
  await events.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  await page.evaluate(() =>
    window.scrollBy(
      0,
      -document.querySelector('.portal-header')!.getBoundingClientRect().height - 12,
    ),
  );
  await page.screenshot({ path: `${inboxEvidence}/${name}-${width}.png` });
}
for (const role of ['account', 'seat', 'teacher', 'author', 'admin'] as const)
  test(`inline notifications preserve ${role} filters, snapshot reads, native destinations and preferences`, async ({
    page,
  }) => {
    mkdirSync(inboxEvidence, { recursive: true });
    for (const width of [1440, 1024, 390, 320]) {
      const state = await fixture(page, {
        seat: role === 'seat',
        educator: role === 'teacher',
        author: role === 'author',
        platformAdmin: role === 'admin',
        unreadCount: 2,
        inboxItems,
      });
      await page.setViewportSize({ width, height: 568 });
      await page.goto(`/?r2=${role}-${width}#/account/notifications`);
      const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
      await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 2');
      await expect(events.locator('.learning-inbox-list > li')).toHaveCount(2);
      await assertInboxGeometry(page, width, `${role}-populated`);
      await expect(events.getByRole('link', { name: 'Открыть' }).nth(0)).toHaveAttribute(
        'href',
        '#/learning?assignment=assignment-1&learner=seat-1',
      );
      await expect(events.getByRole('link', { name: 'Открыть' }).nth(1)).toHaveAttribute(
        'href',
        '#/classrooms/class-2?joinRequest=join-1',
      );
      await events.getByRole('combobox', { name: 'Категория', exact: true }).selectOption('NC01');
      await expect(events.locator('.learning-inbox-list > li')).toHaveCount(1);
      await events.getByRole('combobox', { name: 'Класс', exact: true }).selectOption('class-2');
      await expect(events.locator('.learning-inbox-list > li')).toHaveCount(0);
      await expect(events.getByRole('button', { name: 'Отметить прочитанными' })).toBeDisabled();
      await events.getByRole('combobox', { name: 'Класс', exact: true }).selectOption('');
      await events.getByRole('button', { name: 'Отметить прочитанными' }).click();
      await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 1');
      expect(state.notificationReads).toEqual([
        { ids: ['notification-1'], asOf: '2026-01-01T00:00:00Z' },
      ]);
      await events.getByRole('combobox', { name: 'Категория', exact: true }).selectOption('');
      await events.getByRole('button', { name: 'Отметить прочитанными' }).click();
      await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 0');
      expect(state.notificationReads[1]).toEqual({ ids: null, asOf: '2026-01-01T00:00:00Z' });
      const prefs = page.getByRole('region', {
        name: 'Учебные оповещения — только для меня',
        exact: true,
      });
      await expect(prefs.getByLabel('Работы на проверку', { exact: true })).toHaveCount(
        role === 'teacher' ? 1 : 0,
      );
      await expect(prefs.getByLabel('Заявки и приглашения', { exact: true })).toHaveCount(
        role === 'seat' ? 0 : 1,
      );
      await prefs.getByLabel('Получать учебные оповещения').uncheck();
      await prefs.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
      await expect(prefs.getByRole('status')).toHaveText('Настройки сохранены.');
      expect(
        state.mutations.filter((path) => path === '/api/learning/notifications/preferences'),
      ).toHaveLength(1);
    }
  });
test('inline events mount only in Notifications, stop outside it, and coalesce visible/focus activation', async ({
  page,
}) => {
  mkdirSync(inboxEvidence, { recursive: true });
  await fixture(page, { unreadCount: 7, educator: true });
  await page.addInitScript(() => {
    let visibility: DocumentVisibilityState = 'hidden';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    window.addEventListener('inbox-fixture-visibility', (event) => {
      visibility = (event as CustomEvent<DocumentVisibilityState>).detail;
      document.dispatchEvent(new Event('visibilitychange'));
    });
  });
  await page.clock.install({ time: new Date('2026-10-08T00:00:00Z') });
  let requests = 0,
    attention = 0;
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (path === '/api/learning/notifications') requests++;
    if (path.includes('/attention')) attention++;
  });
  await page.goto('/#/home');
  await expect(page.getByRole('main', { name: 'Главная' })).toBeVisible();
  await page.clock.fastForward(120000);
  expect(requests).toBe(0);
  expect(attention).toBe(0);
  await page.goto('/#/account/profile');
  await expect(page.getByRole('heading', { name: 'Профиль', exact: true })).toBeVisible();
  await page.clock.fastForward(120000);
  expect(requests).toBe(0);
  await panel(page, 'Уведомления').click();
  const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
  await expect(events).toBeVisible();
  await page.clock.fastForward(120000);
  expect(requests).toBe(0);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('inbox-fixture-visibility', { detail: 'visible' }));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(100);
  await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 7');
  expect(requests).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(200);
  expect(requests).toBe(1);
  await page.clock.runFor(18100);
  await expect.poll(() => requests).toBe(2);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent('inbox-fixture-visibility', { detail: 'hidden' })),
  );
  await page.clock.fastForward(300000);
  expect(requests).toBe(2);
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('inbox-fixture-visibility', { detail: 'visible' }));
    window.dispatchEvent(new Event('focus'));
  });
  await page.clock.runFor(100);
  await expect.poll(() => requests).toBe(3);
  await panel(page, 'Интерфейс').click();
  await expect(events).toHaveCount(0);
  await page.clock.fastForward(300000);
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await page.clock.runFor(100);
  expect(requests).toBe(3);
  await panel(page, 'Уведомления').click();
  await expect(events).toBeVisible();
  await expect.poll(() => requests).toBe(4);
  writeFileSync(
    `${inboxEvidence}/compiled-visibility.json`,
    JSON.stringify({ requests, homeRequests: 0, hiddenRequests: 0, stoppedRequests: 0, attention }),
  );
});
for (const seat of [false, true])
  test(`inline ${seat ? 'Seat' : 'Account'} read invalidates an older GET and preserves native read-one navigation`, async ({
    page,
  }) => {
    mkdirSync(inboxEvidence, { recursive: true });
    await fixture(page, { seat, unreadCount: 1, inboxItems: [inboxItems[0]] });
    await page.clock.install();
    await page.goto('/#/account/notifications');
    const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
    await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 1');
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let getCount = 0,
      activeGets = 0,
      maximumGets = 0,
      unread = 1;
    const writes: { ids: string[] | null; asOf: string }[] = [];
    await page.route('**/api/learning/notifications', async (route) => {
      getCount++;
      activeGets++;
      maximumGets = Math.max(maximumGets, activeGets);
      const old = getCount === 1;
      if (old) await gate;
      await route.fulfill({
        json: {
          snapshot: '2026-01-01T00:00:00Z',
          unread: old ? 999 : unread,
          items: [inboxItems[0]],
        },
      });
      activeGets--;
    });
    await page.route('**/api/learning/notifications/read', async (route) => {
      writes.push(route.request().postDataJSON());
      unread = 0;
      await route.fulfill({ json: { count: 1 } });
    });
    await events.locator('.learning-inbox-unread').evaluate((element) => {
      const seen: string[] = [];
      (window as typeof window & { inboxFixtureSeen: string[] }).inboxFixtureSeen = seen;
      new MutationObserver(() => seen.push(element.textContent ?? '')).observe(element, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await page.clock.runFor(19000);
    await expect.poll(() => getCount).toBe(1);
    await events.getByRole('button', { name: 'Отметить прочитанными' }).click();
    await expect.poll(() => writes.length).toBe(1);
    expect(getCount).toBe(1);
    release();
    await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 0');
    expect(getCount).toBe(2);
    expect(maximumGets).toBe(1);
    expect(writes[0]).toEqual({ ids: null, asOf: '2026-01-01T00:00:00Z' });
    expect(
      await page.evaluate(
        () => (window as typeof window & { inboxFixtureSeen: string[] }).inboxFixtureSeen,
      ),
    ).not.toContain('Непрочитанных: 999');
    await events.getByRole('link', { name: 'Открыть', exact: true }).click();
    await expect(page).toHaveURL(/#\/learning\?assignment=assignment-1&learner=seat-1$/);
    await expect.poll(() => writes.length).toBe(2);
    expect(writes[1]).toEqual({ ids: ['notification-1'], asOf: '2026-01-01T00:00:00Z' });
    await expect(events).toHaveCount(0);
    writeFileSync(
      `${inboxEvidence}/compiled-read-race-${seat ? 'seat' : 'account'}.json`,
      JSON.stringify({ getCount, maximumGets, writes }),
    );
  });
for (const width of [1440, 1024, 390, 320])
  test(`inline notifications loading, error and retry keep usable geometry at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(inboxEvidence, { recursive: true });
    await fixture(page);
    let release!: () => void;
    const gate = new Promise<void>((done) => (release = done));
    let requests = 0;
    await page.route('**/api/learning/notifications', async (route) => {
      requests++;
      await gate;
      await route.fulfill({
        status: 503,
        json: { error: { code: 'unavailable', message: 'Временно недоступно' } },
      });
    });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/notifications');
    const events = page.getByRole('region', { name: 'События уведомлений', exact: true });
    await expect(events.getByText('Загружаем события…')).toBeVisible();
    await assertInboxGeometry(page, width, 'loading');
    expect(requests).toBe(1);
    release();
    await expect(events.getByRole('alert')).toContainText('Временно недоступно');
    await page.unroute('**/api/learning/notifications');
    await events.getByRole('button', { name: 'Повторить', exact: true }).click();
    await expect(events.getByRole('alert')).toHaveCount(0);
    await expect(events.getByText('Нет доставленных оповещений в этом списке.')).toBeVisible();
    await expect(events.locator('.learning-inbox-unread')).toHaveText('Непрочитанных: 0');
    await assertInboxGeometry(page, width, 'retry-empty');
    await stressInboxFont(page);
    await assertInboxGeometry(page, width, 'font150-empty');
  });

async function traverse(page: Page, direction: 'back' | 'forward') {
  // Wait for the requested browser entry change before asserting restoration;
  // otherwise an assertion could pass on the old URL before Back has happened.
  await page.evaluate(
    (step) =>
      new Promise<void>((resolve) => {
        window.addEventListener('popstate', () => resolve(), { once: true });
        window.history[step]();
      }),
    direction,
  );
}

for (const navigationApi of [true, false]) {
  const browserMode = navigationApi ? 'Navigation API' : 'without Navigation API';
  const disableNavigationApi = async (page: Page) => {
    if (!navigationApi)
      await page.addInitScript(() =>
        Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
      );
  };
  for (const decision of [
    'Остаться',
    'Отменить изменения и перейти',
    'Сохранить и перейти',
    'Ошибка сохранения и повтор',
  ])
    test(`duplicate addresses retain their distinct history entries: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      let failingSave = decision === 'Ошибка сохранения и повтор';
      await page.route('**/api/account/profile', async (route) => {
        if (route.request().method() === 'PATCH' && failingSave)
          return route.fulfill({
            status: 503,
            json: { error: { code: 'unavailable', message: 'profile save unavailable' } },
          });
        return route.fallback();
      });
      const entryIndex = () =>
        page.evaluate(() => {
          const browser = window as Window & {
            navigation?: { currentEntry?: { index: number } };
          };
          return browser.navigation?.currentEntry?.index ?? window.history.state?.asaRouteIndex;
        });
      const go = (delta: number) =>
        page.evaluate(
          (offset) =>
            new Promise<void>((resolve) => {
              window.addEventListener('popstate', () => resolve(), { once: true });
              window.history.go(offset);
            }),
          delta,
        );
      await page.goto('/#/account/notifications');
      await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
      const firstIndex = await entryIndex();
      await panel(page, 'Профиль').click();
      await panel(page, 'Интерфейс').click();
      await panel(page, 'Профиль').click();
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик повторяющегося адреса');
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await go(-1);
      await expect(guard).toBeVisible();
      await expect.poll(entryIndex).toBe(firstIndex + 3);
      // The history list can select an earlier entry with exactly the same URL.
      // URL-only deduplication would silently leave the browser at profile[1].
      await go(-2);
      await expect.poll(entryIndex).toBe(firstIndex + 3);
      await expect(name).toHaveValue('Черновик повторяющегося адреса');
      if (decision === 'Остаться') {
        await guard.getByRole('button', { name: decision, exact: true }).click();
        await expect(guard).toHaveCount(0);
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await expect(name).toHaveValue('Черновик повторяющегося адреса');
        await go(-2);
        await expect(guard).toBeVisible();
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
        // A new Back decision must still target interface[2], not profile[1].
        await go(-1);
        await expect(guard).toBeVisible();
        await expect.poll(entryIndex).toBe(firstIndex + 3);
      }
      if (failingSave) {
        await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
        await expect(guard.getByRole('alert')).toContainText('Не удалось сохранить');
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        await expect(name).toHaveValue('Черновик повторяющегося адреса');
        await go(-2);
        await expect.poll(entryIndex).toBe(firstIndex + 3);
        failingSave = false;
      }
      const saved = decision === 'Сохранить и перейти' || decision === 'Ошибка сохранения и повтор';
      await guard
        .getByRole('button', {
          name: saved ? 'Сохранить и перейти' : 'Отменить изменения и перейти',
          exact: true,
        })
        .click();
      await expect.poll(entryIndex).toBe(firstIndex + 2);
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
      // Assert every original entry in order in both directions; replacing the
      // notifications entry with interface must never satisfy this regression.
      for (const [offset, route] of [
        [1, 'profile'],
        [0, 'notifications'],
        [1, 'profile'],
        [2, 'interface'],
        [3, 'profile'],
      ] as const) {
        await go(firstIndex + offset - (await entryIndex()));
        await expect.poll(entryIndex).toBe(firstIndex + offset);
        await expect(page).toHaveURL(new RegExp(`#/account/${route}$`));
        if (route === 'profile')
          await expect(name).toHaveValue(
            saved ? 'Черновик повторяющегося адреса' : 'Проверочный профиль',
          );
        if (route === 'notifications')
          await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
      }
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        saved ? 1 : 0,
      );
    });
  for (const decision of ['Остаться', 'Отменить изменения и перейти', 'Сохранить и перейти'])
    test(`native hash replacement preserves the original destination: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      await page.goto('/#/account/profile');
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик исходного адреса');
      await page.evaluate(() => {
        window.location.hash = '/account/security';
      });
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      // A new native entry truncates the original forward entry while the
      // original decision is pending. Its history index is no longer its identity.
      await page.evaluate(() => {
        window.location.hash = '/help';
      });
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue('Черновик исходного адреса');
      await guard.getByRole('button', { name: decision, exact: true }).click();
      if (decision === 'Остаться') {
        await expect(guard).toHaveCount(0);
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await expect(name).toHaveValue('Черновик исходного адреса');
        expect(state.mutations).toEqual([]);
        // A fresh decision must not revive the cancelled destination.
        await page.evaluate(() => {
          window.location.hash = '/account/interface';
        });
        await expect(guard).toBeVisible();
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await guard
          .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
          .click();
        await expect(page).toHaveURL(/#\/account\/interface$/);
        return;
      }
      await expect(page).toHaveURL(/#\/account\/security$/);
      await expect(page.getByRole('heading', { name: 'Безопасность', exact: true })).toBeVisible();
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue(
        decision === 'Сохранить и перейти' ? 'Черновик исходного адреса' : 'Проверочный профиль',
      );
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/security$/);
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        decision === 'Сохранить и перейти' ? 1 : 0,
      );
    });

  test(`failed save retains both draft and original native hash destination ${browserMode}`, async ({
    page,
  }) => {
    await disableNavigationApi(page);
    const state = await fixture(page);
    let failingSave = true;
    await page.route('**/api/account/profile', async (route) => {
      if (route.request().method() === 'PATCH' && failingSave)
        return route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'profile save unavailable' } },
        });
      return route.fallback();
    });
    await page.goto('/#/account/profile');
    const name = page.getByLabel('Отображаемое имя');
    await name.fill('Черновик после ошибки сохранения');
    await page.evaluate(() => {
      window.location.hash = '/account/security';
    });
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await page.evaluate(() => {
      window.location.hash = '/help';
    });
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(guard.getByRole('alert')).toContainText('Не удалось сохранить');
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await expect(name).toHaveValue('Черновик после ошибки сохранения');
    failingSave = false;
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/account\/security$/);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Черновик после ошибки сохранения');
    expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  });

  test(`administrator transition protects the profile draft ${browserMode}`, async ({ page }) => {
    await disableNavigationApi(page);
    const state = await fixture(page, { platformAdmin: true });
    await page.goto('/#/account/profile');
    const admin = page.getByRole('button', { name: 'Админ', exact: true });
    const name = page.getByLabel('Отображаемое имя');
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(admin).toBeVisible();
    await name.fill('Администратор с черновиком');
    await admin.click();
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(name).toHaveValue('Администратор с черновиком');
    await admin.click();
    await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await expect(name).toHaveCount(0);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Проверочный профиль');
    await name.fill('Сохранённый администратор');
    await admin.click();
    await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/admin$/);
    await traverse(page, 'back');
    await expect(name).toHaveValue('Сохранённый администратор');
    expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  });

  for (const decision of ['Остаться', 'Отменить изменения и перейти', 'Сохранить и перейти'])
    test(`repeated Back and Forward during a draft dialog stays coherent: ${decision} ${browserMode}`, async ({
      page,
    }) => {
      await disableNavigationApi(page);
      const state = await fixture(page);
      await page.goto('/#/account/notifications');
      await panel(page, 'Интерфейс').click();
      await panel(page, 'Профиль').click();
      // Keep a genuine forward entry, so both directions can be repeated while
      // the first Back decision is pending.
      await page.evaluate(() => {
        window.location.hash = '/help';
      });
      await expect(page).toHaveURL(/#\/help$/);
      await traverse(page, 'back');
      const name = page.getByLabel('Отображаемое имя');
      await name.fill('Черновик повторного перехода');
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await traverse(page, 'back');
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue('Черновик повторного перехода');
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await guard.getByRole('button', { name: decision, exact: true }).click();
      if (decision === 'Остаться') {
        await expect(page).toHaveURL(/#\/account\/profile$/);
        await expect(name).toHaveValue('Черновик повторного перехода');
        await traverse(page, 'back');
        await guard
          .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
          .click();
      }
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
      await traverse(page, 'forward');
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(name).toHaveValue(
        decision === 'Сохранить и перейти' ? 'Черновик повторного перехода' : 'Проверочный профиль',
      );
      expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(
        decision === 'Сохранить и перейти' ? 1 : 0,
      );
    });

  test(`native hash entry is restored and then reached after discard ${browserMode}`, async ({
    page,
  }) => {
    await disableNavigationApi(page);
    await fixture(page);
    await page.goto('/#/account/profile');
    if (!navigationApi)
      expect(
        await page.evaluate(() => 'navigation' in window && window.navigation),
      ).toBeUndefined();
    const name = page.getByLabel('Отображаемое имя');
    await name.fill('Черновик новой hash-записи');
    await page.evaluate(() => {
      window.location.hash = '/account/notifications';
    });
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(name).toHaveValue('Черновик новой hash-записи');
    await traverse(page, 'forward');
    await expect(guard).toBeVisible();
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/account\/notifications$/);
    await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
    await traverse(page, 'back');
    await expect(page).toHaveURL(/#\/account\/profile$/);
    await expect(name).toHaveValue('Проверочный профиль');
    await traverse(page, 'forward');
    await expect(page).toHaveURL(/#\/account\/notifications$/);
    await expect(page.getByLabel('Получать учебные оповещения')).toBeVisible();
  });
}

test('personal account never receives administrative navigation from its display name', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account/profile');
  await page.getByLabel('Отображаемое имя').fill('Администратор');
  await expect(page.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(0);
});
async function capture(page: Page, path: string) {
  await page.evaluate(async () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    await new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );
  });
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(
    await page.locator('.portal-header').evaluate((header) => header.getBoundingClientRect().top),
  ).toBe(0);
  await page.screenshot({ path, fullPage: true });
}

test('panel addresses reload and repeated Back/Forward keep both history and protected drafts', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account');
  await panel(page, 'Интерфейс').click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await panel(page, 'Профиль').click();
  await page.getByLabel('Отображаемое имя').fill('Черновик после возврата');
  await page.evaluate(() => window.history.back());
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await expect(guard).toBeVisible();
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик после возврата');
  await page.evaluate(() => window.history.back());
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(/#\/account\/profile$/);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
  await page.evaluate(() => window.history.back());
  await expect(page).toHaveURL(/#\/account\/interface$/);
  await expect(guard).toHaveCount(0);
});

test('mobile selection uses the same draft guard and saving navigates only after persistence', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Сохранённый переход');
  await page.getByLabel('Выбрать раздел настроек').selectOption('interface');
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Сохранить и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/account\/interface$/);
  expect(state.mutations.filter((path) => path === '/api/account/profile')).toHaveLength(1);
  await page.getByRole('combobox', { name: /^Часовой пояс/ }).selectOption('UTC');
  await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
  await expect(guard).toBeVisible();
  await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(page.getByRole('combobox', { name: /^Часовой пояс/ })).toHaveValue('UTC');
  await page
    .getByRole('form', { name: 'Часовой пояс', exact: true })
    .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
    .click();
  await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Сохранённый переход');
});

test('avatar dialog contains keyboard focus and restores the opener on Escape', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/account');
  const opener = page.getByRole('button', { name: 'Выбрать аватар', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeFocused();
  await expect(dialog.getByRole('button', { name: 'Загрузить', exact: true })).toBeEnabled();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Информация о выборе аватара' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Загрузить', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Информация о выборе аватара' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(opener).toBeFocused();
});

for (const persona of ['personal', 'author', 'teacher-learner', 'organization'] as const)
  test(`settings follow actual server actions for ${persona}`, async ({ page }) => {
    await fixture(page, {
      author: persona === 'author',
      educator: persona === 'teacher-learner' || persona === 'organization',
      organization: persona === 'organization',
    });
    await page.goto('/#/account/notifications');
    const staff = page.getByLabel('Работы на проверку', { exact: true });
    if (persona === 'teacher-learner' || persona === 'organization')
      await expect(staff).toBeVisible();
    else await expect(staff).toHaveCount(0);
    await panel(page, 'Материалы и классы').click();
    if (persona === 'author')
      await expect(page.getByRole('link', { name: 'Открыть материалы' })).toBeVisible();
    if (persona === 'teacher-learner' || persona === 'organization')
      await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
    await panel(page, 'Школы').click();
    await expect(page.getByText('Активна', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Полный', { exact: true })).toHaveCount(0);
    if (persona === 'organization')
      await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
  });

test('notification load errors are retryable, drafts stay on cancelled navigation and hidden staff keys survive save', async ({
  page,
}) => {
  const state = await fixture(page, { notificationFailure: true });
  await page.goto('/#/account/notifications');
  await expect(page.getByRole('alert')).toContainText('Настройки временно недоступны');
  await expect(page.getByText('Загружаем настройки…', { exact: true })).toHaveCount(0);
  state.recoverNotifications();
  await page.getByRole('button', { name: 'Обновить форму' }).click();
  const master = page.getByLabel('Получать учебные оповещения');
  await master.uncheck();
  await panel(page, 'Профиль').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Остаться', exact: true }).click();
  await expect(master).not.toBeChecked();
  const saved = page.waitForRequest(
    (request) =>
      request.method() === 'POST' &&
      request.url().endsWith('/api/learning/notifications/preferences'),
  );
  await page.getByRole('button', { name: 'Сохранить оповещения' }).click();
  expect((await saved).postDataJSON().categories.NC02).toBe(true);
});

for (const width of [1440, 1024, 390, 320])
  test(`Seat has three honest panels and retryable awards at ${width}px`, async ({ page }) => {
    const state = await fixture(page, { seat: true, awardsFailure: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account');
    await expect(page.getByRole('alert')).toContainText('Не удалось загрузить значки');
    await expect(page.getByText(/Пока ни одного/)).toHaveCount(0);
    state.recoverAwards();
    await page.getByRole('button', { name: 'Повторить загрузку значков' }).click();
    await expect(page.getByText(/Пока ни одного/)).toBeVisible();
    for (const name of ['Мой профиль', 'Интерфейс', 'Уведомления']) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        ),
      ).toBe(true);
      await capture(page, `${evidence}/seat-${width}-${name}.png`);
    }
    const personalPreferences = page.getByRole('region', {
      name: 'Учебные оповещения — только для меня',
      exact: true,
    });
    await expect(personalPreferences.getByLabel('Работы на проверку')).toHaveCount(0);
    await expect(personalPreferences.getByLabel('Заявки и приглашения')).toHaveCount(0);
    expect(state.mutations).toEqual([]);
  });

test('routing outside settings keeps ordinary Back/Forward without a draft dialog', async ({
  page,
}) => {
  await fixture(page);
  await page.goto('/#/help');
  await page.evaluate(() => {
    window.location.hash = '/account/interface';
  });
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await page.evaluate(() => {
    window.location.hash = '/help';
  });
  await expect(page).toHaveURL(/#\/help$/);
  await page.evaluate(() => window.history.back());
  await expect(page.getByRole('heading', { name: 'Интерфейс', exact: true })).toBeVisible();
  await page.evaluate(() => window.history.forward());
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
});

test('profile failure shows retry instead of an endless spinner', async ({ page }) => {
  const state = await fixture(page, { profileFailure: true });
  await page.goto('/#/account');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить профиль');
  await expect(page.getByText('Загружаем настройки…')).toHaveCount(0);
  state.recoverProfile();
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
});

test('secondary failure cannot block profile, grant educator, or erase a dirty draft', async ({
  page,
}) => {
  const state = await fixture(page, { secondaryFailure: true });
  await page.goto('/#/account');
  const name = page.getByLabel('Отображаемое имя');
  await expect(name).toBeVisible();
  await expect(page.getByLabel(/Кто вы в ASA Lab/)).toHaveCount(0);
  await name.fill('Мой несохранённый текст');
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(name).toHaveValue('Мой несохранённый текст');
  state.recoverSecondary();
  await page.getByRole('button', { name: 'Повторить загрузку' }).click();
  await expect(page.getByText(/Не удалось обновить:/)).toHaveCount(0);
  await expect(name).toHaveValue('Мой несохранённый текст');
  await page.getByRole('button', { name: 'Сохранить изменения', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Изменения сохранены.' })).toBeVisible();
  expect(state.mutations).toContain('/api/account/profile');
  expect(state.mutations).not.toContain('/api/account/role');
  expect(state.mutations).not.toContain('/api/capabilities/educator/self-attest');
  await page.reload();
  await expect(name).toHaveValue('Мой несохранённый текст');
});

test('unknown MAX is not disconnected; teaching is a separate explicit action', async ({
  page,
}) => {
  const state = await fixture(page, { secondaryFailure: true });
  await page.goto('/#/account');
  await panel(page, 'Безопасность').click();
  await expect(page.getByText('Статус недоступен', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Подключить MAX', exact: true })).toHaveCount(0);
  await panel(page, 'Материалы и классы').click();
  await page.getByRole('button', { name: 'Подключить', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть классы', exact: true })).toBeVisible();
  expect(
    state.mutations.filter((path) => path === '/api/capabilities/educator/self-attest'),
  ).toHaveLength(1);
  expect(state.mutations).not.toContain('/api/schools');
  expect(state.mutations).not.toContain('/api/account/role');
});

for (const width of [1440, 1024, 390, 320])
  test(`six account panels fit ${width}px without horizontal overflow`, async ({ page }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account');
    if (width <= 900)
      await expect(page.getByLabel('Выбрать раздел настроек').locator('option')).toHaveCount(6);
    else await expect(page.getByLabel('Разделы настроек').getByRole('button')).toHaveCount(6);
    for (const name of [
      'Профиль',
      'Безопасность',
      'Интерфейс',
      'Материалы и классы',
      'Школы',
      'Уведомления',
    ]) {
      if (width <= 900)
        await page.getByLabel('Выбрать раздел настроек').selectOption({ label: name });
      else await panel(page, name).click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth + 1,
      );
      expect(overflow, `${width}px ${name}`).toBe(false);
      if (name === 'Материалы и классы') {
        const textWidths = await page
          .locator('.account-capability-card > div')
          .evaluateAll((elements) =>
            elements.map((element) => element.getBoundingClientRect().width),
          );
        expect(textWidths).toHaveLength(2);
        // The reported failure squeezed the description into a 52px icon slot.
        for (const textWidth of textWidths)
          expect(textWidth, `${width}px capability description`).toBeGreaterThan(
            width <= 700 ? 170 : 210,
          );
      }
      if (name === 'Уведомления') {
        const rows = page.locator(
          '.learning-notification-settings label:has(input[type="checkbox"])',
        );
        for (const row of await rows.all()) {
          const layout = await row.evaluate((label) => {
            const input = label.querySelector('input')!.getBoundingClientRect();
            const bounds = label.getBoundingClientRect();
            const style = getComputedStyle(label);
            const context = document.createElement('canvas').getContext('2d')!;
            context.font = style.font;
            const naturalTextWidth = context.measureText(label.textContent!.trim()).width;
            return {
              checkboxWidth: input.width,
              captionWidth: bounds.width - input.width - 10,
              naturalTextWidth,
              rowHeight: bounds.height,
            };
          });
          expect(layout.checkboxWidth).toBeLessThanOrEqual(24);
          // Short captions and their i form a natural group. Long captions still
          // retain a readable text slot; a stretched label is not a layout goal.
          expect(layout.captionWidth).toBeGreaterThanOrEqual(
            Math.min(150, layout.naturalTextWidth) - 1,
          );
          expect(layout.rowHeight).toBeLessThan(90);
        }
        const actions = page.locator(
          '.learning-notification-settings > .learning-notification-actions',
        );
        const primary = await actions
          .getByRole('button', { name: 'Сохранить оповещения' })
          .boundingBox();
        const cancel = await actions
          .getByRole('button', { name: 'Отменить', exact: true })
          .boundingBox();
        const footer = (await actions.boundingBox())!;
        if (primary!.width + cancel!.width + 8 <= footer.width + 1)
          expect(primary!.y).toBe(cancel!.y);
        else {
          expect(cancel!.y).toBeGreaterThanOrEqual(primary!.y + primary!.height);
          expect(cancel!.x).toBe(primary!.x);
        }
      }
      await capture(page, `${evidence}/account-${width}-${name}.png`);
    }
    if (width <= 900)
      await page.getByLabel('Выбрать раздел настроек').selectOption({ label: 'Профиль' });
    else await panel(page, 'Профиль').click();
    await capture(page, `${evidence}/account-${width}.png`);
  });

for (const width of [1440, 1024, 390, 320])
  test(`shared personal notification layout works in Inbox, attended class and staff class at ${width}px`, async ({
    page,
  }) => {
    await fixture(page, { educator: true });
    await page.setViewportSize({ width, height: 900 });
    for (const route of ['/#/attending', '/#/classrooms/class-1']) {
      await page.goto(route);
      const summary = page.locator('summary').filter({
        hasText: route.includes('attending')
          ? /^Мои оповещения об этом классе$/
          : /^Настройки учебных оповещений$/,
      });
      await summary.click();
      const form = page.getByRole('region', {
        name: 'Учебные оповещения — только для меня',
        exact: true,
      });
      await expect(form.getByLabel('Получать учебные оповещения')).toBeVisible();
      await form.getByLabel('Мои оповещения об этом классе').selectOption('custom');
      await expect(
        form.getByRole('combobox', { name: 'Назначения и условия', exact: true }),
      ).toBeVisible();
      if (route.includes('attending'))
        await expect(
          form.getByRole('combobox', { name: 'Работы на проверку', exact: true }),
        ).toHaveCount(0);
      else
        await expect(
          form.getByRole('combobox', { name: 'Работы на проверку', exact: true }),
        ).toBeVisible();
      const checkbox = await form.getByLabel('Получать учебные оповещения').boundingBox();
      expect(checkbox?.width).toBe(20);
      await form.screenshot({
        path: `${evidence}/${route.includes('attending') ? 'attending' : 'classroom'}-${width}-notifications.png`,
      });
    }
    await page.goto('/#/account/notifications');
    const inbox = page.getByRole('region', {
      name: 'Учебные оповещения — только для меня',
      exact: true,
    });
    await expect(inbox.getByLabel('Работы на проверку', { exact: true })).toBeVisible();
    expect(
      await inbox
        .getByLabel('Получать учебные оповещения')
        .evaluate((element) => element.getBoundingClientRect().width),
    ).toBe(20);
    await inbox.screenshot({ path: `${evidence}/inbox-${width}-notifications.png` });
  });

async function assertCompactSettings(page: Page, width: number) {
  const main = page.locator('main.account-settings-page');
  await expect(main.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(main.getByRole('heading', { name: 'Настройки', level: 1 })).toBeVisible();
  await expect(main.locator('.portal-eyebrow')).toHaveCount(0);
  await expect(main.locator('.account-settings-navigation > strong')).toHaveCount(0);
  await expect(main.getByRole('heading', { name: 'Оформление' })).toHaveCount(0);
  // The first actual setting fits near the top even on a narrow phone. This
  // catches the repeated headings and context strip shown in the owner report.
  const firstControl = await main.getByLabel('Анимация', { exact: false }).boundingBox();
  expect(firstControl).not.toBeNull();
  // Between the picker breakpoint and tablet width, the scope hint may wrap
  // once inside the desktop settings column; it must still fit above 320px.
  // The approved mobile shell has a second 44px public-navigation row. Measure
  // settings density below the shell so this still catches extra page banners.
  const header = (await page.locator('.portal-header').boundingBox())!;
  const belowHeader = firstControl!.y - (header.y + header.height);
  expect(belowHeader).toBeLessThan(width <= 900 ? 314 : width < 1024 ? 264 : 244);
  expect(belowHeader + firstControl!.height).toBeLessThan(width <= 900 ? 354 : 294);
  const sectionHeading = await main
    .getByRole('heading', { name: 'Интерфейс', level: 2 })
    .boundingBox();
  expect(sectionHeading!.height).toBeLessThanOrEqual(1);
  console.log(
    `Settings density ${width}px: H2 y=${sectionHeading!.y.toFixed(1)}, first control y=${firstControl!.y.toFixed(1)}, bottom=${(firstControl!.y + firstControl!.height).toFixed(1)}`,
  );
  const form = main.getByRole('form', { name: 'Оформление', exact: true });
  for (const name of [
    'Сохранить оформление',
    'Отменить изменения оформления',
    'Сбросить оформление',
  ])
    await expect(form.getByRole('button', { name, exact: true })).toBeVisible();
  for (const control of await form.getByRole('button').all())
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  const primary = await form
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .boundingBox();
  const cancel = await form
    .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
    .boundingBox();
  expect(primary!.y).toBe(cancel!.y);
  const actions = await form.locator('.account-presentation-actions').boundingBox();
  const zoneFooter = main.locator('.account-time-zone .account-form-actions');
  const zoneActions = (await zoneFooter.count()) ? await zoneFooter.boundingBox() : null;
  console.log(
    `Settings actions ${width}px: presentation=${actions!.height.toFixed(1)}px, time-zone=${zoneActions?.height.toFixed(1) ?? 'n/a'}px`,
  );
}

async function assertCollapseAnchor(page: Page) {
  const geometry = await page.locator('#portal-sidebar').evaluate((sidebar) => {
    const box = (el: Element) => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const button = sidebar.querySelector('.portal-sidebar-collapse')!;
    const visual = button.querySelector('.portal-sidebar-collapse-visual')!;
    return {
      sidebar: box(sidebar),
      button: box(button),
      visual: box(visual),
      height: innerHeight,
      controls: [
        ...document.querySelectorAll(
          '#portal-sidebar a,#portal-sidebar button:not(.portal-sidebar-collapse),main button,main a,main input,main select',
        ),
      ]
        .filter((el) => el.checkVisibility())
        .map(box),
    };
  });
  expect(geometry.visual.width).toBe(24);
  expect(geometry.visual.height).toBe(48);
  expect(geometry.visual.x + 12).toBeCloseTo(geometry.sidebar.right, 0);
  expect(geometry.height - geometry.visual.bottom).toBe(112);
  expect(geometry.button.width).toBeGreaterThanOrEqual(44);
  expect(geometry.button.height).toBeGreaterThanOrEqual(44);
  for (const control of geometry.controls) {
    const x =
      Math.min(control.right, geometry.button.right) - Math.max(control.x, geometry.button.x);
    const y =
      Math.min(control.bottom, geometry.button.bottom) - Math.max(control.y, geometry.button.y);
    expect(x > 0 && y > 0, 'collapse hit overlaps a navigation/content action').toBe(false);
  }
}
const shellEvidence = `${r2Evidence}/shell`;

async function assertShellGeometry(page: Page, width: number) {
  const metrics = await page.locator('.portal-header').evaluate((header) => {
    const bounds = (element: Element) => {
      const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
    };
    const selectors = [
      '.portal-menu-toggle',
      '.portal-brand',
      '.portal-global-nav a',
      '.portal-quick-create > summary',
      '.learning-inbox-button',
      '.portal-account > summary',
    ];
    return {
      header: bounds(header),
      controls: selectors.flatMap((selector) =>
        [...header.querySelectorAll(selector)]
          .filter((element) => element.checkVisibility())
          .map((element) => ({
            label: element.getAttribute('aria-label') ?? element.textContent,
            ...bounds(element),
          })),
      ),
      links: [...header.querySelectorAll('.portal-global-nav a')].map(bounds),
      main: bounds(document.querySelector('.portal-shell > main')!),
      overflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  expect(metrics.overflow, `${width}px page overflow`).toBe(false);
  for (const control of metrics.controls) {
    expect(control.height, `${width}px ${control.label} touch height`).toBeGreaterThanOrEqual(44);
    expect(control.width, `${width}px ${control.label} touch width`).toBeGreaterThanOrEqual(44);
    expect(control.x, `${width}px ${control.label} left`).toBeGreaterThanOrEqual(0);
    expect(control.right, `${width}px ${control.label} right`).toBeLessThanOrEqual(width);
    expect(control.bottom, `${width}px ${control.label} below header`).toBeLessThanOrEqual(
      metrics.header.bottom + 1,
    );
  }
  for (let i = 0; i < metrics.controls.length; i++)
    for (let j = i + 1; j < metrics.controls.length; j++) {
      const a = metrics.controls[i]!,
        b = metrics.controls[j]!;
      const intersectionWidth = Math.min(a.right, b.right) - Math.max(a.x, b.x);
      const intersectionHeight = Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y);
      expect(
        intersectionWidth > 1 && intersectionHeight > 1,
        `${width}px overlap: ${a.label} / ${b.label}`,
      ).toBe(false);
    }
  if (width <= 1023) {
    const account = metrics.controls.find((control) => control.label?.startsWith('Меню аккаунта'))!;
    expect(account.right, 'mobile avatar follows the Header right inset').toBe(width - 8);
  }
  for (const link of metrics.links) expect(link.height).toBeGreaterThanOrEqual(44);
  if (width <= 1023) {
    expect(metrics.header.height).toBeGreaterThanOrEqual(100);
    for (const link of metrics.links) expect(link.y).toBeGreaterThanOrEqual(metrics.header.y + 56);
    // A hidden desktop sidebar must not leave its 264px content offset behind.
    expect(metrics.main.x).toBeLessThanOrEqual(24);
    expect(metrics.main.right).toBeLessThanOrEqual(width);
  } else expect(metrics.header.height).toBeLessThan(60);
}

for (const width of [1440, 1024, 390, 320, 349, 350, 600, 601, 820, 821, 1022, 1023])
  test(`portal shell has distinct non-overlapping slots and room for a third public link at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(shellEvidence, { recursive: true });
    const state = await fixture(page, {
      educator: true,
      author: true,
      presentationLongContent: true,
    });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимация', { exact: false })).toBeEnabled();
    const publicNav = page.getByLabel('Разделы ASA Lab');
    await expect(publicNav.getByRole('link')).toHaveCount(2);
    await expect(publicNav.getByRole('link', { name: 'ИИ', exact: true })).toHaveCount(0);
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/shell-${width}.png` });
    // Layout-only fixture: the real product exposes no placeholder AI feature.
    await publicNav.evaluate((nav) => {
      const third = nav.querySelector('a')!.cloneNode(true) as HTMLAnchorElement;
      third.href = '/#/ai-fixture';
      third.dataset.layoutFixture = 'future-ai';
      third.removeAttribute('aria-current');
      third.setAttribute('aria-label', 'ИИ');
      third.querySelector('span')!.textContent = 'ИИ';
      nav.append(third);
    });
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/third-link-fixture-${width}.png` });
    await publicNav.locator('[data-layout-fixture]').evaluate((element) => element.remove());
    const sidebar = page.locator('#portal-sidebar');
    const settings = sidebar.getByRole('link', {
      name: 'Настройки',
      exact: true,
      includeHidden: true,
    });
    await expect(sidebar.locator('a[href="/#/gallery"], a[href="/#/knowledge"]')).toHaveCount(2);
    await expect(
      sidebar.getByRole('link', { name: 'Мои проекты', exact: true, includeHidden: true }),
    ).toHaveCount(1);
    await expect(settings).toHaveCount(1);
    await expect(
      sidebar.getByRole('link', { name: 'Курсы и задания', exact: true, includeHidden: true }),
    ).toHaveCount(1);
    if (width <= 1023) {
      const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
      await toggle.click();
      await expect(sidebar).toHaveAttribute('role', 'dialog');
      await expect(page.locator('.portal-header')).toHaveAttribute('inert', '');
      const order = await sidebar.evaluate((element) => {
        const nav = element.querySelector('.portal-nav')!,
          footer = element.querySelector('.portal-sidebar-footer')!;
        const links = [...footer.querySelectorAll('a, button')].map((child) => {
          const r = child.getBoundingClientRect();
          return { top: r.top, bottom: r.bottom, height: r.height };
        });
        return {
          navBottom: nav.getBoundingClientRect().bottom,
          links,
          navOrder: getComputedStyle(nav).order,
          footerBottomMargin: getComputedStyle(footer).marginBottom,
        };
      });
      expect(order.navOrder).toBe('0');
      expect(order.footerBottomMargin).toBe('0px');
      expect(order.links[0]!.top).toBeGreaterThanOrEqual(order.navBottom);
      for (let i = 1; i < order.links.length; i++)
        expect(order.links[i]!.top).toBeGreaterThanOrEqual(order.links[i - 1]!.bottom);
      for (const link of order.links) expect(link.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: `${shellEvidence}/drawer-${width}-short.png` });
      const exit = sidebar.getByRole('button', { name: 'Выход', exact: true });
      await exit.scrollIntoViewIfNeeded();
      expect(
        (await exit.boundingBox())!.y + (await exit.boundingBox())!.height,
      ).toBeLessThanOrEqual(568);
      await page.screenshot({ path: `${shellEvidence}/drawer-${width}-logout.png` });
      // Tab wraps from the last action to Close; Escape restores the trigger.
      await exit.focus();
      await page.keyboard.press('Tab');
      await expect(
        sidebar.getByRole('button', { name: 'Закрыть меню', exact: true }),
      ).toBeFocused();
      await page.keyboard.press('Escape');
      await expect(toggle).toBeFocused();
      await expect(page.locator('.portal-header')).not.toHaveAttribute('inert', '');
    } else {
      const collapse = sidebar.getByRole('button', {
        name: 'Свернуть боковую панель',
        exact: true,
      });
      await collapse.scrollIntoViewIfNeeded();
      const size = await collapse.boundingBox();
      expect(size!.width).toBe(44);
      expect(size!.height).toBe(48);
      await assertCollapseAnchor(page);
      await page.screenshot({ path: `${shellEvidence}/expanded-control-${width}.png` });
      await collapse.click();
      await expect(sidebar).toHaveClass(/collapsed/);
      await assertCollapseAnchor(page);
      await page.screenshot({ path: `${shellEvidence}/collapsed-${width}.png` });
      expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(
        1,
      );
      await page.reload();
      await expect(sidebar).toHaveClass(/collapsed/);
    }
  });

for (const width of [1440, 1024, 1023, 1022, 821, 820, 601, 600, 390, 350, 349, 320])
  test(`portal shell reserves intrinsic brand and Create width under wide text metrics at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(shellEvidence, { recursive: true });
    await fixture(page, { educator: true, author: true, unreadCount: 9999 });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимация', { exact: false })).toBeEnabled();
    await expect(page.locator('.learning-inbox-button')).toHaveCount(0);
    // A deterministic wider font plus text-spacing stress exposes the brand's
    // old 120px minimum on Windows too, instead of depending on Linux fonts.
    await page.addStyleTag({
      content: `
        .portal-header, .portal-header * {
          font-family: monospace !important;
          letter-spacing: 2px !important;
        }
        .portal-header button, .portal-header a, .portal-header summary {
          font-size: 24px !important;
        }
      `,
    });
    await assertShellGeometry(page, width);
    const nav = page.getByLabel('Разделы ASA Lab');
    await nav.evaluate((element) => {
      const third = element.querySelector('a')!.cloneNode(true) as HTMLAnchorElement;
      third.href = '/#/ai-fixture';
      third.removeAttribute('aria-current');
      third.setAttribute('aria-label', 'ИИ');
      third.querySelector('span')!.textContent = 'ИИ';
      element.append(third);
    });
    await assertShellGeometry(page, width);
    await page.screenshot({ path: `${shellEvidence}/wide-text-third-link-${width}.png` });
  });

for (const role of ['account', 'seat', 'teacher', 'author', 'admin'] as const)
  test(`short mobile drawer preserves ${role} navigation projections and one settings destination`, async ({
    page,
  }) => {
    await fixture(page, {
      seat: role === 'seat',
      educator: role === 'teacher',
      author: role === 'author',
      platformAdmin: role === 'admin',
      presentationLongContent: true,
    });
    await page.setViewportSize({ width: 390, height: 568 });
    await page.goto('/#/account');
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    const sidebar = page.locator('#portal-sidebar');
    await expect(
      sidebar.getByRole('link', {
        name: role === 'seat' ? 'Настройки учебного профиля' : 'Настройки',
        exact: true,
      }),
    ).toHaveCount(1);
    await expect(sidebar.locator('a[href="/#/account"]')).toHaveCount(1);
    await expect(sidebar.getByRole('link', { name: 'Классы', exact: true })).toHaveCount(
      role === 'teacher' ? 1 : 0,
    );
    await expect(sidebar.getByRole('link', { name: 'Курсы и задания', exact: true })).toHaveCount(
      ['teacher', 'author'].includes(role) ? 1 : 0,
    );
    await expect(sidebar.getByRole('button', { name: 'Админ', exact: true })).toHaveCount(
      role === 'admin' ? 1 : 0,
    );
    await expect(
      sidebar.getByRole('link', {
        name: role === 'seat' ? 'Мои учебные работы' : 'Мои проекты',
        exact: true,
      }),
    ).toBeVisible();
    const help = sidebar.getByRole('link', {
      name: role === 'seat' ? 'Помощь' : 'Справка',
      exact: true,
    });
    await help.scrollIntoViewIfNeeded();
    await expect(help).toHaveAttribute('href', '/#/help');
    await page.screenshot({ path: `${shellEvidence}/drawer-${role}-390-short.png` });
    await help.click();
    await expect(page).toHaveURL(/#\/help$/);
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.locator('.portal-menu-backdrop').click({ position: { x: 385, y: 300 } });
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await page.setViewportSize({ width: 1023, height: 568 });
    await expect(sidebar).toHaveClass(/mobile-open/);
    await page.setViewportSize({ width: 1024, height: 568 });
    await expect(sidebar).not.toHaveClass(/mobile-open/);
    await expect(sidebar).not.toHaveAttribute('role', 'dialog');
    await expect(page.locator('.portal-header')).not.toHaveAttribute('inert', '');
    await expect(page.locator('.portal-shell > main')).not.toHaveAttribute('inert', '');
    expect(await page.locator('body').evaluate((element) => element.style.overflow)).not.toBe(
      'hidden',
    );
    await page.setViewportSize({ width: 1023, height: 568 });
    const toggle = page.getByRole('button', { name: 'Открыть меню', exact: true });
    await toggle.click();
    await page.keyboard.press('Escape');
    await expect(toggle).toBeFocused();
  });

for (const width of [1440, 1024, 1023, 821, 390, 320])
  test(`public and personal routes retain shell, active section, native links and dirty guard at ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    for (const hash of [
      'home',
      'projects',
      'gallery',
      'knowledge',
      'learning',
      'help',
      'account',
    ]) {
      await page.goto(`/#/${hash}`);
      await expect(page.getByLabel('Разделы ASA Lab').getByRole('link')).toHaveCount(2);
      await assertShellGeometry(page, width);
      const active = page.locator('.portal-global-nav [aria-current="page"]');
      await expect(active).toHaveCount(['gallery', 'knowledge'].includes(hash) ? 1 : 0);
      if (['gallery', 'knowledge'].includes(hash)) {
        await expect(active).toHaveAttribute('href', `/#/${hash}`);
        await expect(page.locator('.portal-nav > a[aria-current="page"]')).toHaveCount(0);
        await expect(page.locator('.portal-mobile-public a[aria-current="page"]')).toHaveAttribute(
          'href',
          `/#/${hash}`,
        );
      }
    }
    const projects = page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Проекты', exact: true });
    await expect(projects).toHaveAttribute('href', '/#/gallery');
    await page.getByLabel('Отображаемое имя').fill('Несохранённый профиль');
    // A modified click follows the native destination; it must not dispatch a
    // guarded same-tab navigation or discard this tab's profile draft.
    const prevented = await projects.evaluate((element) => {
      const click = new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true });
      element.dispatchEvent(click);
      return click.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(page).toHaveURL(/#\/account$/);
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    for (const hash of ['gallery', 'knowledge', 'help']) {
      if (hash !== 'gallery') {
        await page.goto('/#/account');
        await page.getByLabel('Отображаемое имя').fill('Несохранённый профиль');
      }
      const target =
        hash === 'help'
          ? page.locator('#portal-sidebar a[href="/#/help"]')
          : page.locator(`.portal-global-nav a[href="/#/${hash}"]`);
      const follow = async () => {
        if (hash === 'help' && width <= 1023)
          await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
        await target.click();
      };
      await follow();
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
      await page.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Несохранённый профиль');
      await follow();
      await page.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`#/${hash}$`));
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    }
    await page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Проекты', exact: true })
      .click();
    await page
      .getByLabel('Разделы ASA Lab')
      .getByRole('link', { name: 'Знания', exact: true })
      .click();
    await expect(page).toHaveURL(/#\/knowledge$/);
    await traverse(page, 'back');
    await expect(page).toHaveURL(/#\/gallery$/);
    await traverse(page, 'forward');
    await expect(page).toHaveURL(/#\/knowledge$/);
    expect(state.mutations).not.toContain('/api/account/profile');
  });

test('plain native links still protect settings drafts and modified or middle clicks stay native', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик обычной ссылки');
  await page.locator('main').evaluate((main) => {
    const link = document.createElement('a');
    link.href = '/#/help';
    link.textContent = 'Обычная ссылка проверки';
    main.append(link);
  });
  const plain = page.getByRole('link', { name: 'Обычная ссылка проверки', exact: true });
  await plain.click();
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
  await page.getByRole('button', { name: 'Остаться', exact: true }).click();
  const projects = page
    .getByLabel('Разделы ASA Lab')
    .getByRole('link', { name: 'Проекты', exact: true });
  for (const options of [{ button: 1 }, { metaKey: true }, { shiftKey: true }, { altKey: true }])
    expect(
      await projects.evaluate((element, input) => {
        const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...input });
        let observed = false,
          prevented = true;
        document.addEventListener(
          'click',
          (click) => {
            observed = true;
            prevented = click.defaultPrevented;
            // The fixture observes whether the app retained native behavior,
            // then suppresses a real new tab/download from this synthetic click.
            click.preventDefault();
          },
          { once: true },
        );
        element.dispatchEvent(event);
        return { observed, prevented };
      }, options),
    ).toEqual({ observed: true, prevented: false });
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик обычной ссылки');
  expect(state.mutations).not.toContain('/api/account/profile');
  await plain.click();
  await page.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
  await expect(page).toHaveURL(/#\/help$/);
  await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
});

for (const navigationApi of [true, false])
  for (const decision of ['Сохранить и перейти', 'Отменить изменения и перейти'])
    test(`Seat navigation Help completes one ${decision} decision ${navigationApi ? 'with' : 'without'} Navigation API`, async ({
      page,
    }) => {
      if (!navigationApi)
        await page.addInitScript(() =>
          Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
        );
      const state = await fixture(page, { seat: true });
      await page.goto('/#/account/interface');
      await page.getByLabel('Анимация', { exact: false }).selectOption('reduce');
      await expect(
        page.locator('main').getByRole('link', { name: 'Помощь', exact: true }),
      ).toHaveCount(0);
      const help = page
        .locator('#portal-sidebar')
        .getByRole('link', { name: 'Помощь', exact: true });
      await expect(help).toHaveAttribute('href', '/#/help');
      await help.click();
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
      await page.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue('reduce');
      await help.click();
      await page.getByRole('button', { name: decision, exact: true }).click();
      await expect(page).toHaveURL(/#\/help$/);
      await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
      await traverse(page, 'back');
      await expect(page).toHaveURL(/#\/account\/interface$/);
      await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue(
        decision === 'Сохранить и перейти' ? 'reduce' : 'system',
      );
      expect(state.mutations).not.toContain('/api/account/presentation');
    });

for (const width of [560, 561, 900, 901])
  test(`settings heading and picker switch without layout drift at ${width}px boundary`, async ({
    page,
  }) => {
    await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await expect(page.getByLabel('Анимация', { exact: false })).toBeEnabled();
    await assertCompactSettings(page, width);
    await expect(page.getByLabel('Выбрать раздел настроек')).toBeVisible({
      visible: width <= 900,
    });
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await capture(page, `${evidence}/settings-usability-boundary-${width}.png`);
  });

for (const navigationApi of [true, false])
  for (const [alias, destination] of [
    ['privacy', 'security'],
    ['requests', 'school'],
  ])
    test(`legacy ${alias} remains guarded through Back and Forward ${navigationApi ? 'with' : 'without'} Navigation API`, async ({
      page,
    }) => {
      if (!navigationApi)
        await page.addInitScript(() =>
          Object.defineProperty(window, 'navigation', { value: undefined, configurable: true }),
        );
      const state = await fixture(page);
      await page.goto(`/#/account/${alias}`);
      await expect(page.locator('.account-settings-information')).toHaveCount(0);
      if (destination === 'security')
        await expect(page.getByLabel('Новый пароль', { exact: true })).toBeVisible();
      else
        await expect(
          page.getByRole('link', { name: 'Моё обучение с преподавателем', exact: true }),
        ).toBeVisible();
      await expect(page.getByLabel('Выбрать раздел настроек')).toHaveValue(destination);
      await expect(page.getByLabel('Разделы настроек').locator('[aria-current="page"]')).toHaveText(
        destination === 'security' ? 'Безопасность' : 'Школы',
      );
      await panel(page, 'Профиль').click();
      await page.getByLabel('Отображаемое имя').fill('Черновик перед старым адресом');
      await page.evaluate(() => window.history.back());
      const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
      await expect(guard).toBeVisible();
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue(
        'Черновик перед старым адресом',
      );
      await page.evaluate(() => window.history.back());
      await expect(guard).toBeVisible();
      await guard
        .getByRole('button', { name: 'Отменить изменения и перейти', exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/account/${alias}$`));
      await expect(page.getByLabel('Выбрать раздел настроек')).toHaveValue(destination);
      if (destination === 'security')
        await expect(page.getByLabel('Новый пароль', { exact: true })).toBeVisible();
      else
        await expect(
          page.getByRole('link', { name: 'Моё обучение с преподавателем', exact: true }),
        ).toBeVisible();
      await page.evaluate(() => window.history.forward());
      await expect(page).toHaveURL(/#\/account\/profile$/);
      await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Проверочный профиль');
      expect(state.mutations).toHaveLength(0);
    });

test('narrow time-zone action pair tolerates wider 16px font metrics', async ({ page }) => {
  const state = await fixture(page, { presentationSaveFailure: true });
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('/#/account/interface');
  const form = page.getByRole('form', { name: 'Оформление', exact: true });
  const zoneForm = page.getByRole('form', { name: 'Часовой пояс', exact: true });
  const zone = zoneForm.getByRole('combobox', { name: /^Часовой пояс/ });
  await expect(zone).toBeEnabled();
  // Exercise a fallback font with wider Cyrillic metrics without adding a
  // product font preference. Wider font metrics can reproduce the row wrapping seen in CI.
  await page.addStyleTag({
    content: `
    .account-time-zone .account-form-actions > button,
    .account-presentation-actions > :is(.btn-primary, .btn-secondary) {
      font-family: monospace;
      font-size: 16px;
      letter-spacing: 1px;
    }
  `,
  });
  const assertPairs = async (stateName: string) => {
    await capture(page, `${evidence}/settings-actions-font-stress-${stateName}-320.png`);
    for (const actions of [
      form.locator('.account-presentation-actions'),
      zoneForm.locator('.account-form-actions'),
    ]) {
      const pair = actions.locator(':scope > :is(.btn-primary, .btn-secondary)');
      const metrics = await pair.evaluateAll((buttons) =>
        buttons.map((button) => {
          const bounds = button.getBoundingClientRect();
          const style = getComputedStyle(button);
          const text = document.createRange();
          text.selectNodeContents(button);
          const textBounds = text.getBoundingClientRect();
          return {
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            fontSize: style.fontSize,
            family: style.fontFamily,
            textFits: textBounds.left >= bounds.left && textBounds.right <= bounds.right,
          };
        }),
      );
      expect(metrics).toHaveLength(2);
      console.log(`Font stress ${stateName}: ${JSON.stringify(metrics)}`);
      expect(metrics[0].y).toBe(metrics[1].y);
      for (const metric of metrics) {
        expect(metric.fontSize).toBe('16px');
        expect(metric.family).toContain('monospace');
        expect(metric.width).toBeGreaterThanOrEqual(44);
        expect(metric.height).toBeGreaterThanOrEqual(44);
        expect(metric.textFits).toBe(true);
      }
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  };
  await assertPairs('fresh');
  await form.getByLabel('Анимация', { exact: false }).selectOption('reduce');
  await zone.selectOption('UTC');
  await assertPairs('dirty');
  await zoneForm
    .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
    .click();
  await expect(zone).toHaveValue('Europe/Moscow');
  await expect(form.getByLabel('Анимация', { exact: false })).toHaveValue('reduce');
  await zone.selectOption('UTC');
  await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
  await expect(form.getByRole('alert')).toBeVisible();
  await zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
  await expect(page.locator('.account-interface-feedback .account-save-status')).toContainText(
    'Часовой пояс',
  );
  await assertPairs('partial-error');
  expect(state.mutations.filter((path) => path === '/api/account/time-zone')).toHaveLength(1);
  await expect(form.getByLabel('Анимация', { exact: false })).toHaveValue('reduce');
});

for (const width of [1440, 1024, 390, 320])
  test(`independent presentation and time-zone operations remain clear at ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page, { presentationSaveFailure: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    const form = page.getByRole('form', { name: 'Оформление', exact: true });
    const zoneForm = page.getByRole('form', { name: 'Часовой пояс', exact: true });
    const motion = form.getByLabel('Анимация', { exact: false });
    const zone = zoneForm.getByRole('combobox', { name: /^Часовой пояс/ });
    await expect(motion).toBeEnabled();
    await expect(form.getByLabel('Боковое меню')).toBeVisible();
    const zonePrimary = await zoneForm
      .getByRole('button', { name: 'Сохранить часовой пояс', exact: true })
      .boundingBox();
    const zoneCancel = await zoneForm
      .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
      .boundingBox();
    expect(zonePrimary!.y).toBe(zoneCancel!.y);
    await expect(
      form.getByRole('button', { name: 'Сохранить оформление', exact: true }),
    ).toBeDisabled();
    await capture(page, `${evidence}/settings-usability-fresh-${width}.png`);
    await motion.selectOption('reduce');
    await zone.selectOption('UTC');
    await capture(page, `${evidence}/settings-usability-dirty-${width}.png`);
    await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
    await expect(form.getByRole('alert')).toBeVisible();
    await expect(zone).toHaveValue('UTC');
    await zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }).click();
    await expect(
      zoneForm.getByRole('button', { name: 'Сохранить часовой пояс', exact: true }),
    ).toBeDisabled();
    await expect(page.locator('.account-interface-feedback .account-save-status')).toContainText(
      'Часовой пояс',
    );
    await expect(zoneForm.locator('[role="status"]')).toHaveCount(0);
    await expect(page.locator('.account-settings-content > .account-message.success')).toHaveCount(
      0,
    );
    await expect(motion).toHaveValue('reduce');
    await expect(
      form.getByRole('button', { name: 'Сохранить оформление', exact: true }),
    ).toBeEnabled();
    await expect(form.getByRole('alert')).toBeVisible();
    await capture(page, `${evidence}/settings-usability-partial-error-${width}.png`);
    state.recoverPresentation();
    await form.getByRole('button', { name: 'Сохранить оформление', exact: true }).click();
    await expect(form.locator('.account-save-status')).toBeVisible();
    await expect(form.locator('.account-message.success')).toHaveCount(0);
    await expect(zone).toHaveValue('UTC');
    await zone.selectOption('Europe/Paris');
    const mutationsBeforeReset = state.mutations.length;
    await form.getByRole('button', { name: 'Сбросить оформление', exact: true }).click();
    await expect(motion).toHaveValue('system');
    await expect(zone).toHaveValue('Europe/Paris');
    expect(state.mutations).toHaveLength(mutationsBeforeReset);
    await form.getByRole('button', { name: 'Отменить изменения оформления', exact: true }).click();
    await expect(motion).toHaveValue('reduce');
    await expect(zone).toHaveValue('Europe/Paris');
    await zoneForm
      .getByRole('button', { name: 'Отменить изменения часового пояса', exact: true })
      .click();
    await expect(zone).toHaveValue('UTC');
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
    else await panel(page, 'Профиль').click();
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('interface');
    else await panel(page, 'Интерфейс').click();
    await expect(motion).toHaveValue('reduce');
    await expect(zone).toHaveValue('UTC');
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toHaveCount(0);
    await capture(page, `${evidence}/settings-usability-reentry-${width}.png`);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
  });

for (const width of [1440, 1024, 390, 320]) {
  test(`Account presentation preview, guard and coherent persistence fit ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page, {
      educator: true,
      author: true,
      organization: true,
      presentationLongContent: true,
    });
    let attentionRequests = 0;
    page.on('request', (request) => {
      if (new URL(request.url()).pathname === '/api/classrooms/teacher-home-attention')
        attentionRequests++;
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    const motion = page.getByLabel('Анимация', { exact: false }),
      sidebar = page.getByLabel('Боковое меню', { exact: false });
    await expect(motion).toBeEnabled();
    await motion.selectOption('reduce');
    await sidebar.selectOption('collapsed');
    await expect(page.locator('.presentation-shell')).toHaveAttribute('data-motion', 'reduce');
    await expect(page.locator('.portal-sidebar-collapse')).toBeDisabled();
    if (width <= 900) await page.getByLabel('Выбрать раздел настроек').selectOption('profile');
    else await panel(page, 'Профиль').click();
    await expect(page.getByRole('dialog', { name: 'Несохранённые изменения' })).toBeVisible();
    await page.getByRole('button', { name: 'Остаться', exact: true }).click();
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(page.getByText('Оформление сохранено в аккаунте.', { exact: true })).toBeVisible();
    await expect(page.locator('.portal-sidebar-collapse')).toBeEnabled();
    await expect(page.getByRole('combobox', { name: /^Часовой пояс/ })).toHaveValue(
      'Europe/Moscow',
    );
    await expect(page.getByLabel('Текущий аккаунт и контекст')).toHaveCount(0);
    const accountMenu = page.locator('.portal-account > summary');
    await accountMenu.click();
    await expect(page.locator('.portal-account-identity')).toContainText('Проверочный профиль');
    await expect(page.locator('.portal-account-workspace-copy')).toContainText(
      'Личное пространство',
    );
    await accountMenu.click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(async () => Math.abs((await page.locator('.portal-header').boundingBox())!.y))
      .toBeLessThan(1);
    await expect
      .poll(() =>
        page.evaluate(() => document.querySelector('.skip-link')!.getBoundingClientRect().bottom),
      )
      .toBeLessThan(1);
    await assertCompactSettings(page, width);
    await page.screenshot({
      path: `${evidence}/settings-usability-account-full-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${evidence}/settings-usability-account-${width}.png` });
    await page.reload();
    await expect(motion).toHaveValue('reduce');
    await expect(sidebar).toHaveValue('collapsed');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сбросить оформление', exact: true })
      .click();
    await expect(motion).toHaveValue('system');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
      .click();
    await expect(motion).toHaveValue('reduce');
    if (width >= 1024) {
      await page.locator('.portal-sidebar-collapse').click();
      await expect(sidebar).toHaveValue('expanded');
    }
    expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(
      width >= 1024 ? 2 : 1,
    );
    await page.getByRole('button', { name: 'ASA Lab — главная', exact: true }).click();
    await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Требует внимания', exact: true })).toHaveCount(
      0,
    );
    await expect(page.getByText('Работы на проверке: 1', { exact: false })).toHaveCount(0);
    expect(attentionRequests).toBe(0);
    await expect(page.getByLabel('Текущий аккаунт и контекст')).toHaveCount(0);
    await expect(page.locator('.presentation-shell')).toHaveAttribute('data-motion', 'reduce');
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await expect
      .poll(async () => Math.abs((await page.locator('.portal-header').boundingBox())!.y))
      .toBeLessThan(1);
    await page.screenshot({
      path: `${evidence}/settings-usability-home-${width}.png`,
      fullPage: true,
    });
  });
  test(`Seat temporary motion preserves help and context at ${width}px`, async ({ page }) => {
    const state = await fixture(page, { seat: true });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await page.getByLabel('Анимация', { exact: false }).selectOption('reduce');
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(
      page.getByText('Сохранено до выхода из этого учебного сеанса.', { exact: true }),
    ).toBeVisible();
    await expect(
      page.locator('main').getByRole('link', { name: 'Помощь', exact: true }),
    ).toHaveCount(0);
    await page
      .getByRole('button', { name: 'Информация о часовом поясе класса', exact: true })
      .click();
    await expect(page.getByRole('tooltip')).toContainText('преподаватель');
    await page.keyboard.press('Escape');
    if (width <= 1023)
      await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
    await expect(
      page.locator('#portal-sidebar').getByRole('link', { name: 'Помощь', exact: true }),
    ).toBeVisible();
    if (width <= 1023)
      await page
        .locator('#portal-sidebar')
        .getByRole('button', { name: 'Закрыть меню', exact: true })
        .click();
    await expect(page.getByLabel('Боковое меню', { exact: false })).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
      window.scrollTo({ top: 0, behavior: 'instant' });
    });
    await page.evaluate(
      () =>
        new Promise<void>((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
        ),
    );
    await assertCompactSettings(page, width);
    await page.screenshot({
      path: `${evidence}/settings-usability-seat-full-${width}.png`,
      fullPage: true,
    });
    await page.screenshot({ path: `${evidence}/settings-usability-seat-${width}.png` });
    await page.reload();
    await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue('reduce');
    await page.evaluate(() => window.dispatchEvent(new Event('asa-session-logout')));
    await expect
      .poll(() => page.evaluate(() => sessionStorage.getItem('asa-seat-presentation-session')))
      .toBeNull();
    expect(state.mutations).not.toContain('/api/account/presentation');
  });
}
test('old backend leaves preferences unavailable but navigation and profile still work', async ({
  page,
}) => {
  const state = await fixture(page, { presentationFailure: true });
  await page.goto('/#/account/interface');
  await expect(page.getByRole('alert')).toContainText('Не удалось загрузить оформление');
  await expect(page.getByLabel('Анимация', { exact: false })).toBeDisabled();
  await panel(page, 'Профиль').click();
  await expect(page.getByLabel('Отображаемое имя')).toBeEnabled();
  state.recoverPresentation();
  await panel(page, 'Интерфейс').click();
  await page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }).click();
  await expect(page.getByLabel('Анимация', { exact: false })).toBeEnabled();
});
test('failed save preserves preview and conflict requires explicit cancellation and reload', async ({
  page,
}) => {
  const state = await fixture(page, { presentationSaveFailure: true });
  await page.goto('/#/account/interface');
  await page.getByLabel('Анимация', { exact: false }).selectOption('reduce');
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('не сохранено');
  await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue('reduce');
  state.recoverPresentation();
  state.externalPresentation();
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Сохранить оформление', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('другом окне');
  await page
    .getByRole('form', { name: 'Оформление', exact: true })
    .getByRole('button', { name: 'Отменить изменения оформления', exact: true })
    .click();
  await page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }).click();
  await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue('system');
  await expect(page.getByLabel('Боковое меню', { exact: false })).toHaveValue('collapsed');
});
test('dirty independent profile blocks header preference writes without storing a cross-user browser preference', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.addInitScript(() => localStorage.setItem('asa-portal-sidebar', 'collapsed'));
  await page.goto('/#/account');
  await expect(page.locator('#portal-sidebar')).not.toHaveClass(/collapsed/);
  await page.getByLabel('Отображаемое имя').fill('Несохранённое новое имя');
  const collapse = page.getByRole('button', { name: 'Свернуть боковую панель', exact: true });
  await expect(collapse).toBeDisabled();
  await expect(collapse).toHaveAttribute(
    'title',
    'Сначала сохраните или отмените изменения настроек',
  );
  expect(state.mutations).not.toContain('/api/account/presentation');
});

for (const width of [1440, 1024, 390, 320]) {
  test(`Account changed terminal presentation state and explicit refresh fit ${width}px`, async ({
    page,
  }) => {
    const state = await fixture(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/#/account/interface');
    await page.getByLabel('Анимация', { exact: false }).selectOption('reduce');
    state.changePresentationActor();
    await page
      .getByRole('form', { name: 'Оформление', exact: true })
      .getByRole('button', { name: 'Сохранить оформление', exact: true })
      .click();
    await expect(page.locator('.account-presentation').getByRole('alert')).toContainText(
      'Аккаунт изменился',
    );
    await expect(
      page.getByRole('button', { name: 'Обновить страницу', exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Загрузить сохранённое оформление', exact: true }),
    ).toHaveCount(0);
    await expect(page.getByLabel('Анимация', { exact: false })).toHaveValue('system');
    await expect(page.getByLabel('Анимация', { exact: false })).toBeDisabled();
    await expect(
      page
        .getByRole('form', { name: 'Оформление', exact: true })
        .getByRole('button', { name: 'Отменить изменения оформления', exact: true }),
    ).toBeDisabled();
    await expect(
      page.getByText('Предпросмотр только здесь; изменения ещё не сохранены.', { exact: true }),
    ).toHaveCount(0);
    const metrics = await page.evaluate(() => ({
      viewport: innerWidth,
      document: document.documentElement.scrollWidth,
    }));
    expect(metrics.document).toBeLessThanOrEqual(metrics.viewport);
    await page.screenshot({
      path: `${evidence}/settings-usability-actor-changed-${width}.png`,
      fullPage: true,
    });
    expect(state.mutations.filter((path) => path === '/api/account/presentation')).toHaveLength(1);
  });
}

const compactAvatarEvidence = 'reports/playwright/portal-compact-avatar-r1-20261008';
for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true])
    test(`R1 compact catalogue and click enlargement ${seat ? 'seat' : 'account'} ${width}`, async ({
      page,
    }) => {
      mkdirSync(compactAvatarEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      const state = await fixture(page, { seat });
      await page.goto('/#/account');
      const opener = page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true });
      await expect(opener.locator('img')).toBeVisible();
      await expect(
        page.locator('.account-avatar-editor, .seat-avatar-current').getByRole('button'),
      ).toHaveCount(2);
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveCount(0);
      await expect(dialog.locator('select, figcaption, .avatar-selection-options')).toHaveCount(0);
      await expect(dialog).not.toContainText(
        /Текущий аватар|Автоматический аватар|Загруженный аватар/,
      );
      await assertAvatarGeometry(page);
      const initial = await dialog.evaluate((element) => {
        const r = element.getBoundingClientRect();
        const grid = element.querySelector<HTMLElement>('.avatar-selection-grid')!;
        return {
          width: r.width,
          height: r.height,
          gridHeight: grid.clientHeight,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        };
      });
      expect(initial.height).toBeLessThanOrEqual(420);
      expect(initial.gridHeight).toBeGreaterThanOrEqual(250);
      expect(initial.columns).toBe(width > 600 ? 8 : 4);
      writeFileSync(
        `${compactAvatarEvidence}/${seat ? 'seat' : 'account'}-${width}-catalogue.json`,
        JSON.stringify(initial, null, 2),
      );
      await page.screenshot({
        path: `${compactAvatarEvidence}/${seat ? 'seat' : 'account'}-${width}-catalogue.png`,
      });
      const tile = dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true });
      await tile.click();
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
        'src',
        /avatar-07.webp$/,
      );
      await expect(dialog.locator('.avatar-selection-grid')).toBeHidden();
      await expect(dialog.getByRole('button', { name: 'Вернуться к аватарам' })).toBeFocused();
      await assertAvatarGeometry(page);
      const enlargedBounds = await dialog.boundingBox();
      expect(enlargedBounds!.width).toBeLessThanOrEqual(304);
      const imageBounds = await dialog
        .getByRole('img', { name: 'Предпросмотр аватара' })
        .boundingBox();
      expect(enlargedBounds!.width - imageBounds!.width).toBeLessThanOrEqual(48);
      await expect(dialog.getByRole('button', { name: 'Загрузить', exact: true })).toHaveCount(0);
      await expect(dialog.getByRole('button', { name: 'Информация о выборе аватара' })).toHaveCount(
        0,
      );
      await page.screenshot({
        path: `${compactAvatarEvidence}/${seat ? 'seat' : 'account'}-${width}-enlarged.png`,
      });
      await dialog.getByRole('button', { name: 'Вернуться к аватарам' }).click();
      await expect(tile).toBeFocused();
      await expect(tile).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.getByRole('button', { name: 'Использовать', exact: true })).toBeEnabled();
      await dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).click();
      await expect(
        dialog.getByRole('button', { name: 'Использовать', exact: true }),
      ).toBeDisabled();
      await dialog.getByRole('button', { name: 'Закрыть выбор аватара' }).click();
      await expect(opener).toBeFocused();
      expect(state.mutations).not.toContain(
        seat ? '/api/class-join/me/avatar' : '/api/account/avatar',
      );
    });

for (const width of [1440, 390, 320])
  for (const seat of [false, true])
    test(`R1 avatar information ${width > 600 ? 'pointer keyboard' : 'touch'} ${seat ? 'seat' : 'account'} ${width}`, async ({
      browser,
    }) => {
      const context = await browser.newContext({
        baseURL: 'http://127.0.0.1:4612',
        viewport: { width, height: 568 },
        hasTouch: width <= 600,
      });
      const page = await context.newPage();
      try {
        mkdirSync(compactAvatarEvidence, { recursive: true });
        await serveBuiltApp(page);
        await fixture(page, { seat });
        await page.goto('/#/account');
        const info = page.getByRole('button', { name: 'Информация об аватаре', exact: true });
        const tip = page.getByRole('tooltip');
        await expect(tip).toHaveCount(0);
        if (width > 600) await info.hover();
        else await info.tap();
        await expect(tip).toContainText('Использовать');
        await expect(tip).toContainText(seat ? 'готовые аватары' : '8 МБ');
        const box = await tip.boundingBox();
        expect(box!.x).toBeGreaterThanOrEqual(12);
        expect(box!.x + box!.width).toBeLessThanOrEqual(width - 12);
        expect(box!.y).toBeGreaterThanOrEqual(12);
        expect(box!.y + box!.height).toBeLessThanOrEqual(556);
        const anchor = (await info.boundingBox())!;
        expect(box!.y + box!.height <= anchor.y || box!.y >= anchor.y + anchor.height).toBe(true);
        expect(await info.evaluate((button) => button.getBoundingClientRect().width)).toBe(44);
        await page.screenshot({
          path: `${compactAvatarEvidence}/${seat ? 'seat' : 'account'}-${width}-information.png`,
        });
        if (width > 600) {
          await tip.hover();
          await page.waitForTimeout(200);
          await expect(tip).toBeVisible();
          await page.locator('.portal-header').hover({ position: { x: width / 2, y: 2 } });
          await expect(tip).toHaveCount(0);
          await info.focus();
          await expect(tip).toBeVisible();
          await page.keyboard.press('Escape');
          await expect(tip).toHaveCount(0);
          await expect(info).toBeFocused();
        } else {
          const row = page.locator('main .account-avatar-editor, main .seat-avatar-current');
          const rowBox = (await row.boundingBox())!;
          expect(
            await row.evaluate((element) => {
              const rect = element.getBoundingClientRect();
              return (
                document.elementFromPoint(rect.right - 4, rect.top + rect.height / 2) === element
              );
            }),
          ).toBe(true);
          await row.tap({ position: { x: rowBox.width - 4, y: rowBox.height / 2 } });
          await expect(page).toHaveURL(/#\/account$/);
          await expect(tip).toHaveCount(0);
          await info.tap();
          await expect(tip).toBeVisible();
          await info.tap();
          await expect(tip).toHaveCount(0);
        }
        await page
          .locator('main')
          .getByRole('button', { name: 'Выбрать аватар', exact: true })
          .click();
        const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
        await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
        await dialog.getByRole('button', { name: 'Информация о выборе аватара' }).click();
        await expect(tip).toBeVisible();
        await expect(dialog.getByRole('tooltip')).toBeVisible();
        const dialogTip = (await tip.boundingBox())!;
        const dialogInfo = (await dialog
          .getByRole('button', { name: 'Информация о выборе аватара' })
          .boundingBox())!;
        expect(
          dialogTip.y + dialogTip.height <= dialogInfo.y ||
            dialogTip.y >= dialogInfo.y + dialogInfo.height,
        ).toBe(true);
        await page.keyboard.press('Escape');
        await expect(tip).toHaveCount(0);
        await expect(dialog).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(dialog).toHaveCount(0);
        expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(
          false,
        );
      } finally {
        await context.close();
      }
    });

for (const width of [1440, 320])
  for (const seat of [false, true])
    test(`R1 enlarged avatar 150 percent text ${seat ? 'seat' : 'account'} ${width}`, async ({
      page,
    }) => {
      mkdirSync(compactAvatarEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      const state = await fixture(page, { seat });
      await page.goto('/#/account');
      const opener = page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true });
      await opener.click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
      await page.addStyleTag({ content: '.avatar-chooser-dialog button { font-size: 21px; }' });
      await assertAvatarGeometry(page);
      const metrics = await dialog.evaluate((element) => {
        const image = element
          .querySelector('img[alt="Предпросмотр аватара"]')!
          .getBoundingClientRect();
        const buttons = [...element.querySelectorAll('button')]
          .filter((button) => button.getClientRects().length)
          .map((button) => {
            const box = button.getBoundingClientRect();
            return {
              width: box.width,
              height: box.height,
              top: box.top,
              bottom: box.bottom,
              textFits: button.scrollWidth <= button.clientWidth,
              fontSize: getComputedStyle(button).fontSize,
            };
          });
        return { gutter: element.getBoundingClientRect().width - image.width, buttons };
      });
      expect(metrics.gutter).toBeLessThanOrEqual(48);
      expect(metrics.buttons).toHaveLength(3);
      for (const button of metrics.buttons) {
        expect(button.width).toBeGreaterThanOrEqual(44);
        expect(button.height).toBeGreaterThanOrEqual(44);
        expect(button.textFits).toBe(true);
        expect(button.fontSize).toBe('21px');
        expect(button.top).toBeGreaterThanOrEqual(0);
        expect(button.bottom).toBeLessThanOrEqual(568);
      }
      await expect(dialog.getByRole('button', { name: 'Вернуться к аватарам' })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Использовать', exact: true })).toBeFocused();
      await page.keyboard.press('Tab');
      await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeFocused();
      await page.screenshot({
        path: `${compactAvatarEvidence}/${seat ? 'seat' : 'account'}-${width}-150-text.png`,
      });
      await page.keyboard.press('Escape');
      await expect(opener).toBeFocused();
      expect(state.mutations).not.toContain(
        seat ? '/api/class-join/me/avatar' : '/api/account/avatar',
      );
    });

const avatarEvidence = 'reports/playwright/settings-ui/portal-avatar-s2-20261008';
const avatarRepairEvidence = 'reports/playwright/settings-ui/portal-avatar-s2-repair-20261008';
const avatarFontEvidence = 'reports/playwright/settings-ui/portal-avatar-s2-font-repair-20261008';
const avatarLifecycleEvidence =
  'reports/playwright/settings-ui/portal-avatar-s2-lifecycle-repair-20261008';
const avatarPendingFontEvidence =
  'reports/playwright/settings-ui/portal-avatar-s2-pending-font-repair-20261008';

async function delayedAvatarWrite(page: Page, seat: boolean) {
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  let writes = 0;
  let fail = false;
  let saved: string | null = null;
  await page.route(
    seat ? '**/api/class-join/me/avatar' : '**/api/account/avatar',
    async (route) => {
      if (route.request().method() === 'GET')
        return route.fulfill({ json: { avatarDataUrl: saved } });
      writes += 1;
      const body = route.request().postDataJSON();
      if (writes === 1) await gate;
      if (fail)
        return route.fulfill({
          status: 503,
          json: {
            error: { code: 'unavailable', message: 'Проверочная ошибка отправленного запроса' },
          },
        });
      saved = seat ? body.avatarKey : body.avatarDataUrl;
      return route.fulfill({
        json: seat
          ? {
              authenticated: true,
              student: {
                seatId: 'seat-1',
                displayName: 'Ученик с длинным именем',
                safeMode: true,
                avatarKey: saved,
              },
              classroom: {
                id: 'class-1',
                title: 'Учебный класс',
                teacherDisplayName: 'Преподаватель',
              },
              expiresAt: '2030-01-01T00:00:00Z',
            }
          : { avatarDataUrl: saved },
      });
    },
  );
  return {
    release,
    fail: (value: boolean) => (fail = value),
    writes: () => writes,
    saved: () => saved,
  };
}

for (const width of [1440, 320])
  for (const seat of [false, true])
    for (const close of ['Escape', 'Close'])
      test(`S2 lifecycle sent save reconciles after ${close} ${seat ? 'seat' : 'account'} ${width}`, async ({
        page,
      }) => {
        mkdirSync(avatarLifecycleEvidence, { recursive: true });
        await page.setViewportSize({ width, height: 568 });
        const state = await fixture(page, { seat });
        const write = await delayedAvatarWrite(page, seat);
        await page.goto('/#/account');
        if (!seat) await page.getByLabel('Отображаемое имя').fill('Независимый черновик');
        const opener = page
          .locator('main')
          .getByRole('button', { name: 'Выбрать аватар', exact: true });
        await opener.click();
        const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
        await dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
        await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
        await expect.poll(write.writes).toBe(1);
        await expect(dialog.getByRole('status')).toContainText('Закрытие окна не отменяет');
        if (close === 'Escape') await page.keyboard.press('Escape');
        else
          await dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }).click();
        await expect(dialog).toHaveCount(0);
        await expect(opener).toBeFocused();
        write.release();
        const headerAvatar = page.locator('.portal-user-avatar img');
        if (seat) await expect(headerAvatar).toHaveAttribute('src', /avatar-07.webp$/);
        else {
          await expect(headerAvatar).toHaveAttribute('src', /^data:image\/webp;base64,/);
          await expect(headerAvatar).toHaveAttribute('src', write.saved()!);
          await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Независимый черновик');
          const profileAvatar = await page
            .locator('.account-avatar-preview-button img')
            .boundingBox();
          expect(profileAvatar!.width).toBe(width <= 560 ? 64 : 96);
          expect(profileAvatar!.height).toBe(profileAvatar!.width);
        }
        await opener.click();
        await expect(
          dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).locator('img'),
        ).toHaveAttribute('src', (await headerAvatar.getAttribute('src'))!);
        await expect(
          dialog.getByRole('button', { name: 'Посмотреть свой аватар' }),
        ).toHaveAttribute('aria-pressed', 'true');
        await expect(dialog.locator('select')).toHaveCount(0);
        await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveCount(0);
        await assertAvatarGeometry(page);
        await page.screenshot({
          path: `${avatarLifecycleEvidence}/${seat ? 'seat' : 'account'}-${width}-${close}-reconciled.png`,
        });
        expect(write.writes()).toBe(1);
        expect(state.mutations).not.toContain('/api/account/profile');
        await page.keyboard.press('Escape');
      });

for (const seat of [false, true])
  test(`S2 lifecycle pending reopen blocks duplicate save and displays late error ${seat ? 'seat' : 'account'}`, async ({
    page,
  }) => {
    mkdirSync(avatarLifecycleEvidence, { recursive: true });
    await page.setViewportSize({ width: 320, height: 568 });
    await fixture(page, { seat });
    const write = await delayedAvatarWrite(page, seat);
    await page.goto('/#/account');
    const opener = page
      .locator('main')
      .getByRole('button', { name: 'Выбрать аватар', exact: true });
    await opener.click();
    const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
    await dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
    await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
    await expect.poll(write.writes).toBe(1);
    await page.keyboard.press('Escape');
    await opener.click();
    await expect(
      dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Использовать', exact: true })).toBeDisabled();
    await expect(
      dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }),
    ).toBeEnabled();
    await assertAvatarGeometry(page);
    await page.screenshot({
      path: `${avatarLifecycleEvidence}/${seat ? 'seat' : 'account'}-320-reopened-pending.png`,
    });
    expect(write.writes()).toBe(1);
    write.fail(true);
    write.release();
    await expect(dialog.getByRole('alert')).toHaveText('Проверочная ошибка отправленного запроса');
    await expect(
      dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }),
    ).toBeEnabled();
    await page.screenshot({
      path: `${avatarLifecycleEvidence}/${seat ? 'seat' : 'account'}-320-reopened-error.png`,
    });
    await dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    write.fail(false);
    await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(write.writes()).toBe(2);
    await opener.click();
    const headerAvatar = page.locator('.portal-user-avatar img');
    await expect(
      dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).locator('img'),
    ).toHaveAttribute('src', (await headerAvatar.getAttribute('src'))!);
    if (seat) await expect(headerAvatar).toHaveAttribute('src', /avatar-08.webp$/);
  });

for (const width of [320, 600, 601])
  for (const { seat, letterSpacing } of [
    ...[false, true].map((seat) => ({ seat, letterSpacing: 1 })),
    ...(width === 320 ? [false, true].map((seat) => ({ seat, letterSpacing: 2 })) : []),
  ])
    test(`S2 avatar action row tolerates ${letterSpacing === 2 ? 'pending-label wider' : 'wider'} 16px font ${seat ? 'seat' : 'account'} ${width}`, async ({
      page,
    }) => {
      const fontEvidence = letterSpacing === 2 ? avatarPendingFontEvidence : avatarFontEvidence;
      mkdirSync(fontEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      await fixture(page, { seat, presentationLongContent: true });
      let releaseSave!: () => void;
      let sentWrites = 0;
      const saveGate = new Promise<void>((resolve) => (releaseSave = resolve));
      await page.route(
        seat ? '**/api/class-join/me/avatar' : '**/api/account/avatar',
        async (route) => {
          if (route.request().method() === 'GET')
            return route.fulfill({ json: { avatarDataUrl: null } });
          sentWrites += 1;
          await saveGate;
          return route.fulfill({
            status: 503,
            json: {
              error: {
                code: 'unavailable',
                message: 'Не удалось сохранить выбранный аватар. Повторите попытку позднее.',
              },
            },
          });
        },
      );
      await page.goto('/#/account');
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
      // Keep the original six fallback-font cases. Two extra narrow cases widen
      // glyph advance in the compact catalogue and confirmation states.
      await page.addStyleTag({
        content: `.avatar-chooser-dialog .avatar-chooser-actions button {
          font-family: monospace;
          font-size: 16px;
          letter-spacing: ${letterSpacing}px;
        }`,
      });
      const samples: unknown[] = [];
      const assertActions = async (state: string) => {
        const metrics = await dialog.evaluate((element) => {
          const bounds = element.getBoundingClientRect();
          const preview = element
            .querySelector('img[alt="Предпросмотр аватара"]')
            ?.getBoundingClientRect();
          const actions = [...element.querySelectorAll('.avatar-chooser-actions button')]
            .filter((button) => button.getClientRects().length)
            .map((button) => {
              const r = button.getBoundingClientRect();
              const style = getComputedStyle(button);
              const text = document.createRange();
              text.selectNodeContents(button);
              const textBounds = text.getBoundingClientRect();
              return {
                top: r.top,
                bottom: r.bottom,
                width: r.width,
                height: r.height,
                left: r.left,
                right: r.right,
                text: button.textContent,
                textWidth: textBounds.width,
                contentWidth:
                  r.width -
                  parseFloat(style.paddingLeft) -
                  parseFloat(style.paddingRight) -
                  parseFloat(style.borderLeftWidth) -
                  parseFloat(style.borderRightWidth),
                textFits:
                  textBounds.left >= r.left &&
                  textBounds.right <= r.right &&
                  button.scrollWidth <= button.clientWidth,
                fontSize: style.fontSize,
                fontFamily: style.fontFamily,
                padding: style.padding,
              };
            });
          return {
            actions,
            previewWidth: preview?.width ?? 0,
            dialogWidth: bounds.width,
            dialogOverflow: element.scrollWidth > element.clientWidth,
            pageOverflow: document.documentElement.scrollWidth > innerWidth,
          };
        });
        samples.push({ state, ...metrics });
        writeFileSync(
          `${fontEvidence}/${seat ? 'seat' : 'account'}-${width}-actions.json`,
          JSON.stringify(samples, null, 2),
        );
        await page.screenshot({
          path: `${fontEvidence}/${seat ? 'seat' : 'account'}-${width}-${state}.png`,
        });
        expect(metrics.actions).toHaveLength(!seat && state === 'current' ? 2 : 1);
        if (!seat && state === 'current') {
          expect(Math.abs(metrics.actions[0]!.top - metrics.actions[1]!.top)).toBeLessThan(1);
          expect(Math.abs(metrics.actions[0]!.bottom - metrics.actions[1]!.bottom)).toBeLessThan(1);
          expect(metrics.actions[0]!.right).toBeLessThanOrEqual(metrics.actions[1]!.left);
        }
        for (const action of metrics.actions) {
          expect(action.textFits).toBe(true);
          expect(action.fontSize).toBe('16px');
          expect(action.fontFamily).toContain('monospace');
          expect(action.width).toBeGreaterThanOrEqual(44);
          expect(action.height).toBeGreaterThanOrEqual(44);
          expect(action.top).toBeGreaterThanOrEqual(0);
          expect(action.bottom).toBeLessThanOrEqual(568);
        }
        expect(metrics.previewWidth).toBe(state === 'current' ? 0 : 240);
        expect(metrics.dialogOverflow).toBe(false);
        expect(metrics.pageOverflow).toBe(false);
      };
      try {
        const use = dialog.getByRole('button', { name: 'Использовать', exact: true });
        await expect(use).toBeDisabled();
        await assertActions('current');
        await dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
        await expect(use).toBeEnabled();
        await assertActions('selected');
        await use.click();
        await expect.poll(() => sentWrites).toBe(1);
        await expect(dialog.getByRole('status')).toContainText('Закрытие окна не отменяет');
        await expect(
          dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }),
        ).toBeEnabled();
        await expect(use).toBeDisabled();
        await assertActions('busy');
        releaseSave();
        await expect(dialog.getByRole('alert')).toContainText(
          'Не удалось сохранить выбранный аватар',
        );
        await expect(use).toBeEnabled();
        await assertActions('error');
        await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
          'src',
          /avatar-07.webp$/,
        );
        await dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }).click();
        await expect(dialog).toHaveCount(0);
      } finally {
        releaseSave();
      }
    });
for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true])
    test(`S2 repair avatar action row ${seat ? 'seat' : 'account'} ${width} short screen`, async ({
      page,
    }) => {
      mkdirSync(avatarRepairEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      await fixture(page, { seat, presentationLongContent: true });
      await page.goto('/#/account');
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
      const samples = [];
      for (const state of ['current', 'selected']) {
        if (state === 'selected')
          await dialog.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
        const actions = await dialog
          .locator('.avatar-chooser-actions button')
          .evaluateAll((buttons) =>
            buttons
              .filter((button) => button.getClientRects().length)
              .map((button) => {
                const r = button.getBoundingClientRect();
                return {
                  top: r.top,
                  bottom: r.bottom,
                  width: r.width,
                  height: r.height,
                  textFits: button.scrollWidth <= button.clientWidth,
                };
              }),
          );
        samples.push({ state, actions });
        writeFileSync(
          `${avatarRepairEvidence}/${seat ? 'seat' : 'account'}-${width}-actions.json`,
          JSON.stringify(samples, null, 2),
        );
        expect(actions).toHaveLength(!seat && state === 'current' ? 2 : 1);
        if (!seat && state === 'current') {
          expect(Math.abs(actions[0]!.top - actions[1]!.top)).toBeLessThan(1);
          expect(Math.abs(actions[0]!.bottom - actions[1]!.bottom)).toBeLessThan(1);
        }
        for (const action of actions) {
          expect(action.height).toBeGreaterThanOrEqual(44);
          expect(action.width).toBeGreaterThanOrEqual(44);
          expect(action.textFits).toBe(true);
        }
        await expect(
          dialog.getByRole('button', { name: 'Использовать', exact: true }),
        ).toBeInViewport();
        await page.screenshot({
          path: `${avatarRepairEvidence}/${seat ? 'seat' : 'account'}-${width}-${state}-short.png`,
        });
      }
    });
async function assertAvatarGeometry(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  const metrics = await dialog.evaluate((element) => {
    const preview = element
      .querySelector('img[alt="Предпросмотр аватара"]')
      ?.getBoundingClientRect();
    const bounds = element.getBoundingClientRect();
    const grid = element.querySelector<HTMLElement>('.avatar-selection-grid')!;
    const tiles = [...grid.querySelectorAll('button')]
      .filter((tile) => tile.getClientRects().length)
      .map((tile) => {
        const r = tile.getBoundingClientRect();
        return {
          x: r.x,
          y: r.y,
          right: r.right,
          bottom: r.bottom,
          width: r.width,
          height: r.height,
        };
      });
    return {
      preview: preview ? { width: preview.width, height: preview.height } : null,
      bounds: {
        width: bounds.width,
        x: bounds.x,
        right: bounds.right,
        top: bounds.top,
        bottom: bounds.bottom,
      },
      tiles,
      pageOverflow: document.documentElement.scrollWidth > innerWidth,
    };
  });
  if (metrics.preview) {
    expect(metrics.preview.width).toBe(240);
    expect(metrics.preview.height).toBe(metrics.preview.width);
  } else expect(metrics.tiles).toHaveLength(68);
  expect(metrics.bounds.width).toBeLessThanOrEqual(560);
  expect(metrics.pageOverflow).toBe(false);
  expect(metrics.bounds.x).toBeGreaterThanOrEqual(0);
  expect(metrics.bounds.right).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(metrics.bounds.top).toBeGreaterThanOrEqual(0);
  expect(metrics.bounds.bottom).toBeLessThanOrEqual(page.viewportSize()!.height);
  for (const tile of metrics.tiles) {
    expect(Math.abs(tile.width - tile.height)).toBeLessThan(1);
    expect(tile.width).toBeGreaterThanOrEqual(44);
  }
  for (let i = 0; i < metrics.tiles.length; i++)
    for (let j = i + 1; j < metrics.tiles.length; j++) {
      const a = metrics.tiles[i]!,
        b = metrics.tiles[j]!;
      expect(
        Math.min(a.right, b.right) - Math.max(a.x, b.x) > 1 &&
          Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y) > 1,
      ).toBe(false);
    }
  await expect(dialog.getByRole('button', { name: 'Закрыть выбор аватара' })).toBeInViewport();
  await expect(dialog.getByRole('button', { name: 'Использовать', exact: true })).toBeInViewport();
}
for (const width of [1440, 1024, 390, 320])
  for (const seat of [false, true]) {
    test(`S2 avatar chooser geometry ${seat ? 'seat' : 'account'} ${width} short screen`, async ({
      page,
    }) => {
      mkdirSync(avatarEvidence, { recursive: true });
      await page.setViewportSize({ width, height: 568 });
      const state = await fixture(page, { seat, presentationLongContent: true });
      await page.goto('/#/account');
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
      await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
      await assertAvatarGeometry(page);
      if (seat) await expect(dialog.locator('input[type="file"]')).toHaveCount(0);
      await page.screenshot({
        path: `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-short.png`,
      });
      const firstTile = dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true });
      await firstTile.scrollIntoViewIfNeeded();
      const reachability = await dialog.locator('.avatar-selection-grid').evaluate((grid) => {
        const r = grid.getBoundingClientRect(),
          parent = grid.closest('.avatar-selection')!.getBoundingClientRect();
        return {
          height: grid.clientHeight,
          visibleHeight: Math.min(r.bottom, parent.bottom) - Math.max(r.top, parent.top),
          contentHeight: grid.scrollHeight,
        };
      });
      expect(reachability.height).toBeGreaterThanOrEqual(80);
      expect(reachability.visibleHeight).toBeGreaterThanOrEqual(60);
      await dialog
        .getByRole('button', { name: 'Выбрать: Аватар 67', exact: true })
        .scrollIntoViewIfNeeded();
      await expect(
        dialog.getByRole('button', { name: 'Выбрать: Аватар 67', exact: true }),
      ).toBeInViewport();
      await firstTile.scrollIntoViewIfNeeded();
      await page.screenshot({
        path: `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-catalogue.png`,
      });
      writeFileSync(
        `${avatarEvidence}/${seat ? 'seat' : 'account'}-${width}-reachability.json`,
        JSON.stringify(reachability),
      );

      await dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true }).click();
      await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
        'src',
        /avatar-01.webp$/,
      );
      expect(state.mutations).not.toContain(
        seat ? '/api/class-join/me/avatar' : '/api/account/avatar',
      );
      await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
      await expect(dialog).toHaveCount(0);
      expect(
        state.mutations.filter(
          (path) => path === (seat ? '/api/class-join/me/avatar' : '/api/account/avatar'),
        ),
      ).toHaveLength(1);
      await page
        .locator('main')
        .getByRole('button', { name: 'Выбрать аватар', exact: true })
        .click();
      await expect(
        dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).locator('img'),
      ).toHaveAttribute('src', seat ? /avatar-01.webp$/ : /^data:image\/webp;base64,/);
      await page.keyboard.press('Escape');
      await expect(dialog).toHaveCount(0);
    });
  }
test('S2 quick avatar access keeps routes and dirty drafts, returns focus to live account control', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик имени');
  const menu = page.locator('.portal-account > summary');
  await menu.click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/account$/);
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 3', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeFocused();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик имени');
  expect(state.mutations).not.toContain('/api/account/avatar');
  expect(state.mutations).not.toContain('/api/account/profile');
  await page.locator('.portal-sidebar-avatar').click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 4', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик имени');
  expect(state.mutations).not.toContain('/api/account/profile');
  await page.getByRole('button', { name: 'Интерфейс', exact: true }).click();
  const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
  await guard.getByRole('button', { name: 'Отменить изменения и перейти' }).click();
  await page.getByLabel('Анимация').selectOption('reduce');
  await page.locator('.portal-sidebar-avatar').click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 5', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(page.getByLabel('Анимация')).toHaveValue('reduce');
  expect(state.mutations).not.toContain('/api/account/presentation');
  await expect(page).toHaveURL(/#\/account\/interface$/);
});
test('S2 mobile drawer avatar opens above the current page and cancels without mutation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const state = await fixture(page, { seat: true });
  await page.goto('/#/home');
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  await page.locator('.portal-sidebar-avatar').click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/#\/home$/);
  await expect(page.locator('.portal-sidebar')).not.toHaveClass(/mobile-open/);
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 1', exact: true }).click();
  await dialog.getByRole('button', { name: 'Закрыть выбор аватара', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Открыть меню', exact: true })).toBeFocused();
  expect(state.mutations).not.toContain('/api/class-join/me/avatar');
});
test('S2 upload is transformed for preview, explicit save and reopen retain current data URL', async ({
  page,
}) => {
  const state = await fixture(page);
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await dialog
    .getByLabel('Загрузить свой аватар')
    .setInputFiles('apps/web/public/assets/avatars/default/avatar-02.webp');
  const preview = dialog.getByRole('img', { name: 'Предпросмотр аватара' });
  await expect(preview).toHaveAttribute('src', /^data:image\/webp;base64,/);
  expect(
    await preview.evaluate((image: HTMLImageElement) => [image.naturalWidth, image.naturalHeight]),
  ).toEqual([320, 320]);
  expect(state.mutations).not.toContain('/api/account/avatar');
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await expect(
    dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).locator('img'),
  ).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await dialog.getByRole('button', { name: 'Посмотреть свой аватар' }).click();
  await expect(preview).toHaveAttribute('src', /^data:image\/webp;base64,/);
  await page.keyboard.press('Escape');
});
test('S2 save error stays visible, retry retains selected preview and Escape works after busy', async ({
  page,
}) => {
  await fixture(page);
  let failure = true;
  let saves = 0;
  await page.route('**/api/account/avatar', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { avatarDataUrl: null } });
    saves++;
    return failure
      ? route.fulfill({
          status: 503,
          json: { error: { code: 'unavailable', message: 'Проверочная ошибка сохранения' } },
        })
      : route.fulfill({ json: route.request().postDataJSON() });
  });
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Проверочная ошибка сохранения');
  await page.screenshot({ path: `${avatarEvidence}/account-error-retry.png` });
  await expect(dialog.getByRole('img', { name: 'Предпросмотр аватара' })).toHaveAttribute(
    'src',
    /avatar-06.webp$/,
  );
  await dialog.getByRole('button', { name: 'Вернуться к аватарам' }).click();
  await expect(
    dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(1);
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 6', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  failure = false;
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(saves).toBe(3);
});
for (const width of [1440, 1024, 390, 320])
  test(`S2 teacher avatar preview stages in narrow parent modal ${width}`, async ({ page }) => {
    mkdirSync(avatarEvidence, { recursive: true });
    mkdirSync(avatarRepairEvidence, { recursive: true });
    await page.setViewportSize({ width, height: 568 });
    await fixture(page, { educator: true });
    const student = {
      id: 'seat-1',
      displayLabel: 'Ученица с длинным именем',
      studentCode: 'AbC123',
      loginHandle: 'AbC123',
      safeMode: true,
      status: 'issued',
      avatarKey: null,
      lastActiveAt: null,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const writes: unknown[] = [];
    await page.route('**/api/classrooms/class-1/roster', (route) =>
      route.fulfill({ json: { items: [student] } }),
    );
    await page.route('**/api/classrooms/class-1/seats/seat-1', (route) => {
      writes.push(route.request().postDataJSON());
      return route.fulfill({
        json: { student: { ...student, ...route.request().postDataJSON() } },
      });
    });
    await page.goto('/#/classrooms/class-1');
    await expect(
      page.getByRole('button', { name: 'Действия: Ученица с длинным именем', exact: true }),
    ).toBeVisible();
    const baselineLayout = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: innerWidth,
    }));
    const baselineOverflow = baselineLayout.scrollWidth > baselineLayout.clientWidth;
    await page
      .getByRole('button', { name: 'Действия: Ученица с длинным именем', exact: true })
      .click();
    await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
    const parent = page.locator('.classroom-student-dialog');
    await parent
      .getByRole('textbox', { name: 'Имя в списке класса' })
      .fill('Изменённое имя ученика');
    await parent.getByRole('button', { name: 'Выбрать аватар ученика', exact: true }).click();
    await parent.getByRole('button', { name: 'Выбрать: Аватар 7', exact: true }).click();
    expect(writes).toHaveLength(0);
    const geometry = await parent.evaluate((element) => {
      const r = element.getBoundingClientRect();
      const content = element.querySelector('.avatar-selection')!.getBoundingClientRect();
      return {
        parentWidth: r.width,
        contentWidth: content.width,
        overflow: document.documentElement.scrollWidth > innerWidth,
      };
    });
    expect(geometry.contentWidth).toBeLessThan(geometry.parentWidth);
    expect(geometry.overflow).toBe(baselineOverflow);
    writeFileSync(
      `${avatarEvidence}/teacher-${width}-layout.json`,
      JSON.stringify({ baseline: baselineLayout, chooser: geometry }),
    );
    await parent.getByRole('img', { name: 'Предпросмотр аватара' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${avatarEvidence}/teacher-${width}-short.png` });
    await parent.getByRole('button', { name: 'Использовать', exact: true }).click();
    const labelOpener = parent.getByRole('button', { name: 'Выбрать аватар ученика', exact: true });
    await expect(labelOpener).toBeFocused();
    mkdirSync(avatarRepairEvidence, { recursive: true });
    const focusSamples = [{ trigger: 'avatar', action: 'use' }];
    for (const [trigger, action] of [
      ['avatar', 'cancel'],
      ['avatar', 'escape'],
      ['avatar', 'use'],
    ] as const) {
      const opener = labelOpener;
      await opener.click();
      await parent
        .getByRole('button', {
          name: action !== 'use' ? 'Выбрать: Аватар 8' : 'Выбрать: Аватар 7',
          exact: true,
        })
        .click();
      if (action === 'escape') await page.keyboard.press('Escape');
      else
        await parent
          .getByRole('button', {
            name: action === 'cancel' ? 'Закрыть выбор аватара ученика' : 'Использовать',
            exact: true,
          })
          .click();
      await expect(parent.locator('.seat-avatar-staged-selection')).toHaveCount(0);
      await expect(opener).toBeFocused();
      await expect(parent.getByRole('img', { name: 'Аватар ученика' })).toHaveAttribute(
        'src',
        /avatar-07.webp$/,
      );
      await expect(parent.getByRole('textbox', { name: 'Имя в списке класса' })).toHaveValue(
        'Изменённое имя ученика',
      );
      expect(writes).toHaveLength(0);
      focusSamples.push({ trigger, action });
      await page.screenshot({
        path: `${avatarRepairEvidence}/teacher-${width}-${trigger}-${action}-focus.png`,
      });
      await page.keyboard.press('Tab');
      expect(await parent.evaluate((element) => element.contains(document.activeElement))).toBe(
        true,
      );
    }
    writeFileSync(
      `${avatarRepairEvidence}/teacher-${width}-focus.json`,
      JSON.stringify(focusSamples, null, 2),
    );
    expect(writes).toHaveLength(0);
    const teacherInfo = parent.getByRole('button', { name: 'Информация об аватаре ученика' });
    const teacherTip = page.getByRole('tooltip');
    await expect(teacherInfo).toBeFocused();
    await expect(teacherTip).toBeVisible();
    await page.keyboard.press('Enter');
    await expect(teacherTip).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(teacherTip).toHaveCount(0);
    await teacherInfo.focus();
    await page.keyboard.press('Escape');
    await expect(teacherTip).toHaveCount(0);
    await expect(parent).toBeVisible();
    await teacherInfo.click();
    await expect(teacherTip).toBeVisible();
    const hint = (await teacherTip.boundingBox())!;
    const hintTrigger = (await teacherInfo.boundingBox())!;
    expect(
      hint.y + hint.height <= hintTrigger.y || hint.y >= hintTrigger.y + hintTrigger.height,
    ).toBe(true);
    await parent.getByRole('button', { name: 'Сохранить', exact: true }).click();
    await expect(parent).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      avatarKey: 'asa-avatar-07',
      displayLabel: 'Изменённое имя ученика',
    });
  });

test('S2 late initial avatar GET cannot overwrite a confirmed save', async ({ page }) => {
  await fixture(page);
  let reads = 0;
  let release!: () => void;
  let staleDone!: () => void;
  const staleComplete = new Promise<void>((resolve) => {
    staleDone = resolve;
  });
  await page.route('**/api/account/avatar', async (route) => {
    if (route.request().method() !== 'GET')
      return route.fulfill({ json: route.request().postDataJSON() });
    reads++;
    if (reads === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      await route.fulfill({ json: { avatarDataUrl: null } });
      staleDone();
      return;
    }
    return route.fulfill({ json: { avatarDataUrl: null } });
  });
  await page.goto('/#/account');
  await page.locator('main').getByRole('button', { name: 'Выбрать аватар', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(
    dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }),
  ).toBeEnabled();
  await dialog.getByRole('button', { name: 'Выбрать: Аватар 8', exact: true }).click();
  await dialog.getByRole('button', { name: 'Использовать', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.portal-sidebar-avatar img')).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
  release();
  await staleComplete;
  await expect(page.locator('.portal-sidebar-avatar img')).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
  await expect(page.getByRole('img', { name: 'Аватар', exact: true })).toHaveAttribute(
    'src',
    /^data:image\/webp;base64,/,
  );
});
test('S2 lazy chooser failure keeps drafts, retries locally and leaves unrelated recovery alone', async ({
  page,
}) => {
  await fixture(page);
  let fail = true;
  await page.route('**/AvatarChooser-*.js', (route) => (fail ? route.abort() : route.fallback()));
  await page.goto('/#/account');
  await page.getByLabel('Отображаемое имя').fill('Черновик пережил загрузку');
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Выберите аватар' });
  await expect(dialog.getByRole('alert')).toContainText('Не удалось открыть выбор аватара');
  await expect(page).toHaveURL(/#\/account$/);
  expect(await page.evaluate(() => sessionStorage.getItem('asa-vite-preload-recovery'))).toBeNull();
  fail = false;
  await dialog.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(dialog.locator('.avatar-selection-grid')).toBeVisible();
  const unrelated = await page.evaluate(() => {
    sessionStorage.setItem('asa-vite-preload-recovery', String(Date.now()));
    let delivered = false;
    const listener = () => {
      delivered = true;
    };
    window.addEventListener('vite:preloadError', listener);
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error('Failed to fetch OtherChunk-test.js');
    window.dispatchEvent(event);
    window.removeEventListener('vite:preloadError', listener);
    return { delivered, handledByGlobal: event.defaultPrevented };
  });
  expect(unrelated).toEqual({ delivered: true, handledByGlobal: true });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('.portal-account > summary')).toBeFocused();
  const afterUnmount = await page.evaluate(() => {
    const event = new Event('vite:preloadError', { cancelable: true }) as Event & {
      payload: Error;
    };
    event.payload = new Error(
      `Failed to fetch dynamically imported module: ${location.origin}/assets/AvatarChooser-test.js`,
    );
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  expect(afterUnmount).toBe(true);
  await expect(page.getByLabel('Отображаемое имя')).toHaveValue('Черновик пережил загрузку');
});

test('S2 teacher optional catalogue failure preserves parent draft and retries locally', async ({
  page,
}) => {
  await fixture(page, { educator: true });
  let fail = true;
  const student = {
    id: 'seat-1',
    displayLabel: 'Ученица',
    studentCode: 'AbC123',
    loginHandle: 'AbC123',
    safeMode: true,
    status: 'issued',
    avatarKey: null,
    lastActiveAt: null,
    createdAt: '2026-01-01T00:00:00Z',
  };
  await page.route('**/api/classrooms/class-1/roster', (route) =>
    route.fulfill({ json: { items: [student] } }),
  );
  await page.route('**/AvatarChooser-*.js*', (route) => (fail ? route.abort() : route.fallback()));
  await page.goto('/#/classrooms/class-1');
  await page.getByRole('button', { name: 'Действия: Ученица', exact: true }).click();
  await page.getByRole('button', { name: 'Изменить данные', exact: true }).click();
  const parent = page.locator('.classroom-student-dialog');
  await parent.getByRole('textbox', { name: 'Имя в списке класса' }).fill('Черновик преподавателя');
  await parent.getByRole('button', { name: 'Выбрать аватар ученика', exact: true }).click();
  await expect(parent.getByRole('alert')).toContainText('Не удалось открыть выбор аватара');
  expect(await page.evaluate(() => sessionStorage.getItem('asa-vite-preload-recovery'))).toBeNull();
  fail = false;
  await parent.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(parent.locator('.avatar-selection-grid')).toBeVisible();
  await expect(parent.getByRole('textbox', { name: 'Имя в списке класса' })).toHaveValue(
    'Черновик преподавателя',
  );
  await parent.getByRole('button', { name: 'Закрыть выбор аватара ученика', exact: true }).click();
  await expect(parent.getByRole('textbox', { name: 'Имя в списке класса' })).toHaveValue(
    'Черновик преподавателя',
  );
  await parent.getByRole('button', { name: 'Отмена', exact: true }).click();
});
test('S2 avatar library code is requested only when opening the chooser', async ({ page }) => {
  await fixture(page);
  const requests: string[] = [];
  page.on('request', (request) => {
    if (/AvatarChooser-/.test(request.url())) requests.push(request.url());
  });
  await page.goto('/#/home');
  await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await page.locator('.portal-account > summary').click();
  await page.getByRole('button', { name: 'Открыть выбор аватара', exact: true }).click();
  await expect(page.locator('.avatar-selection-grid')).toBeVisible();
  expect(requests.length).toBeGreaterThan(0);
});

const startupEvidence = 'reports/playwright/settings-ui/portal-startup-s4-boundary-20261008';
type BuildChunk = { file: string; name?: string; css?: string[]; dynamicImports?: string[] };
function startupChunks() {
  const manifest = JSON.parse(readFileSync('apps/web/dist/.vite/manifest.json', 'utf8')) as Record<
    string,
    BuildChunk
  >;
  // Rollup shares this lazy host with module chunks, so its manifest key is a
  // generated chunk ID. Read its declared name rather than guessing that key.
  const host = Object.values(manifest).find((chunk) => chunk.name === 'ModuleEditorHost')!;
  return {
    manifest,
    host,
    editorFiles: [
      host.file,
      ...(host.css ?? []),
      ...(host.dynamicImports ?? []).map((key) => manifest[key]!.file),
    ],
  };
}
async function startupCapture(page: Page, name: string) {
  mkdirSync(startupEvidence, { recursive: true });
  const geometry = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    overflow: document.documentElement.scrollWidth > innerWidth,
    mainCount: document.querySelectorAll('main').length,
    nestedMain: document.querySelectorAll('main main').length,
    controls: [...document.querySelectorAll('.page-delivery-actions button')].map((node) => {
      const rect = node.getBoundingClientRect();
      return {
        label: node.textContent,
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        height: rect.height,
      };
    }),
  }));
  expect(geometry.overflow).toBe(false);
  expect(geometry.nestedMain).toBe(0);
  expect(geometry.mainCount).toBe(1);
  for (const control of geometry.controls) {
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(geometry.width);
    expect(control.bottom).toBeLessThanOrEqual(geometry.height);
  }
  writeFileSync(`${startupEvidence}/${name}.json`, JSON.stringify(geometry, null, 2));
  await page.screenshot({ path: `${startupEvidence}/${name}.png` });
}
async function anonymousStartup(page: Page) {
  await fixture(page);
  await page.route('**/api/auth/me', (route) => route.fulfill({ json: { authenticated: false } }));
}
async function holdStartupChunk(page: Page, chunk: string) {
  let release!: () => void;
  const gate = new Promise<void>((done) => {
    release = done;
  });
  await page.route(`**/${chunk}`, async (route) => {
    await gate;
    await route.fallback();
  });
  return release;
}
async function invitationStartup(page: Page, acceptFailure = false) {
  const accepted: unknown[] = [];
  await page.route('**/api/classroom-teacher-invitations/*', (route) =>
    route.fulfill({
      json: {
        invitation: {
          classroomId: 'class-1',
          classroomTitle: 'Учебный класс',
          ownerDisplayName: 'Преподаватель',
          status: 'pending',
          expiresAt: '2030-01-01T00:00:00Z',
        },
      },
    }),
  );
  await page.route('**/api/classroom-teacher-invitations/*/accept', (route) => {
    accepted.push(route.request().postDataJSON());
    return route.fulfill(
      acceptFailure
        ? {
            status: 403,
            json: { error: { code: 'forbidden', message: 'Проверьте возможности аккаунта' } },
          }
        : { json: { classroom: { id: 'class-1', title: 'Учебный класс', role: 'co_teacher' } } },
    );
  });
  return accepted;
}

for (const actor of ['account', 'seat', 'teacher', 'author', 'admin'] as const) {
  test(`S4 ordinary portal defers editor, public-entry and invitation code for ${actor}`, async ({
    page,
  }) => {
    await fixture(page, {
      seat: actor === 'seat',
      educator: actor === 'teacher',
      author: actor === 'author',
      platformAdmin: actor === 'admin',
    });
    const { manifest, editorFiles } = startupChunks();
    const requests: string[] = [];
    page.on('request', (request) => requests.push(new URL(request.url()).pathname.slice(1)));
    await page.goto('/#/home');
    await expect(page.getByRole('main', { name: 'Главная', exact: true })).toBeVisible();
    for (const route of ['projects', 'gallery', 'knowledge', 'learning', 'help', 'account']) {
      await page.evaluate((hash) => {
        window.location.hash = hash;
      }, `/${route}`);
      await expect(page.locator('main').first()).toBeVisible();
      await expect(page.locator('main[aria-busy="true"]')).toHaveCount(0);
    }
    for (const file of [
      ...editorFiles,
      manifest['src/pages/PublicEntryPage.tsx']!.file,
      manifest['src/pages/TeacherInvitePage.tsx']!.file,
    ])
      expect(requests).not.toContain(file);
    expect(
      await page
        .locator('link[rel="stylesheet"]')
        .evaluateAll((links) => links.map((node) => (node as HTMLLinkElement).href)),
    ).not.toContain(`http://127.0.0.1:4612/${editorFiles[1]}`);
    mkdirSync(startupEvidence, { recursive: true });
    writeFileSync(
      `${startupEvidence}/deferred-${actor}.json`,
      JSON.stringify({ requests, excluded: editorFiles }, null, 2),
    );
  });
}

for (const width of [1440, 1024, 390, 320]) {
  for (const kind of ['entry', 'home', 'invite'] as const) {
    test(`S4 branded ${kind} chunk loading stays within ${width}px short screen`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 568 });
      if (kind === 'home') await fixture(page, { educator: true });
      else await anonymousStartup(page);
      if (kind === 'invite') await invitationStartup(page);
      const chunk =
        startupChunks().manifest[
          `src/pages/${kind === 'entry' ? 'PublicEntryPage' : kind === 'home' ? 'CreatorHomePage' : 'TeacherInvitePage'}.tsx`
        ]!.file;
      const release = await holdStartupChunk(page, chunk);
      try {
        await page.goto(kind === 'invite' ? '/#/teacher-invite/s4-token' : '/#/home', {
          waitUntil: 'domcontentloaded',
        });
        const label =
          kind === 'home'
            ? 'Открываем главную'
            : kind === 'invite'
              ? 'Открываем приглашение'
              : 'Открываем ASA Lab';
        await expect(page.getByRole('status', { name: label, exact: true })).toBeVisible();
        await expect(page.locator('.app-boot-brand img')).toHaveAttribute(
          'src',
          '/asa-lab-mark.svg',
        );
        await startupCapture(page, `${kind}-${width}-loading`);
        release();
        await expect(
          page.getByRole(kind === 'home' ? 'main' : 'heading', {
            name:
              kind === 'home'
                ? 'Главная'
                : kind === 'invite'
                  ? 'Вести класс вместе'
                  : 'Идея есть? Сделай её.',
            exact: true,
          }),
        ).toBeVisible();
        if (kind === 'entry') {
          await page.getByRole('button', { name: 'Войти и открыть галерею', exact: true }).click();
          await expect(page).toHaveURL(/#\/sign-in$/);
          await expect(page.locator('input[type="password"]')).toBeVisible();
        }
      } finally {
        release();
      }
    });
  }
  test(`S4 public chunk failure preserves usable sign-in and reload retry at ${width}px`, async ({
    page,
  }) => {
    await anonymousStartup(page);
    await page.setViewportSize({ width, height: 568 });
    const chunk = startupChunks().manifest['src/pages/PublicEntryPage.tsx']!.file;
    let fail = true;
    let attempts = 0;
    await page.route(`**/${chunk}`, (route) => {
      attempts += 1;
      return fail ? route.fulfill({ status: 503, body: 'delivery unavailable' }) : route.fallback();
    });
    await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'Страница не загрузилась', exact: true }),
    ).toBeVisible();
    expect(attempts).toBe(2); // Original global recovery reloads once; its bounded second failure reaches our boundary.
    await expect(page.getByRole('alert')).not.toContainText(chunk);
    await startupCapture(page, `entry-${width}-error`);
    fail = false;
    await page.getByRole('button', { name: 'Попробовать снова', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Идея есть? Сделай её.', exact: true }),
    ).toBeVisible();
    fail = true;
    // A same-hash goto is a same-document traversal and keeps a loaded module.
    // Start a new document before failing delivery again to test the other exit.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(
      page.getByRole('heading', { name: 'Страница не загрузилась', exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Войти', exact: true }).click();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });
}

for (const authenticated of [false, true]) {
  test(`S4 invitation preserves native ${authenticated ? 'authenticated' : 'anonymous'} handlers`, async ({
    page,
  }) => {
    if (authenticated) await fixture(page, { educator: true });
    else await anonymousStartup(page);
    const accepted = await invitationStartup(page);
    await page.goto('/#/teacher-invite/s4-token');
    await expect(
      page.getByRole('heading', { name: 'Вести класс вместе', exact: true }),
    ).toBeVisible();
    if (authenticated) {
      await page.getByRole('button', { name: 'Принять приглашение', exact: true }).click();
      await expect(page).toHaveURL(/#\/classrooms\/class-1/);
      expect(accepted).toEqual([{}]);
    } else {
      await page.getByRole('button', { name: 'Войти и продолжить', exact: true }).click();
      await expect(page).toHaveURL(/#\/sign-in$/);
      // Exercise the second original action from its actual invitation URL;
      // anonymous auth-history restoration is not changed by this delivery slice.
      await page.goto('/#/teacher-invite/s4-token');
      await expect(
        page.getByRole('heading', { name: 'Вести класс вместе', exact: true }),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Создать аккаунт', exact: true }).click();
      await expect(page).toHaveURL(/#\/sign-up$/);
      expect(accepted).toEqual([]);
    }
  });
  test(`S4 invitation delivery error retains ${authenticated ? 'class' : 'public'} exit`, async ({
    page,
  }) => {
    if (authenticated) await fixture(page, { educator: true });
    else await anonymousStartup(page);
    await page.setViewportSize({ width: 320, height: 568 });
    const chunk = startupChunks().manifest['src/pages/TeacherInvitePage.tsx']!.file;
    let requests = 0;
    let documents = 0;
    let release!: () => void;
    const releasePromise = new Promise<void>((done) => {
      release = done;
    });
    await page.route('http://127.0.0.1:4612/', async (route) => {
      const request = route.request();
      if (
        request.method() === 'GET' &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        documents += 1;
        if (documents === 2) await releasePromise;
      }
      await route.fallback();
    });
    await page.route(`**/${chunk}`, (route) => {
      requests += 1;
      return route.fulfill({ status: 503, body: 'delivery unavailable' });
    });
    try {
      await page.goto('/#/teacher-invite/s4-token', { waitUntil: 'domcontentloaded' });
      // Keep capture out of the old document while its recovery reload is held.
      // The second invitation request proves the replacement document is running.
      await expect.poll(() => documents).toBe(2);
      expect(requests).toBe(1);
      release();
      await expect.poll(() => requests).toBe(2);
      await expect(
        page.getByRole('heading', { name: 'Страница не загрузилась', exact: true }),
      ).toBeVisible();
      await startupCapture(
        page,
        `invite-${authenticated ? 'authenticated' : 'anonymous'}-320-error`,
      );
      await page
        .getByRole('button', {
          name: authenticated ? 'Вернуться к классам' : 'На главную',
          exact: true,
        })
        .click();
      await expect(page).toHaveURL(authenticated ? /#\/classrooms$/ : /#\/$/);
      await expect(
        page.getByRole('heading', { name: 'Страница не загрузилась', exact: true }),
      ).toHaveCount(0);
    } finally {
      release();
    }
  });
}
test('S4 Home delivery error preserves portal controls and My Projects exit', async ({ page }) => {
  await fixture(page);
  await page.setViewportSize({ width: 390, height: 568 });
  const chunk = startupChunks().manifest['src/pages/CreatorHomePage.tsx']!.file;
  let documents = 0;
  let requests = 0;
  let failedDeliveries = 0;
  let loadedDocuments = 0;
  let release!: () => void;
  const releasePromise = new Promise<void>((done) => {
    release = done;
  });
  const onDocumentLoaded = () => {
    loadedDocuments += 1;
  };
  page.on('domcontentloaded', onDocumentLoaded);
  await page.route('http://127.0.0.1:4612/', async (route) => {
    const request = route.request();
    if (
      request.method() === 'GET' &&
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame()
    ) {
      documents += 1;
      if (documents === 2) await releasePromise;
    }
    await route.fallback();
  });
  await page.route(`**/${chunk}`, async (route) => {
    requests += 1;
    await route.fulfill({ status: 503, body: 'delivery unavailable' });
    failedDeliveries += 1;
  });
  try {
    await page.goto('/#/home', { waitUntil: 'domcontentloaded' });
    await expect.poll(() => documents).toBe(2);
    expect(requests).toBe(1);
    expect(failedDeliveries).toBe(1);
    expect(loadedDocuments).toBe(1);
    const held = { documents, requests, failedDeliveries, loadedDocuments };
    release();
    // The load witness is registered before goto; neither an outgoing heading
    // nor a second request alone proves that its replacement document is ready.
    await expect.poll(() => loadedDocuments).toBe(2);
    await expect.poll(() => failedDeliveries).toBe(2);
    expect(requests).toBe(2);
    mkdirSync(test.info().outputDir, { recursive: true });
    writeFileSync(
      test.info().outputPath('home-barrier.json'),
      JSON.stringify(
        { held, reloaded: { documents, requests, failedDeliveries, loadedDocuments } },
        null,
        2,
      ),
    );
    await expect(
      page.getByRole('heading', { name: 'Страница не загрузилась', exact: true }),
    ).toBeVisible();
    await startupCapture(page, 'home-390-error');
    await expect(page.locator('.learning-inbox-button')).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath('home-error.png') });
    await page.getByRole('button', { name: 'Мои проекты', exact: true }).click();
    await expect(page).toHaveURL(/#\/projects$/);
    await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible();
    writeFileSync(test.info().outputPath('home-exit.json'), JSON.stringify({ url: page.url() }));
  } finally {
    release();
    page.off('domcontentloaded', onDocumentLoaded);
  }
});

const startupProjectId = '30000000-0000-4000-8000-000000000004';
for (const seat of [false, true])
  for (const known of [false, true]) {
    test(`S4 deferred host preserves ${seat ? 'Seat' : 'Account'} ${known ? 'known' : 'historical'} editor document and return route`, async ({
      page,
    }) => {
      await fixture(page, { seat });
      await page.setViewportSize({ width: seat ? 320 : 1024, height: 568 });
      const reads: string[] = [];
      const projectJson = {
        targets: [
          {
            isStage: true,
            name: 'S4 сохранённый документ',
            blocks: {},
            variables: {},
            costumes: [],
            sounds: [],
          },
        ],
        monitors: [],
        extensions: [],
      };
      await page.route(`**/api/projects/${startupProjectId}`, (route) => {
        reads.push(route.request().url());
        return route.fulfill({
          json: {
            project: { id: startupProjectId, moduleKey: 'blocks', title: 'Сохранённая работа' },
            draft: { revision: 7, document: projectJson },
            versions: [],
            result: null,
          },
        });
      });
      await page.route(`**/api/projects/${startupProjectId}/blocks/runtime-session`, (route) =>
        route.fulfill({
          json: {
            runtimeOrigin: 'http://127.0.0.1:4612',
            runtimeToken: 'fixture.payload.signature',
            expiresAt: Math.floor(Date.now() / 1000) + 3600,
            draftRevision: 7,
            projectJson,
            assets: [],
          },
        }),
      );
      // GUI is a protocol fixture, not a second Scratch runtime. The compiled ASA
      // host, Blocks adapter, actor props and real bridge execute unchanged.
      await page.route('**/internal/blocks/?asaStatus=parent', (route) =>
        route.fulfill({
          contentType: 'text/html',
          body: `<!doctype html><html><body><button id="fail">Ошибка среды</button><script>
      let init;
      window.addEventListener('message', (event) => {
        if (event.source !== parent || event.origin !== location.origin || event.data.messageType !== 'ASA_BLOCKS_INIT') return;
        init = event.data; window.fixtureInit = init;
        parent.postMessage({ protocolVersion: init.protocolVersion, projectId: init.projectId, sessionNonce: init.sessionNonce, messageType: 'ASA_BLOCKS_STATUS', status: 'editor-ready' }, location.origin);
      });
      document.getElementById('fail').onclick = () => parent.postMessage({ protocolVersion: init.protocolVersion, projectId: init.projectId, sessionNonce: init.sessionNonce, messageType: 'ASA_BLOCKS_FATAL', code: 'runtime_error', message: 'Fixture error' }, location.origin);
    </script></body></html>`,
        }),
      );
      const hostFile = startupChunks().host.file;
      const release = await holdStartupChunk(page, hostFile);
      try {
        await page.goto(`/#/projects/${startupProjectId}${known ? '?module=blocks' : ''}`, {
          waitUntil: 'domcontentloaded',
        });
        await expect(
          page.getByRole('status', { name: 'Открываем проект', exact: true }),
        ).toBeVisible();
        await startupCapture(
          page,
          `editor-${seat ? 'seat' : 'account'}-${known ? 'known' : 'historical'}-loading`,
        );
        release();
        await expect(page.locator('[data-asa-blocks-loading-overlay]')).toHaveAttribute(
          'data-state',
          'ready',
        );
        const frame = page.frameLocator('iframe[title="Scratch runtime"]');
        const init = await frame
          .locator('body')
          .evaluate(
            () => (window as unknown as { fixtureInit: Record<string, unknown> }).fixtureInit,
          );
        expect(init.projectId).toBe(startupProjectId);
        expect(init.projectJson).toEqual(projectJson);
        expect(init.draftRevision).toBe(7);
        expect(init.recoveryPrincipalKey).toBe(
          seat ? 'seat-1' : '20000000-0000-4000-8000-000000000001',
        );
        expect(reads).toHaveLength(known ? 0 : 1);
        await expect(
          page.getByRole('button', {
            name: seat
              ? 'Открыть аккаунт: Ученик с длинным именем'
              : 'Открыть аккаунт: Проверочный профиль',
            exact: true,
          }),
        ).toBeVisible();
        await frame.getByRole('button', { name: 'Ошибка среды' }).click();
        await expect(page.locator('[data-asa-blocks-loading-overlay]')).toHaveAttribute(
          'data-state',
          'error',
        );
        await page.getByRole('button', { name: 'К проектам', exact: true }).click();
        await expect(page).toHaveURL(/#\/projects$/);
        await expect(page.getByRole('heading', { name: 'Мои проекты', exact: true })).toBeVisible();
        mkdirSync(startupEvidence, { recursive: true });
        writeFileSync(
          `${startupEvidence}/editor-${seat ? 'seat' : 'account'}-${known ? 'known' : 'historical'}-bridge.json`,
          JSON.stringify(
            { init: { ...init, runtimeToken: '[synthetic fixture]' }, reads },
            null,
            2,
          ),
        );
      } finally {
        release();
      }
    });
  }
for (const game of [false, true]) {
  test(`S4 host chunk failure retains global recovery and ${game ? 'game' : 'project'} back action`, async ({
    page,
  }) => {
    await fixture(page);
    await page.setViewportSize({ width: 320, height: 568 });
    const hostFile = startupChunks().host.file;
    let requests = 0;
    let documents = 0;
    let release!: () => void;
    const releasePromise = new Promise<void>((done) => {
      release = done;
    });
    await page.route('http://127.0.0.1:4612/', async (route) => {
      const request = route.request();
      if (
        request.method() === 'GET' &&
        request.isNavigationRequest() &&
        request.frame() === page.mainFrame()
      ) {
        documents += 1;
        if (documents === 2) await releasePromise;
      }
      await route.fallback();
    });
    await page.route(`**/${hostFile}`, (route) => {
      requests += 1;
      return route.fulfill({ status: 503, body: 'delivery unavailable' });
    });
    try {
      await page.goto(`/#/projects/${startupProjectId}?module=${game ? 'chess' : 'blocks'}`, {
        waitUntil: 'domcontentloaded',
      });
      // The old boundary can appear while the global reload is still in flight.
      // Hold its document request to prove the second host request cannot yet
      // have happened, then synchronize the final assertions with that request.
      await expect.poll(() => documents).toBe(2);
      expect(requests).toBe(1);
      release();
      await expect.poll(() => requests).toBe(2);
      await expect(
        page.getByRole('heading', { name: 'Учебная среда не загрузилась', exact: true }),
      ).toBeVisible();
      await expect(page.getByRole('alert')).toContainText(
        'Не удалось загрузить рабочую среду. Проверьте соединение и попробуйте снова.',
      );
      await expect(page.getByRole('alert')).not.toContainText(hostFile);
      await startupCapture(page, `editor-320-${game ? 'game' : 'project'}-chunk-error`);
      await page
        .getByRole('button', { name: game ? 'К играм' : 'К проектам', exact: true })
        .click();
      await expect(page).toHaveURL(game ? /#\/games$/ : /#\/projects$/);
      await expect(
        page.getByRole('heading', { name: 'Учебная среда не загрузилась', exact: true }),
      ).toHaveCount(0);
    } finally {
      release();
    }
  });
}

for (const width of [1440, 1024, 390, 320])
  test(`R2 compact Home has one create action per empty module and no attention/global polling at ${width}px`, async ({
    page,
  }) => {
    mkdirSync(`${r2Evidence}/home`, { recursive: true });
    await fixture(page, { educator: true });
    await page.route('**/api/modules', (route) =>
      route.fulfill({
        json: {
          items: ['three-d', 'electronics', 'blocks'].map((moduleKey) => ({
            moduleKey,
            displayName: moduleKey,
            availability: 'active',
            creatable: true,
          })),
        },
      }),
    );

    let notifications = 0,
      attention = 0;
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/learning/notifications') notifications++;
      if (path.includes('/attention')) attention++;
    });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/home');
    const main = page.getByRole('main', { name: 'Главная', exact: true });
    await expect(main).toBeVisible();
    await expect(main.locator('.creator-module-section')).toHaveCount(3);
    await expect(main.getByRole('heading', { name: 'Главная', exact: true })).toHaveCount(0);
    await expect(
      main.locator('.home-mobile-create,.home-empty-create,.portal-quick-create'),
    ).toHaveCount(0);
    await expect(main.locator('.home-create-button')).toHaveCount(3);
    const actionGeometry = async () => {
      const boxes = await main.locator('.home-create-button').evaluateAll((buttons) =>
        buttons.map((button) => {
          const hit = button.getBoundingClientRect();
          const empty = button
            .closest('.creator-module-section')!
            .querySelector('.home-module-empty')!
            .getBoundingClientRect();
          const frame = getComputedStyle(button, '::before');
          return {
            width: hit.width,
            height: hit.height,
            visualHeight: hit.height - parseFloat(frame.top) - parseFloat(frame.bottom),
            hitBottom: hit.bottom,
            emptyTop: empty.top,
          };
        }),
      );
      for (const box of boxes) {
        expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.height).toBeGreaterThanOrEqual(44);
        expect(box.hitBottom).toBeLessThanOrEqual(box.emptyTop);
      }
      return boxes;
    };
    const normalGeometry = await actionGeometry();

    await expect(main.locator('.home-module-empty')).toHaveCount(3);
    await expect(page.locator('.portal-header .portal-quick-create > summary')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Открыть знания', exact: true })).toBeVisible();
    await assertShellGeometry(page, width);
    expect(notifications).toBe(0);
    expect(attention).toBe(0);
    await page.screenshot({ path: `${r2Evidence}/home/empty-${width}.png` });
    await page.addStyleTag({ content: '.creator-home button {font-size:24px !important; }' });
    await assertShellGeometry(page, width);
    const font150Geometry = await actionGeometry();
    writeFileSync(
      `${r2Evidence}/home/geometry-${width}.json`,
      JSON.stringify({ normalGeometry, font150Geometry }, null, 2),
    );
    await page.screenshot({ path: `${r2Evidence}/home/empty-font150-${width}.png` });
  });

for (const seat of [false, true])
  test(`R2 ${seat ? 'Seat' : 'Account'} retains general and per-class preferences through guarded tabs and clean lifecycle`, async ({
    page,
  }) => {
    await fixture(page, { seat });
    let preferenceLoads = 0,
      eventLoads = 0;
    page.on('request', (request) => {
      const path = new URL(request.url()).pathname;
      if (path === '/api/learning/notifications/preferences' && request.method() === 'GET')
        preferenceLoads++;
      if (path === '/api/learning/notifications') eventLoads++;
    });
    await page.goto('/#/account/notifications');
    const prefs = page.getByRole('region', {
      name: 'Учебные оповещения — только для меня',
      exact: true,
    });
    const dueSoon = prefs.getByRole('checkbox', { name: 'Скоро срок', exact: true });
    await expect(dueSoon).toBeChecked();
    await prefs.evaluate(
      (element) =>
        ((window as typeof window & { r2PreferencesElement: Element }).r2PreferencesElement =
          element),
    );
    await dueSoon.uncheck();
    await expect(prefs.getByRole('region', { name: 'По классам', exact: true })).toBeVisible();
    await prefs.getByLabel('Мои оповещения об этом классе').selectOption('custom');
    await prefs
      .getByRole('combobox', { name: 'Назначения и условия', exact: true })
      .selectOption('off');
    await panel(page, seat ? 'Мой профиль' : 'Профиль').click();
    const guard = page.getByRole('dialog', { name: 'Несохранённые изменения' });
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Остаться', exact: true }).click();
    await expect(dueSoon).not.toBeChecked();
    await expect(prefs.getByLabel('Мои оповещения об этом классе')).toHaveValue('custom');
    await expect(
      prefs.getByRole('combobox', { name: 'Назначения и условия', exact: true }),
    ).toHaveValue('off');
    await prefs.getByRole('button', { name: 'Сохранить оповещения', exact: true }).click();
    await expect(prefs.getByRole('status')).toHaveText('Настройки сохранены.');
    await panel(page, 'Интерфейс').click();
    await expect(page.locator('.learning-inbox-events')).toHaveCount(0);
    await panel(page, 'Уведомления').click();
    await expect(page.locator('.learning-inbox-events')).toBeVisible();
    expect(
      await prefs.evaluate(
        (element) =>
          element ===
          (window as typeof window & { r2PreferencesElement: Element }).r2PreferencesElement,
      ),
    ).toBe(true);
    expect(preferenceLoads).toBe(1);
    expect(eventLoads).toBe(2);
    await expect(dueSoon).not.toBeChecked();
    await expect(
      prefs.getByRole('combobox', { name: 'Назначения и условия', exact: true }),
    ).toHaveValue('off');
    await dueSoon.check();
    await panel(page, 'Интерфейс').click();
    await expect(guard).toBeVisible();
    await guard.getByRole('button', { name: 'Отменить изменения и перейти', exact: true }).click();
    await expect(page).toHaveURL(/#\/account\/interface$/);
    await panel(page, 'Уведомления').click();
    await expect(dueSoon).not.toBeChecked();
  });
test('R2 short admin drawer scrolls navigation independently while profile, close and footer remain reachable', async ({
  page,
}) => {
  mkdirSync(`${r2Evidence}/shell`, { recursive: true });
  await fixture(page, {
    platformAdmin: true,
    educator: true,
    author: true,
    presentationLongContent: true,
  });
  await page.route('**/api/admin/v1/me', (route) =>
    route.fulfill({
      json: {
        administrator: true,
        principalId: 'admin-1',
        accountId: '20000000-0000-4000-8000-000000000001',
        displayName: 'Проверочный администратор',
        activeWorkspaceId: '10000000-0000-4000-8000-000000000001',
        scopes: [
          {
            kind: 'platform',
            id: null,
            title: 'ASA Lab',
            role: 'platform_admin',
            permissions: [
              'administration.open',
              'administration.accounts.read',
              'administration.organizations.read',
              'administration.security.read',
              'administration.audit.read',
              'administration.operations.read',
            ],
          },
        ],
      },
    }),
  );
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto('/#/admin');
  await page.getByRole('button', { name: 'Открыть меню', exact: true }).click();
  const sidebar = page.locator('#portal-sidebar');
  await expect(sidebar.locator('.portal-admin-subnav-item')).toHaveCount(8);
  await expect(sidebar.getByRole('button', { name: 'Закрыть меню', exact: true })).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Выбрать аватар в меню' })).toBeInViewport();
  const nav = sidebar.locator('.portal-nav');
  expect(await nav.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
  await sidebar.getByRole('button', { name: 'История', exact: true }).scrollIntoViewIfNeeded();
  await expect(sidebar.getByRole('button', { name: 'История', exact: true })).toBeInViewport();
  for (const label of ['Настройки', 'Справка'])
    await expect(sidebar.getByRole('link', { name: label, exact: true })).toBeInViewport();
  await expect(sidebar.getByRole('button', { name: 'Выход', exact: true })).toBeInViewport();
  expect(await sidebar.evaluate((el) => el.scrollHeight <= el.clientHeight)).toBe(true);
  await page.screenshot({ path: `${r2Evidence}/shell/admin-long-nav-320.png` });
});

for (const width of [390, 320])
  test(`R2 inline event keyboard focus stays below fixed Header at ${width}px`, async ({
    page,
  }) => {
    await fixture(page, { inboxItems });
    await page.setViewportSize({ width, height: 568 });
    await page.goto('/#/account/notifications');
    await expect(page.locator('.learning-inbox-list li')).toHaveCount(2);
    const category = page.locator('.learning-inbox-events select').first();
    await category.focus();
    for (let i = 0; i < 5; i++) {
      await expect
        .poll(
          async () =>
            page.locator(':focus').evaluate((element) => {
              const rect = element.getBoundingClientRect();
              const header = document.querySelector('.portal-header')!.getBoundingClientRect();
              return rect.y >= header.bottom && rect.bottom <= innerHeight;
            }),
          { message: `focused event control ${i} fits below Header` },
        )
        .toBe(true);
      await page.keyboard.press('Tab');
    }
  });

test('R2 Home module creation preserves server projection, busy and idempotent retry after failure', async ({
  page,
}) => {
  await fixture(page);
  await page.route('**/api/modules', (route) =>
    route.fulfill({
      json: {
        items: [
          {
            moduleKey: 'electronics',
            displayName: 'Электроника',
            availability: 'active',
            creatable: true,
          },
          { moduleKey: 'three-d', displayName: '3D', availability: 'active', creatable: false },
        ],
      },
    }),
  );
  let release!: () => void;
  const gate = new Promise<void>((done) => (release = done));
  const keys: string[] = [];
  const bodies: unknown[] = [];
  await page.route('**/api/projects', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    keys.push(route.request().headers()['idempotency-key']);
    bodies.push(route.request().postDataJSON());
    if (keys.length === 1) await gate;
    await route.fulfill({
      status: 503,
      json: { error: { code: 'unavailable', message: 'Создание временно недоступно' } },
    });
  });
  await page.goto('/#/home');
  const button = page.getByRole('button', { name: 'Создать цепь', exact: true });
  await expect(button).toBeVisible();
  await expect(page.getByRole('button', { name: 'Создать модель', exact: true })).toHaveCount(0);
  await button.click();
  await expect(button).toBeDisabled();
  release();
  await expect(page.getByRole('alert')).toContainText('Создание временно недоступно');
  await expect(button).toBeEnabled();
  await page
    .getByRole('alert')
    .getByRole('button', { name: 'Продолжить создание', exact: true })
    .click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  expect(bodies[0]).toEqual(bodies[1]);
  expect(bodies[0]).toMatchObject({
    scope: 'personal',
    module: 'electronics',
    automaticTitle: true,
  });
});
