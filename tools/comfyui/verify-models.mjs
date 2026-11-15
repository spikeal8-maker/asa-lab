import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import process from 'node:process';
import console from 'node:console';
import { URL } from 'node:url';

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--models-root' || !args[1]) {
  console.error('Usage: node tools/comfyui/verify-models.mjs --models-root <ComfyUI/models>');
  process.exitCode = 2;
} else {
  const profile = JSON.parse(
    await readFile(
      new URL('../../docs/deployment/comfyui/rtx3060-12gb-profile.json', import.meta.url),
      'utf8',
    ),
  );
  const root = resolve(args[1]);
  console.log(`Profile: ${profile.profile} (file integrity only; no GPU generation)`);
  for (const model of profile.models) {
    try {
      const path = resolve(root, model.path);
      const info = await stat(path);
      if (!info.isFile() || info.size !== model.bytes) throw new Error('size mismatch');
      const hash = createHash('sha256');
      for await (const chunk of createReadStream(path)) hash.update(chunk);
      if (hash.digest('hex') !== model.sha256) throw new Error('SHA-256 mismatch');
      console.log(`PASS ${model.path}`);
    } catch (e) {
      const reason =
        e?.code === 'ENOENT'
          ? 'missing file'
          : e?.message === 'size mismatch'
            ? 'size mismatch'
            : e?.message === 'SHA-256 mismatch'
              ? 'SHA-256 mismatch'
              : 'file not readable';
      console.error(`FAIL ${model.path}: ${reason}`);
      process.exitCode = 1;
    }
  }
}
