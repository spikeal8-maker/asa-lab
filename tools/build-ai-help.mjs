import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath, URL } from 'node:url';
import { Buffer } from 'node:buffer';
import process from 'node:process';

// Deliberate public documentation allowlist. Never scan the repository or accept a client path.
const paths = ['ai-chat.md', 'ai-internet.md', 'ai-images.md'];
const root = new URL('../', import.meta.url);
const documents = paths.map((name) => {
  const path = 'docs/public-help/' + name;
  const text = readFileSync(new URL(path, root), 'utf8').replace(/\r\n/g, '\n').trim();
  if (Buffer.byteLength(text) > 16000) throw new Error('AI_HELP_DOCUMENT_TOO_LARGE');
  return { path, sha256: createHash('sha256').update(text).digest('hex'), text };
});
const target = new URL('apps/api/src/ai-public-help.json', root);
const output = JSON.stringify(documents, null, 2) + '\n';
if (process.argv.includes('--check')) {
  if (readFileSync(target, 'utf8').replace(/\r\n/g, '\n') !== output)
    throw new Error('AI_HELP_STALE: run node tools/build-ai-help.mjs');
} else writeFileSync(fileURLToPath(target), output);
