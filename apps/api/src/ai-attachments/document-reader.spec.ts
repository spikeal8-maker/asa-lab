import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { afterEach, expect, it, vi } from 'vitest';
import { documentPythonExecutable, readDocument } from './document-reader';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

function childProcess() {
  const child = Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    kill: vi.fn(() => true),
  });
  vi.mocked(spawn).mockReturnValue(child as never);
  return child;
}

it('selects host Python by platform and accepts a trusted configured executable without shell parsing', () => {
  expect(documentPythonExecutable({}, 'win32')).toBe('python');
  expect(documentPythonExecutable({}, 'linux')).toBe('python3');
  expect(documentPythonExecutable({}, 'darwin')).toBe('python3');
  expect(
    documentPythonExecutable({ ASA_DOCUMENT_PYTHON: 'C:\\Trusted Tools\\python.exe' }, 'win32'),
  ).toBe('C:\\Trusted Tools\\python.exe');
  expect(
    documentPythonExecutable(
      { ASA_DOCUMENT_PYTHON: '/opt/asa-document-python/bin/python' },
      'linux',
    ),
  ).toBe('/opt/asa-document-python/bin/python');
  for (const value of ['', ' ', 'python\nother', 'python\0other'])
    expect(() => documentPythonExecutable({ ASA_DOCUMENT_PYTHON: value })).toThrow();
});

it('passes only the fixed isolated reader, validated extension and document stdin to the configured Python', async () => {
  vi.stubEnv('ASA_DOCUMENT_PYTHON', '/trusted/python');
  const child = childProcess();
  const bytes = Buffer.from('%PDF-fixture');
  const pending = readDocument(bytes, 'pdf', new AbortController().signal);
  expect(spawn).toHaveBeenCalledWith(
    '/trusted/python',
    ['-I', expect.stringMatching(/[/\\]ai-attachments[/\\]document-reader\.py$/), 'pdf'],
    { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true, shell: false },
  );
  expect(child.stdin.read()).toEqual(bytes);
  child.stdout.write(JSON.stringify({ text: 'ALPHA-742' }));
  child.emit('close', 0);
  expect(await pending).toMatchObject({ kind: 'text', extension: 'pdf', text: 'ALPHA-742' });
});

it('does not spawn for an already aborted request or an unsupported input', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    readDocument(Buffer.from('%PDF-fixture'), 'pdf', controller.signal),
  ).rejects.toThrow();
  await expect(
    readDocument(Buffer.from('not a PDF'), 'pdf', new AbortController().signal),
  ).rejects.toThrow();
  expect(spawn).not.toHaveBeenCalled();
});

it('kills extraction on cancellation and rejects partial content', async () => {
  const child = childProcess();
  const controller = new AbortController();
  const pending = readDocument(Buffer.from('%PDF-fixture'), 'pdf', controller.signal);
  child.stdout.write(JSON.stringify({ text: 'partial text' }));
  controller.abort();
  child.emit('close', null);
  await expect(pending).rejects.toMatchObject({ code: 'ai_document_unreadable' });
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});

it('keeps the bounded-output failure closed', async () => {
  const child = childProcess();
  const pending = readDocument(Buffer.from('%PDF-fixture'), 'pdf', new AbortController().signal);
  child.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1));
  child.emit('close', null);
  await expect(pending).rejects.toMatchObject({ code: 'ai_document_unreadable' });
  expect(child.kill).toHaveBeenCalledWith('SIGKILL');
});

it('fails closed when the configured Python cannot start without exposing its private path', async () => {
  const child = childProcess();
  const pending = readDocument(Buffer.from('%PDF-fixture'), 'pdf', new AbortController().signal);
  child.emit('error', new Error('ENOENT /private/document-environment/python'));
  child.emit('close', -2);
  await expect(pending).rejects.toMatchObject({ code: 'ai_document_unreadable', status: 422 });
  await expect(pending).rejects.not.toThrow('/private/document-environment');
});

it('retains the 15-second extraction deadline instead of accepting a partial result', async () => {
  vi.useFakeTimers();
  try {
    const child = childProcess();
    const pending = readDocument(Buffer.from('%PDF-fixture'), 'pdf', new AbortController().signal);
    const rejected = expect(pending).rejects.toMatchObject({ code: 'ai_document_unreadable' });
    child.stdout.write(JSON.stringify({ text: 'unfinished result' }));
    await vi.advanceTimersByTimeAsync(15000);
    child.emit('close', null);
    await rejected;
    expect(child.kill).toHaveBeenCalledWith('SIGKILL');
  } finally {
    vi.useRealTimers();
  }
});
