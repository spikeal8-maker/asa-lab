import { setTimeout } from 'node:timers';

export async function runtimeFrame(page) {
  const iframe = page.locator('#runtime-frame');
  await iframe.waitFor({ state: 'attached' });
  const frame = page.frameLocator('#runtime-frame');
  await frame.locator('[data-asa-host-shell]').waitFor({ state: 'visible' });
  return frame;
}

export async function waitForRuntimeState(frame, expected) {
  const shell = frame.locator('[data-asa-host-shell]');
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if ((await shell.getAttribute('data-runtime-state')) === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`runtime state did not reach ${expected}`);
}

export async function rejectionCount(frame) {
  return Number.parseInt(
    (await frame.locator('[data-asa-host-shell]').getAttribute('data-protocol-rejections')) ?? '0',
    10,
  );
}

export async function runtimeState(frame) {
  return frame.locator('[data-asa-host-shell]').getAttribute('data-runtime-state');
}

export async function expectRejectionIncrement(frame, before, label) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const after = await rejectionCount(frame);
    if (after > before) return after;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  const after = await rejectionCount(frame);
  const state = await runtimeState(frame);
  throw new Error(
    `${label} did not increment rejection counter: before=${before}, after=${after}, state=${state}`,
  );
}
