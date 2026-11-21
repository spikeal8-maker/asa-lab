import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { S3Client, PutObjectCommand, CreateBucketCommand } from '@aws-sdk/client-s3';
import type pg from 'pg';

export async function persistPublicScratchFixture(tenant: string, pool: pg.Pool) {
  const f = publicScratchFixture();
  const storage = new S3Client({
    endpoint: process.env['ASA_OBJECT_STORAGE_ENDPOINT']!,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env['ASA_OBJECT_STORAGE_ACCESS_KEY']!,
      secretAccessKey: process.env['ASA_OBJECT_STORAGE_SECRET_KEY']!,
    },
  });
  const bucket = process.env['ASA_OBJECT_STORAGE_BUCKET']!;
  try {
    try {
      await storage.send(new CreateBucketCommand({ Bucket: bucket }));
    } catch (error) {
      if (
        !['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(String((error as Error).name))
      )
        throw error;
    }
    const objectKey = `tenants/${tenant}/blocks/assets/${f.ref.sha256.slice(0, 2)}/${f.ref.sha256}.svg`;
    await storage.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectKey,
        Body: f.bytes,
        ContentType: 'image/svg+xml',
        Metadata: { 'asa-sha256': f.ref.sha256 },
      }),
    );
    await pool.query(
      'INSERT INTO blocks_blobs(tenant_id,sha256,data_format,size_bytes,object_key) VALUES($1,$2,$3,$4,$5)',
      [tenant, f.ref.sha256, 'svg', f.bytes.length, objectKey],
    );
    await pool.query(
      'INSERT INTO blocks_asset_aliases(tenant_id,asset_id,data_format,sha256) VALUES($1,$2,$3,$4)',
      [tenant, f.ref.assetId, 'svg', f.ref.sha256],
    );
  } finally {
    storage.destroy();
  }
  return f;
}

/** Original repository SVG fixture, not a VM or a fake asset endpoint. */
export function publicScratchFixture() {
  const bytes = readFileSync(
    'apps/api/src/testing/fixtures/scratch-library/1e2c3987e4cdb1f317b1773662719b13.svg',
  );
  const assetId = createHash('md5').update(bytes).digest('hex');
  const ref = {
    assetId,
    dataFormat: 'svg' as const,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
  };
  const stage = {
    isStage: true,
    name: 'Stage',
    variables: { counter: ['counter', 0] },
    lists: {},
    broadcasts: {},
    blocks: {
      start: {
        opcode: 'event_whenflagclicked',
        next: 'forever',
        parent: null,
        inputs: {},
        fields: {},
        shadow: false,
        topLevel: true,
        x: 20,
        y: 30,
      },
      forever: {
        opcode: 'control_forever',
        next: null,
        parent: 'start',
        inputs: { SUBSTACK: [2, 'change'] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
      change: {
        opcode: 'data_changevariableby',
        next: 'wait',
        parent: 'forever',
        inputs: { VALUE: [1, [4, '1']] },
        fields: { VARIABLE: ['counter', 'counter'] },
        shadow: false,
        topLevel: false,
      },
      wait: {
        opcode: 'control_wait',
        next: null,
        parent: 'change',
        inputs: { DURATION: [1, [4, '0.05']] },
        fields: {},
        shadow: false,
        topLevel: false,
      },
    },
    comments: {},
    currentCostume: 0,
    costumes: [
      {
        name: 'Published library shape',
        assetId,
        md5ext: `${assetId}.svg`,
        dataFormat: 'svg',
        bitmapResolution: 1,
        rotationCenterX: 25,
        rotationCenterY: 25,
      },
    ],
    sounds: [],
    volume: 100,
    layerOrder: 0,
    tempo: 60,
    videoTransparency: 50,
    videoState: 'off',
    textToSpeechLanguage: null,
  };
  const projectJson = {
    targets: [stage],
    monitors: [
      {
        id: 'counter',
        mode: 'default',
        opcode: 'data_variable',
        params: { VARIABLE: 'counter' },
        spriteName: null,
        value: 0,
        width: 0,
        height: 0,
        x: 10,
        y: 10,
        visible: true,
        sliderMin: 0,
        sliderMax: 100,
        isDiscrete: true,
      },
    ],
    extensions: [],
    meta: { semver: '3.0.0', vm: '15.1.1', agent: 'ASA native publication fixture' },
  };
  return {
    bytes,
    ref,
    document: { schemaVersion: 1, format: 'scratch-3', projectJson, assets: [ref] },
  };
}
