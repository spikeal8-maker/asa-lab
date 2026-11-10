import { Readable } from 'node:stream';
import { crc32, deflateRawSync } from 'node:zlib';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import {
  describeLearningFile,
  LEARNING_FILE_CONTENT_TYPE,
  readExactLearningFile,
  registerLearningFileTransport,
  validateLearningFile,
} from './learning-file-transport.js';

describe('learner file transport', () => {
  it('exposes the vendor parser only on the precise learner draft route', async () => {
    const server = Fastify();
    try {
      registerLearningFileTransport(server);
      server.put(
        '/api/learning/file/runs/:activityRunId/draft/:attemptId/:expectedRevision/:requestId',
        async (request) => ({
          bytes: (
            await readExactLearningFile(request.body as Readable, 3, AbortSignal.timeout(500))
          ).toString(),
        }),
      );
      server.put('/unrelated', async () => ({ unexpected: true }));
      const request = {
        method: 'PUT' as const,
        headers: { 'content-type': LEARNING_FILE_CONTENT_TYPE },
        payload: Buffer.from('abc'),
      };
      const uploaded = await server.inject({
        ...request,
        url: '/api/learning/file/runs/run/draft/attempt/0/request',
      });
      expect(uploaded.statusCode).toBe(200);
      expect(uploaded.json()).toEqual({ bytes: 'abc' });
      expect((await server.inject({ ...request, url: '/unrelated' })).statusCode).toBe(415);
      expect(
        (
          await server.inject({
            ...request,
            url: '/api/learning/file/runs/run/draft/attempt/0/request',
            headers: { ...request.headers, 'content-encoding': 'gzip' },
          })
        ).statusCode,
      ).toBe(415);
    } finally {
      await server.close();
    }
  });

  it('rejects an incomplete or oversized body regardless of declared length', async () => {
    const signal = AbortSignal.timeout(1_000);
    await expect(
      readExactLearningFile(Readable.from([Buffer.from('abc')]), 2, signal),
    ).rejects.toThrow();
    await expect(
      readExactLearningFile(Readable.from([Buffer.from('a')]), 2, signal),
    ).rejects.toThrow();
  });

  it('validates names, encoded content, and per-format caps independently', async () => {
    const text = describeLearningFile(encodeURIComponent('Отчёт.txt'));
    expect(text).toMatchObject({ name: 'Отчёт.txt', maxBytes: 50_000_000 });
    expect(describeLearningFile('scan.PDF').maxBytes).toBe(25_000_000);
    expect(describeLearningFile('photo.jpg').maxBytes).toBe(20_000_000);
    expect(() => describeLearningFile('..%2Fforeign.txt')).toThrow();
    expect(() => describeLearningFile('work.svg')).toThrow();
    await expect(validateLearningFile(Buffer.from('Отчёт'), text)).resolves.toBeUndefined();
    await expect(validateLearningFile(Buffer.from([0xff]), text)).rejects.toThrow();
    await expect(validateLearningFile(Buffer.from('<html>'), text)).rejects.toThrow();
    await expect(
      validateLearningFile(Buffer.from('not an image'), describeLearningFile('x.png')),
    ).rejects.toThrow();
    await expect(
      validateLearningFile(Buffer.from('%PDF-1.4\n% fake\n%%EOF'), describeLearningFile('x.pdf')),
    ).rejects.toThrow();
    await expect(
      validateLearningFile(
        Buffer.from(
          '%PDF-1.4\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n9\n%%EOF\n',
        ),
        describeLearningFile('x.pdf'),
      ),
    ).resolves.toBeUndefined();
  });
});

type ZipFixture = string | { body: string; size?: number; checksum?: number };
function fixtureZip(files: Record<string, ZipFixture>): Buffer {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const [name, fixture] of Object.entries(files)) {
    const path = Buffer.from(name);
    const stored = typeof fixture === 'string';
    const original = Buffer.from(stored ? fixture : fixture.body);
    const payload = stored ? original : deflateRawSync(original);
    const checksum = stored ? crc32(original) : (fixture.checksum ?? crc32(original));
    const size = stored ? original.length : (fixture.size ?? original.length);
    const entry = Buffer.alloc(30);
    entry.writeUInt32LE(0x04034b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(stored ? 0 : 8, 8);
    entry.writeUInt32LE(checksum, 14);
    entry.writeUInt32LE(payload.length, 18);
    entry.writeUInt32LE(size, 22);
    entry.writeUInt16LE(path.length, 26);
    local.push(entry, path, payload);

    const reference = Buffer.alloc(46);
    reference.writeUInt32LE(0x02014b50, 0);
    reference.writeUInt16LE(20, 4);
    reference.writeUInt16LE(20, 6);
    reference.writeUInt16LE(stored ? 0 : 8, 10);
    reference.writeUInt32LE(checksum, 16);
    reference.writeUInt32LE(payload.length, 20);
    reference.writeUInt32LE(size, 24);
    reference.writeUInt16LE(path.length, 28);
    reference.writeUInt32LE(offset, 42);
    directory.push(reference, path);
    offset += entry.length + path.length + payload.length;
  }
  const count = Object.keys(files).length;
  const central = Buffer.concat(directory);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(count, 8);
  end.writeUInt16LE(count, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, central, end]);
}

describe('learning archive and STL format gates', () => {
  const validate = (extension: string, bytes: Buffer) =>
    validateLearningFile(bytes, describeLearningFile('work.' + extension));

  it('admits bounded ZIP while rejecting dangerous paths, active files and malformed layouts', async () => {
    const archive = fixtureZip({ 'report.txt': 'abc' });
    await expect(validate('zip', archive)).resolves.toBeUndefined();
    await expect(validate('zip', fixtureZip({ '../report.txt': 'abc' }))).rejects.toThrow();
    await expect(validate('zip', fixtureZip({ 'run.bat': 'abc' }))).rejects.toThrow();
    await expect(
      validate('zip', Buffer.concat([Buffer.from('prefix'), archive])),
    ).rejects.toThrow();
    await expect(validate('zip', archive.subarray(0, -1))).rejects.toThrow();
  });

  it('checks exact inflated lengths, CRC and hard caps of non-manifest entries', async () => {
    const payload = 'a'.repeat(1024 * 1024);
    await expect(
      validate('zip', fixtureZip({ 'valid.txt': { body: payload } })),
    ).resolves.toBeUndefined();
    await expect(
      validate('zip', fixtureZip({ 'bad-size.txt': { body: payload, size: 1 } })),
    ).rejects.toThrow();
    await expect(
      validate('zip', fixtureZip({ 'bad-crc.txt': { body: 'abc', checksum: 0 } })),
    ).rejects.toThrow();
    await expect(
      validate('zip', fixtureZip({ 'per-entry.txt': { body: 'a', size: 50_000_001 } })),
    ).rejects.toThrow();
    const aggregate = Object.fromEntries(
      Array.from({ length: 5 }, (_, index) => [index + '.txt', { body: 'a', size: 41_000_000 }]),
    );
    await expect(validate('zip', fixtureZip(aggregate))).rejects.toThrow();
  });

  it('distinguishes Office and Scratch containers from renamed ZIPs and rejects macro parts', async () => {
    const office = {
      '[Content_Types].xml':
        '<Types><Override ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      'word/document.xml': '<document/>',
      '_rels/.rels': '<Relationships/>',
    };
    await expect(validate('docx', fixtureZip(office))).resolves.toBeUndefined();
    await expect(
      validate(
        'docx',
        fixtureZip({
          ...office,
          'word/document.xml': { body: '<document/>', checksum: 0 },
        }),
      ),
    ).rejects.toThrow();
    await expect(validate('xlsx', fixtureZip(office))).rejects.toThrow();
    await expect(
      validate('docx', fixtureZip({ ...office, 'word/vbaProject.bin': 'macro' })),
    ).rejects.toThrow();
    const scratch = fixtureZip({
      'project.json': JSON.stringify({ targets: [{}], meta: { semver: '3.0.0' } }),
      ['a'.repeat(32) + '.svg']: '<svg/>',
    });
    await expect(validate('sb3', scratch)).resolves.toBeUndefined();
    await expect(validate('sb3', fixtureZip({ 'project.json': '{}' }))).rejects.toThrow();
  });

  it('admits structurally complete STL and rejects truncated and non-finite geometry', async () => {
    const binary = Buffer.alloc(134);
    binary.writeUInt32LE(1, 80);
    await expect(validate('stl', binary)).resolves.toBeUndefined();
    await expect(validate('stl', binary.subarray(0, -1))).rejects.toThrow();
    binary.writeFloatLE(Infinity, 84);
    await expect(validate('stl', binary)).rejects.toThrow();
    const ascii = Buffer.from(
      'solid a\nfacet normal 0 0 1\nouter loop\nvertex 0 0 0\nvertex 1 0 0\nvertex 0 1 0\nendloop\nendfacet\nendsolid a\n',
    );
    await expect(validate('stl', ascii)).resolves.toBeUndefined();
  });
});
