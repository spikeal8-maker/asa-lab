import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';
import fs from 'node:fs';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let parentOrigin: string;
let runtimeUrl: string;

const PRINCIPAL_A = '33333333-3333-4333-8333-333333333333';
const BARK_ASSET_ID = 'cd8fa8390b0efdd281882533fbfcfcfb';

function bootstrapFixture() {
  const imageBytes = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="#0877b3"/></svg>',
    'utf8',
  );
  const imageAssetId = createHash('md5').update(imageBytes).digest('hex');
  const imageReference = {
    assetId: imageAssetId,
    dataFormat: 'svg' as const,
    sha256: createHash('sha256').update(imageBytes).digest('hex'),
    sizeBytes: imageBytes.byteLength,
  };
  const costume = (name: string) => ({
    assetId: imageAssetId,
    name,
    bitmapResolution: 1,
    md5ext: `${imageAssetId}.svg`,
    dataFormat: 'svg',
    rotationCenterX: 48,
    rotationCenterY: 48,
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
        costumes: [costume('Recovery Backdrop')],
        sounds: [],
        volume: 100,
      },
      {
        isStage: false,
        name: 'Recovery Sprite',
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
            inputs: { STEPS: [1, [4, '10']] },
            fields: {},
            shadow: false,
            topLevel: false,
          },
        },
        currentCostume: 0,
        costumes: [costume('Recovery Costume')],
        sounds: [],
        volume: 100,
        visible: true,
        x: 20,
        y: -10,
        size: 100,
        direction: 90,
        draggable: false,
        rotationStyle: 'all around',
      },
    ],
    monitors: [],
    extensions: [],
    meta: { semver: '3.0.0', vm: '0.1.0', agent: 'ASA media recovery acceptance' },
  };
  return {
    projectJson,
    assets: [imageReference],
    runtimeAssets: new Map([
      [`${imageAssetId}.svg`, { body: imageBytes, contentType: 'image/svg+xml' }],
    ]),
    imageAssetId,
  };
}

type RecoveryAssetSummary = {
  assetId: string;
  dataFormat: string;
  sha256: string;
  computedSha256: string;
  sizeBytes: number;
  byteLength: number;
  bytes: number[];
};

type RecoveryRecordSummary = {
  principalKey: string;
  projectId: string;
  baseRevision: number;
  projectJson: Record<string, unknown>;
  generation: number;
  schemaVersion: number;
  assets: RecoveryAssetSummary[];
};

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin, runtimeUrl } = await import('../tools/blocks/browser/protocol.mjs'));
});

async function readRecoveryRecords(
  frame: import('@playwright/test').FrameLocator,
): Promise<RecoveryRecordSummary[]> {
  return frame.locator('html').evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (!databases.some((database) => database.name === 'asa-blocks-recovery')) return [];

    const toHex = (bytes: Uint8Array) =>
      [...bytes].map((value) => value.toString(16).padStart(2, '0')).join('');
    return new Promise<RecoveryRecordSummary[]>((resolve, reject) => {
      const open = indexedDB.open('asa-blocks-recovery');
      open.onerror = () => reject(open.error ?? new Error('recovery database open failed'));
      open.onsuccess = () => {
        const database = open.result;
        const transaction = database.transaction('project-recovery', 'readonly');
        const request = transaction.objectStore('project-recovery').getAll();
        request.onerror = () => reject(request.error ?? new Error('recovery database read failed'));
        request.onsuccess = () => {
          void Promise.all(
            request.result.map(async (value) => {
              const assets = await Promise.all(
                (value.assets ?? []).map(async (asset: Record<string, unknown>) => {
                  const source = asset.bytes as Uint8Array | ArrayBuffer;
                  const bytes =
                    source instanceof Uint8Array ? source : new Uint8Array(source as ArrayBuffer);
                  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
                  return {
                    assetId: String(asset.assetId),
                    dataFormat: String(asset.dataFormat),
                    sha256: String(asset.sha256),
                    computedSha256: toHex(digest),
                    sizeBytes: Number(asset.sizeBytes),
                    byteLength: bytes.byteLength,
                    bytes: Array.from(bytes),
                  };
                }),
              );
              return {
                principalKey: String(value.principalKey),
                projectId: String(value.projectId),
                baseRevision: Number(value.baseRevision),
                projectJson: value.projectJson as Record<string, unknown>,
                generation: Number(value.generation),
                schemaVersion: Number(value.schemaVersion),
                assets,
              };
            }),
          ).then((records) => {
            database.close();
            resolve(records);
          }, reject);
        };
      };
    });
  });
}

async function waitReady(frame: import('@playwright/test').FrameLocator) {
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
}

async function openProduct(
  fixture: Awaited<ReturnType<typeof createProtocolFixture>>,
  suffix = '',
) {
  const page = await fixture.context.newPage();
  await page.goto(`${parentOrigin}/product${suffix}`, { waitUntil: 'domcontentloaded' });
  const frame = page.frameLocator('iframe[title="Scratch runtime"]');
  await waitReady(frame);
  return { page, frame };
}

async function waitForMediaRecovery(
  frame: import('@playwright/test').FrameLocator,
  predicate: (record: RecoveryRecordSummary) => boolean,
) {
  await expect
    .poll(
      async () => {
        const record = (await readRecoveryRecords(frame))[0];
        return record ? predicate(record) : false;
      },
      { timeout: 6000 },
    )
    .toBe(true);
  return (await readRecoveryRecords(frame))[0]!;
}

function targetByName(record: RecoveryRecordSummary, name: string) {
  const project = record.projectJson as {
    targets?: Array<Record<string, unknown> & { name?: string }>;
  };
  return project.targets?.find((target) => target.name === name);
}

async function addAbby(frame: import('@playwright/test').FrameLocator, x = '137') {
  await frame.getByRole('button', { name: 'Choose a Sprite' }).first().click();
  await frame.getByText('Abby', { exact: true }).click();
  await expect(frame.getByPlaceholder('Name', { exact: true })).toHaveValue('Abby');
  await frame.getByPlaceholder('x', { exact: true }).fill(x);
  await frame.getByPlaceholder('x', { exact: true }).press('Enter');
}

async function addBark(frame: import('@playwright/test').FrameLocator) {
  await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
  await frame.getByRole('button', { name: 'Choose a Sound', exact: true }).first().click();
  await frame.getByText('Bark', { exact: true }).click();
  await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');
}

async function setSteps(
  frame: import('@playwright/test').FrameLocator,
  fromValue: string,
  toValue: string,
) {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
  const program = frame.locator('.blocklyBlockCanvas').first();
  await program.getByText(fromValue, { exact: true }).dblclick();
  const input = frame.locator('.blocklyHtmlInput:focus');
  await input.fill(toValue);
  await input.press('Enter');
  await expect(program.getByText(toValue, { exact: true })).toBeVisible();
}

function snapshot23() {
  return {
    sourceRevision: 23,
    contentType: 'image/png',
    bytes: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  };
}

async function paintRectangleCostume(
  page: import('@playwright/test').Page,
  frame: import('@playwright/test').FrameLocator,
) {
  await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
  await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
  const chooseCostume = frame
    .getByRole('button', { name: 'Choose a Costume', exact: true })
    .first();
  await chooseCostume.hover();
  const paint = frame.getByRole('button', { name: 'Paint', exact: true }).first();
  await expect(paint).toBeVisible({ timeout: 5000 });
  await paint.click();
  await expect(frame.getByRole('button', { name: 'Brush', exact: true })).toBeVisible({
    timeout: 10000,
  });

  const canvas = frame.locator('canvas[id^="paper-view-"]').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('paint canvas unavailable');
  await frame.getByRole('button', { name: 'Rectangle', exact: true }).click();
  await page.mouse.move(box.x + box.width * 0.38, box.y + box.height * 0.38);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.58, { steps: 8 });
  await page.mouse.up();
  return canvas;
}

function localCostume(record: RecoveryRecordSummary, targetName: string, confirmedAssetId: string) {
  const target = targetByName(record, targetName) as
    | (Record<string, unknown> & {
        costumes?: Array<{ name?: string; assetId?: string; dataFormat?: string }>;
      })
    | undefined;
  return target?.costumes?.find((costume) => costume.assetId !== confirmedAssetId);
}

test('new stock sprite survives crash with exact recovery media and then reopens from server', async () => {
  const server = bootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
    initialSnapshot: snapshot23(),
  });
  try {
    let { frame } = await openProduct(fixture);
    await addAbby(frame, '137');

    const record = await waitForMediaRecovery(frame, (candidate) => {
      const abby = targetByName(candidate, 'Abby');
      return candidate.schemaVersion === 2 && candidate.assets.length > 0 && abby?.x === 137;
    });
    expect(record.baseRevision).toBe(23);
    expect(record.assets.every((asset) => asset.sha256 === asset.computedSha256)).toBe(true);
    expect(record.assets.every((asset) => asset.sizeBytes === asset.byteLength)).toBe(true);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'recovery');
    const abbyButton = frame.getByRole('button', { name: 'Abby', exact: true });
    await expect(abbyButton).toBeVisible();
    await abbyButton.click();
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    await expect
      .poll(() =>
        abbyButton
          .locator('img')
          .first()
          .evaluate((image) => (image as HTMLImageElement).naturalWidth),
      )
      .toBeGreaterThan(0);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10000 })
      .toBe(0);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20000 }).toBe(24);
    expect(fixture.runtimeAssetPutEvidence.length).toBeGreaterThan(0);

    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'runtime-session',
    );
    const serverAbby = frame.getByRole('button', { name: 'Abby', exact: true });
    await expect(serverAbby).toBeVisible();
    await serverAbby.click();
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('137');
    expect(await readRecoveryRecords(frame)).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('new Bark sound survives crash with exact bytes and server roundtrip', async () => {
  const server = bootstrapFixture();
  const barkResponse = await fetch(`${runtimeUrl}/library-assets/${BARK_ASSET_ID}.wav`);
  expect(barkResponse.ok).toBe(true);
  const barkBytes = Buffer.from(await barkResponse.arrayBuffer());
  const barkSha = createHash('sha256').update(barkBytes).digest('hex');

  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
  });
  try {
    let { page, frame } = await openProduct(fixture);
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await addBark(frame);

    const record = await waitForMediaRecovery(frame, (candidate) =>
      candidate.assets.some(
        (asset) => asset.assetId === BARK_ASSET_ID && asset.dataFormat === 'wav',
      ),
    );
    const bark = record.assets.find((asset) => asset.assetId === BARK_ASSET_ID)!;
    expect(bark.sizeBytes).toBe(barkBytes.byteLength);
    expect(bark.byteLength).toBe(barkBytes.byteLength);
    expect(bark.sha256).toBe(barkSha);
    expect(bark.computedSha256).toBe(barkSha);
    const recoveryBarkBytes = Buffer.from(bark.bytes);
    expect(recoveryBarkBytes.byteLength).toBe(barkBytes.byteLength);
    expect(createHash('sha256').update(recoveryBarkBytes).digest('hex')).toBe(barkSha);
    expect(fixture.getServerRevision()).toBe(23);

    await fixture.reopenContextWithIndexedDB();
    ({ page, frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'recovery',
    );
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    const restoredBark = frame
      .getByRole('tabpanel', { name: 'Sounds', exact: true })
      .getByText('Bark', { exact: true });
    await restoredBark.click();
    await expect(frame.getByRole('textbox', { name: 'Sound', exact: true })).toHaveValue('Bark');

    await restoredBark.click({ button: 'right' });
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      frame.getByRole('menuitem', { name: 'export', exact: true }).click(),
    ]);
    const path = await download.path();
    expect(path).not.toBeNull();
    const restoredBytes = await fs.promises.readFile(path!);
    expect(createHash('md5').update(restoredBytes).digest('hex')).toBe(BARK_ASSET_ID);
    expect(restoredBytes.equals(barkBytes)).toBe(true);

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20000 }).toBe(24);
    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Sounds', exact: true })
        .getByText('Bark', { exact: true }),
    ).toBeVisible();
  } finally {
    await fixture.close();
  }
});

test('Paint costume versions keep only the latest recovery media and restore visual state', async () => {
  const server = bootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
  });
  try {
    let { page, frame } = await openProduct(fixture);
    let canvas = await paintRectangleCostume(page, frame);

    const first = await waitForMediaRecovery(frame, (candidate) => {
      const costume = localCostume(candidate, 'Recovery Sprite', server.imageAssetId);
      return Boolean(
        costume?.assetId && candidate.assets.some((asset) => asset.assetId === costume.assetId),
      );
    });
    const costumeA = localCostume(first, 'Recovery Sprite', server.imageAssetId);
    if (!costumeA?.assetId || !costumeA.dataFormat) throw new Error('paint version A missing');
    const assetA = first.assets.find((asset) => asset.assetId === costumeA.assetId);
    expect(assetA?.sha256).toBe(assetA?.computedSha256);
    expect(createHash('md5').update(Buffer.from(assetA!.bytes)).digest('hex')).toBe(
      costumeA.assetId,
    );

    const beforeSecond = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    const box = await canvas.boundingBox();
    if (!box) throw new Error('paint canvas unavailable');
    await frame.getByRole('button', { name: 'Rectangle', exact: true }).click();
    await page.mouse.move(box.x + box.width * 0.62, box.y + box.height * 0.25);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.78, box.y + box.height * 0.42, { steps: 8 });
    await page.mouse.up();

    const second = await waitForMediaRecovery(frame, (candidate) => {
      const costume = localCostume(candidate, 'Recovery Sprite', server.imageAssetId);
      return Boolean(costume?.assetId && costume.assetId !== costumeA.assetId);
    });
    const costumeB = localCostume(second, 'Recovery Sprite', server.imageAssetId);
    if (!costumeB?.assetId || !costumeB.dataFormat || !costumeB.name) {
      throw new Error('paint version B missing');
    }
    expect(costumeB.assetId).not.toBe(costumeA.assetId);
    expect(second.assets.some((asset) => asset.assetId === costumeA.assetId)).toBe(false);
    expect(second.assets.some((asset) => asset.assetId === costumeB.assetId)).toBe(true);
    const assetB = second.assets.find((asset) => asset.assetId === costumeB.assetId)!;
    expect(assetB.sha256).toBe(assetB.computedSha256);
    expect(createHash('md5').update(Buffer.from(assetB.bytes)).digest('hex')).toBe(
      costumeB.assetId,
    );

    const finalVisual = await canvas.evaluate((node) => (node as HTMLCanvasElement).toDataURL());
    expect(finalVisual).not.toBe(beforeSecond);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    await fixture.reopenContextWithIndexedDB();
    ({ page, frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'recovery',
    );
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
    await frame
      .getByRole('tabpanel', { name: 'Costumes', exact: true })
      .getByText(costumeB.name, { exact: true })
      .click();
    canvas = frame.locator('canvas[id^="paper-view-"]').first();
    await expect(canvas).toBeVisible();
    const restoredCanvasBox = await canvas.boundingBox();
    expect(restoredCanvasBox?.width).toBeGreaterThan(0);
    expect(restoredCanvasBox?.height).toBeGreaterThan(0);

    const restoredCostumeItem = frame
      .getByRole('tabpanel', { name: 'Costumes', exact: true })
      .getByText(costumeB.name, { exact: true })
      .first();
    await restoredCostumeItem.click({ button: 'right' });
    const [restoredCostumeDownload] = await Promise.all([
      page.waitForEvent('download'),
      frame.getByRole('menuitem', { name: 'export', exact: true }).click(),
    ]);
    const restoredCostumePath = await restoredCostumeDownload.path();
    if (!restoredCostumePath) throw new Error('restored costume export unavailable');
    const restoredCostumeBytes = await fs.promises.readFile(restoredCostumePath);
    expect(createHash('md5').update(restoredCostumeBytes).digest('hex')).toBe(costumeB.assetId);
    expect(createHash('sha256').update(restoredCostumeBytes).digest('hex')).toBe(assetB.sha256);
    expect(restoredCostumeBytes.equals(Buffer.from(assetB.bytes))).toBe(true);

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10000 })
      .toBe(0);

    await fixture.reopenContextWithIndexedDB();
    ({ page, frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'runtime-session',
    );
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Costumes', exact: true }).click();
    const serverCostumeItem = frame
      .getByRole('tabpanel', { name: 'Costumes', exact: true })
      .getByText(costumeB.name, { exact: true })
      .first();
    await serverCostumeItem.click();
    const serverCanvas = frame.locator('canvas[id^="paper-view-"]').first();
    await expect(serverCanvas).toBeVisible();
    const serverCanvasBox = await serverCanvas.boundingBox();
    expect(serverCanvasBox?.width).toBeGreaterThan(0);
    expect(serverCanvasBox?.height).toBeGreaterThan(0);

    await serverCostumeItem.click({ button: 'right' });
    const [serverCostumeDownload] = await Promise.all([
      page.waitForEvent('download'),
      frame.getByRole('menuitem', { name: 'export', exact: true }).click(),
    ]);
    const serverCostumePath = await serverCostumeDownload.path();
    if (!serverCostumePath) throw new Error('server costume export unavailable');
    const serverCostumeBytes = await fs.promises.readFile(serverCostumePath);
    expect(createHash('md5').update(serverCostumeBytes).digest('hex')).toBe(costumeB.assetId);
    expect(createHash('sha256').update(serverCostumeBytes).digest('hex')).toBe(assetB.sha256);
    expect(serverCostumeBytes.equals(Buffer.from(assetB.bytes))).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('sprite sound and block edit survive one combined crash checkpoint', async () => {
  const server = bootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
  });
  try {
    let { frame } = await openProduct(fixture);
    await addAbby(frame, '149');
    await addBark(frame);
    await setSteps(frame, '10', '73');

    const record = await waitForMediaRecovery(frame, (candidate) => {
      const abby = targetByName(candidate, 'Abby') as
        (Record<string, unknown> & { sounds?: Array<{ name?: string }> }) | undefined;
      const recovery = targetByName(candidate, 'Recovery Sprite') as
        | (Record<string, unknown> & {
            blocks?: Record<string, { inputs?: Record<string, unknown> }>;
          })
        | undefined;
      const steps = recovery?.blocks?.move?.inputs?.STEPS as [number, [number, string]] | undefined;
      return (
        candidate.assets.length >= 2 &&
        abby?.x === 149 &&
        abby.sounds?.some((sound) => sound.name === 'Bark') === true &&
        steps?.[1]?.[1] === '73'
      );
    });
    expect(record.assets.every((asset) => asset.sha256 === asset.computedSha256)).toBe(true);
    expect(fixture.getServerRevision()).toBe(23);

    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'recovery',
    );
    const abby = frame.getByRole('button', { name: 'Abby', exact: true });
    await expect(abby).toBeVisible();
    await abby.click();
    await expect(frame.getByPlaceholder('x', { exact: true })).toHaveValue('149');
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Sounds', exact: true })
        .getByText('Bark', { exact: true }),
    ).toBeVisible();
    await frame.getByRole('tab', { name: 'Code', exact: true }).click();
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await expect(
      frame.locator('.blocklyBlockCanvas').first().getByText('73', { exact: true }),
    ).toBeVisible();

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10000 })
      .toBe(0);
  } finally {
    await fixture.close();
  }
});

test('asset PUT success plus draft failure keeps media recovery for crash retry', async () => {
  const server = bootstrapFixture();
  let failDraft = true;
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
    draftWriteStatus: () => (failDraft ? 503 : 200),
  });
  try {
    let { frame } = await openProduct(fixture);
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await addBark(frame);
    const checkpoint = await waitForMediaRecovery(frame, (candidate) =>
      candidate.assets.some((asset) => asset.assetId === BARK_ASSET_ID),
    );
    expect(checkpoint.assets.some((asset) => asset.assetId === BARK_ASSET_ID)).toBe(true);

    await expect
      .poll(
        () =>
          fixture.runtimeAssetPutEvidence.filter(
            (item) => item.assetFile === `${BARK_ASSET_ID}.wav`,
          ).length,
        { timeout: 20000 },
      )
      .toBeGreaterThanOrEqual(1);
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20000 }).toBe(1);
    expect(fixture.getServerRevision()).toBe(23);

    const retained = (await readRecoveryRecords(frame))[0]!;
    expect(retained.assets.some((asset) => asset.assetId === BARK_ASSET_ID)).toBe(true);
    const putCountBeforeCrash = fixture.runtimeAssetPutEvidence.filter(
      (item) => item.assetFile === `${BARK_ASSET_ID}.wav`,
    ).length;

    failDraft = false;
    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
      'data-project-source',
      'recovery',
    );
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Sounds', exact: true })
        .getByText('Bark', { exact: true }),
    ).toBeVisible();

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20000 }).toBe(24);
    const totalBarkPuts = fixture.runtimeAssetPutEvidence.filter(
      (item) => item.assetFile === `${BARK_ASSET_ID}.wav`,
    ).length;
    expect(totalBarkPuts).toBeGreaterThan(putCountBeforeCrash);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10000 })
      .toBe(0);
  } finally {
    await fixture.close();
  }
});

test('another account cannot restore or send account A media recovery bytes', async () => {
  const server = bootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
  });
  try {
    let { frame } = await openProduct(fixture);
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await addBark(frame);
    const record = await waitForMediaRecovery(frame, (candidate) =>
      candidate.assets.some((asset) => asset.assetId === BARK_ASSET_ID),
    );
    expect(record.principalKey).toBe(PRINCIPAL_A);
    expect(fixture.getServerRevision()).toBe(23);
    const putsBefore = fixture.runtimeAssetPutEvidence.length;

    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture, '?account=b'));
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Sounds', exact: true })
        .getByText('Bark', { exact: true }),
    ).toHaveCount(0);
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeAssetPutEvidence.length).toBe(putsBefore);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    const retained = await readRecoveryRecords(frame);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.principalKey).toBe(PRINCIPAL_A);
    expect(retained[0]?.assets.some((asset) => asset.assetId === BARK_ASSET_ID)).toBe(true);
  } finally {
    await fixture.close();
  }
});

test('server-ahead media conflict keeps canonical server and retains local asset bytes', async () => {
  const server = bootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: { draftRevision: 23, projectJson: server.projectJson, assets: server.assets },
    runtimeAssets: server.runtimeAssets,
  });
  try {
    let { frame } = await openProduct(fixture);
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await addBark(frame);
    const record = await waitForMediaRecovery(frame, (candidate) =>
      candidate.assets.some((asset) => asset.assetId === BARK_ASSET_ID),
    );
    expect(record.baseRevision).toBe(23);
    expect(fixture.advanceServerRevision()).toBe(24);
    const putsBefore = fixture.runtimeAssetPutEvidence.length;

    await fixture.reopenContextWithIndexedDB();
    ({ frame } = await openProduct(fixture));
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-recovery-state', 'recovery_conflict');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
    await frame.getByRole('tab', { name: 'Sounds', exact: true }).click();
    await expect(
      frame
        .getByRole('tabpanel', { name: 'Sounds', exact: true })
        .getByText('Bark', { exact: true }),
    ).toHaveCount(0);
    expect(fixture.getServerRevision()).toBe(24);
    expect(fixture.runtimeAssetPutEvidence.length).toBe(putsBefore);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);

    const retained = await readRecoveryRecords(frame);
    expect(retained).toHaveLength(1);
    expect(retained[0]?.baseRevision).toBe(23);
    expect(retained[0]?.assets.some((asset) => asset.assetId === BARK_ASSET_ID)).toBe(true);
  } finally {
    await fixture.close();
  }
});
