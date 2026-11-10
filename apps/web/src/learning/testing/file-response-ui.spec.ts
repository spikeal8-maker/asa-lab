// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, type FileLearningResponse } from '../../api';
import { FileResponseEditor } from '../../components/FileResponseEditor';

const globals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const savedFile = {
  id: 'file-id',
  name: 'отчёт.txt',
  sizeBytes: 6,
  contentType: 'text/plain',
  sha256: 'digest',
};
const attempt: NonNullable<FileLearningResponse['attempt']> = {
  id: 'attempt',
  number: 1,
  state: 'in_progress',
  revisionOfAttemptId: null,
  revision: 0,
  file: null,
  savedAt: '',
  submittedAt: null,
  submissionId: null,
  digest: null,
  reviewDecision: null,
  feedback: null,
};
const draft: FileLearningResponse = {
  activityRunId: 'run',
  participationId: 'participation',
  activityVersionId: 'version',
  title: 'Отчёт',
  instructions: null,
  goal: null,
  blocks: null,
  resultMode: 'graded',
  maxPoints: 10,
  canStart: false,
  canEdit: true,
  attempt,
};
const saved: FileLearningResponse = {
  ...draft,
  attempt: { ...attempt, revision: 1, file: savedFile },
};
const ok = (data: FileLearningResponse) => ({ ok: true as const, status: 200, data });
let root: Root;
let host: HTMLDivElement;
let guard: (() => boolean) | null;
const changed = vi.fn(async () => undefined);

beforeEach(() => {
  globals.IS_REACT_ACT_ENVIRONMENT = true;
  guard = null;
  changed.mockClear();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  vi.spyOn(api, 'readFileLearning').mockResolvedValue(ok(draft));
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () => {
    root.render(
      createElement(FileResponseEditor, {
        activityRunId: 'run',
        activityVersionId: 'version',
        onChanged: changed,
        onRegisterLeaveGuard: (_id, registered) => {
          guard = registered;
        },
      }),
    );
  });
}

function button(text: string) {
  const node = [...host.querySelectorAll('button')].find((item) => item.textContent === text);
  if (!node) throw new Error(text);
  return node;
}

async function click(text: string) {
  await act(async () => button(text).click());
}

async function select(file: File) {
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { value: { item: () => file }, configurable: true });
  await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
}

it('submits only the acknowledged file revision and keeps its download after review', async () => {
  const upload = vi.spyOn(api, 'saveFileLearning').mockResolvedValue(ok(saved));
  const submit = vi.spyOn(api, 'submitFileLearning').mockResolvedValue(
    ok({
      ...saved,
      canEdit: false,
      attempt: {
        ...attempt,
        revision: 1,
        file: savedFile,
        state: 'closed',
        submissionId: 'submission',
        reviewDecision: 'accepted',
        feedback: 'Отлично',
      },
    }),
  );
  await mount();
  expect(button('Сдать файл').disabled).toBe(true);
  const file = new File(['report'], 'отчёт.txt');
  await select(file);
  expect(button('Сдать файл').disabled).toBe(true);
  await click('Загрузить файл');
  expect(upload).toHaveBeenCalledWith('run', {
    attemptId: 'attempt',
    expectedRevision: 0,
    requestId: expect.any(String),
    file,
  });
  expect(host.querySelector('a')?.getAttribute('href')).toBe(
    '/api/learning/file/runs/run/files/file-id',
  );
  await click('Сдать файл');
  expect(submit).toHaveBeenCalledWith('run', {
    attemptId: 'attempt',
    expectedRevision: 1,
    requestId: expect.any(String),
  });
  expect(changed).toHaveBeenCalledOnce();
  expect(host.querySelector('input[type="file"]')).toBeNull();
  expect(host.textContent).toContain('Отлично');
  expect(host.querySelector('a')?.textContent).toContain(savedFile.name);
});

it('keeps a pending replacement through a conflict and requires refresh before uploading again', async () => {
  vi.mocked(api.readFileLearning)
    .mockResolvedValueOnce(ok(saved))
    .mockResolvedValueOnce(ok({ ...saved, attempt: { ...saved.attempt!, revision: 2 } }));
  const upload = vi
    .spyOn(api, 'saveFileLearning')
    .mockResolvedValueOnce({
      ok: false,
      status: 409,
      error: { code: 'draft_revision_conflict', message: 'conflict' },
    })
    .mockResolvedValueOnce(ok({ ...saved, attempt: { ...saved.attempt!, revision: 3 } }));
  vi.spyOn(window, 'confirm').mockReturnValue(false);
  await mount();
  const replacement = new File(['replacement'], 'replacement.txt');
  await select(replacement);
  expect(button('Сдать файл').disabled).toBe(true);
  expect(guard?.()).toBe(false);
  await click('Загрузить файл');
  expect(button('Загрузить файл').disabled).toBe(true);
  await click('Обновить ответ');
  expect(button('Сдать файл').disabled).toBe(true);
  await click('Загрузить файл');
  expect(upload).toHaveBeenLastCalledWith(
    'run',
    expect.objectContaining({
      attemptId: 'attempt',
      expectedRevision: 2,
      file: replacement,
    }),
  );
  expect(guard?.()).toBe(true);
  expect(button('Сдать файл').disabled).toBe(false);
});
