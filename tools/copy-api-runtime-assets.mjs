import { copyFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

/** Copy fixed, trusted application assets after tsc; no upload supplies a path. */
export async function copyApiRuntimeAssets(outputDirectory = join(root, 'apps/api/dist')) {
  const target = join(outputDirectory, 'ai-attachments/document-reader.py');
  await mkdir(dirname(target), { recursive: true });
  await copyFile(join(root, 'apps/api/src/ai-attachments/document-reader.py'), target);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await copyApiRuntimeAssets();
