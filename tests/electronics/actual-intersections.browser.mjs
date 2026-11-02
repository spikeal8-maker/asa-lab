/* global document */
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { chromium } from '@playwright/test';
import { createServer } from 'vite';

// Existing TypeScript loader only; no listener, ports or application server.
const loader = await createServer({
  configFile: false,
  server: { middlewareMode: true, hmr: false, watch: null },
});
let browser;
try {
  const { observeActualIntersections } = await loader.ssrLoadModule(
    '/tests/electronics/actual-intersections.ts',
  );
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 800, height: 600 } });
  await page.route('**/*', (route) => route.abort());
  await page.setContent(`
    <style>
      body { margin: 0; }
      .clip { position: absolute; left: 20px; width: 80px; height: 40px; overflow: hidden; }
      button { box-sizing: border-box; padding: 0; border: 0; width: 40px; height: 28px; }
    </style>
    <div class="clip" style="top:20px">
      <button id="normal" style="position:absolute;left:60px;top:10px">A</button>
    </div>
    <div class="clip" style="top:100px">
      <button id="fixed" style="position:fixed;left:120px;top:110px">B</button>
    </div>
    <div class="clip" style="top:180px;transform:translateZ(0)">
      <button id="transformed" style="position:fixed;left:60px;top:10px">C</button>
    </div>
    <div class="clip" style="top:260px">
      <div style="position:fixed;left:120px;top:260px;width:50px;height:40px;overflow:hidden">
        <button id="popup-local" style="position:absolute;left:30px;top:10px">D</button>
      </div>
    </div>
    <button id="viewport" style="position:fixed;right:-20px;top:350px">E</button>
    <button id="occluded" style="position:fixed;left:120px;top:410px">F</button>
    <div style="position:fixed;left:120px;top:410px;width:40px;height:28px;background:black"></div>
  `);
  // This is exactly the function used by the production journey, not a mirror.
  const capture = await page.evaluateHandle(observeActualIntersections, 'button');
  const { intersections, controls } = await page.evaluate(
    (capture) =>
      capture.read((elements, intersections) => ({
        intersections,
        controls: elements.map((element) => {
          const rect = element.getBoundingClientRect();
          const points = [
            [rect.left + 3, rect.top + 3],
            [rect.right - 3, rect.top + 3],
            [rect.left + 3, rect.bottom - 3],
            [rect.right - 3, rect.bottom - 3],
            [rect.left + rect.width / 2, rect.top + rect.height / 2],
          ].map(([x, y]) => {
            const hit = document.elementFromPoint(x, y);
            return { x, y, owned: hit !== null && (hit === element || element.contains(hit)) };
          });
          return {
            id: element.id,
            rect: { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom },
            points,
          };
        }),
      })),
    capture,
  );
  await capture.dispose();
  const expected = [
    { id: 'normal', fits: false, right: 100 },
    { id: 'fixed', fits: true, right: 160 },
    { id: 'transformed', fits: false, right: 100 },
    { id: 'popup-local', fits: false, right: 170 },
    { id: 'viewport', fits: false, right: 800 },
    { id: 'occluded', fits: true, right: 160 },
  ];
  assert.equal(intersections.length, expected.length);
  for (const [index, control] of controls.entries()) {
    const intersection = intersections[index];
    const contract = expected[index];
    assert.equal(control.id, contract.id);
    assert.equal(intersection.right, contract.right, control.id);
    const fits =
      control.rect.left >= intersection.left - 1 &&
      control.rect.right <= intersection.right + 1 &&
      control.rect.top >= intersection.top - 1 &&
      control.rect.bottom <= intersection.bottom + 1;
    assert.equal(fits, contract.fits, control.id);
    assert.equal(control.points.length, 5);
    if (control.id === 'fixed')
      assert.equal(
        control.points.every((point) => point.owned),
        true,
      );
    else if (control.id === 'occluded')
      assert.equal(
        control.points.some((point) => point.owned),
        false,
      );
    else
      assert.equal(
        control.points.every((point) => point.owned),
        false,
      );
  }
  await page.locator('#fixed').evaluate((button) => {
    button.addEventListener('click', (event) => {
      button.setAttribute('data-trusted-click', String(event.isTrusted));
    });
  });
  await page.locator('#fixed').click();
  assert.equal(await page.locator('#fixed').getAttribute('data-trusted-click'), 'true');
  await assert.rejects(
    page.evaluate(observeActualIntersections, '.missing'),
    /No intersection targets/,
  );
  for (const mutation of ['shrink', 'replace', 'reorder']) {
    await page.setContent(
      '<style>body{margin:0}button{border:0;padding:0;width:40px;height:28px}</style><div id="clip" style="overflow:hidden;width:40px;height:28px"><button>A</button><button>B</button></div>',
    );
    const stale = await page.evaluateHandle(observeActualIntersections, 'button');
    await page.locator('#clip').evaluate((clip, mutation) => {
      if (mutation === 'shrink') clip.style.width = '38px';
      else if (mutation === 'replace')
        clip.firstElementChild.replaceWith(clip.firstElementChild.cloneNode(true));
      else clip.append(clip.firstElementChild);
    }, mutation);
    if (mutation === 'shrink') {
      const fresh = await page.evaluateHandle(observeActualIntersections, 'button');
      const proof = await page.evaluate(
        (capture) =>
          capture.read((targets, intersections) => {
            const target = targets[0];
            const rect = target.getBoundingClientRect();
            return {
              width: rect.width,
              clipWidth: intersections[0].width,
              owned: [
                [3, 3],
                [37, 3],
                [3, 25],
                [37, 25],
                [20, 14],
              ].every(([x, y]) => {
                const hit = document.elementFromPoint(x, y);
                return hit === target || target.contains(hit);
              }),
            };
          }),
        fresh,
      );
      assert.deepEqual(proof, { width: 40, clipWidth: 38, owned: true });
      await fresh.dispose();
    }
    await assert.rejects(
      page.evaluate(
        (capture) =>
          capture.read((targets, intersections) =>
            targets.map((target, index) => ({
              rect: target.getBoundingClientRect().toJSON(),
              intersection: intersections[index],
            })),
          ),
        stale,
      ),
      /Actual intersection capture changed/,
      mutation,
    );
    await stale.dispose();
  }
  log(
    'PASS: normal clip, fixed escape, transformed containing block, popup-local clip, viewport clip, occlusion; 2px ancestor shrink, replacement, reorder reject stale captures; native five-point ownership retained',
  );
} finally {
  await browser?.close();
  await loader.close();
}
