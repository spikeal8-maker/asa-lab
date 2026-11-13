
type NestedSurface = 'ai' | 'games' | 'network' | 'rating';
const nestedSurfaces = ['ai', 'games', 'network', 'rating'] as const;

async function allSettingsFixture(page: Page, rejected?: NestedSurface) {
  const state = await fixture(page, 3, { sidebar: 'collapsed' });
  const writes: Array<{ surface: NestedSurface; input: Record<string, unknown> }> = [];
  const factors = { projects: true, logins: true, days: true, time: true, grades: true };
  let ai = { classroomId: classId, mode: 'deny', minimumRating: 0, revision: 1, readOnly: false, students: [] };
  let games = { mode: 'allow', threshold: null, state: 'active', version: 1 };
  let network = { enabled: false, scope: 'classroom', version: 1 };
  let rating = { periodDays: 30, factors, revision: 1 };
  const urls = {
    ai: `${origin}/api/ai/classrooms/${classId}/access`,
    games: `${origin}/api/games/classrooms/${classId}/policy`,
    network: `${origin}/api/games/chess/policy/${classId}`,
    rating: `${origin}/api/classrooms/${classId}/participants/actions/settings`,
  };
  await page.route(`${origin}/api/classrooms/${classId}/participants`, (route) =>
    route.fulfill({ json: { settings: rating, items: [] } }),
  );
  for (const surface of nestedSurfaces) {
    await page.route(urls[surface], async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const value = surface === 'ai' ? ai : surface === 'games' ? games : network;
        return route.fulfill({ json: value });
      }
      expect(method).toBe(surface === 'rating' ? 'POST' : 'PUT');
      const input = route.request().postDataJSON() as Record<string, unknown>;
      writes.push({ surface, input });
      if (surface === rejected) {
        return route.fulfill({ status: 409, json: { error: { code: 'conflict', message: 'Изменение не подтверждено.' } } });
      }
      if (surface === 'ai') {
        expect(input).toMatchObject({ kind: 'class', mode: 'allow', minimumRating: 0, expectedRevision: 1 });
        expect(input.requestId).toEqual(expect.any(String));
        ai = { ...ai, mode: 'allow', revision: 2 };
        return route.fulfill({ json: { saved: true, revision: 2 } });
      }
      if (surface === 'games') {
        expect(input).toEqual({ mode: 'deny', threshold: null, expectedVersion: 1 });
        games = { ...games, mode: 'deny', version: 2 };
        return route.fulfill({ json: games });
      }
      if (surface === 'network') {
        expect(input).toEqual({ enabled: true, scope: 'classroom', expectedVersion: 1 });
        expect(route.request().headers()['idempotency-key']).toEqual(expect.any(String));
        network = { ...network, enabled: true, version: 2 };
        return route.fulfill({ json: { ...network, replayed: false } });
      }
      expect(input).toMatchObject({ periodDays: 7, expectedRevision: 1, factors });
      expect(input.requestId).toEqual(expect.any(String));
      rating = { ...rating, periodDays: 7, revision: 2 };
      return route.fulfill({ json: rating });
    });
  }
  return { state, writes };
}

async function prepareNestedSave(page: Page, surface: NestedSurface) {
  await page.goto(`${origin}/#/classrooms/${classId}`);
  await selectSection(page, 'settings');
  const group = surface === 'rating'
    ? page.getByRole('region', { name: 'Настройки рейтинга', exact: true })
    : page.getByRole('group', {
        name: surface === 'ai' ? 'ИИ-чат учеников' : surface === 'games' ? 'Игры в классе' : 'Сетевая игра в шахматы и шашки',
        exact: true,
      });
  const name = surface === 'ai' ? 'Сохранить правило класса'
    : surface === 'games' ? 'Сохранить доступ'
      : surface === 'network' ? 'Сохранить сетевой режим' : 'Сохранить рейтинг';
  const button = group.getByRole('button', { name, exact: true });
  await expect(button).toBeVisible();
  if (surface === 'ai') await group.getByLabel('Доступ к ИИ', { exact: true }).selectOption('allow');
  else if (surface === 'games') await group.getByLabel('Доступ к играм', { exact: true }).selectOption('deny');
  else if (surface === 'network') await group.getByLabel('Разрешить сетевую игру', { exact: true }).check();
  else await group.getByLabel('Период рейтинга', { exact: true }).selectOption('7');
  await expect(button).toBeEnabled();
  await button.scrollIntoViewIfNeeded();
  await settle(page);
  const message = surface === 'ai' ? 'Доступ к ИИ сохранён. Новые сообщения используют это правило.'
    : surface === 'games' ? 'Доступ к играм сохранён.'
      : surface === 'network' ? 'Настройки сетевой игры сохранены.' : 'Рейтинг сохранён';
  return { group, button, message };
}

for (const surface of nestedSurfaces) {
  for (const width of [1440, 390]) {
    test(`${surface} confirmed save uses one overlay without reflow at ${width}`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const { state, writes } = await allSettingsFixture(page);
      const { group, button, message } = await prepareNestedSave(page, surface);
      const before = await boxes(page, group);
      await button.click();
      const ribbon = page.locator('.system-feedback-ribbon.system-feedback-success');
      await expect(ribbon).toHaveCount(1);
      await expect(ribbon).toBeVisible();
      await expect(ribbon).toContainText(message);
      await expect(group.getByText(message, { exact: true })).toHaveCount(0);
      const announcement = page.locator('.system-feedback-announcement[role="status"]');
      await expect(announcement).toHaveCount(1);
      await expect(announcement).toContainText(message);
      await expect(button).toBeVisible();
      await expect(group).not.toHaveAttribute('aria-busy', 'true');
      await settle(page);
      const during = await boxes(page, group);
      unchanged(before, during);
      await page.screenshot({ path: `${evidence}/${surface}-${width}-success.png` });
      await ribbon.getByRole('button', { name: 'Закрыть уведомление' }).click();
      await expect(ribbon).toHaveCount(0);
      await settle(page);
      const after = await boxes(page, group);
      unchanged(before, after);
      await info.attach('nested-settings-geometry', { body: JSON.stringify({ surface, width, before, during, after }), contentType: 'application/json' });
      expect(writes).toHaveLength(1);
      expect(writes[0]?.surface).toBe(surface);
      expect(state.errors).toEqual([]);
    });
  }
  test(`${surface} rejected save stays local without a false success`, async ({ page }) => {
    const { state, writes } = await allSettingsFixture(page, surface);
    const { group, button, message } = await prepareNestedSave(page, surface);
    await button.click();
    await expect(group.getByRole('alert')).toBeVisible();
    await expect(page.locator('.system-feedback-ribbon.system-feedback-success')).toHaveCount(0);
    await expect(page.locator('.system-feedback-announcement[role="status"]')).toHaveCount(0);
    await expect(group.getByText(message, { exact: true })).toHaveCount(0);
    expect(writes).toHaveLength(1);
    expect(state.errors).toEqual([]);
  });
}
