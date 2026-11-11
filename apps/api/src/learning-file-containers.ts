import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { crc32, createInflateRaw, inflateRawSync } from 'node:zlib';

const MAX_ENTRY_COUNT = 4_096;
const MAX_ENTRY_BYTES = 50_000_000;
const MAX_EXPANDED_BYTES = 200_000_000;
const MAX_MANIFEST_BYTES = 2_000_000;
const END_RECORD = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const DATA_DESCRIPTOR = 0x08074b50;
const UNAVAILABLE_ENTRY =
  /(?:^|\/)(?:vbaProject\.bin|vbaData\.xml|activeX|embeddings|_xmlsignatures)(?:$|\/)|\.(?:exe|dll|msi|com|scr|sys|bat|cmd|ps1|vbs|js|jar|app|sh|html?|docm|pptm|xlsm|dotm|xlam|ppam|zip|rar|7z|tar|gz)$/iu;

type ArchiveKind = 'zip' | 'docx' | 'pptx' | 'xlsx' | 'sb3';

interface ArchiveEntry {
  start: number;
  compressed: number;
  uncompressed: number;
  method: number;
  crc: number;
}

function requireContainer(condition: unknown): asserts condition {
  if (!condition) throw new Error('invalid learning file container');
}

function decodeName(bytes: Buffer): string {
  const name = new TextDecoder('utf-8', { fatal: true }).decode(bytes).normalize('NFC');
  requireContainer(name.length > 0 && name.length <= 1_024 && !/[:\\\p{Cc}\p{Cf}]/u.test(name));
  const path = name.replace(/\/$/u, '').split('/');
  requireContainer(path.every((part) => part !== '' && part !== '.' && part !== '..'));
  return name;
}

function findEnd(bytes: Buffer): number {
  requireContainer(bytes.length >= 22);
  const floor = Math.max(0, bytes.length - 22 - 65_535);
  for (let offset = bytes.length - 22; offset >= floor; offset--) {
    if (
      bytes.readUInt32LE(offset) === END_RECORD &&
      offset + 22 + bytes.readUInt16LE(offset + 20) === bytes.length
    )
      return offset;
  }
  throw new Error('ZIP end directory not found');
}

function centralDirectory(bytes: Buffer, kind: ArchiveKind): Map<string, ArchiveEntry> {
  const end = findEnd(bytes);
  const count = bytes.readUInt16LE(end + 10);
  const start = bytes.readUInt32LE(end + 16);
  requireContainer(
    bytes.readUInt32LE(end + 4) === 0 &&
      count === bytes.readUInt16LE(end + 8) &&
      count > 0 &&
      count <= MAX_ENTRY_COUNT &&
      start + bytes.readUInt32LE(end + 12) === end,
  );
  const entries = new Map<string, ArchiveEntry>();
  const ranges: Array<{ start: number; end: number }> = [];
  let totalExpanded = 0;
  let cursor = start;
  while (entries.size < count) {
    requireContainer(cursor + 46 <= end && bytes.readUInt32LE(cursor) === DIRECTORY_ENTRY);
    const flags = bytes.readUInt16LE(cursor + 8);
    const method = bytes.readUInt16LE(cursor + 10);
    const crc = bytes.readUInt32LE(cursor + 16);
    const compressed = bytes.readUInt32LE(cursor + 20);
    const uncompressed = bytes.readUInt32LE(cursor + 24);
    const nameLength = bytes.readUInt16LE(cursor + 28);
    const local = bytes.readUInt32LE(cursor + 42);
    const unixType = (bytes.readUInt32LE(cursor + 38) >>> 28) & 0xf;
    const next =
      cursor + 46 + nameLength + bytes.readUInt16LE(cursor + 30) + bytes.readUInt16LE(cursor + 32);
    totalExpanded += uncompressed;
    requireContainer(
      next <= end &&
        nameLength > 0 &&
        bytes.readUInt16LE(cursor + 34) === 0 &&
        (flags & ~0x080e) === 0 &&
        (method === 8 || (method === 0 && compressed === uncompressed)) &&
        uncompressed <= MAX_ENTRY_BYTES &&
        totalExpanded <= MAX_EXPANDED_BYTES &&
        (unixType === 0 || unixType === 4 || unixType === 8) &&
        local + 30 <= start &&
        bytes.readUInt32LE(local) === LOCAL_ENTRY,
    );
    const rawName = bytes.subarray(cursor + 46, cursor + 46 + nameLength);
    const name = decodeName(rawName).toLowerCase();
    const allowedAsset = kind === 'sb3' && /^[a-f0-9]{32}\.svg$/u.test(name);
    requireContainer(
      !entries.has(name) &&
        !UNAVAILABLE_ENTRY.test(name) &&
        (!/\.svgz?$/u.test(name) || allowedAsset) &&
        bytes.readUInt16LE(local + 6) === flags &&
        bytes.readUInt16LE(local + 8) === method &&
        bytes.readUInt16LE(local + 26) === nameLength,
    );
    const payload = local + 30 + nameLength + bytes.readUInt16LE(local + 28);
    let after = payload + compressed;
    requireContainer(
      after <= start && rawName.equals(bytes.subarray(local + 30, local + 30 + nameLength)),
    );
    if ((flags & 8) !== 0) {
      if (after + 4 <= start && bytes.readUInt32LE(after) === DATA_DESCRIPTOR) after += 4;
      requireContainer(
        after + 12 <= start &&
          bytes.readUInt32LE(after) === crc &&
          bytes.readUInt32LE(after + 4) === compressed &&
          bytes.readUInt32LE(after + 8) === uncompressed,
      );
      after += 12;
    } else {
      requireContainer(
        bytes.readUInt32LE(local + 14) === crc &&
          bytes.readUInt32LE(local + 18) === compressed &&
          bytes.readUInt32LE(local + 22) === uncompressed,
      );
    }
    entries.set(name, { start: payload, compressed, uncompressed, method, crc });
    ranges.push({ start: local, end: after });
    cursor = next;
  }
  requireContainer(cursor === end);
  ranges.sort((left, right) => left.start - right.start);
  let previousEnd = 0;
  for (const range of ranges) {
    requireContainer(range.start === previousEnd);
    previousEnd = range.end;
  }
  requireContainer(previousEnd === start);
  return entries;
}

async function verifyEntry(bytes: Buffer, entry: ArchiveEntry): Promise<void> {
  const payload = bytes.subarray(entry.start, entry.start + entry.compressed);
  if (entry.method === 0) {
    requireContainer(crc32(payload) === entry.crc);
    return;
  }
  const inflater = createInflateRaw();
  let actual = 0;
  let checksum = 0;
  await pipeline(Readable.from([payload]), inflater, async (chunks) => {
    for await (const chunk of chunks) {
      actual += chunk.length;
      requireContainer(actual <= entry.uncompressed);
      checksum = crc32(chunk, checksum);
    }
  });
  requireContainer(
    actual === entry.uncompressed &&
      checksum === entry.crc &&
      inflater.bytesWritten === entry.compressed,
  );
}

function readManifest(bytes: Buffer, entry: ArchiveEntry | undefined): string {
  requireContainer(entry && entry.uncompressed > 0 && entry.uncompressed <= MAX_MANIFEST_BYTES);
  const payload = bytes.subarray(entry.start, entry.start + entry.compressed);
  const decoded =
    entry.method === 8 ? inflateRawSync(payload, { maxOutputLength: entry.uncompressed }) : payload;
  requireContainer(decoded.length === entry.uncompressed && crc32(decoded) === entry.crc);
  return new TextDecoder('utf-8', { fatal: true }).decode(decoded);
}

/** Verify exact archive entry sizes and checksums without retaining expanded entries. */
export async function validateLearningArchive(bytes: Buffer, kind: ArchiveKind): Promise<void> {
  const entries = centralDirectory(bytes, kind);
  // The directory bounds each entry and their sum. Streaming enforces that each
  // entry stays within its own declared length before any type manifest is read.
  for (const entry of entries.values()) {
    await verifyEntry(bytes, entry);
  }
  if (kind === 'zip') return;
  if (kind === 'sb3') {
    const project = JSON.parse(readManifest(bytes, entries.get('project.json'))) as {
      targets?: unknown;
      meta?: { semver?: unknown };
    } | null;
    requireContainer(
      [...entries.keys()].every(
        (name) =>
          name === 'project.json' || /^[a-f0-9]{32}\.(?:svg|png|jpg|jpeg|gif|wav|mp3)$/u.test(name),
      ),
    );
    requireContainer(
      project &&
        Array.isArray(project.targets) &&
        project.targets.length > 0 &&
        typeof project.meta?.semver === 'string' &&
        /^3\.\d+\.\d+$/u.test(project.meta.semver),
    );
    return;
  }
  const parts = {
    docx: ['word/document.xml', 'wordprocessingml.document.main+xml'],
    pptx: ['ppt/presentation.xml', 'presentationml.presentation.main+xml'],
    xlsx: ['xl/workbook.xml', 'spreadsheetml.sheet.main+xml'],
  } as const;
  const [main, type] = parts[kind];
  const manifest = readManifest(bytes, entries.get('[content_types].xml'));
  requireContainer(
    entries.has(main) &&
      entries.has('_rels/.rels') &&
      !/<!DOCTYPE|<!ENTITY|macroEnabled|vbaProject|activeX/iu.test(manifest) &&
      manifest.includes('application/vnd.openxmlformats-officedocument.' + type),
  );
}

const NUMBER = '[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
const VECTOR = new RegExp('^' + NUMBER + '\\s+' + NUMBER + '\\s+' + NUMBER + '$', 'u');

export function validateLearningStl(bytes: Buffer): void {
  if (bytes.length >= 84) {
    const triangles = bytes.readUInt32LE(80);
    if (triangles > 0 && 84 + triangles * 50 === bytes.length) {
      for (let offset = 84; offset < bytes.length; offset += 50) {
        for (let coordinate = 0; coordinate < 48; coordinate += 4)
          requireContainer(Number.isFinite(bytes.readFloatLE(offset + coordinate)));
      }
      return;
    }
  }
  // ASCII STL uses short structural lines. Read bounded slices, retaining at most one line.
  const pattern = [
    'facet normal ',
    'outer loop',
    'vertex ',
    'vertex ',
    'vertex ',
    'endloop',
    'endfacet',
  ];
  let step = 0;
  let triangles = 0;
  let started = false;
  let ended = false;
  let position = 0;
  while (position < bytes.length) {
    const newline = bytes.indexOf(10, position);
    const end = newline < 0 ? bytes.length : newline;
    requireContainer(end - position <= 1_024);
    const line = bytes.subarray(position, end).toString('latin1').trim();
    position = end + 1;
    if (line === '') continue;
    requireContainer(!ended && /^[\x20-\x7e]+$/u.test(line));
    if (!started) {
      requireContainer(/^solid(?: |$)/u.test(line));
      started = true;
    } else if (step === 0 && /^endsolid(?: |$)/u.test(line)) {
      ended = true;
    } else {
      const token = pattern[step]!;
      requireContainer(
        token.endsWith(' ')
          ? line.startsWith(token) &&
              VECTOR.test(line.slice(token.length)) &&
              line
                .slice(token.length)
                .trim()
                .split(/\s+/u)
                .every((coordinate) => Number.isFinite(Number(coordinate)))
          : line === token,
      );
      step = (step + 1) % pattern.length;
      if (step === 0) triangles++;
    }
  }
  requireContainer(ended && triangles > 0);
}
