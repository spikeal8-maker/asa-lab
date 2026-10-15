import { parentPort, workerData } from 'node:worker_threads';
import { open, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { deflateRawSync, gunzipSync, inflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import {
  LOG_SUBSYSTEMS,
  logSubsystem,
  isHostLogSource,
  logEditorModule,
  logModule,
} from './log-subsystems.js';
import { projectDatabaseEntry } from './database-diagnostics.js';

export const LOG_STORE_FORMAT = 2;
const MAX_SEGMENT_BYTES = 4 * 1024 * 1024;
const MAX_EXPORT_BYTES = 3584 * 1024 * 1024;

export interface LogEntry {
  readonly id: string;
  readonly time: string;
  readonly source: string;
  readonly module: string;
  readonly subsystem?: string;
  readonly level: string;
  readonly message: string;
  readonly requestId: string | null;
  readonly revision: string | null;
  readonly origin: string;
  readonly truncated: boolean;
  readonly timeBasis?: 'event' | 'file_mtime' | 'transcript';
  readonly windowsEventId?: number;
  readonly windowsRecordId?: string;
  readonly normalizationVersion?: number;
}

export interface LogFilter {
  readonly scope?: 'all' | 'application' | 'host';
  readonly subsystem?: string;
  readonly from: string;
  readonly to: string;
  readonly source: string;
  readonly module: string;
  readonly level: string;
  readonly search: string;
  readonly before: { readonly time: string; readonly id: string } | null;
}

export interface LogScanState {
  readonly catalog: LogCatalog;
  readonly offset: number;
  readonly matches: readonly LogEntry[];
  readonly scanned: number;
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
  readonly subsystems?: readonly string[];
  readonly rawBytes?: number;
  readonly schema?: number;
  readonly sha256?: string;
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
  return (
    catalog.segments
      .filter((s) => s.last >= filter.from && s.first <= filter.to)
      .filter((s) => !filter.before || s.first <= filter.before.time)
      // Historical classification can change under the privacy projection. Apply
      // source/module/level/subsystem/scope filters to the projected rows below.
      .sort((a, b) => b.last.localeCompare(a.last))
  );
}

function inScope(source: string, scope: LogFilter['scope']): boolean {
  const host = isHostLogSource(source);
  return !scope || scope === 'all' || (scope === 'host' ? host : !host);
}

function matches(event: LogEntry, filter: LogFilter): boolean {
  return (
    inScope(event.source, filter.scope) &&
    event.time >= filter.from &&
    event.time <= filter.to &&
    (!filter.source || event.source === filter.source) &&
    (!filter.module || event.module === filter.module) &&
    (!filter.subsystem || event.subsystem === filter.subsystem) &&
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

function segmentRange(segment: Segment): readonly [bigint, bigint] {
  const match = /^seg-(\d{16})-(\d{16})\.jsonl(?:\.gz)?$/.exec(segment.file);
  if (!match || BigInt(match[1]!) > BigInt(match[2]!)) throw new Error('LOG_SEGMENT_INVALID');
  return [BigInt(match[1]!), BigInt(match[2]!)];
}

async function segmentData(root: string, segment: Segment) {
  segmentRange(segment);
  const path = join(root, segment.file);
  try {
    const size = (await stat(path)).size;
    if (size > MAX_SEGMENT_BYTES || size !== segment.bytes) throw new Error('LOG_SEGMENT_INVALID');
    const stored = await readFile(path);
    const raw = segment.file.endsWith('.gz')
      ? gunzipSync(stored, { maxOutputLength: MAX_SEGMENT_BYTES })
      : stored;
    if (segment.rawBytes !== undefined && raw.length !== segment.rawBytes)
      throw new Error('LOG_SEGMENT_INVALID');
    if (
      segment.sha256 !== undefined &&
      createHash('sha256').update(raw).digest('hex') !== segment.sha256
    )
      throw new Error('LOG_SEGMENT_INVALID');
    return { raw, stored };
  } catch (failure) {
    if ((failure as NodeJS.ErrnoException).code === 'ENOENT')
      throw new Error('LOG_SNAPSHOT_CHANGED', { cause: failure });
    if (failure instanceof Error && failure.message.startsWith('LOG_')) throw failure;
    throw new Error('LOG_SEGMENT_INVALID', { cause: failure });
  }
}

function parseEntry(line: string): LogEntry {
  if (line.length > 65536) throw new Error('LOG_SEGMENT_INVALID');
  let entry: LogEntry;
  try {
    entry = JSON.parse(line) as LogEntry;
  } catch {
    throw new Error('LOG_SEGMENT_INVALID');
  }
  if (
    !entry ||
    !/^[a-f0-9]{64}$/.test(entry.id) ||
    typeof entry.message !== 'string' ||
    Array.from(entry.message).length > 16384 ||
    !Number.isFinite(Date.parse(entry.time))
  )
    throw new Error('LOG_SEGMENT_INVALID');
  entry = projectDatabaseEntry(entry);
  if (typeof entry.source !== 'string' || typeof entry.origin !== 'string') {
    entry = {
      ...entry,
      source: typeof entry.source === 'string' ? entry.source : 'unknown',
      origin: typeof entry.origin === 'string' ? entry.origin : '',
    };
  }
  let path = '';
  let kind = '';
  let module = '';
  if (
    (entry.source === 'api' || entry.source === 'web') &&
    entry.message.trimStart().startsWith('{')
  ) {
    try {
      const value = JSON.parse(entry.message);
      if (typeof value?.path === 'string') path = value.path;
      if (typeof value?.kind === 'string') kind = value.kind;
      if (typeof value?.module === 'string') module = value.module;
    } catch {
      /* Historical plain messages remain searchable. */
    }
  }
  const subsystem =
    isHostLogSource(entry.source) ||
    logEditorModule(entry.source) ||
    (['api', 'web'].includes(entry.source) && (!entry.truncated || path || kind || module)) ||
    (entry.subsystem === 'host' && ['api', 'web'].includes(entry.source)) ||
    !LOG_SUBSYSTEMS.includes(entry.subsystem as (typeof LOG_SUBSYSTEMS)[number])
      ? logSubsystem(entry.source, path, entry.origin, kind, module)
      : entry.subsystem!;
  entry = { ...entry, subsystem, module: logModule(entry.source, subsystem, module, entry.module) };
  return entry;
}

async function* entries(root: string, segment: Segment): AsyncGenerator<LogEntry> {
  const { raw } = await segmentData(root, segment);
  for (const line of raw.toString('utf8').split('\n')) {
    if (line) yield parseEntry(line);
  }
}

export async function queryLogs(
  root: string,
  filter: LogFilter,
  limit: number,
  resume?: LogScanState,
) {
  const catalog = resume?.catalog ?? (await readLogCatalog(root));
  if (!catalog) return { items: [], next: null, partial: false, scanned: 0 };
  const sorted: LogEntry[] = [...(resume?.matches ?? [])];
  let scanned = 0;
  const seen = new Set<string>(sorted.map((e) => e.id));
  let partial = false;
  const segments = candidates(catalog, filter);
  let offset = resume?.offset ?? 0;
  const started = performance.now();
  for (; offset < segments.length; offset++) {
    const segment = segments[offset]!;
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
    if (scanned >= 200000 || performance.now() - started > 8000) {
      offset++;
      partial =
        offset < segments.length &&
        !(sorted.length > limit && segments[offset]!.last < sorted[limit]!.time);
      break;
    }
  }
  // Until the remaining time frontier is known, these matches are provisional.
  // Keep them privately for the next bounded scan; never show an incomplete
  // chronological page as an empty/final search result.
  const items = partial ? [] : sorted.slice(0, limit);
  const last = items.at(-1);
  return {
    items,
    next: sorted.length > limit && last ? { time: last.time, id: last.id } : null,
    partial,
    scanned: (resume?.scanned ?? 0) + scanned,
    ...(partial
      ? {
          scanState: {
            catalog,
            offset,
            matches: sorted,
            scanned: (resume?.scanned ?? 0) + scanned,
          } satisfies LogScanState,
        }
      : {}),
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
  const exportedSegments: Segment[] = [];
  let batchEntries: LogEntry[] = [];
  const write = async (data: Buffer): Promise<void> => {
    if (offset + data.length > MAX_EXPORT_BYTES) throw new Error('LOG_EXPORT_TOO_LARGE');
    await handle.writeFile(data);
    offset += data.length;
  };
  const add = async (
    name: string,
    raw: Buffer,
    prepared?: { deflate: Buffer; crc: number },
  ): Promise<void> => {
    if (central.length >= 65533) throw new Error('LOG_EXPORT_TOO_LARGE');
    const compressed = prepared?.deflate ?? deflateRawSync(raw);
    const filename = Buffer.from(name);
    const crc = prepared?.crc ?? crc32(raw);
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
    const selected = candidates(catalog, { ...filter, before: null });
    // The collector's unique binary digest index and disjoint sequence ranges
    // guarantee occurrences are exported once, without an unbounded in-memory ID set.
    const ranges = selected.map(segmentRange).sort((a, b) => (a[0] < b[0] ? -1 : 1));
    for (let n = 1; n < ranges.length; n += 1) {
      if (ranges[n]![0] <= ranges[n - 1]![1]) throw new Error('LOG_CATALOG_INVALID');
    }
    const flush = async (): Promise<void> => {
      if (!batch) return;
      await addRecords(Buffer.from(batch), batchEntries);
      batch = '';
      batchBytes = 0;
      batchEntries = [];
    };
    const addRecords = async (
      raw: Buffer,
      events: readonly LogEntry[],
      prepared?: { deflate: Buffer; crc: number },
    ): Promise<void> => {
      const file = `records/part-${String(++part).padStart(5, '0')}.jsonl`;
      await add(file, raw, prepared);
      const times = events.map((event) => event.time).sort();
      exportedSegments.push({
        file,
        bytes: raw.length,
        rawBytes: raw.length,
        schema: 2,
        sha256: createHash('sha256').update(raw).digest('hex'),
        count: events.length,
        first: times[0]!,
        last: times.at(-1)!,
        sources: [...new Set(events.map((event) => event.source))],
        modules: [...new Set(events.map((event) => event.module))],
        levels: [...new Set(events.map((event) => event.level))],
        subsystems: [
          ...new Set(events.flatMap((event) => (event.subsystem ? [event.subsystem] : []))),
        ],
      });
    };
    for (const segment of selected) {
      // Validate the original gzip/checksum before projecting. Catalog classification
      // is only an optimization hint: inspect every actual row before copying bytes.
      const { raw, stored } = await segmentData(root, segment);
      const lines = raw.toString('utf8').split('\n').filter(Boolean);
      const events = lines.map(parseEntry);
      const whole =
        segment.file.endsWith('.gz') &&
        segment.schema === 2 &&
        typeof segment.sha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(segment.sha256) &&
        Number.isSafeInteger(segment.count) &&
        segment.count > 0 &&
        segment.first >= filter.from &&
        segment.last <= filter.to &&
        !filter.search &&
        (!filter.subsystem ||
          (segment.subsystems?.length &&
            segment.subsystems.every((s) => s === filter.subsystem))) &&
        segment.sources.every((source) => inScope(source, filter.scope)) &&
        (!filter.source || segment.sources.every((s) => s === filter.source)) &&
        (!filter.module || segment.modules.every((s) => s === filter.module)) &&
        (!filter.level || segment.levels.every((s) => s === filter.level)) &&
        events.every(
          (event, index) =>
            matches(event, { ...filter, before: null }) && JSON.stringify(event) === lines[index],
        );
      if (whole) {
        // Python's canonical gzip output is a single member with no optional header.
        // Reuse its validated deflate stream inside ZIP: extracted files stay JSONL.
        let prepared: { deflate: Buffer; crc: number } | undefined;
        if (stored[3] === 0 && stored.readUInt32LE(stored.length - 4) === raw.length) {
          const deflate = stored.subarray(10, stored.length - 8);
          const decoded = inflateRawSync(deflate, {
            maxOutputLength: MAX_SEGMENT_BYTES,
            info: true,
          }) as unknown as { buffer: Buffer; engine: { bytesWritten: number } };
          if (decoded.engine.bytesWritten === deflate.length && decoded.buffer.equals(raw)) {
            prepared = { deflate, crc: stored.readUInt32LE(stored.length - 8) };
          }
        }
        let lineCount = 0;
        for (const byte of raw) if (byte === 10) lineCount += 1;
        if (lineCount !== segment.count) throw new Error('LOG_SEGMENT_INVALID');
        await flush();
        await addRecords(raw, events, prepared);
        count += segment.count;
        uncompressed += raw.length;
      } else {
        for (const event of events) {
          if (!matches(event, { ...filter, before: null })) continue;
          const line = `${JSON.stringify(event)}\n`;
          const lineBytes = Buffer.byteLength(line);
          batch += line;
          batchEntries.push(event);
          batchBytes += lineBytes;
          uncompressed += lineBytes;
          count += 1;
          if (batchBytes >= 1024 * 1024) await flush();
        }
      }
      if (uncompressed > 64 * 1024 * 1024 * 1024) throw new Error('LOG_EXPORT_TOO_LARGE');
    }
    await flush();
    // Search text may itself be private historical content. Record that a search
    // was applied without copying that text into the archive's metadata.
    const { search, ...exportFilter } = filter;
    await add(
      'manifest.json',
      Buffer.from(
        JSON.stringify(
          {
            filter: exportFilter,
            searchApplied: Boolean(search),
            count,
            catalog: {
              version: 1,
              collectedAt: new Date().toISOString(),
              bytes: exportedSegments.reduce((sum, segment) => sum + segment.bytes, 0),
              retentionDays: Number.isSafeInteger(catalog.retentionDays)
                ? catalog.retentionDays
                : null,
              maxBytes: Number.isSafeInteger(catalog.maxBytes) ? catalog.maxBytes : null,
              trimmed: catalog.trimmed === true,
              sources: [],
              segments: exportedSegments,
            },
            sourceStatusIncluded: false,
            exportedAt: new Date().toISOString(),
            normalized: true,
          },
          null,
          2,
        ),
      ),
    );
    await add(
      'README.txt',
      Buffer.from(
        'Журналы ASA Lab\nЗаписи JSONL: одна строка — одно событие. В каждой записи указаны время UTC, источник, модуль, уровень и сообщение.\nЭто сохранённые диагностические записи с очисткой известных секретов. Полнота, ограничения источников и фильтры указаны в manifest.json.\ntruncated=true означает ограничение длины исходного сообщения. Отсутствие событий не доказывает отсутствие сбоев.\ntimeBasis=file_mtime означает время изменения файла, если собственное время события не распознано.\n',
      ),
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
    scanState?: LogScanState;
  };
  const run =
    task.kind === 'query'
      ? queryLogs(task.root, task.filter, task.limit, task.scanState)
      : exportLogs(task.root, task.filter, task.output);
  void run
    .then((result) => parentPort!.postMessage({ ok: true, result }))
    .catch((failure: unknown) => {
      const code = failure instanceof Error ? failure.message : '';
      const allowed = [
        'LOG_COLLECTOR_UNAVAILABLE',
        'LOG_SEGMENT_INVALID',
        'LOG_CATALOG_INVALID',
        'LOG_EXPORT_TOO_LARGE',
        'LOG_SNAPSHOT_CHANGED',
      ];
      parentPort!.postMessage({
        ok: false,
        error: allowed.includes(code) ? code : 'LOG_READ_OR_EXPORT_FAILED',
      });
    });
}
