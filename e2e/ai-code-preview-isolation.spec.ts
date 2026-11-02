import { test, expect } from '@playwright/test';
import { codePreviewDocument } from '../apps/web/src/ai/ai-code-preview';

const escapeAttribute = (text: string) =>
  text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

test('standalone SVG fits wide, tall and pixel-sized drawings inside the preview', async ({
  page,
}) => {
  for (const [width, height, viewBox] of [
    [800, 200, true],
    [200, 800, true],
    [2400, 1200, false],
    [120, 80, false],
  ] as const) {
    const attrs = viewBox
      ? `viewBox="0 0 ${width} ${height}"`
      : `width="${width}" height="${height}"`;
    const doc = codePreviewDocument(
      `<svg ${attrs}><rect width="${width}" height="${height}" fill="blue"/></svg>`,
      false,
      true,
    )!;
    await page.setContent(
      `<iframe title="SVG" style="width:320px;height:220px;border:0" sandbox="" srcdoc="${escapeAttribute(doc)}"></iframe>`,
    );
    const frame = page.frameLocator('iframe');
    await expect(frame.locator('svg')).toBeVisible();
    const box = await frame.locator('rect').boundingBox();
    expect(box!.width).toBeLessThanOrEqual(320.1);
    expect(box!.height).toBeLessThanOrEqual(220.1);
    expect(Math.min(Math.abs(box!.width - 320), Math.abs(box!.height - 220))).toBeLessThan(0.2);
    expect(await frame.locator('html').evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(
      false,
    );
  }
});

test('interactive preview runs buttons, isolates ASA data and blocks navigation before requests', async ({
  page,
  context,
}) => {
  const outgoing: string[] = [];
  page.on('websocket', (socket) => outgoing.push(socket.url()));
  await context.addCookies([
    { name: 'asa_probe', value: 'private-cookie', url: 'https://asa-preview.test' },
  ]);
  await page.route('**/*', (route) => {
    if (route.request().url() === 'https://asa-preview.test/parent.html')
      return route.fulfill({
        contentType: 'text/html',
        body: '<!doctype html><h1>ASA parent</h1>',
      });
    outgoing.push(route.request().url());
    return route.abort();
  });
  await page.goto('https://asa-preview.test/parent.html');
  await page.evaluate(() => {
    localStorage.setItem('asa_secret', 'private');
  });
  const mount = async (code: string) => {
    const doc = codePreviewDocument(code, true)!;
    await page.setContent(
      `<h1>ASA parent</h1><iframe id="preview" sandbox="allow-scripts" srcdoc="${escapeAttribute(doc)}"></iframe>`,
    );
  };
  await mount(`<button id="play" onclick="this.textContent='Работает'">Играть</button><p id="isolation"></p><script>
    const results=[];
    try { parent.document.body; results.push('parent-open'); } catch { results.push('parent-blocked'); }
    try { document.cookie; results.push('cookie-open'); } catch { results.push('cookie-blocked'); }
    results.push(localStorage.getItem('asa_secret') === null ? 'storage-isolated' : 'storage-leak');
    localStorage.setItem('score','42'); results.push(localStorage.getItem('score'));
    document.getElementById('isolation').textContent=results.join('|');
  </script>`);
  const game = page.frameLocator('#preview').frameLocator('iframe');
  await expect(game.locator('#isolation')).toHaveText(
    'parent-blocked|cookie-blocked|storage-isolated|42',
  );
  await game.getByRole('button', { name: 'Играть', exact: true }).click();
  await expect(game.getByRole('button', { name: 'Работает', exact: true })).toBeVisible();
  const probes = [
    `location.assign('https://blocked.invalid/assign')`,
    `location.replace('https://blocked.invalid/replace')`,
    `location.href='https://asa-preview.test/private'`,
    `const a=document.createElement('a');a.href='https://blocked.invalid/link';document.body.append(a);a.click()`,
    `const f=document.createElement('form');f.action='https://blocked.invalid/form';document.body.append(f);f.submit()`,
    `location.href=URL.createObjectURL(new Blob(['<h1>blob</h1>'],{type:'text/html'}))`,
    `location.href='data:text/html,test'`,
    `parent.location.href='https://blocked.invalid/parent'`,
    `top.location.href='https://blocked.invalid/top'`,
    `fetch('https://blocked.invalid/fetch').catch(()=>{})`,
    `navigator.sendBeacon('https://blocked.invalid/beacon','test')`,
    `new Image().src='https://blocked.invalid/image'`,
    `new WebSocket('wss://blocked.invalid/socket')`,
    `document.open();document.write('<h1>rewritten</h1><script>location.replace("https://blocked.invalid/rewrite")</scr'+'ipt>');document.close()`,
  ];
  for (const probe of probes) {
    await mount(`<script>try{${probe}}catch{}</script><p>probe</p>`);
    await page.waitForTimeout(200);
    expect(page.url(), probe).toBe('https://asa-preview.test/parent.html');
    expect(outgoing, probe).toEqual([]);
  }
});
