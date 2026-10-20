import { createHash, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { BlocksObjectStorageConfig } from '../../apps/api/src/blocks-asset-storage';
import {
  aiAttachmentObjectKey,
  AiAttachmentStorageError,
  S3AiAttachmentBlobStore,
  type AiAttachmentObject,
  type AiS3Sender,
} from '../../apps/api/src/ai-attachments/blob-store';
import { aiAttachmentImageFixture } from '../../apps/api/src/ai-attachments/validation.fixture';

interface FixtureConfiguration extends BlocksObjectStorageConfig {
  runId: string;
  sha: string;
  containerName: string;
  imageName: string;
  labels: Record<string, string>;
}
interface FixtureModule {
  readAiAttachmentFixtureEnvironment(env: NodeJS.ProcessEnv): FixtureConfiguration;
  assertAiAttachmentFixtureContainer(
    value: unknown,
    fixture: FixtureConfiguration,
    requireRunning?: boolean,
  ): string;
  assertAiAttachmentFixtureRunning(fixture: FixtureConfiguration): string;
}
interface S3Response {
  $metadata?: { httpStatusCode?: number };
  ContentLength?: number;
  CacheControl?: string;
  Metadata?: Record<string, string>;
  VersionId?: string;
  Status?: string;
  TagSet?: { Key?: string; Value?: string }[];
  Versions?: { Key?: string; VersionId?: string }[];
  DeleteMarkers?: { Key?: string; VersionId?: string }[];
  IsTruncated?: boolean;
}
interface TestS3Client {
  send(command: unknown, options?: { abortSignal?: AbortSignal }): Promise<S3Response>;
  destroy(): void;
}
type S3CommandConstructor = new (input: object) => unknown;
interface TestS3Module {
  S3Client: new (config: object) => TestS3Client;
  HeadBucketCommand: S3CommandConstructor;
  GetBucketTaggingCommand: S3CommandConstructor;
  GetBucketVersioningCommand: S3CommandConstructor;
  HeadObjectCommand: S3CommandConstructor;
  PutObjectCommand: S3CommandConstructor;
  DeleteObjectCommand: S3CommandConstructor;
  ListObjectVersionsCommand: S3CommandConstructor;
}

const fixtureModule = (await import(
  new URL('./minio-fixture.mjs', import.meta.url).href
)) as FixtureModule;
// The existing SDK belongs to apps/api. Resolve its installed dependency through
// that package instead of adding a second SDK or changing the lockfile for tests.
const sdk = createRequire(new URL('../../apps/api/package.json', import.meta.url))(
  '@aws-sdk/client-s3',
) as TestS3Module;
const optIn = process.env.ASA_AI_ATTACHMENTS_STORAGE_TEST;
if (optIn !== undefined && optIn !== '' && optIn !== '1')
  throw new Error('ASA_AI_ATTACHMENTS_STORAGE_TEST must be unset or exactly 1');
const enabled = optIn === '1';
// Once explicitly selected, invalid/missing configuration is a collection FAIL.
// An ordinary general test run reports the real S3 suite below as SKIPPED.
const selected = enabled
  ? fixtureModule.readAiAttachmentFixtureEnvironment(process.env)
  : undefined;

function syntheticEnvironment(): NodeJS.ProcessEnv {
  return {
    ASA_AI_ATTACHMENTS_STORAGE_TEST: '1',
    GITHUB_ACTIONS: 'true',
    GITHUB_RUN_ID: '123456789',
    GITHUB_SHA: 'a'.repeat(40),
    ASA_OBJECT_STORAGE_ENDPOINT: 'http://127.0.0.1:19000',
    ASA_OBJECT_STORAGE_REGION: 'us-east-1',
    ASA_OBJECT_STORAGE_BUCKET: 'ai-attachments-123456789',
    ASA_OBJECT_STORAGE_FORCE_PATH_STYLE: 'true',
    ASA_OBJECT_STORAGE_ACCESS_KEY: 'ai-attachments-ci-only',
    ASA_OBJECT_STORAGE_SECRET_KEY: 'ai-attachments-ci-only-secret',
  };
}

function containerInspection(fixture: FixtureConfiguration) {
  return {
    Id: 'b'.repeat(64),
    Name: `/${fixture.containerName}`,
    Image: `sha256:${'c'.repeat(64)}`,
    Config: {
      Image: fixture.imageName,
      Labels: {
        ...fixture.labels,
        'asa.ai-attachments.image': `sha256:${'c'.repeat(64)}`,
      } as Record<string, string>,
    },
    HostConfig: {
      Privileged: false,
      NetworkMode: 'bridge',
      PublishAllPorts: false,
      ReadonlyRootfs: true,
      Binds: [] as string[],
      PortBindings: { '9000/tcp': [{ HostIp: '127.0.0.1', HostPort: '19000' }] },
      Tmpfs: {
        '/data': 'rw,nosuid,nodev,noexec,size=512m,uid=1000,gid=1000,mode=0700',
        '/tmp': 'rw,nosuid,nodev,noexec,size=64m,uid=1000,gid=1000,mode=0700',
      },
    },
    Mounts: [
      { Type: 'tmpfs', Destination: '/data' },
      { Type: 'tmpfs', Destination: '/tmp' },
    ],
    State: { Running: true },
    NetworkSettings: { Ports: { '9000/tcp': [{ HostIp: '127.0.0.1', HostPort: '19000' }] } },
  };
}

describe('AI attachment MinIO fixture guard (pure, no Docker or S3)', () => {
  it('selects only the exact synthetic run and returns a checked immutable container ID', () => {
    const fixture = fixtureModule.readAiAttachmentFixtureEnvironment(syntheticEnvironment());
    expect(fixture.containerName).toBe('asa-ai-attachments-objects-123456789');
    expect(fixture.bucket).toBe('ai-attachments-123456789');
    expect(Object.isFrozen(fixture)).toBe(true);
    expect(
      fixtureModule.assertAiAttachmentFixtureContainer(containerInspection(fixture), fixture, true),
    ).toBe('b'.repeat(64));
  });

  it.each([
    ['ASA_AI_ATTACHMENTS_STORAGE_TEST', ''],
    ['ASA_AI_ATTACHMENTS_STORAGE_TEST', 'true'],
    ['GITHUB_ACTIONS', 'false'],
    ['GITHUB_RUN_ID', '../123'],
    ['GITHUB_RUN_ID', '0'],
    ['GITHUB_RUN_ID', '1'.repeat(21)],
    ['GITHUB_SHA', 'a'.repeat(39)],
    ['GITHUB_SHA', 'A'.repeat(40)],
    ['ASA_OBJECT_STORAGE_ENDPOINT', 'https://storage.example.invalid'],
    ['ASA_OBJECT_STORAGE_ENDPOINT', 'http://127.0.0.1:19000/'],
    ['ASA_OBJECT_STORAGE_ENDPOINT', 'http://127.0.0.1:19001'],
    ['ASA_OBJECT_STORAGE_REGION', 'eu-west-1'],
    ['ASA_OBJECT_STORAGE_BUCKET', 'working-bucket'],
    ['ASA_OBJECT_STORAGE_BUCKET', 'ai-attachments-987654321'],
    ['ASA_OBJECT_STORAGE_ACCESS_KEY', 'working-access-key'],
    ['ASA_OBJECT_STORAGE_SECRET_KEY', 'working-secret-key'],
    ['ASA_OBJECT_STORAGE_FORCE_PATH_STYLE', 'false'],
    ['DOCKER_HOST', 'tcp://other-host.invalid:2375'],
    ['DOCKER_CONTEXT', 'working-installation'],
  ])('rejects unsafe or mismatched %s without contacting storage', (name, value) => {
    expect(() =>
      fixtureModule.readAiAttachmentFixtureEnvironment({
        ...syntheticEnvironment(),
        [name]: value,
      }),
    ).toThrow();
  });

  it('requires every selected fixture setting rather than falling back to ambient SDK configuration', () => {
    for (const name of Object.keys(syntheticEnvironment())) {
      const env = syntheticEnvironment();
      delete env[name];
      expect(() => fixtureModule.readAiAttachmentFixtureEnvironment(env), name).toThrow();
    }
  });

  it.each([
    'run',
    'sha',
    'image',
    'name',
    'id',
    'bind-mount',
    'volume',
    'other-tmpfs',
    'public-port',
    'extra-port',
    'host-network',
    'privileged',
    'writable-root',
    'running-port',
  ])('refuses %s substitution before a container could be removed or queried', (kind) => {
    const fixture = fixtureModule.readAiAttachmentFixtureEnvironment(syntheticEnvironment());
    const value = containerInspection(fixture);
    if (kind === 'run') value.Config.Labels['asa.ai-attachments.run'] = '987654321';
    if (kind === 'sha') value.Config.Labels['asa.ai-attachments.sha'] = 'd'.repeat(40);
    if (kind === 'image') value.Image = `sha256:${'d'.repeat(64)}`;
    if (kind === 'name') value.Name = '/working-installation';
    if (kind === 'id') value.Id = 'working-installation';
    if (kind === 'bind-mount') value.HostConfig.Binds = ['/working-data:/data'];
    if (kind === 'volume') value.Mounts[0]!.Type = 'volume';
    if (kind === 'other-tmpfs') value.Mounts[0]!.Destination = '/working-data';
    if (kind === 'public-port') value.HostConfig.PortBindings['9000/tcp'][0]!.HostIp = '0.0.0.0';
    if (kind === 'extra-port')
      value.HostConfig.PortBindings['9000/tcp'].push({ HostIp: '127.0.0.1', HostPort: '19001' });
    if (kind === 'host-network') value.HostConfig.NetworkMode = 'host';
    if (kind === 'privileged') value.HostConfig.Privileged = true;
    if (kind === 'writable-root') value.HostConfig.ReadonlyRootfs = false;
    if (kind === 'running-port') value.NetworkSettings.Ports['9000/tcp'][0]!.HostPort = '19001';
    expect(() => fixtureModule.assertAiAttachmentFixtureContainer(value, fixture, true)).toThrow(
      'Refusing foreign or non-disposable',
    );
  });

  it('permits cleanup of an owned stopped fixture but never uses it as a live test endpoint', () => {
    const fixture = fixtureModule.readAiAttachmentFixtureEnvironment(syntheticEnvironment());
    const value = containerInspection(fixture);
    value.State.Running = false;
    expect(fixtureModule.assertAiAttachmentFixtureContainer(value, fixture)).toBe(value.Id);
    expect(() => fixtureModule.assertAiAttachmentFixtureContainer(value, fixture, true)).toThrow();
  });
});

function httpStatus(problem: unknown): number | undefined {
  if (problem === null || typeof problem !== 'object') return undefined;
  return (problem as S3Response).$metadata?.httpStatusCode;
}

function storageDiagnostic(value: unknown) {
  const status = httpStatus(value);
  const name = value instanceof Error ? value.name : undefined;
  return {
    httpStatus:
      typeof status === 'number' && Number.isInteger(status) && status >= 100 && status <= 599
        ? status
        : null,
    errorName:
      typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,79}$/.test(name) ? name : null,
    outcome: value instanceof AiAttachmentStorageError ? value.outcome : null,
  };
}

describe.skipIf(!enabled)(
  'AI attachments real MinIO/S3 integration (explicit CI fixture only)',
  () => {
    let client: TestS3Client | undefined;
    let directory: string | undefined;
    let containerId: string;
    const stores: S3AiAttachmentBlobStore[] = [];
    const ownedKeys = new Set<string>();

    function fixture(): FixtureConfiguration {
      if (!selected) throw new Error('Explicit AI attachment S3 fixture was not selected');
      return selected;
    }
    function liveClient(): TestS3Client {
      if (!client) throw new Error('Real AI attachment S3 client was not initialized');
      return client;
    }
    function send(command: unknown, milliseconds = 5000): Promise<S3Response> {
      return liveClient().send(command, { abortSignal: AbortSignal.timeout(milliseconds) });
    }
    function store(sender?: AiS3Sender): S3AiAttachmentBlobStore {
      const value = new S3AiAttachmentBlobStore(fixture(), sender);
      stores.push(value);
      return value;
    }
    async function assertBucketIdentity(): Promise<void> {
      const result = await send(new sdk.GetBucketTaggingCommand({ Bucket: fixture().bucket }));
      expect(Object.fromEntries((result.TagSet ?? []).map((tag) => [tag.Key, tag.Value]))).toEqual({
        'asa-ai-attachments-fixture': '1',
        'asa-ai-attachments-run': fixture().runId,
        'asa-ai-attachments-sha': fixture().sha,
      });
    }
    async function objectFixture(
      bytes: Buffer = aiAttachmentImageFixture('png'),
      ownerId: string = randomUUID(),
      uploadId: string = randomUUID(),
    ) {
      if (!directory) throw new Error('Private S3 test directory was not initialized');
      if (ownedKeys.size >= 24) throw new Error('Bounded S3 test object budget exceeded');
      const object: AiAttachmentObject = {
        ownerId,
        uploadId,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        sizeBytes: bytes.length,
      };
      const sourcePath = join(directory, randomUUID());
      const key = aiAttachmentObjectKey(object);
      ownedKeys.add(key);
      await writeFile(sourcePath, bytes, { mode: 0o600, flag: 'wx' });
      return {
        object,
        bytes,
        key,
        input: {
          ...object,
          sourcePath,
          md5Base64: createHash('md5').update(bytes).digest('base64'),
        },
      };
    }
    function rawPut(object: AiAttachmentObject, bytes: Buffer, ownerId = object.ownerId) {
      return new sdk.PutObjectCommand({
        Bucket: fixture().bucket,
        Key: aiAttachmentObjectKey(object),
        Body: bytes,
        ContentLength: bytes.length,
        ContentMD5: createHash('md5').update(bytes).digest('base64'),
        IfNoneMatch: '*',
        ContentType: 'application/octet-stream',
        CacheControl: 'private, no-store',
        Metadata: {
          'asa-ai-owner': ownerId,
          'asa-ai-upload': object.uploadId,
          'asa-sha256': object.sha256,
        },
      });
    }
    async function versions(key: string, milliseconds = 5000) {
      const result = await send(
        new sdk.ListObjectVersionsCommand({
          Bucket: fixture().bucket,
          Prefix: key,
          MaxKeys: 32,
        }),
        milliseconds,
      );
      expect(result.IsTruncated).not.toBe(true);
      const existing = [...(result.Versions ?? []), ...(result.DeleteMarkers ?? [])].filter(
        (version) => version.Key === key,
      );
      expect(existing.length).toBeLessThanOrEqual(8);
      return { result, existing };
    }

    beforeAll(async () => {
      // Validate Docker provenance before even the first signed storage request.
      containerId = fixtureModule.assertAiAttachmentFixtureRunning(fixture());
      client = new sdk.S3Client({
        endpoint: fixture().endpoint,
        region: fixture().region,
        forcePathStyle: fixture().forcePathStyle,
        maxAttempts: 1,
        credentials: {
          accessKeyId: fixture().accessKeyId,
          secretAccessKey: fixture().secretAccessKey,
        },
      });
      await send(new sdk.HeadBucketCommand({ Bucket: fixture().bucket }));
      await assertBucketIdentity();
      expect(
        await send(new sdk.GetBucketVersioningCommand({ Bucket: fixture().bucket })),
      ).toMatchObject({
        Status: 'Enabled',
      });
      await mkdir('reports', { recursive: true });
      directory = await mkdtemp(join(process.cwd(), 'reports/ai-attachment-real-s3-'));
    }, 30000);

    afterAll(async () => {
      try {
        if (client && ownedKeys.size > 0) {
          expect(fixtureModule.assertAiAttachmentFixtureRunning(fixture())).toBe(containerId);
          await assertBucketIdentity();
          const deadline = Date.now() + 20000;
          const remaining = () => {
            if (Date.now() >= deadline) throw new Error('Bounded owned S3 test cleanup timed out');
            return Math.min(3000, deadline - Date.now());
          };
          // Delete only exact keys this suite created, including deliberately
          // corrupt fixtures. Never list/delete another bucket or owner prefix.
          for (const key of ownedKeys) {
            for (const version of (await versions(key, remaining())).existing) {
              if (!version.VersionId) throw new Error('Refusing unversioned S3 fixture cleanup');
              await send(
                new sdk.DeleteObjectCommand({
                  Bucket: fixture().bucket,
                  Key: key,
                  VersionId: version.VersionId,
                }),
                remaining(),
              );
            }
          }
        }
      } finally {
        for (const value of stores) value.close();
        client?.destroy();
        if (directory) await rm(directory, { recursive: true, force: true });
      }
    }, 30000);

    it('keeps the bucket and actual uploaded bytes private to signed server requests', async () => {
      const f = await objectFixture(),
        blobs = store();
      await blobs.putImmutable(f.input);
      expect(
        await send(new sdk.HeadObjectCommand({ Bucket: fixture().bucket, Key: f.key })),
      ).toMatchObject({
        ContentLength: f.bytes.length,
        CacheControl: 'private, no-store',
        Metadata: {
          'asa-ai-owner': f.object.ownerId,
          'asa-ai-upload': f.object.uploadId,
          'asa-sha256': f.object.sha256,
        },
      });
      for (const [method, path] of [
        ['GET', `${fixture().bucket}/${f.key}`],
        ['HEAD', `${fixture().bucket}/${f.key}`],
        ['GET', `${fixture().bucket}?list-type=2`],
      ]) {
        const response = await fetch(`${fixture().endpoint}/${path}`, {
          method,
          credentials: 'omit',
          redirect: 'error',
          signal: AbortSignal.timeout(5000),
        });
        try {
          expect(response.status, `anonymous ${method}`).toBe(403);
        } finally {
          await response.body?.cancel();
        }
      }
      expect(await blobs.read(f.object)).toEqual(f.bytes);
    }, 30000);

    it('keeps equal upload IDs and digests in separate owner prefixes, including deletion', async () => {
      const a = await objectFixture(),
        blobs = store();
      await blobs.putImmutable(a.input);
      const absentOwner = { ...a.object, ownerId: randomUUID() };
      expect(await blobs.read(absentOwner)).toBeNull();
      expect(await blobs.verify(absentOwner)).toBe(false);
      expect(await blobs.remove(absentOwner)).toBe(true);
      expect(await blobs.read(a.object)).toEqual(a.bytes);
      const b = await objectFixture(a.bytes, randomUUID(), a.object.uploadId);
      expect(b.key).not.toBe(a.key);
      await blobs.putImmutable(b.input);
      expect(await blobs.remove(a.object)).toBe(true);
      expect(await blobs.read(a.object)).toBeNull();
      expect(await blobs.read(b.object)).toEqual(b.bytes);
    }, 30000);

    it('reads the complete real S3 body and rejects size or final-byte digest corruption', async () => {
      const bytes = Buffer.from('bounded private attachment\n'.repeat(10000));
      const f = await objectFixture(bytes),
        blobs = store();
      await blobs.putImmutable(f.input);
      const read = await blobs.read(f.object);
      expect(read).toEqual(bytes);
      expect(createHash('sha256').update(read!).digest('hex')).toBe(f.object.sha256);
      await expect(
        blobs.read({ ...f.object, sizeBytes: f.object.sizeBytes - 1 }),
      ).rejects.toMatchObject({ outcome: 'integrity' });

      const corrupt = await objectFixture(bytes),
        altered = Buffer.from(bytes);
      altered[altered.length - 1] = altered[altered.length - 1]! ^ 1;
      await send(rawPut(corrupt.object, altered));
      // The real HEAD is internally consistent; only hashing the full GET catches this.
      expect(
        await send(new sdk.HeadObjectCommand({ Bucket: fixture().bucket, Key: corrupt.key })),
      ).toMatchObject({
        ContentLength: corrupt.object.sizeBytes,
        Metadata: { 'asa-sha256': corrupt.object.sha256 },
      });
      await expect(blobs.read(corrupt.object)).rejects.toMatchObject({ outcome: 'integrity' });
      await expect(blobs.verify(corrupt.object)).rejects.toMatchObject({ outcome: 'integrity' });
      await expect(blobs.remove(corrupt.object)).rejects.toMatchObject({ outcome: 'integrity' });
      expect((await versions(corrupt.key)).existing).toHaveLength(1);
    }, 30000);

    it('rejects foreign object metadata without deleting the existing object', async () => {
      const f = await objectFixture(),
        blobs = store();
      await send(rawPut(f.object, f.bytes, randomUUID()));
      await expect(blobs.read(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
      await expect(blobs.verify(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
      await expect(blobs.remove(f.object)).rejects.toMatchObject({ outcome: 'integrity' });
      expect((await versions(f.key)).existing).toHaveLength(1);
    }, 30000);

    it('allows only one actual conditional write when two writers race and refuses replacement', async () => {
      const f = await objectFixture();
      const putStatuses: (number | undefined)[] = [];
      const operations: (ReturnType<typeof storageDiagnostic> & {
        operation: string;
        status: 'fulfilled' | 'rejected';
      })[] = [];
      let putCalls = 0;
      const sender: AiS3Sender = {
        async send(command, options) {
          const isPut = command instanceof sdk.PutObjectCommand;
          if (isPut) putCalls++;
          try {
            const result = await liveClient().send(command, options);
            if (isPut) putStatuses.push(result.$metadata?.httpStatusCode);
            operations.push({
              operation: command.constructor.name,
              status: 'fulfilled',
              ...storageDiagnostic(result),
            });
            return result;
          } catch (problem) {
            if (isPut) putStatuses.push(httpStatus(problem));
            operations.push({
              operation: command.constructor.name,
              status: 'rejected',
              ...storageDiagnostic(problem),
            });
            throw problem;
          }
        },
      };
      const results = await Promise.allSettled([
        store(sender).putImmutable(f.input),
        store(sender).putImmutable(f.input),
      ]);
      // Serialize only completed operation summaries, never bodies, keys, credentials or stacks.
      const diagnostics = JSON.stringify({
        putCalls,
        putStatuses,
        operations,
        results: results.map((result) => ({
          status: result.status,
          ...(result.status === 'rejected' ? storageDiagnostic(result.reason) : {}),
        })),
      });
      expect(
        results.map((result) => result.status),
        diagnostics,
      ).toEqual(['fulfilled', 'fulfilled']);
      expect(putCalls).toBe(2);
      expect(putStatuses.filter((value) => value === 200)).toHaveLength(1);
      expect(putStatuses.filter((value) => value === 409 || value === 412)).toHaveLength(1);
      expect((await versions(f.key)).existing).toHaveLength(1);
      const replacement = Buffer.alloc(f.bytes.length, 1);
      await expect(send(rawPut(f.object, replacement))).rejects.toMatchObject({
        $metadata: { httpStatusCode: 412 },
      });
      expect(await store().read(f.object)).toEqual(f.bytes);
      expect((await versions(f.key)).existing).toHaveLength(1);
    }, 30000);

    it('reconciles a lost PUT reply after real persistence using real HEAD and full GET, with no second PUT', async () => {
      const f = await objectFixture(),
        operations: string[] = [];
      const sender: AiS3Sender = {
        async send(command, options) {
          const result = await liveClient().send(command, options);
          operations.push(command.constructor.name);
          if (command instanceof sdk.PutObjectCommand)
            throw new Error('synthetic reply loss AFTER actual S3 PUT persistence');
          return result;
        },
      };
      await expect(store(sender).putImmutable(f.input)).resolves.toBeUndefined();
      expect(operations).toEqual(['PutObjectCommand', 'HeadObjectCommand', 'GetObjectCommand']);
      expect(await store().read(f.object)).toEqual(f.bytes);
      expect((await versions(f.key)).existing).toHaveLength(1);
    }, 30000);

    it('keeps an actual persisted PUT uncertain when its immediate verification reply is also lost, then reconciles without rewriting', async () => {
      const f = await objectFixture();
      let putCalls = 0,
        headRepliesLost = 0;
      const sender: AiS3Sender = {
        async send(command, options) {
          const result = await liveClient().send(command, options);
          if (command instanceof sdk.PutObjectCommand) {
            putCalls++;
            throw new Error('synthetic reply loss AFTER actual S3 PUT persistence');
          }
          if (command.constructor.name === 'HeadObjectCommand' && headRepliesLost++ === 0)
            throw new Error('synthetic reply loss AFTER actual S3 HEAD');
          return result;
        },
      };
      const blobs = store(sender);
      await expect(blobs.putImmutable(f.input)).rejects.toMatchObject({ outcome: 'unknown' });
      expect(await blobs.verify(f.object)).toBe(true);
      expect(await blobs.read(f.object)).toEqual(f.bytes);
      expect(putCalls).toBe(1);
      expect((await versions(f.key)).existing).toHaveLength(1);
    }, 30000);

    it('recovers a lost actual DELETE reply through absence, removes the observed version and never recreates bytes', async () => {
      const f = await objectFixture();
      await store().putImmutable(f.input);
      const before = await send(
        new sdk.HeadObjectCommand({ Bucket: fixture().bucket, Key: f.key }),
      );
      expect(before.VersionId).toBeTypeOf('string');
      expect(before.VersionId).not.toBe('null');
      const deletedVersions: (string | undefined)[] = [];
      let putCalls = 0;
      const sender: AiS3Sender = {
        async send(command, options) {
          if (command instanceof sdk.PutObjectCommand) putCalls++;
          const result = await liveClient().send(command, options);
          if (command instanceof sdk.DeleteObjectCommand) {
            deletedVersions.push((command.input as { VersionId?: string }).VersionId);
            throw new Error('synthetic reply loss AFTER actual S3 DELETE');
          }
          return result;
        },
      };
      const blobs = store(sender);
      await expect(blobs.remove(f.object)).rejects.toThrow('AFTER actual S3 DELETE');
      await expect(
        send(new sdk.HeadObjectCommand({ Bucket: fixture().bucket, Key: f.key })),
      ).rejects.toMatchObject({
        $metadata: { httpStatusCode: 404 },
      });
      expect(await blobs.remove(f.object)).toBe(true);
      expect(await blobs.read(f.object)).toBeNull();
      expect(deletedVersions).toEqual([before.VersionId]);
      expect(putCalls).toBe(0);
      // A bare versioned DELETE would leave both bytes and a delete marker here.
      expect((await versions(f.key)).existing).toEqual([]);
    }, 30000);
  },
);
