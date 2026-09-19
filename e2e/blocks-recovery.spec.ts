import { expect, test } from '@playwright/test';
import { createHash } from 'node:crypto';

let createProtocolFixture: typeof import('../tools/blocks/browser/fixture.mjs').createProtocolFixture;
let parentOrigin: string;

const PRINCIPAL_A = '33333333-3333-4333-8333-333333333333';

function recoveryBootstrapFixture() {
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
    meta: { semver: '3.0.0', vm: '0.1.0', agent: 'ASA recovery acceptance' },
  };
  return {
    projectJson,
    assets: [imageReference],
    runtimeAssets: new Map([
      [`${imageAssetId}.svg`, { body: imageBytes, contentType: 'image/svg+xml' }],
    ]),
  };
}

type RecoveryRecord = {
  principalKey: string;
  projectId: string;
  baseRevision: number;
  projectJson: Record<string, unknown>;
  generation: number;
  capturedAt: number;
  expiresAt: number;
};

test.beforeAll(async () => {
  ({ createProtocolFixture } = await import('../tools/blocks/browser/fixture.mjs'));
  ({ parentOrigin } = await import('../tools/blocks/browser/protocol.mjs'));
});
async function readRecoveryRecords(
  frame: import('@playwright/test').FrameLocator,
): Promise<RecoveryRecord[]> {
  return frame.locator('html').evaluate(async () => {
    const databases = typeof indexedDB.databases === 'function' ? await indexedDB.databases() : [];
    if (!databases.some((database) => database.name === 'asa-blocks-recovery')) return [];
    return new Promise<RecoveryRecord[]>((resolve, reject) => {
      const open = indexedDB.open('asa-blocks-recovery');
      open.onerror = () => reject(open.error ?? new Error('recovery database open failed'));
      open.onsuccess = () => {
        const database = open.result;
        if (!database.objectStoreNames.contains('project-recovery')) {
          database.close();
          resolve([]);
          return;
        }
        const transaction = database.transaction('project-recovery', 'readonly');
        const request = transaction.objectStore('project-recovery').getAll();
        request.onerror = () => reject(request.error ?? new Error('recovery database read failed'));
        request.onsuccess = () => {
          const records = request.result.map((value) => {
            const record = { ...value } as Record<string, unknown>;
            delete record.key;
            return record;
          });
          database.close();
          resolve(records as RecoveryRecord[]);
        };
      };
    });
  });
}

function recoverySteps(record: RecoveryRecord | undefined): string | null {
  if (!record) return null;
  const project = record.projectJson as {
    targets?: Array<{
      name?: string;
      blocks?: Record<string, { inputs?: Record<string, unknown> }>;
    }>;
  };
  const sprite = project.targets?.find((target) => target.name === 'Recovery Sprite');
  const steps = sprite?.blocks?.move?.inputs?.STEPS as [number, [number, string]] | undefined;
  return steps?.[1]?.[1] ?? null;
}
async function waitReady(frame: import('@playwright/test').FrameLocator) {
  await expect(frame.locator('[data-asa-host-shell]')).toHaveAttribute(
    'data-editor-state',
    'ready',
    { timeout: 45000 },
  );
}

async function expectSteps(frame: import('@playwright/test').FrameLocator, value: string) {
  await frame.getByRole('tab', { name: 'Code', exact: true }).click();
  await frame.getByRole('button', { name: 'Recovery Sprite', exact: true }).click();
  await expect(
    frame.locator('.blocklyBlockCanvas').first().getByText(value, { exact: true }),
  ).toBeVisible();
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
  await expect(input).toHaveValue(fromValue);
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
test('dirty crash restores real Scratch state, autosaves it, clears recovery and second reopen uses server', async () => {
  const serverProject = recoveryBootstrapFixture();
  const fixture = await createProtocolFixture({
    product: true,
    locale: 'en-US',
    runtimeSession: {
      draftRevision: 23,
      projectJson: serverProject.projectJson,
      assets: serverProject.assets,
    },
    runtimeAssets: serverProject.runtimeAssets,
    initialSnapshot: snapshot23(),
  });
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);

    await setSteps(frame, '10', '73');
    await expect
      .poll(async () => recoverySteps((await readRecoveryRecords(frame))[0]), { timeout: 5000 })
      .toBe('73');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    expect(fixture.runtimeSnapshotEvidence).toHaveLength(0);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'recovery');
    await expectSteps(frame, '73');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.getSnapshotRevision()).toBe(23);

    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10_000 })
      .toBe(0);
    await expect.poll(() => fixture.getSnapshotRevision(), { timeout: 20_000 }).toBe(24);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const secondShell = frame.locator('[data-asa-host-shell]');
    await expect(secondShell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '73');
    expect(fixture.getServerRevision()).toBe(24);
    expect(await readRecoveryRecords(frame)).toEqual([]);
    expect(fixture.pageErrors).toEqual([]);
  } finally {
    await fixture.close();
  }
});

test('rapid dirty edits coalesce to one latest recovery record', async () => {
  const serverProject = recoveryBootstrapFixture();
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
  try {
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '20');

    const program = frame.locator('.blocklyBlockCanvas').first();
    for (const [fromValue, toValue] of [
      ['20', '30'],
      ['30', '73'],
    ]) {
      await program.getByText(fromValue, { exact: true }).dblclick();
      const input = frame.locator('.blocklyHtmlInput:focus');
      await input.fill(toValue);
      await input.press('Enter');
    }

    await expect
      .poll(
        async () => {
          const records = await readRecoveryRecords(frame);
          return { count: records.length, steps: recoverySteps(records[0]) };
        },
        { timeout: 5000 },
      )
      .toEqual({ count: 1, steps: '73' });
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
  } finally {
    await fixture.close();
  }
});

test('normal upstream autosave clears recovery only after durable save', async () => {
  const serverProject = recoveryBootstrapFixture();
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
  try {
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => (await readRecoveryRecords(frame)).length).toBe(1);
    await expect.poll(() => fixture.getServerRevision(), { timeout: 20_000 }).toBe(24);
    await expect
      .poll(async () => (await readRecoveryRecords(frame)).length, { timeout: 10_000 })
      .toBe(0);
  } finally {
    await fixture.close();
  }
});

test('failed server autosave retains recovery', async () => {
  const serverProject = recoveryBootstrapFixture();
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
  try {
    const page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    const frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => recoverySteps((await readRecoveryRecords(frame))[0])).toBe('73');
    await expect.poll(() => fixture.runtimeDraftEvidence.length, { timeout: 20_000 }).toBe(1);
    expect(fixture.getServerRevision()).toBe(23);
    expect(recoverySteps((await readRecoveryRecords(frame))[0])).toBe('73');
  } finally {
    await fixture.close();
  }
});

test('different account cannot restore or autosave another principal recovery', async () => {
  const serverProject = recoveryBootstrapFixture();
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
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => (await readRecoveryRecords(frame)).length).toBe(1);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product?account=b`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '10');
    expect(fixture.getServerRevision()).toBe(23);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    const records = await readRecoveryRecords(frame);
    expect(records).toHaveLength(1);
    expect(records[0]?.principalKey).toBe(PRINCIPAL_A);
    expect(recoverySteps(records[0])).toBe('73');
  } finally {
    await fixture.close();
  }
});

test('server-ahead conflict opens server state, does not overwrite, and retains recovery', async () => {
  const serverProject = recoveryBootstrapFixture();
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
  try {
    let page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    let frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    await setSteps(frame, '10', '73');
    await expect.poll(async () => recoverySteps((await readRecoveryRecords(frame))[0])).toBe('73');
    expect(fixture.advanceServerRevision()).toBe(24);

    await fixture.reopenContextWithIndexedDB();
    page = await fixture.context.newPage();
    await page.goto(`${parentOrigin}/product`, { waitUntil: 'domcontentloaded' });
    frame = page.frameLocator('iframe[title="Scratch runtime"]');
    await waitReady(frame);
    const shell = frame.locator('[data-asa-host-shell]');
    await expect(shell).toHaveAttribute('data-recovery-state', 'recovery_conflict');
    await expect(shell).toHaveAttribute('data-project-source', 'runtime-session');
    await expectSteps(frame, '10');
    expect(fixture.getServerRevision()).toBe(24);
    expect(fixture.runtimeDraftEvidence).toHaveLength(0);
    const records = await readRecoveryRecords(frame);
    expect(records).toHaveLength(1);
    expect(records[0]?.baseRevision).toBe(23);
    expect(recoverySteps(records[0])).toBe('73');
  } finally {
    await fixture.close();
  }
});
