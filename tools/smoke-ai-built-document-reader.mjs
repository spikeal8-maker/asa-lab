import assert from 'node:assert/strict';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { URL } from 'node:url';

const require = createRequire(import.meta.url);
const { readDocument } = require('../apps/api/dist/ai-attachments/document-reader.js');
const fixture = (name) =>
  readFile(new URL('../tests/ai-attachments/documents/' + name, import.meta.url));
assert.deepEqual(
  await readFile(new URL('../apps/api/dist/ai-attachments/document-reader.py', import.meta.url)),
  await readFile(new URL('../apps/api/src/ai-attachments/document-reader.py', import.meta.url)),
);
for (const [extension, markers] of [
  ['pdf', ['ALPHA-742', 'OMEGA-913', '[Страница 2]']],
  ['docx', ['КЕДР-742', '314159', 'последний абзац', '[Таблица:']],
  ['xlsx', ['План', 'Итог', 'B2\t271828', 'Формула: SUM(B2:B3)', 'КОНЕЦ-913']],
]) {
  const result = await readDocument(
    await fixture('review.' + extension),
    extension,
    globalThis.AbortSignal.timeout(20000),
  );
  assert.equal(result.kind, 'text');
  for (const marker of markers) assert.ok(result.text.includes(marker), extension + ': ' + marker);
  console.log('Built API document reader:', extension, 'PASS');
}
await assert.rejects(
  readDocument(await fixture('no-text.pdf'), 'pdf', globalThis.AbortSignal.timeout(20000)),
  { code: 'ai_document_unreadable' },
);
console.log('Built API document reader: scanned PDF rejected PASS');
