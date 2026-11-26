import { channel } from 'node:diagnostics_channel';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { performance } from 'node:perf_hooks';
import process from 'node:process';

const filename = process.env.ASA_JOURNAL_TIMING_FILE;
if (
  process.env.NODE_ENV !== 'test' ||
  process.env.GITHUB_ACTIONS !== 'true' ||
  process.env.ASA_JOURNAL_CAPACITY !== '1' ||
  filename !== 'reports/capacity/classroom-journal-timings.ndjson'
)
  throw new Error('Journal timing instrumentation requires the opted-in CI fixture.');

// Record both endpoints using the server's monotonic clock. There is no wait,
// artificial hold, or response rewriting on the request path.
mkdirSync(dirname(filename), { recursive: true });
const stream = createWriteStream(filename);
const started = new WeakMap();
channel('http.server.request.start').subscribe(({ request }) => {
  const key = request.headers['x-asa-journal-timing'];
  if (typeof key !== 'string') return;
  const teacher =
    /^\d+:teacher$/.test(key) &&
    request.method === 'POST' &&
    /^\/api\/classrooms\/[^/]+\/journal\/quick$/.test(request.url ?? '');
  if (teacher || /^\d+:[0-2]:\d{1,2}$/.test(key))
    started.set(request, { key, startMs: performance.now() });
});

channel('http.server.response.finish').subscribe(({ request }) => {
  const entry = started.get(request);
  if (entry) stream.write(JSON.stringify({ ...entry, endMs: performance.now() }) + '\n');
});
