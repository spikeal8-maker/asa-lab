import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  generateKeyPairSync,
  privateDecrypt,
  publicEncrypt,
  randomBytes,
  constants,
} from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function encryptSymbols(archive, publicKey) {
  const key = randomBytes(32),
    iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(JSON.stringify(archive))),
    cipher.final(),
  ]);
  return JSON.stringify({
    format: 'asa-web-symbols-encrypted-v1',
    recipient: digest(createPublicKey(publicKey).export({ type: 'spki', format: 'der' })),
    key: publicEncrypt(
      { key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
      key,
    ).toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: ciphertext.toString('base64'),
  });
}
export function decryptSymbols(envelope, privateKey) {
  if (envelope.format !== 'asa-web-symbols-encrypted-v1')
    throw new Error('Unsupported symbol archive');
  const key = privateDecrypt(
    { key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(envelope.key, 'base64'),
  );
  const cipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  cipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
  return JSON.parse(
    gunzipSync(
      Buffer.concat([cipher.update(Buffer.from(envelope.data, 'base64')), cipher.final()]),
      { maxOutputLength: 128 * 1024 * 1024 },
    ).toString('utf8'),
  );
}

// Source Map v3 base64 VLQ. Original source/line/column deltas persist across
// generated lines; generated column resets. A one-field segment is unmapped.
export function originalPosition(map, line, column) {
  if (
    map.version !== 3 ||
    !Number.isInteger(line) ||
    line < 1 ||
    !Number.isInteger(column) ||
    column < 1
  )
    throw new Error('Invalid source coordinate');
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let source = 0,
    originalLine = 0,
    originalColumn = 0;
  const lines = map.mappings.split(';');
  if (line > lines.length) throw new Error('Unmapped generated line');
  let found;
  for (let y = 0; y < line; y++) {
    let generatedColumn = 0;
    for (const segment of lines[y].split(',')) {
      if (!segment) continue;
      const values = [];
      let value = 0,
        shift = 0;
      for (const character of segment) {
        const digit = alphabet.indexOf(character);
        if (digit < 0 || shift > 30) throw new Error('Invalid VLQ mapping');
        value += (digit & 31) * 2 ** shift;
        if (digit & 32) shift += 5;
        else {
          values.push(value % 2 ? -Math.floor(value / 2) : value / 2);
          value = 0;
          shift = 0;
        }
      }
      if (shift || ![1, 4, 5].includes(values.length)) throw new Error('Invalid mapping segment');
      generatedColumn += values[0];
      if (values.length > 1) {
        source += values[1];
        originalLine += values[2];
        originalColumn += values[3];
      }
      if (y === line - 1 && generatedColumn <= column - 1)
        found =
          values.length === 1
            ? undefined
            : { source: map.sources[source], line: originalLine + 1, column: originalColumn + 1 };
    }
  }
  if (!found?.source || found.line < 1 || found.column < 1)
    throw new Error('Unmapped generated coordinate');
  return found;
}

export function symbolize(archive, event) {
  if (
    archive.format !== 'asa-web-symbols-v1' ||
    !/^[a-f0-9]{40}$/.test(event.revision) ||
    event.revision !== archive.revision
  )
    throw new Error('Exact revision mismatch');
  if (
    !Array.isArray(event.exception?.frames) ||
    !event.exception.frames.length ||
    event.exception.frames.length > 5
  )
    throw new Error('Missing bounded frames');
  return event.exception.frames.map((frame) => {
    if (
      !/^\/assets\/[A-Za-z0-9_-]{1,140}-[A-Za-z0-9_-]{8,16}\.js$/.test(frame.script) ||
      !Object.hasOwn(archive.assets, frame.script)
    )
      throw new Error('Unknown generated asset');
    const asset = archive.assets[frame.script];
    if (digest(asset.generated) !== asset.sha256)
      throw new Error('Generated asset digest mismatch');
    const generatedLine = asset.generated.split(/\r?\n/)[frame.line - 1];
    if (
      !Number.isInteger(frame.line) ||
      !Number.isInteger(frame.column) ||
      frame.line < 1 ||
      frame.column < 1 ||
      generatedLine === undefined ||
      frame.column > generatedLine.length + 1
    )
      throw new Error('Generated coordinate outside asset');
    return {
      generated: frame,
      original: originalPosition(asset.map, frame.line, frame.column),
      sha256: asset.sha256,
    };
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [command, ...args] = process.argv.slice(2);
    if (command === 'keygen' && args.length === 2) {
      const pair = generateKeyPairSync('rsa', {
        modulusLength: 3072,
        privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
        publicKeyEncoding: { type: 'spki', format: 'pem' },
      });
      mkdirSync(dirname(resolve(args[0])), { recursive: true });
      writeFileSync(args[0], pair.privateKey, { flag: 'wx', mode: 0o600 });
      writeFileSync(args[1], pair.publicKey, { flag: 'wx' });
      console.info('Created owner key pair; private key was not printed.');
    } else if (command === 'symbolize' && args.length === 3) {
      const archive = decryptSymbols(
        JSON.parse(readFileSync(args[0], 'utf8')),
        readFileSync(args[1], 'utf8'),
      );
      const event = JSON.parse(readFileSync(args[2], 'utf8'));
      console.info(
        JSON.stringify({ revision: event.revision, frames: symbolize(archive, event) }, null, 2),
      );
    } else
      throw new Error(
        'Usage: keygen PRIVATE.pem PUBLIC.pem | symbolize ARCHIVE.json PRIVATE.pem EVENT.json',
      );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
