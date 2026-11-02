/* global document, requestAnimationFrame, queueMicrotask, getComputedStyle */
import assert from 'node:assert/strict';
import { log } from 'node:console';
import { readFile } from 'node:fs/promises';
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
  const productionCss = await readFile('apps/web/src/electronics/workbench.css', 'utf8');
  const pulse = productionCss.slice(
    productionCss.indexOf('@keyframes workbench-simulation-running-pulse'),
    productionCss.indexOf('.workbench-toolbar-group.right .workbench-pill.simulate.running:hover'),
  );
  assert.match(pulse, /animation: workbench-simulation-running-pulse 1\.9s ease-in-out infinite/);
  const liveFixture = async (extraCss = '') => {
    await page.setContent(`<style>
      body{margin:0}button{border:0;padding:0;width:40px;height:28px}
      ${pulse}${extraCss}
      </style><div id="clip" class="workbench-toolbar-group right"
      style="overflow:hidden;width:40px;height:28px" data-time-ms="52.5">
      <button class="workbench-pill simulate running">A</button></div>`);
    // Install the very same browser-serializable helper, so mutations can run
    // in the capture's pending task rather than racing separate protocol calls.
    await page.addScriptTag({ content: observeActualIntersections.toString() });
  };
  await liveFixture();
  const live = await page.evaluate(async () => {
    const clip = document.querySelector('#clip');
    let ticks = 0;
    let running = true;
    const tick = () => {
      clip.setAttribute('data-time-ms', String(52.5 + ++ticks * 25));
      if (running) requestAnimationFrame(tick);
    };
    const shadows = [];
    const frames = [];
    try {
      requestAnimationFrame(tick);
      for (let frame = 0; frame < 3; frame++) {
        const pending = globalThis.observeActualIntersections('button');
        queueMicrotask(tick);
        const capture = await pending;
        frames.push(
          capture.read(([button], [intersection]) => {
            const rect = button.getBoundingClientRect();
            shadows.push(getComputedStyle(button).boxShadow);
            return {
              width: rect.width,
              clipWidth: intersection.width,
              owned: [
                [3, 3],
                [37, 3],
                [3, 25],
                [37, 25],
                [20, 14],
              ].map(([x, y]) => {
                const hit = document.elementFromPoint(rect.left + x, rect.top + y);
                return hit === button || button.contains(hit);
              }),
            };
          }),
        );
      }
      return { frames, ticks, shadows };
    } finally {
      running = false;
    }
  });
  assert.ok(live.ticks >= 3, 'clock updated during every pending capture');
  assert.ok(new Set(live.shadows).size > 1, 'exact production infinite pulse is moving');
  for (const frame of live.frames)
    assert.deepEqual(frame, { width: 40, clipWidth: 40, owned: Array(5).fill(true) });

  // Continuous telemetry and paint must not hide an actual clipping mutation,
  // including change-and-revert that a final geometry fingerprint cannot see.
  for (const mutation of [
    'shrink',
    'shrink-revert',
    'css-telemetry-revert',
    'css-escaped-telemetry-revert',
    'css-class-revert',
    'content',
  ]) {
    await liveFixture(
      mutation === 'css-class-revert'
        ? '.narrow{width:38px!important}'
        : mutation === 'css-escaped-telemetry-revert'
          ? '[data-time-\\6ds="77.5"]{width:38px!important}'
          : mutation === 'css-telemetry-revert'
            ? '[data-time-ms="77.5"]{width:38px!important}'
            : '',
    );
    await assert.rejects(
      page.evaluate(async (mutation) => {
        const clip = document.querySelector('#clip');
        const pending = globalThis.observeActualIntersections('button');
        queueMicrotask(() => {
          clip.setAttribute('data-time-ms', '77.5');
          if (mutation.includes('telemetry-revert')) clip.setAttribute('data-time-ms', '52.5');
          else if (mutation === 'css-class-revert') {
            clip.classList.add('narrow');
            clip.classList.remove('narrow');
          } else if (mutation === 'content') clip.querySelector('button').textContent = 'B';
          else {
            clip.style.width = '38px';
            if (mutation === 'shrink-revert') clip.style.width = '40px';
          }
        });
        const capture = await pending;
        return capture.read(() => true);
      }, mutation),
      /Actual intersection capture changed/,
      mutation,
    );
  }
  log(
    'PASS: six clipping/ownership adversaries; shrink, replacement, reorder reject stale captures; continuous clock and exact production infinite pulse retain geometry/all five native hits; live shrink/revert, CSS-dependent telemetry/revert and content mutations reject',
  );
} finally {
  await browser?.close();
  await loader.close();
}
