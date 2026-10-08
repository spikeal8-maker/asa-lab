import { parentPort, workerData } from 'node:worker_threads';
import { createReadStream } from 'node:fs';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { deflateRawSync } from 'node:zlib';

export interface LogEntry {
  readonly id: string;
  readonly time: string;
  readonly source: string;
  readonly module: string;
  readonly level: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly revision: string | null;
  readonly origin: string;
  readonly truncated: boolean;
}

export interface LogFilter {
  readonly from: string;
  readonly to: string;
  readonly source: string;
  readonly module: string;
  readonly level: string;
  readonly search: string;
  readonly before: { readonly time: string; readonly id: string } | null;
}

interface Segment {
  readonly file: string;
  readonly bytes: number;
  readonly count: number;
  readonly first: string;
  readonly last: string;
  readonly sources: readonly string[];
  readonly modules: readonly string[];
  readonly levels: readonly string[];
}

export interface LogCatalog {
  readonly version: number;
  readonly collectedAt: string;
  readonly retentionDays: number;
  readonly maxBytes: number;
  readonly bytes: number;
  readonly trimmed: boolean;
  readonly sources: readonly {
    readonly source: string;
    readonly state: string;
    readonly checkedAt: string;
    readonly lastCollectedAt: string | null;
    readonly detail: string;
  }[];
  readonly segments: readonly Segment[];
}

export async function readLogCatalog(root: string): Promise<LogCatalog | null> {
  try {
    const path = join(root, 'catalog.json');
    if ((await stat(path)).size > 16 * 1024 * 1024) throw new Error('LOG_CATALOG_INVALID');
    const catalog = JSON.parse(await readFile(path, 'utf8')) as LogCatalog;
    if (
      catalog.version !== 1 ||
      !Array.isArray(catalog.segments) ||
      !Array.isArray(catalog.sources)
    ) {
      throw new Error('LOG_CATALOG_INVALID');
    }
    return catalog;
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw failure;
  }
}

function candidates(catalog: LogCatalog, filter: LogFilter): readonly Segment[] {
  return catalog.segments
    .filter((s) => s.last >= filter.from && s.first <= filter.to)
    .filter((s) => !filter.before || s.first <= filter.before.time)
    .filter((s) => !filter.source || s.sources.includes(filter.source))
    .filter((s) => !filter.module || s.modules.includes(filter.module))
    .filter((s) => !filter.level || s.levels.includes(filter.level))
    .sort((a, b) => b.last.localeCompare(a.last));
}

function matches(event: LogEntry, filter: LogFilter): boolean {
  return (
    event.time >= filter.from &&
    event.time <= filter.to &&
    (!filter.source || event.source === filter.source) &&
    (!filter.module || event.module === filter.module) &&
    (!filter.level || event.level === filter.level) &&
    (!filter.before ||
      event.time < filter.before.time ||
      (event.time === filter.before.time && event.id < filter.before.id)) &&
    (!filter.search ||
      [event.message, event.requestId, event.revision, event.origin].some((v) =>
        v?.toLowerCase().includes(filter.search.toLowerCase()),
      ))
  );
}

async function* entries(root: string, segment: Segment): AsyncGenerator<LogEntry> {
  if (!/^seg-\d{16}-\d{16}\.jsonl$/.test(segment.file)) throw new Error('LOG_SEGMENT_INVALID');
  const path = join(root, segment.file);
  const size = (await stat(path)).size;
  if (size > 4 * 1024 * 1024 || size !== segment.bytes) throw new Error('LOG_SEGMENT_INVALID');
  const stream = createReadStream(path, { encoding: 'utf8' });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (line.length > 65536) throw new Error('LOG_SEGMENT_INVALID');
      const entry = JSON.parse(line) as LogEntry;
      if (
        !/^[a-f0-9]{64}$/.test(entry.id) ||
        typeof entry.message !== 'string' ||
        Array.from(entry.message).length > 16384 ||
        !Number.isFinite(Date.parse(entry.time))
      ) {
        throw new Error('LOG_SEGMENT_INVALID');
      }
      yield entry;
    }
  } finally {
    lines.close();
    stream.destroy();
  }
}

export async function queryLogs(root: string, filter: LogFilter, limit: number) {
  const catalog = await readLogCatalog(root);
  if (!catalog) return { items: [], next: null, partial: false, scanned: 0 };
  const sorted: LogEntry[] = [];
  let scanned = 0;
  const seen = new Set<string>();
  let partial = false;
  for (const segment of candidates(catalog, filter)) {
    if (sorted.length > limit && segment.last < sorted[limit]!.time) break;
    for await (const event of entries(root, segment)) {
      scanned += 1;
      if (matches(event, filter) && !seen.has(event.id)) {
        seen.add(event.id);
        sorted.push(event);
      }
    }
    sorted.sort((a, b) => b.time.localeCompare(a.time) || b.id.localeCompare(a.id));
    sorted.splice(limit + 1);
    if (scanned >= 200000) {
      partial = true;
      break;
    }
  }
  const items = sorted.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next: sorted.length > limit && last ? { time: last.time, id: last.id } : null,
    partial,
    scanned,
  };
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i += 1) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 255]! ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export async function exportLogs(root: string, filter: LogFilter, output: string) {
  const catalog = await readLogCatalog(root);
  if (!catalog) throw new Error('LOG_COLLECTOR_UNAVAILABLE');
  const handle = await open(output, 'wx', 0o600);
  const central: Buffer[] = [];
  let offset = 0;
  let count = 0;
  let uncompressed = 0;
  let batch = '';
  let batchBytes = 0;
  let part = 0;
  const write = async (data: Buffer): Promise<void> => {
    if (offset + data.length > 64 * 1024 * 1024) throw new Error('LOG_EXPORT_TOO_LARGE');
    await handle.writeFile(data);
    offset += data.length;
  };
  const add = async (name: string, text: string): Promise<void> => {
    const raw = Buffer.from(text);
    const compressed = deflateRawSync(raw);
    const filename = Buffer.from(name);
    const crc = crc32(raw);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x800, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(33, 12); // valid DOS date: 1980-01-01
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(filename.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(0x800, 8);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt16LE(33, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(compressed.length, 20);
    dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(filename.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(Buffer.concat([dir, filename]));
    await write(Buffer.concat([local, filename]));
    await write(compressed);
  };
  try {
    const seen = new Set<string>();
    let scanned = 0;
    for (const segment of candidates(catalog, { ...filter, before: null })) {
      for await (const event of entries(root, segment)) {
        scanned += 1;
        if (scanned > 1000000) throw new Error('LOG_EXPORT_TOO_LARGE');
        if (!matches(event, { ...filter, before: null }) || seen.has(event.id)) continue;
        seen.add(event.id);
        const line = `${JSON.stringify(event)}\n`;
        batch += line;
        const lineBytes = Buffer.byteLength(line);
        batchBytes += lineBytes;
        count += 1;
        uncompressed += lineBytes;
        if (uncompressed > 256 * 1024 * 1024) throw new Error('LOG_EXPORT_TOO_LARGE');
        if (batchBytes >= 1024 * 1024) {
          await add(`records/part-${String(++part).padStart(5, '0')}.jsonl`, batch);
          batch = '';
          batchBytes = 0;
        }
      }
    }
    if (batch) await add(`records/part-${String(++part).padStart(5, '0')}.jsonl`, batch);
    await add(
      'manifest.json',
      JSON.stringify(
        { filter, count, catalog, exportedAt: new Date().toISOString(), normalized: true },
        null,
        2,
      ),
    );
    await add(
      'README.txt',
      'Журналы ASA Lab\nЗаписи JSONL: одна строка — одно событие. В каждой записи указаны время UTC, источник, модуль, уровень и сообщение.\nЭто сохранённые диагностические записи с очисткой известных секретов. Полнота, ограничения источников и фильтры указаны в manifest.json.\ntruncated=true означает ограничение длины исходного сообщения. Отсутствие событий не доказывает отсутствие сбоев.\n',
    );
    const centralOffset = offset;
    for (const dir of central) await write(dir);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50);
    end.writeUInt16LE(central.length, 8);
    end.writeUInt16LE(central.length, 10);
    end.writeUInt32LE(offset - centralOffset, 12);
    end.writeUInt32LE(centralOffset, 16);
    await write(end);
    return { count, bytes: offset };
  } finally {
    await handle.close();
  }
}

if (parentPort) {
  const task = workerData as {
    root: string;
    filter: LogFilter;
    kind: 'query' | 'export';
    limit: number;
    output: string;
  };
  const run =
    task.kind === 'query'
      ? queryLogs(task.root, task.filter, task.limit)
      : exportLogs(task.root, task.filter, task.output);
  void run
    .then((result) => parentPort!.postMessage({ ok: true, result }))
    .catch(() => parentPort!.postMessage({ ok: false, error: 'LOG_READ_OR_EXPORT_FAILED' }));
}
