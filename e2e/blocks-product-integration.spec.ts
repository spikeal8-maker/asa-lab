import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { createHash } from 'node:crypto';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let parentOrigin: string;
let projectId: string;
let runtimeUrl: string;
const evidenceDir = 'reports/blocks/product-integration';
const barkAssetId = 'cd8fa8390b0efdd281882533fbfcfcfb';

async function realRuntimeBootstrapFixture() {
  const imageBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96"><rect width="96" height="96" rx="16" fill="#ff5f57"/><circle cx="48" cy="48" r="23" fill="#0877b3"/></svg>',
    'utf8',
  );
  const stockSoundId = '83c36d806dc92327b9e7049a565c6bff';
  const soundResponse = await fetch(`${runtimeUrl}/library-assets/${stockSoundId}.wav`);
  if (!soundResponse.ok) throw new Error('pinned Scratch bootstrap sound unavailable');
  const soundBytes = Buffer.from(await soundResponse.arrayBuffer());
  if (
    soundBytes.length <= 44 ||
    soundBytes.subarray(0, 4).toString() !== 'RIFF' ||
    soundBytes.subarray(8, 12).toString() !== 'WAVE'
  ) {
    throw new Error('pinned Scratch bootstrap sound is not canonical WAV');
  }
  soundBytes[44] = soundBytes[44]! ^ 1;
  const imageAssetId = createHash('md5').update(imageBytes).digest('hex');
  const soundAssetId = createHash('md5').update(soundBytes).digest('hex');
  const asset = (assetId: string, dataFormat: 'svg' | 'wav', bytes: Buffer) => ({
    assetId,
    dataFormat,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.byteLength,
  });
  const imageReference = asset(imageAssetId, 'svg', imageBytes);
  const soundReference = asset(soundAssetId, 'wav', soundBytes);
  const costume = (name: string) => ({
    assetId: imageAssetId,
    name,
    bitmapResolution: 1,
    md5ext: `${imageAssetId}.svg`,
    dataFormat: 'svg',
    rotationCenterX: 50,
    rotationCenterY: 50,
  });
  const projectJson = {
    targets: [
      {
        isStage: true,
        name: 'Stage',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {},
        currentCostume: 0,
        costumes: [costume('Server Bootstrap Backdrop')],
        sounds: [],
        volume: 100,
      },
      {
        isStage: false,
        name: 'Server Bootstrap Sprite',
        variables: {},
        lists: {},
        broadcasts: {},
        blocks: {
          flag: {
            opcode: 'event_whenflagclicked',
            next: 'move',
            parent: null,
            inputs: {},
            fields: {},
            shadow: false,
            topLevel: true,
            x: 70,
            y: 60,
          },
          move: {
            opcode: 'motion_movesteps',
            next: null,
            parent: 'flag',
            inputs: { STEPS: [1, [4, '8']] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        currentCostume: 0,
        costumes: [costume('Server Bootstrap Costume')],
        sounds: [
          {
            assetId: soundAssetId,
            name: 'Server Bootstrap Tone',
            dataFormat: 'wav',
            format: '',
            rate: 22050,
            sampleCount: 18688,
            md5ext: `${soundAssetId}.wav`,
          },
        ],
        volume: 100,
        visible: true,
        x: 37,
        y: -11,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.1.0', agent: 'ASA Lab browser test' },
  };
  return {
    projectJson,
    assets: [imageReference, soundReference],
    runtimeAssets: new Map([
      [`${imageAssetId}.svg`, { body: imageBytes, contentType: 'image/svg+xml' }],
      [`${soundAssetId}.wav`, { body: soundBytes, contentType: 'audio/wav' }],
    ]),
    imageAssetId,
    soundAssetId,
  };
}

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin, projectId, runtimeUrl } = await import('../tools/blocks/browser/protocol.mjs'));
  fs.mkdirSync(evidenceDir, { recursive: true });
});

type CapturedBlocksMessage = {
  messageType?: string;
  protocolVersion?: number;
  projectId?: string;
  sessionNonce?: string;
  requestId?: string;
  ok?: boolean;
  reason?: string | null;
  revision?: number;
  generation?: number;
  snapshotGeneration?: number;
  savedGeneration?: number;
};

async function installBlocksMessageCapture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    const state = window as unknown as { __asaBlocksTestMessages?: unknown[] };
    state.__asaBlocksTestMessages = [];
    window.addEventListener('message', (event) => {
      const message = event.data as { messageType?: unknown } | null;
      if (
        typeof message?.messageType === 'string' &&
        message.messageType.startsWith('ASA_BLOCKS_')
      ) {
        state.__asaBlocksTestMessages?.push(message);
      }
    });
  });
}

async function explicitFlush(
  page: import('@playwright/test').Page,
  requestId: string,
): Promise<CapturedBlocksMessage> {
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const messages =
          (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
            .__asaBlocksTestMessages ?? [];
        return messages.some(
          (message) =>
            message.messageType === 'ASA_BLOCKS_STATUS' &&
            (message as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
        );
      }),
    )
    .toBe(true);

  const binding = await page.evaluate(() => {
    const messages =
      (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
        .__asaBlocksTestMessages ?? [];
    const message = [...messages]
      .reverse()
      .find(
        (candidate) =>
          candidate.messageType === 'ASA_BLOCKS_STATUS' &&
          (candidate as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
      );
    if (
      !message ||
      typeof message.protocolVersion !== 'number' ||
      typeof message.projectId !== 'string' ||
      typeof message.sessionNonce !== 'string'
    ) {
      return null;
    }
    return {
      protocolVersion: message.protocolVersion,
      projectId: message.projectId,
      sessionNonce: message.sessionNonce,
    };
  });
  if (!binding) throw new Error('accepted child binding was not observed');

  await page.evaluate(
    ({ binding: activeBinding, requestId: activeRequestId, targetOrigin }) => {
      const frame = document.querySelector<HTMLIFrameElement>('iframe[title="Scratch runtime"]');
      if (!frame?.contentWindow) throw new Error('Scratch runtime iframe unavailable');
      frame.contentWindow.postMessage(
        {
          ...activeBinding,
          messageType: 'ASA_BLOCKS_FLUSH_REQUEST',
          requestId: activeRequestId,
        },
        targetOrigin,
      );
    },
    { binding, requestId, targetOrigin: runtimeUrl },
  );

  await expect
    .poll(async () =>
      page.evaluate((targetRequestId) => {
        const messages =
          (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
            .__asaBlocksTestMessages ?? [];
        return messages.some(
          (message) =>
            message.messageType === 'ASA_BLOCKS_FLUSH_RESULT' &&
            message.requestId === targetRequestId,
        );
      }, requestId),
    )
    .toBe(true);

  return await page.evaluate((targetRequestId) => {
    const messages =
      (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
        .__asaBlocksTestMessages ?? [];
    return (
      [...messages]
        .reverse()
        .find(
          (message) =>
            message.messageType === 'ASA_BLOCKS_FLUSH_RESULT' &&
            message.requestId === targetRequestId,
        ) ?? {}
    );
  }, requestId);
}

async function setServerSteps(
  frame: import('@playwright/test').FrameLocator,
  fromValue: string,
  toValue: string,
): Promise<void> {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }).click();
  const program = frame.locator('.blocklyBlockCanvas').first();
  await program.getByText(fromValue, { exact: true }).dblclick();
  const numberField = frame.locator('.blocklyHtmlInput:focus');
  await expect(numberField).toHaveValue(fromValue);
  await numberField.fill(toValue);
  await numberField.press('Enter');
  await expect(program.getByText(toValue, { exact: true })).toBeVisible();
}

async function editLiveServerProjectAndAddMedia(
  frame: import('@playwright/test').FrameLocator,
): Promise<void> {
  await setServerSteps(frame, '8', '37');

  await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
  await frame.getByText('Abby', { exact: true }).click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');

  await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
  await frame.getByText('Bark', { exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
}

test('shipping fullscreen host loads the account avatar in ASA only and survives runtime failure', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  fixture.context.on('request', (request) => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const account = page.locator('[data-asa-blocks-account-overlay]');
    const avatar = account.locator('img');
    await expect(account).toHaveAccessibleName('Открыть аккаунт: Scratch acceptance account');
    await expect(avatar).toHaveAttribute('src', fixture.avatarDataUrl ?? 'missing-avatar');
    await expect
      .poll(() => avatar.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await expect(account.locator('.blocks-editor-account-initials')).toHaveCount(0);
    await expect(frame.locator('[data-asa-blocks-account-overlay]')).toHaveCount(0);
    await expect(page.locator('.portal-shell, .portal-header')).toHaveCount(0);
    await expect(frame.locator('header[role="banner"]')).toHaveCount(1);
    await expect(frame.locator('#logo_img')).toHaveAttribute(
      'src',
      '/asa-lab-scratch-wordmark.svg',
    );
    for (const size of [
      { width: 1440, height: 960 },
      { width: 1024, height: 768 },
    ]) {
      await page.setViewportSize(size);
      await expect
        .poll(async () => page.locator('[data-asa-blocks-fullscreen]').boundingBox())
        .toEqual({ x: 0, y: 0, ...size });
      await expect(page.getByRole('status')).toHaveCount(0);
      await expect
        .poll(async () => page.locator('iframe').boundingBox())
        .toEqual({ x: 0, y: 0, width: size.width, height: size.height });
    }
    await expect(page.getByRole('status')).toHaveCount(0);
    await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
    await page.screenshot({ path: `${evidenceDir}/01-shipping-host-account.png` });
    await account.click();
    await expect(page).toHaveURL(`${parentOrigin}/product#/account`);
    const updatedAvatar = fixture.updatedAvatarDataUrl;
    await page.evaluate((src) => {
      window.dispatchEvent(new CustomEvent('asa-profile-avatar-changed', { detail: src }));
    }, updatedAvatar);
    await expect(avatar).toHaveAttribute('src', updatedAvatar ?? 'missing-avatar');
    expect(requests).toContain(`${parentOrigin}/api/account/avatar`);
    expect(requests.filter((url) => url.startsWith(`${runtimeUrl}/api/account`))).toEqual([]);
    expect(
      requests.filter(
        (url) => /^https?:/.test(url) && ![parentOrigin, runtimeUrl].includes(new URL(url).origin),
      ),
    ).toEqual([]);
    await page.screenshot({ path: `${evidenceDir}/02-updated-account.png` });
    await frame.locator('body').evaluate(() => {
      window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
    });
    await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime');
    await expect(account).toBeVisible();
    await expect(avatar).toBeVisible();
    await page.screenshot({ path: `${evidenceDir}/03-parent-survives-failure.png` });
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    fs.writeFileSync(`${evidenceDir}/network.json`, JSON.stringify({ requests }, null, 2));
    await fixture.close();
  }
});

test('missing library files return HTTP 404 instead of a successful SPA document', async ({
  request,
}) => {
  for (const path of [
    '/library-assets/00000000000000000000000000000000.svg',
    '/library-assets/11111111-1111-4111-8111-111111111111.json',
  ]) {
    const response = await request.get(`${runtimeUrl}${path}`);
    expect(response.status()).toBe(404);
    expect(await response.text()).not.toContain('data-asa-scratch-host');
  }
});

// A successful HTTP response is insufficient: the storage adapter checks MIME.
test('stock WAV is served as audio and retains the pinned sound bytes', async ({ request }) => {
  const response = await request.get(`${runtimeUrl}/library-assets/${barkAssetId}.wav`);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toBe('audio/wav');
  const bytes = await response.body();
  expect(bytes.subarray(0, 4).toString()).toBe('RIFF');
  expect(bytes.subarray(8, 12).toString()).toBe('WAVE');
  expect(createHash('md5').update(bytes).digest('hex')).toBe(barkAssetId);
});

test('runtime-session opens the real server project and reads declared costume and sound assets', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const page = await fixture.context.newPage();
  const requests: string[] = [];
  fixture.context.on('request', (request) => requests.push(request.url()));
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expect(shell).toHaveAttribute('data-draft-revision', '23');

    const serverSprite = frame.getByRole('button', {
      name: 'Server Bootstrap Sprite',
      exact: true,
    });
    await expect(serverSprite).toBeVisible();
    await serverSprite.click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue(
      'Server Bootstrap Sprite',
    );
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('37');
    await expect(frame.getByText('Fixture Cat', { exact: true })).toHaveCount(0);
    await expect(
      frame.locator('[class*="monitor_label"]').filter({ hasText: 'Ticks' }),
    ).toHaveCount(0);
    await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Server Bootstrap Costume', { exact: true }),
    ).toBeVisible();
    const costumeImage = serverSprite.locator('img').first();
    await expect
      .poll(() => costumeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);

    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await frame
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Server Bootstrap Tone', { exact: true })
      .click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue(
      'Server Bootstrap Tone',
    );

    expect(fixture.runtimeAssetEvidence).toHaveLength(2);
    expect(fixture.runtimeAssetEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          assetFile: `${serverProject.imageAssetId}.svg`,
          authorizationOk: true,
          cookiePresent: false,
          urlHasCapability: false,
          originOk: true,
        }),
        expect.objectContaining({
          assetFile: `${serverProject.soundAssetId}.wav`,
          authorizationOk: true,
          cookiePresent: false,
          urlHasCapability: false,
          originOk: true,
        }),
      ]),
    );
    expect(
      requests.some((url) =>
        url.includes(
          `/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/assets/${serverProject.imageAssetId}.svg`,
        ),
      ),
    ).toBe(true);
    expect(
      requests.some((url) =>
        url.includes(
          `/api/blocks/runtime/projects/11111111-1111-4111-8111-111111111111/assets/${serverProject.soundAssetId}.wav`,
        ),
      ),
    ).toBe(true);
    expect(requests.some((url) => url.includes('fixture.1.signature'))).toBe(false);
    expect(fixture.pageErrors).toEqual([]);
    await page.screenshot({ path: `${evidenceDir}/real-runtime-bootstrap.png` });
  } finally {
    await fixture.close();
  }
});

test('long-lived editor rotates capability in place and upstream autosaves with the refreshed bearer', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    runtimeSessionExpiresAt: (sequence: number) =>
      Math.floor(Date.now() / 1000) + (sequence === 1 ? 62 : 600),
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  let runtimeNavigations = 0;
  page.on('framenavigated', (navigated) => {
    if (navigated.url().startsWith(runtimeUrl)) runtimeNavigations += 1;
  });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    expect(fixture.getRuntimeSessionSequence()).toBe(1);
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);

    const initialBinding = await page.evaluate(() => {
      const messages =
        (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
          .__asaBlocksTestMessages ?? [];
      return messages.find(
        (message) =>
          message.messageType === 'ASA_BLOCKS_STATUS' &&
          (message as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
      );
    });
    if (!initialBinding?.sessionNonce) throw new Error('initial runtime binding unavailable');

    await frame.locator('body').evaluate(() => {
      (
        window as unknown as { __asaCapabilityRefreshMarker?: string }
      ).__asaCapabilityRefreshMarker = 'same-runtime-realm';
    });
    await setServerSteps(frame, '8', '37');

    await expect.poll(() => fixture.getRuntimeSessionSequence(), { timeout: 10_000 }).toBe(2);
    expect(
      await frame
        .locator('body')
        .evaluate(
          () =>
            (window as unknown as { __asaCapabilityRefreshMarker?: string })
              .__asaCapabilityRefreshMarker,
        ),
    ).toBe('same-runtime-realm');
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('37', { exact: true }),
    ).toBeVisible();

    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    expect(fixture.runtimeDraftEvidence[0].authorizationOk).toBe(true);
    expect(
      fixture.runtimeDraftEvidence[0].body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('37');

    const messages = await page.evaluate(
      () =>
        (window as unknown as { __asaBlocksTestMessages?: CapturedBlocksMessage[] })
          .__asaBlocksTestMessages ?? [],
    );
    const readyMessages = messages.filter(
      (message) =>
        message.messageType === 'ASA_BLOCKS_STATUS' &&
        (message as CapturedBlocksMessage & { status?: string }).status === 'editor-ready',
    );
    const dirtyMessages = messages.filter(
      (message) =>
        message.messageType === 'ASA_BLOCKS_STATUS' &&
        (message as CapturedBlocksMessage & { status?: string }).status === 'project-dirty',
    );
    expect(readyMessages.length).toBeGreaterThanOrEqual(1);
    expect(
      readyMessages.every((message) => message.sessionNonce === initialBinding.sessionNonce),
    ).toBe(true);
    expect(dirtyMessages.length).toBeGreaterThan(0);
    expect(
      dirtyMessages.every((message) => message.sessionNonce === initialBinding.sessionNonce),
    ).toBe(true);
    expect(messages.some((message) => message.messageType === 'ASA_BLOCKS_FLUSH_RESULT')).toBe(
      false,
    );
    expect(runtimeNavigations).toBe(1);

    await setServerSteps(frame, '37', '41');
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(2);
    const latestDraft = fixture.runtimeDraftEvidence.at(-1);
    expect(
      latestDraft.body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('41');
    expect(latestDraft.authorizationOk).toBe(true);
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('41', { exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test('edit during in-flight upstream autosave persists the latest generation', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const runtimeDraftPath = `/api/blocks/runtime/projects/${projectId}/draft`;
  let releaseResponse!: () => void;
  let markCommitted!: () => void;
  const release = new Promise<void>((resolve) => {
    releaseResponse = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    markCommitted = resolve;
  });
  await fixture.context.route(
    (url) => url.pathname === runtimeDraftPath,
    async (route, request) => {
      if (request.method() !== 'PUT') {
        await route.continue();
        return;
      }
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      await response.body();
      markCommitted();
      await release;
      await route.fulfill({ response });
    },
  );

  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);

    await setServerSteps(frame, '8', '37');
    await committed;
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.getServerRevision()).toBe(24);

    await setServerSteps(frame, '37', '41');
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    releaseResponse();

    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(2);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);

    const finalDraft = fixture.runtimeDraftEvidence.at(-1);
    expect(
      finalDraft.body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ).blocks.move.inputs.STEPS[1][1],
    ).toBe('41');
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('41', { exact: true }),
    ).toBeVisible();
  } finally {
    releaseResponse();
    await fixture.close();
  }
});

test('explicit FLUSH fingerprints canonical state, no-ops unchanged work and advances only new edits', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  try {
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });

    const p0 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(fixture.runtimeWriteEvents).toEqual([]);

    await editLiveServerProjectAndAddMedia(frame);
    expect(fixture.runtimeWriteEvents).toEqual([]);

    const first = await explicitFlush(page, 'browser-save-first');
    expect(first).toMatchObject({
      messageType: 'ASA_BLOCKS_FLUSH_RESULT',
      requestId: 'browser-save-first',
      ok: true,
      revision: 24,
      reason: null,
    });
    await expect(shell).toHaveAttribute('data-draft-revision', '24');

    const p1 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p1.assetRequests - p0.assetRequests).toBeGreaterThan(0);
    expect(p1.uploadedBytes - p0.uploadedBytes).toBeGreaterThan(0);
    expect(p1.uniqueAssetBytes - p0.uniqueAssetBytes).toBeGreaterThan(0);
    expect(p1.blobRows - p0.blobRows).toBeGreaterThan(0);
    expect(p1.aliasRows - p0.aliasRows).toBeGreaterThan(0);
    expect(p1.draftRequests - p0.draftRequests).toBe(1);
    expect(p1.revisionCommits - p0.revisionCommits).toBe(1);
    expect(p1.serverRevision - p0.serverRevision).toBe(1);

    expect(
      fixture.runtimeAssetPutEvidence.some(
        (item) =>
          item.assetFile === `${serverProject.imageAssetId}.svg` ||
          item.assetFile === `${serverProject.soundAssetId}.wav`,
      ),
    ).toBe(false);
    expect(
      fixture.runtimeAssetPutEvidence.some((item) => item.assetFile === `${barkAssetId}.wav`),
    ).toBe(true);
    expect(
      fixture.runtimeAssetPutEvidence.every(
        (item) =>
          item.authorizationOk &&
          !item.cookiePresent &&
          !item.urlHasCapability &&
          item.originOk &&
          item.identityOk &&
          item.contentTypeOk,
      ),
    ).toBe(true);

    const firstDraft = fixture.runtimeDraftEvidence[0];
    expect(firstDraft.body.baseRevision).toBe(23);
    expect(firstDraft.body.mutationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    const savedServerSprite = firstDraft.body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedServerSprite.blocks.move.inputs.STEPS[1][1]).toBe('37');
    expect(
      firstDraft.body.document.projectJson.targets.some(
        (target: { name?: string }) => target.name === 'Abby',
      ),
    ).toBe(true);
    expect(
      firstDraft.body.document.projectJson.targets.some(
        (target: { sounds?: { name?: string }[] }) =>
          target.sounds?.some((sound) => sound.name === 'Bark'),
      ),
    ).toBe(true);

    const firstRefs = firstDraft.body.document.assets as Array<{
      assetId: string;
      dataFormat: string;
      sha256: string;
      sizeBytes: number;
    }>;
    expect(
      new Set(firstRefs.map((reference) => `${reference.assetId}.${reference.dataFormat}`)).size,
    ).toBe(firstRefs.length);
    expect(
      fixture.runtimeAssetPutEvidence.every((item) =>
        firstRefs.some(
          (reference) =>
            `${reference.assetId}.${reference.dataFormat}` === item.assetFile &&
            reference.sha256 === item.sha256 &&
            reference.sizeBytes === item.sizeBytes,
        ),
      ),
    ).toBe(true);

    const writesBeforeNoop = fixture.runtimeWriteEvents.length;
    const draftsBeforeNoop = fixture.runtimeDraftEvidence.length;
    const unchanged = await explicitFlush(page, 'browser-save-unchanged');
    expect(unchanged).toMatchObject({
      requestId: 'browser-save-unchanged',
      ok: true,
      revision: 24,
      reason: null,
    });
    const p2 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p2).toEqual(p1);
    expect(fixture.runtimeWriteEvents).toHaveLength(writesBeforeNoop);
    expect(fixture.runtimeDraftEvidence).toHaveLength(draftsBeforeNoop);
    await expect(shell).toHaveAttribute('data-draft-revision', '24');

    await setServerSteps(frame, '37', '41');
    const editedAgain = await explicitFlush(page, 'browser-save-new-edit');
    expect(editedAgain).toMatchObject({
      requestId: 'browser-save-new-edit',
      ok: true,
      revision: 25,
      reason: null,
    });
    const p3 = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(p3.assetRequests - p2.assetRequests).toBe(0);
    expect(p3.uploadedBytes - p2.uploadedBytes).toBe(0);
    expect(p3.uniqueAssetBytes - p2.uniqueAssetBytes).toBe(0);
    expect(p3.blobRows - p2.blobRows).toBe(0);
    expect(p3.aliasRows - p2.aliasRows).toBe(0);
    expect(p3.draftRequests - p2.draftRequests).toBe(1);
    expect(p3.revisionCommits - p2.revisionCommits).toBe(1);
    expect(p3.serverRevision - p2.serverRevision).toBe(1);
    expect(fixture.runtimeDraftEvidence.at(-1).body.mutationId).not.toBe(
      firstDraft.body.mutationId,
    );
    expect(fixture.runtimeDraftEvidence.at(-1).body.baseRevision).toBe(24);
    await expect(shell).toHaveAttribute('data-draft-revision', '25');

    fs.writeFileSync(
      `${evidenceDir}/explicit-flush-p0-p3.json`,
      JSON.stringify(
        {
          p0,
          p1,
          p2,
          p3,
          firstSave: {
            assetRequests: p1.assetRequests - p0.assetRequests,
            uploadedBytes: p1.uploadedBytes - p0.uploadedBytes,
            uniqueAssetBytes: p1.uniqueAssetBytes - p0.uniqueAssetBytes,
            blobRowDelta: p1.blobRows - p0.blobRows,
            aliasRowDelta: p1.aliasRows - p0.aliasRows,
            draftRequests: p1.draftRequests - p0.draftRequests,
            revisionDelta: p1.serverRevision - p0.serverRevision,
          },
          unchanged: {
            assetRequests: p2.assetRequests - p1.assetRequests,
            uploadedBytes: p2.uploadedBytes - p1.uploadedBytes,
            uniqueAssetBytes: p2.uniqueAssetBytes - p1.uniqueAssetBytes,
            blobRowDelta: p2.blobRows - p1.blobRows,
            aliasRowDelta: p2.aliasRows - p1.aliasRows,
            draftRequests: p2.draftRequests - p1.draftRequests,
            revisionDelta: p2.serverRevision - p1.serverRevision,
          },
          newEdit: {
            assetRequests: p3.assetRequests - p2.assetRequests,
            uploadedBytes: p3.uploadedBytes - p2.uploadedBytes,
            uniqueAssetBytes: p3.uniqueAssetBytes - p2.uniqueAssetBytes,
            blobRowDelta: p3.blobRows - p2.blobRows,
            aliasRowDelta: p3.aliasRows - p2.aliasRows,
            draftRequests: p3.draftRequests - p2.draftRequests,
            revisionDelta: p3.serverRevision - p2.serverRevision,
          },
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('lost draft response followed by edit reconciles A before saving B without duplicate assets', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const runtimeDraftPath = `/api/blocks/runtime/projects/${projectId}/draft`;
  let loseFirstDraftResponse = true;
  await fixture.context.route(
    (url) => loseFirstDraftResponse && url.pathname === runtimeDraftPath,
    async (route, request) => {
      if (request.method() !== 'PUT') {
        await route.continue();
        return;
      }
      loseFirstDraftResponse = false;
      const committedResponse = await route.fetch();
      expect(committedResponse.status()).toBe(200);
      await committedResponse.body();
      await route.abort('failed');
    },
  );
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);

    const first = await explicitFlush(page, 'browser-lost-first');
    expect(first).toMatchObject({
      requestId: 'browser-lost-first',
      ok: false,
      reason: 'draft_write_failed',
    });
    expect(first.revision).toBeUndefined();
    const afterLost = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(afterLost.revisionCommits).toBe(1);
    expect(afterLost.serverRevision).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    const firstMutation = fixture.runtimeDraftEvidence[0].body;
    const assetRequestsBeforeRetry = afterLost.assetRequests;
    const uploadedBytesBeforeRetry = afterLost.uploadedBytes;
    const uniqueBytesBeforeRetry = afterLost.uniqueAssetBytes;
    const blobRowsBeforeRetry = afterLost.blobRows;
    const aliasRowsBeforeRetry = afterLost.aliasRows;
    await expect(shell).toHaveAttribute('data-draft-revision', '23');

    await setServerSteps(frame, '37', '41');
    const reconciledAndSaved = await explicitFlush(page, 'browser-lost-edit-reconcile');
    expect(reconciledAndSaved).toMatchObject({
      requestId: 'browser-lost-edit-reconcile',
      ok: true,
      revision: 25,
      reason: null,
    });
    expect(fixture.runtimeDraftEvidence).toHaveLength(3);
    const replayMutation = fixture.runtimeDraftEvidence[1].body;
    const generationB = fixture.runtimeDraftEvidence[2].body;
    expect(replayMutation.mutationId).toBe(firstMutation.mutationId);
    expect(replayMutation.baseRevision).toBe(23);
    expect(firstMutation.baseRevision).toBe(23);
    expect(replayMutation.document).toEqual(firstMutation.document);
    expect(generationB.mutationId).not.toBe(firstMutation.mutationId);
    expect(generationB.baseRevision).toBe(24);
    expect(
      generationB.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      )?.blocks.move.inputs.STEPS[1][1],
    ).toBe('41');

    const afterReplayAndB = {
      ...fixture.runtimePersistenceMetrics,
      serverRevision: fixture.getServerRevision(),
    };
    expect(afterReplayAndB.assetRequests).toBe(assetRequestsBeforeRetry);
    expect(afterReplayAndB.uploadedBytes).toBe(uploadedBytesBeforeRetry);
    expect(afterReplayAndB.uniqueAssetBytes).toBe(uniqueBytesBeforeRetry);
    expect(afterReplayAndB.blobRows).toBe(blobRowsBeforeRetry);
    expect(afterReplayAndB.aliasRows).toBe(aliasRowsBeforeRetry);
    expect(afterReplayAndB.revisionCommits).toBe(2);
    expect(afterReplayAndB.idempotentReplays).toBe(1);
    expect(afterReplayAndB.serverRevision).toBe(25);
    expect(new Set(fixture.runtimeDraftEvidence.map((entry) => entry.body.mutationId)).size).toBe(
      2,
    );
    await expect(shell).toHaveAttribute('data-draft-revision', '25');

    fs.writeFileSync(
      `${evidenceDir}/lost-response-edit-reconciliation.json`,
      JSON.stringify(
        {
          logicalMutations: 2,
          generationA: {
            mutationId: firstMutation.mutationId,
            baseRevision: firstMutation.baseRevision,
            replayMutationId: replayMutation.mutationId,
            replayBaseRevision: replayMutation.baseRevision,
          },
          generationB: {
            mutationId: generationB.mutationId,
            baseRevision: generationB.baseRevision,
          },
          draftRequests: afterReplayAndB.draftRequests,
          revisionCommits: afterReplayAndB.revisionCommits,
          idempotentReplays: afterReplayAndB.idempotentReplays,
          revisionDelta: afterReplayAndB.serverRevision - 23,
          assetRequestsAfterAmbiguity: afterReplayAndB.assetRequests - assetRequestsBeforeRetry,
          uploadedBytesAfterAmbiguity: afterReplayAndB.uploadedBytes - uploadedBytesBeforeRetry,
          uniqueAssetBytesAfterAmbiguity: afterReplayAndB.uniqueAssetBytes - uniqueBytesBeforeRetry,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('server revision movement returns explicit conflict without overwrite or automatic retry', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await setServerSteps(frame, '8', '37');
    expect(fixture.runtimeWriteEvents).toEqual([]);
    expect(fixture.advanceServerRevision()).toBe(24);

    const result = await explicitFlush(page, 'browser-revision-conflict');
    expect(result).toMatchObject({
      requestId: 'browser-revision-conflict',
      ok: false,
      reason: 'revision_conflict',
    });
    expect(result.revision).toBeUndefined();
    expect(fixture.runtimePersistenceMetrics.assetRequests).toBe(0);
    expect(fixture.runtimePersistenceMetrics.draftRequests).toBe(1);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(0);
    expect(fixture.runtimePersistenceMetrics.externalRevisionAdvances).toBe(1);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    await expect(shell).toHaveAttribute('data-draft-revision', '23');

    fs.writeFileSync(
      `${evidenceDir}/revision-conflict.json`,
      JSON.stringify(
        {
          reason: result.reason,
          clientConfirmedRevision: 23,
          serverRevision: fixture.getServerRevision(),
          draftRequests: fixture.runtimePersistenceMetrics.draftRequests,
          clientRevisionCommits: fixture.runtimePersistenceMetrics.revisionCommits,
          automaticRetries: 0,
        },
        null,
        2,
      ),
    );
  } finally {
    await fixture.close();
  }
});

test('asset PUT failure returns failed FLUSH and does not issue draft PUT', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    assetWriteStatus: 503,
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    expect(fixture.runtimeWriteEvents).toEqual([]);

    const result = await explicitFlush(page, 'browser-asset-failure');
    expect(result).toMatchObject({
      requestId: 'browser-asset-failure',
      ok: false,
      reason: 'asset_write_failed',
    });
    expect(result.revision).toBeUndefined();
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(1);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    expect(fixture.runtimeWriteEvents).toHaveLength(1);
    expect(fixture.runtimeWriteEvents[0]?.kind).toBe('asset-put');
    await expect(shell).toHaveAttribute('data-draft-revision', '23');
  } finally {
    await fixture.close();
  }
});

test('draft PUT failure never produces false save success or advances confirmed revision', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    draftWriteStatus: 409,
  });
  const page = await fixture.context.newPage();
  await installBlocksMessageCapture(page);
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await editLiveServerProjectAndAddMedia(frame);
    expect(fixture.runtimeWriteEvents).toEqual([]);

    const result = await explicitFlush(page, 'browser-draft-failure');
    expect(result).toMatchObject({
      requestId: 'browser-draft-failure',
      ok: false,
      reason: 'draft_write_failed',
    });
    expect(result.revision).toBeUndefined();
    expect(fixture.runtimeAssetPutEvidence.length).toBeGreaterThan(0);
    expect(fixture.runtimeDraftEvidence).toHaveLength(1);
    expect(fixture.runtimeWriteEvents.at(-1)).toEqual({ kind: 'draft-put' });
    expect(
      fixture.runtimeWriteEvents.slice(0, -1).every((event) => event.kind === 'asset-put'),
    ).toBe(true);
    await expect(shell).toHaveAttribute('data-draft-revision', '23');
  } finally {
    await fixture.close();
  }
});

// Regression #256: text presence alone missed two overlapping live regions.
test('ready editor has no footer; connection error stays actionable outside the frame', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'ru-RU' });
  const page = await fixture.context.newPage();
  const directory = `${evidenceDir}/status-layout`;
  fs.mkdirSync(directory, { recursive: true });
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    for (const state of ['ready', 'error']) {
      if (state === 'error') {
        await frame.locator('body').evaluate(() => {
          window.dispatchEvent(new ErrorEvent('error', { message: 'protocol-fixture-fatal' }));
        });
        await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime');
      }
      for (const size of [
        { width: 1440, height: 960 },
        { width: 1024, height: 768 },
        { width: 390, height: 844 },
        { width: 320, height: 720 },
      ]) {
        await page.setViewportSize(size);
        const status = page.getByRole('status');
        const iframe = await page.locator('iframe[title="Scratch runtime"]').boundingBox();
        expect(iframe).not.toBeNull();
        expect(iframe!.x).toBe(0);
        expect(iframe!.y).toBe(0);
        expect(iframe!.width).toBe(size.width);
        await expect(frame.locator('#runtime-status')).toBeHidden();
        if (state === 'ready') {
          await expect(status).toHaveCount(0);
          expect(iframe!.height).toBeCloseTo(size.height, 1);
          await expect(page.locator('.blocks-editor-connection-status')).toHaveCount(0);
        } else {
          await expect(status).toHaveCount(1);
          await expect(status).toContainText('Ошибка Scratch runtime');
          await expect(page.getByRole('button', { name: 'Повторить подключение' })).toBeVisible();
          const footer = await status.boundingBox();
          expect(footer).not.toBeNull();
          expect(iframe!.y + iframe!.height).toBeLessThanOrEqual(footer!.y);
          expect(iframe!.height + footer!.height).toBeCloseTo(size.height, 1);
          expect(
            await status.evaluate(
              (element) =>
                element.scrollWidth <= element.clientWidth &&
                element.scrollHeight <= element.clientHeight,
            ),
          ).toBe(true);
        }
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= document.documentElement.clientWidth,
          ),
        ).toBe(true);
        await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
        await page.screenshot({ path: `${directory}/${state}-${size.width}.png` });
      }
    }
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('status presentation opt-in cannot hide local errors before accepted INIT', async () => {
  const fixture = await createProtocolFixture();
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${runtimeUrl}/?asaStatus=parent`, { waitUntil: 'domcontentloaded' });
    await expect(page.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-runtime-state',
      'awaiting-init',
    );
    await expect(page.locator('#runtime-status')).toBeVisible();
    await expect(page.locator('#runtime-status')).toContainText('Ожидание безопасного подключения');
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('native File New resets the same managed ASA project and reopens the Scratch default', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  try {
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: {
        draftRevision: 23,
        projectJson: serverProject.projectJson,
        assets: serverProject.assets,
      },
      runtimeAssets: serverProject.runtimeAssets,
    });
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });

    await setServerSteps(frame, '8', '37');
    await expect(frame.getByText('Save Now', { exact: true })).toHaveCount(0);
    await frame.getByText('File', { exact: true }).click();
    await expect(frame.getByText('Save now', { exact: true })).toHaveCount(0);
    await expect(frame.getByText('Save to your computer', { exact: true })).toBeVisible();
    await frame.getByText('File', { exact: true }).click();

    await expect.poll(() => fixture?.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    expect(fixture.getServerRevision()).toBe(24);
    const editedDraft = fixture.runtimeDraftEvidence[0]!.body.document.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(editedDraft.blocks.move.inputs.STEPS[1][1]).toBe('37');

    page.once('dialog', async (confirmation) => {
      expect(confirmation.type()).toBe('confirm');
      expect(confirmation.message()).toBe('Replace contents of the current project?');
      await confirmation.accept();
    });
    await frame.getByText('File', { exact: true }).click();
    await frame.getByText('New', { exact: true }).click();

    await expect(
      frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }),
    ).toHaveCount(0);
    await expect(frame.getByText('Could not find project', { exact: false })).toHaveCount(0);
    await expect.poll(() => fixture?.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(2);
    expect(fixture.getServerRevision()).toBe(25);
    const resetDocument = fixture.runtimeDraftEvidence.at(-1)!.body.document;
    expect(
      resetDocument.projectJson.targets.some(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      ),
    ).toBe(false);
    const resetSprite = resetDocument.projectJson.targets.find(
      (target: { isStage?: boolean }) => target.isStage === false,
    );
    const resetSpriteName = resetSprite?.name;
    expect(resetSpriteName).toEqual(expect.any(String));
    if (typeof resetSpriteName !== 'string') throw new Error('default Scratch sprite name missing');
    expect(resetSprite?.costumes?.map((costume: { assetId?: string }) => costume.assetId)).toEqual([
      'bcf454acf82e4504149f7ffe07081dbc',
      '0fb9be3e8397c983338cb71dc84d0b25',
    ]);
    expect(resetSprite?.sounds?.map((sound: { assetId?: string }) => sound.assetId)).toEqual([
      '83c36d806dc92327b9e7049a565c6bff',
    ]);
    expect(
      resetDocument.projectJson.targets.some((target: { blocks?: Record<string, unknown> }) =>
        Object.values(target.blocks ?? {}).some(
          (block) =>
            typeof block === 'object' && block !== null && JSON.stringify(block).includes('"37"'),
        ),
      ),
    ).toBe(false);
    expect(fixture.pageErrors).toEqual([]);

    const reopenedSession = {
      draftRevision: fixture.getServerRevision(),
      projectJson: resetDocument.projectJson,
      assets: resetDocument.assets,
    };
    await fixture.close();
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: reopenedSession,
      runtimeAssets: serverProject.runtimeAssets,
    });
    const reopened = await fixture.context.newPage();
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(
      frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }),
    ).toHaveCount(0);
    await expect(frame.getByRole('button', { name: resetSpriteName, exact: true })).toBeVisible();
    await expect(frame.getByText('Could not find project', { exact: false })).toHaveCount(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture?.close();
  }
});

test('dirty Home waits for upstream durable save and a fresh browser reopens the saved value', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  try {
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: {
        draftRevision: 23,
        projectJson: serverProject.projectJson,
        assets: serverProject.assets,
      },
      runtimeAssets: serverProject.runtimeAssets,
    });
    const page = await fixture.context.newPage();
    let draftSeenResolve: (() => void) | undefined;
    const draftSeen = new Promise<void>((resolve) => {
      draftSeenResolve = resolve;
    });
    let releaseDraftResolve: (() => void) | undefined;
    const releaseDraft = new Promise<void>((resolve) => {
      releaseDraftResolve = resolve;
    });
    await fixture.context.route(
      `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`,
      async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        draftSeenResolve?.();
        await releaseDraft;
        await route.continue();
      },
    );

    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await setServerSteps(frame, '8', '73');
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await page.getByRole('button', { name: 'ASA Lab — на главную', exact: true }).click();
    await draftSeen;
    expect(page.url()).toBe(`${parentOrigin}/product`);
    expect(fixture.getServerRevision()).toBe(23);
    releaseDraftResolve?.();

    await expect.poll(() => fixture?.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    const savedDocument = fixture.runtimeDraftEvidence.at(-1)!.body.document;
    const savedSprite = savedDocument.projectJson.targets.find(
      (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
    );
    expect(savedSprite.blocks.move.inputs.STEPS[1][1]).toBe('73');

    const reopenedSession = {
      draftRevision: fixture.getServerRevision(),
      projectJson: savedDocument.projectJson,
      assets: savedDocument.assets,
    };
    await fixture.close();
    fixture = await createProtocolFixture({
      product: true,
      locale: 'en-US',
      runtimeSession: reopenedSession,
      runtimeAssets: serverProject.runtimeAssets,
    });
    const reopened = await fixture.context.newPage();
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await frame.getByRole('button', { name: 'Server Bootstrap Sprite', exact: true }).click();
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('73', { exact: true }),
    ).toBeVisible();
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture?.close();
  }
});

test('dirty Home stays in the editor when upstream draft save fails', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    draftWriteStatus: 503,
  });
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await setServerSteps(frame, '8', '74');
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await page.getByRole('button', { name: 'ASA Lab — на главную', exact: true }).click();
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    await expect(page).toHaveURL(`${parentOrigin}/product`);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
    );
    await expect(frame.getByText('Project could not save.', { exact: true })).toBeVisible();
    await expect(frame.getByText('Save Now', { exact: true })).toHaveCount(0);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimePersistenceMetrics.revisionCommits).toBe(0);
  } finally {
    await fixture.close();
  }
});

test('Home waits for the latest generation when an edit arrives during upstream save', async () => {
  const serverProject = await realRuntimeBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
  });
  const page = await fixture.context.newPage();
  let putCount = 0;
  let firstSeenResolve: (() => void) | undefined;
  const firstSeen = new Promise<void>((resolve) => {
    firstSeenResolve = resolve;
  });
  let secondSeenResolve: (() => void) | undefined;
  const secondSeen = new Promise<void>((resolve) => {
    secondSeenResolve = resolve;
  });
  let releaseFirstResolve: (() => void) | undefined;
  const releaseFirst = new Promise<void>((resolve) => {
    releaseFirstResolve = resolve;
  });
  let releaseSecondResolve: (() => void) | undefined;
  const releaseSecond = new Promise<void>((resolve) => {
    releaseSecondResolve = resolve;
  });
  try {
    await fixture.context.route(
      `${parentOrigin}/api/blocks/runtime/projects/${projectId}/draft`,
      async (route) => {
        if (route.request().method() !== 'PUT') {
          await route.continue();
          return;
        }
        putCount += 1;
        if (putCount === 1) {
          firstSeenResolve?.();
          await releaseFirst;
        } else if (putCount === 2) {
          secondSeenResolve?.();
          await releaseSecond;
        }
        await route.continue();
      },
    );
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );

    await setServerSteps(frame, '8', '73');
    await page.getByRole('button', { name: 'ASA Lab — на главную', exact: true }).click();
    await firstSeen;
    await setServerSteps(frame, '73', '74');
    expect(page.url()).toBe(`${parentOrigin}/product`);
    releaseFirstResolve?.();

    await secondSeen;
    expect(fixture.getServerRevision()).toBe(24);
    expect(page.url()).toBe(`${parentOrigin}/product`);
    releaseSecondResolve?.();

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(25);
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(fixture.runtimeDraftEvidence).toHaveLength(2);
    expect(fixture.runtimeAssetPutEvidence).toHaveLength(0);
    const latestSprite = fixture.runtimeDraftEvidence
      .at(-1)!
      .body.document.projectJson.targets.find(
        (target: { name?: string }) => target.name === 'Server Bootstrap Sprite',
      );
    expect(latestSprite.blocks.move.inputs.STEPS[1][1]).toBe('74');
  } finally {
    releaseFirstResolve?.();
    releaseSecondResolve?.();
    await fixture.close();
  }
});

// Native Scratch File commands are not ASA durable save or the M1-007 import API.
// Reopen in a fresh browser so an in-memory VM/storage cache cannot fake restoration.
test('native File saves an edited sb3 and restores code and media in a fresh editor', async () => {
  const directory = `${evidenceDir}/native-file-roundtrip`;
  fs.mkdirSync(directory, { recursive: true });
  const savedPath = `${directory}/edited-project.sb3`;
  const marker = 'ASA File Sprite';
  const variable = 'ASA_File_Proof';
  const requests: Array<{ phase: string; url: string; method: string }> = [];
  const failed: Array<{ phase: string; url: string; error: string; type: string }> = [];
  const requestPhases = new WeakMap<object, string>();
  const badResponses: string[] = [];
  let phase = 'edit';
  let fixture: Awaited<ReturnType<typeof createProtocolFixture>> | undefined;
  const observe = (current: NonNullable<typeof fixture>) => {
    current.context.on('request', (request) => {
      requestPhases.set(request, phase);
      requests.push({ phase, url: request.url(), method: request.method() });
    });
    current.context.on('requestfailed', (request) => {
      failed.push({
        phase: requestPhases.get(request) ?? 'unknown',
        url: request.url(),
        error: request.failure()?.errorText ?? 'unknown',
        type: request.resourceType(),
      });
    });
    current.context.on('response', (response) => {
      if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
    });
  };
  try {
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const page = await fixture.context.newPage();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    phase = 'sprite-library';
    await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
    await frame.getByText('Abby', { exact: true }).click();
    await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
    await frame.getByPlaceholder('Name', { exact: true }).fill(marker);
    await frame.getByPlaceholder('Name', { exact: true }).press('Enter');
    await frame.getByPlaceholder('x', { exact: true }).fill('137');
    await frame.getByPlaceholder('x', { exact: true }).press('Enter');
    await frame.getByRole('treeitem', { name: 'Variables', exact: true }).click();
    await frame.getByText('Make a Variable', { exact: true }).click();
    const dialog = frame.getByRole('dialog', { name: 'New Variable' });
    await dialog.getByRole('textbox').fill(variable);
    await dialog.getByRole('button', { name: 'OK', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    phase = 'sound-library';
    await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
    await frame.getByText('Bark', { exact: true }).click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await frame.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(frame.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await expect(page.getByRole('status')).toHaveCount(0);
    await page.screenshot({ path: `${directory}/01-before-save.png` });
    await frame.getByText('File', { exact: true }).click();
    const downloadPromise = page.waitForEvent('download');
    await frame.getByText('Save to your computer', { exact: true }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.sb3$/i);
    await download.saveAs(savedPath);
    expect(await download.failure()).toBeNull();
    const savedBytes = fs.readFileSync(savedPath);
    expect(savedBytes.length).toBeGreaterThan(1024);
    expect(savedBytes.readUInt32LE(0)).toBe(0x04034b50);
    expect(fixture.pageErrors).toEqual([]);
    await fixture.close();
    fixture = undefined;
    phase = 'fresh-boot';
    fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
    observe(fixture);
    const reopened = await fixture.context.newPage();
    await reopened.setViewportSize({ width: 1440, height: 960 });
    await reopened.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const restored = reopened.frameLocator('iframe[title="Scratch runtime"]');
    await expect(restored.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    await expect(restored.getByRole('button', { name: marker, exact: true })).toHaveCount(0);
    phase = 'restore';
    await restored.getByText('File', { exact: true }).click();
    fs.writeFileSync(`${directory}/fresh-menu.html`, await restored.locator('body').innerHTML());
    try {
      await expect(restored.getByText('Load from your computer', { exact: true })).toBeVisible();
    } catch (error) {
      await reopened.screenshot({ path: `${directory}/fresh-menu-failure.png` });
      fs.writeFileSync(
        `${directory}/fresh-menu-failure.html`,
        await restored.locator('body').innerHTML(),
      );
      throw error;
    }
    const [chooser] = await Promise.all([
      reopened.waitForEvent('filechooser'),
      restored.getByText('Load from your computer', { exact: true }).click(),
    ]);
    await chooser.setFiles(savedPath);
    const importedSprite = restored.getByRole('button', { name: marker, exact: true });
    await expect(importedSprite).toBeVisible();
    await importedSprite.click();
    await expect(restored.getByPlaceholder('Name', { exact: true })).toHaveValue(marker);
    await expect(restored.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    await expect(
      restored.locator('[class*="monitor_label"]').filter({ hasText: variable }),
    ).toBeVisible();
    await restored.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-a', { exact: true }),
    ).toBeVisible();
    await expect(
      restored
        .getByRole('tabpanel', { name: 'Costumes', exact: true })
        .getByText('Abby-d', { exact: true }),
    ).toBeVisible();
    const costumeImage = importedSprite.locator('img').first();
    await expect
      .poll(() => costumeImage.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBeGreaterThan(0);
    await reopened.screenshot({ path: `${directory}/03-restored-costumes.png` });
    await restored.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await restored
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true })
      .click();
    await expect(restored.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
    await reopened.screenshot({ path: `${directory}/04-restored-sound.png` });
    // Native export proves the restored sound is Bark, not a silent fallback
    // retaining its label. Never read or alter the VM to make this assertion.
    await restored
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true })
      .click({ button: 'right' });
    const [soundDownload] = await Promise.all([
      reopened.waitForEvent('download'),
      restored.getByRole('menuitem', { name: 'export', exact: true }).click(),
    ]);
    expect(soundDownload.suggestedFilename()).toBe('Bark.wav');
    const restoredSoundPath = `${directory}/restored-Bark.wav`;
    await soundDownload.saveAs(restoredSoundPath);
    expect(await soundDownload.failure()).toBeNull();
    expect(createHash('md5').update(fs.readFileSync(restoredSoundPath)).digest('hex')).toBe(
      barkAssetId,
    );

    await restored.getByRole('tab', { name: 'Code', exact: true }).click();
    await expect(restored.getByRole('button', { name: marker, exact: true })).toBeVisible();
    await expect(restored.getByText('Fixture Cat', { exact: true })).toHaveCount(0);
    await restored.getByRole('button', { name: 'Start project', exact: true }).click();
    const shell = restored.locator('[data-asa-host-shell]');
    await expect(shell).not.toHaveAttribute('data-runtime-state', 'error');
    await restored.getByRole('button', { name: 'Stop project', exact: true }).click();
    await expect(shell).toHaveAttribute('data-project-running', 'false');
    await expect(reopened.getByRole('status')).toHaveCount(0);
    await expect(reopened.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
    await reopened.screenshot({ path: `${directory}/05-restored-project.png` });
    const httpRequests = requests.filter(({ url }) => /^https?:/.test(url));
    expect(
      httpRequests.filter(({ url }) => ![parentOrigin, runtimeUrl].includes(new URL(url).origin)),
    ).toEqual([]);
    const runtimeSessionRequests = httpRequests.filter(
      ({ method, url }) =>
        method === 'POST' &&
        new URL(url).origin === parentOrigin &&
        new URL(url).pathname ===
          '/api/projects/11111111-1111-4111-8111-111111111111/blocks/runtime-session',
    );
    expect(runtimeSessionRequests.length).toBeGreaterThanOrEqual(2);
    const managedRuntimeMutations = httpRequests.filter(({ method, url }) => {
      if (method !== 'PUT') return false;
      const parsed = new URL(url);
      if (parsed.origin !== parentOrigin) return false;
      return (
        /^\/api\/blocks\/runtime\/projects\/[0-9a-f-]+\/assets\/[a-f0-9]{32}\.(svg|png|jpg|wav|mp3)$/i.test(
          parsed.pathname,
        ) || /^\/api\/blocks\/runtime\/projects\/[0-9a-f-]+\/draft$/i.test(parsed.pathname)
      );
    });
    expect(managedRuntimeMutations.length).toBeGreaterThan(0);
    expect(
      httpRequests.filter(
        ({ method, url }) =>
          !['GET', 'HEAD'].includes(method) &&
          !runtimeSessionRequests.some(
            (runtimeSessionRequest) =>
              runtimeSessionRequest.method === method && runtimeSessionRequest.url === url,
          ) &&
          !managedRuntimeMutations.some(
            (runtimeMutation) => runtimeMutation.method === method && runtimeMutation.url === url,
          ),
      ),
    ).toEqual([]);
    expect(
      httpRequests.filter(
        ({ phase: step, url }) =>
          step === 'restore' && new URL(url).pathname.startsWith('/library-assets/'),
      ),
    ).toEqual([]);
    // Closing a stock picker may cancel an unused thumbnail. Keep that evidence,
    // but do not confuse it with failed project/media reads during file restoration.
    expect(
      failed.filter(
        (failure) =>
          !(
            failure.phase === 'sprite-library' &&
            failure.type === 'image' &&
            failure.error === 'net::ERR_ABORTED' &&
            new URL(failure.url).origin === runtimeUrl &&
            /^\/library-assets\/[a-f0-9]{32}\.(svg|png|jpg)$/.test(new URL(failure.url).pathname)
          ),
      ),
    ).toEqual([]);
    expect(badResponses).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } catch (error) {
    const lastPage = fixture?.context.pages().at(-1);
    if (lastPage && !lastPage.isClosed()) {
      await Promise.allSettled([
        lastPage.screenshot({ path: `${directory}/failure.png` }),
        lastPage
          .frameLocator('iframe[title="Scratch runtime"]')
          .locator('body')
          .innerHTML()
          .then((html) => fs.writeFileSync(`${directory}/failure.html`, html)),
      ]);
    }
    throw error;
  } finally {
    try {
      fs.writeFileSync(
        `${directory}/network.json`,
        JSON.stringify(
          { requests, failed, badResponses, pageErrors: fixture?.pageErrors ?? [] },
          null,
          2,
        ),
      );
    } finally {
      await fixture?.close();
    }
  }
});

// A missing runtime must leave an actionable portal-owned state, not an endless spinner.
test('unreachable Scratch times out and can reconnect without hiding the editor', async () => {
  test.setTimeout(100000);
  const fixture = await createProtocolFixture({ product: true, locale: 'ru-RU' });
  const page = await fixture.context.newPage();
  const blockRuntime = (route: import('@playwright/test').Route) => route.abort();
  try {
    await page.route(`${runtimeUrl}/**`, blockRuntime);
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime', {
      timeout: 55000,
    });
    await expect(page.getByRole('status')).toContainText('Ошибка Scratch runtime');
    await expect(page.locator('[data-asa-blocks-account-overlay]')).toBeVisible();
    await page.unroute(`${runtimeUrl}/**`, blockRuntime);
    await page.getByRole('button', { name: 'Повторить подключение' }).click();
    await expect(
      page.frameLocator('iframe[title="Scratch runtime"]').locator('[data-asa-host-shell]'),
    ).toHaveAttribute('data-editor-state', 'ready', { timeout: 45000 });
    await expect(page.getByRole('button', { name: 'Повторить подключение' })).toHaveCount(0);
    await expect(page.getByRole('status')).toHaveCount(0);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

// The parent ASA wordmark navigates; Scratch's own Home action stays inert.
test('ASA wordmark supports keyboard and returns to home without an explicit-save prompt', async () => {
  const fixture = await createProtocolFixture({ product: true, locale: 'en-US' });
  const page = await fixture.context.newPage();
  try {
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
      { timeout: 45000 },
    );
    const home = page.getByRole('button', { name: 'ASA Lab — на главную', exact: true });
    await expect(home).toBeVisible();
    await expect(page.locator('[data-asa-blocks-save]')).toHaveCount(0);
    for (const width of [1440, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 960 });
      const hit = await home.boundingBox();
      const logo = await frame.locator('#logo_img').boundingBox();
      const settings = await frame
        .getByRole('button', { name: 'Settings menu', exact: true })
        .boundingBox();
      expect(hit).not.toBeNull();
      expect(logo).not.toBeNull();
      expect(settings).not.toBeNull();
      expect(hit!.x).toBeLessThanOrEqual(logo!.x);
      expect(hit!.x + hit!.width).toBeGreaterThanOrEqual(logo!.x + logo!.width);
      expect(hit!.y).toBeLessThanOrEqual(logo!.y);
      expect(hit!.y + hit!.height).toBeGreaterThanOrEqual(logo!.y + logo!.height);
      expect(hit!.x + hit!.width).toBeLessThanOrEqual(settings!.x);
      await home.hover();
      expect(await home.evaluate((el) => getComputedStyle(el).cursor)).toBe('pointer');
      await page.screenshot({ path: `${evidenceDir}/home-wordmark-${width}.png` });
    }
    const childUrl = await frame.locator('body').evaluate(() => window.location.href);
    await frame
      .getByRole('button', { name: 'Home', exact: true })
      .evaluate((button) => (button as HTMLButtonElement).click());
    await expect(page).toHaveURL(`${parentOrigin}/product`);
    expect(await frame.locator('body').evaluate(() => window.location.href)).toBe(childUrl);
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-editor-state',
      'ready',
    );

    let dialogSeen = false;
    page.on('dialog', async (dialog) => {
      dialogSeen = true;
      await dialog.dismiss();
    });
    await home.focus();
    await home.press('Enter');
    await expect(page).toHaveURL(`${parentOrigin}/product#/home`);
    expect(dialogSeen).toBe(false);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('runtime compresses scripts and safely separates stock and entry caching', async ({
  request,
}) => {
  const script = await request.get(`${runtimeUrl}/vendor/scratch/scratch-gui-standalone.js`, {
    headers: { 'Accept-Encoding': 'gzip', Via: '1.1 asa-local-test' },
  });
  expect(script.status()).toBe(200);
  expect(script.headers()['content-encoding']).toBe('gzip');
  expect(script.headers()['vary']).toContain('Accept-Encoding');
  expect(script.headers()['cache-control']).toBe('no-cache');
  const identity = await request.get(`${runtimeUrl}/vendor/scratch/scratch-gui-standalone.js`, {
    headers: { 'Accept-Encoding': 'identity' },
  });
  expect(identity.headers()['content-encoding']).toBeUndefined();
  expect(Number(script.headers()['content-length'])).toBeGreaterThan(0);
  expect(Number(script.headers()['content-length'])).toBeLessThan(
    Number(identity.headers()['content-length']) * 0.5,
  );
  expect(
    createHash('sha256')
      .update(await script.body())
      .digest('hex'),
  ).toBe(
    createHash('sha256')
      .update(await identity.body())
      .digest('hex'),
  );
  const sound = await request.get(`${runtimeUrl}/library-assets/${barkAssetId}.wav`);
  expect(sound.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const pathname of [
    '/',
    '/index.html',
    '/editor.js',
    '/asa-commit.txt',
    '/library-assets/library-assets-manifest.json',
  ]) {
    const response = await request.get(`${runtimeUrl}${pathname}`);
    expect(response.status()).toBe(200);
    expect(response.headers()['cache-control']).toBe('no-cache');
  }
  const missing = await request.get(
    `${runtimeUrl}/library-assets/00000000000000000000000000000000.svg`,
  );
  expect(missing.status()).toBe(404);
  expect(missing.headers()['cache-control'] ?? '').not.toContain('immutable');
});
