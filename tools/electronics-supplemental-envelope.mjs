import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createPublicKey,
  createPrivateKey,
  publicEncrypt,
  privateDecrypt,
  randomBytes,
  constants,
} from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { readFileSync, writeFileSync, readdirSync, lstatSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const FORMAT = 'asa-supplemental-evidence-encrypted-v1';
const PAYLOAD = 'asa-supplemental-evidence-files-v1';
const MAX_FILES = 2000,
  MAX_FILE = 128 * 1024 * 1024,
  MAX_TOTAL = 256 * 1024 * 1024,
  MAX_JSON = 384 * 1024 * 1024,
  MAX_CIPHER = 320 * 1024 * 1024;
const need = (v) => assert.ok(v, 'Invalid bounded private evidence envelope');
const sha = (v) => createHash('sha256').update(v).digest('hex');
const fingerprint = (key) => sha(createPublicKey(key).export({ type: 'spki', format: 'der' }));
const b64 = (text, limit) => {
  need(
    typeof text === 'string' &&
      text.length <= Math.ceil(limit / 3) * 4 &&
      /^[A-Za-z0-9+/]*={0,2}$/.test(text),
  );
  const bytes = Buffer.from(text, 'base64');
  need(bytes.length <= limit && bytes.toString('base64') === text);
  return bytes;
};
function validate(archive) {
  need(
    archive &&
      Object.keys(archive).sort().join('|') === 'candidateRevision|files|format|workflowRevision' &&
      Array.isArray(archive.files),
  );
  need(
    archive.format === PAYLOAD &&
      /^[a-f0-9]{40}$/.test(archive.candidateRevision) &&
      /^[a-f0-9]{40}$/.test(archive.workflowRevision) &&
      archive.files.length > 0 &&
      archive.files.length <= MAX_FILES,
  );
  const seen = new Set();
  let total = 0;
  for (const file of archive.files) {
    need(file && Object.keys(file).sort().join('|') === 'bytes|data|path|sha256');
    need(
      typeof file.path === 'string' &&
        file.path.length <= 1024 &&
        !isAbsolute(file.path) &&
        !file.path.includes('\\') &&
        file.path.split('/').every((p) => p && p !== '.' && p !== '..' && !p.includes(':')) &&
        !seen.has(file.path),
    );
    seen.add(file.path);
    const bytes = b64(file.data, MAX_FILE);
    total += bytes.length;
    need(total <= MAX_TOTAL && file.bytes === bytes.length && file.sha256 === sha(bytes));
  }
}
function metadata(value) {
  return {
    format: FORMAT,
    recipient: value.recipient,
    candidateRevision: value.candidateRevision,
    workflowRevision: value.workflowRevision,
  };
}
export function encryptEvidence(archive, publicKey) {
  validate(archive);
  const plain = Buffer.from(JSON.stringify(archive));
  need(plain.length <= MAX_JSON);
  const info = {
    format: FORMAT,
    recipient: fingerprint(publicKey),
    candidateRevision: archive.candidateRevision,
    workflowRevision: archive.workflowRevision,
  };
  const key = randomBytes(32),
    iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(JSON.stringify(info)));
  try {
    const data = Buffer.concat([cipher.update(gzipSync(plain)), cipher.final()]);
    need(data.length <= MAX_CIPHER);
    return {
      ...info,
      key: publicEncrypt(
        { key: publicKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
        key,
      ).toString('base64'),
      iv: iv.toString('base64'),
      tag: cipher.getAuthTag().toString('base64'),
      data: data.toString('base64'),
    };
  } finally {
    key.fill(0);
  }
}
export function decryptEvidence(envelope, privateKey) {
  need(
    envelope &&
      Object.keys(envelope).sort().join('|') ===
        'candidateRevision|data|format|iv|key|recipient|tag|workflowRevision',
  );
  need(
    envelope.format === FORMAT &&
      envelope.recipient === fingerprint(createPrivateKey(privateKey)) &&
      /^[a-f0-9]{40}$/.test(envelope.candidateRevision) &&
      /^[a-f0-9]{40}$/.test(envelope.workflowRevision),
  );
  const key = privateDecrypt(
    { key: privateKey, oaepHash: 'sha256', padding: constants.RSA_PKCS1_OAEP_PADDING },
    b64(envelope.key, 512),
  );
  try {
    need(key.length === 32);
    const iv = b64(envelope.iv, 12),
      tag = b64(envelope.tag, 16);
    need(iv.length === 12 && tag.length === 16);
    const cipher = createDecipheriv('aes-256-gcm', key, iv);
    cipher.setAAD(Buffer.from(JSON.stringify(metadata(envelope))));
    cipher.setAuthTag(tag);
    const payload = gunzipSync(
      Buffer.concat([cipher.update(b64(envelope.data, MAX_CIPHER)), cipher.final()]),
      { maxOutputLength: MAX_JSON },
    );
    const archive = JSON.parse(payload.toString('utf8'));
    validate(archive);
    need(
      archive.candidateRevision === envelope.candidateRevision &&
        archive.workflowRevision === envelope.workflowRevision,
    );
    return archive;
  } finally {
    key.fill(0);
  }
}
export function collect(directory, candidateRevision, workflowRevision) {
  need(lstatSync(directory).isDirectory() && !lstatSync(directory).isSymbolicLink());
  const files = [];
  let total = 0;
  function visit(path) {
    for (const name of readdirSync(path)) {
      const file = resolve(path, name),
        info = lstatSync(file);
      need(!info.isSymbolicLink());
      if (info.isDirectory()) visit(file);
      else {
        need(
          info.isFile() && info.nlink === 1 && info.size <= MAX_FILE && files.length < MAX_FILES,
        );
        total += info.size;
        need(total <= MAX_TOTAL);
        const data = readFileSync(file);
        need(data.length === info.size);
        files.push({
          path: relative(directory, file).replace(/\\/g, '/'),
          bytes: data.length,
          sha256: sha(data),
          data: data.toString('base64'),
        });
      }
    }
  }
  visit(directory);
  return { format: PAYLOAD, candidateRevision, workflowRevision, files };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    need(
      process.argv.length === 3 &&
        process.argv[2] === 'seal' &&
        process.env.GITHUB_ACTIONS === 'true' &&
        process.env.GITHUB_REPOSITORY === 'spikeal8-maker/asa-lab',
    );
    const control = resolve(fileURLToPath(new URL('../', import.meta.url))),
      workspace = resolve(control, '..');
    const source = JSON.parse(
      readFileSync(
        resolve(workspace, 'candidate/reports/electronics-supplemental-native/source.json'),
        'utf8',
      ),
    );
    need(
      source.workflowRevision === process.env.GITHUB_WORKFLOW_SHA &&
        source.candidateRevision === process.env.ASA_CANDIDATE_REVISION &&
        sha(readFileSync(fileURLToPath(import.meta.url), 'utf8').replace(/\r\n/g, '\n')) ===
          source.envelopeSha256,
    );
    const archive = collect(
      resolve(workspace, 'candidate/reports/electronics-supplemental-native'),
      source.candidateRevision,
      source.workflowRevision,
    );
    const envelope = encryptEvidence(
      archive,
      readFileSync(resolve(control, 'tools/web-symbols-public.pem'), 'utf8'),
    );
    writeFileSync(
      resolve(process.env.RUNNER_TEMP, 'asa-electronics-supplemental.encrypted.json'),
      JSON.stringify(envelope),
      { flag: 'wx', mode: 0o600 },
    );
    console.log(
      'Encrypted supplemental evidence available; owner decryption is a separate verification.',
    );
  } catch {
    console.error('Private evidence sealing failed; no plaintext artifact is authorized.');
    process.exitCode = 1;
  }
}
