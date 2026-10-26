// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  ReportPublicProject,
  REPORT_REASONS,
  normalizeReportComment,
  reportError,
  validReportReceipt,
} from './ReportPublicProject';
import { publicProjectsApi, type PublicProject } from './api';
import { setTelemetryContext } from '../telemetry-context';

let root: Root;
let host: HTMLDivElement;
const publication = {
  publicationId: 'publication',
  revisionId: 'revision',
  title: '<img onerror=alert(1)>',
} as PublicProject;
const receipt = {
  reportId: '7b50361c-4ea6-4a12-8264-c15018ad6219',
  status: 'received' as const,
  duplicate: false,
};
beforeEach(() => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  setTelemetryContext(null, true, 'public');
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});
async function open() {
  await act(async () =>
    root.render(createElement(ReportPublicProject, { publication, onRefresh: vi.fn() })),
  );
  await act(async () =>
    host.querySelector('details button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })),
  );
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'spam';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
}
async function submit() {
  await act(async () =>
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })),
  );
}
it('uses all six exact reason keys and B1 ASCII normalization/codepoints', () => {
  expect(REPORT_REASONS.map(([key]) => key)).toEqual([
    'spam',
    'abuse',
    'dangerous_content',
    'personal_data',
    'copyright',
    'other',
  ]);
  expect(normalizeReportComment('  \t🚀\n  ')).toBe('\t🚀\n');
  expect(Array.from(normalizeReportComment(' 🚀 '.repeat(500))).length).toBeGreaterThan(500);
});
it('validates only exact 200 received UUID receipts', () => {
  expect(validReportReceipt(200, receipt)).toBe(true);
  expect(validReportReceipt(201, receipt)).toBe(false);
  expect(validReportReceipt(200, { ...receipt, reportId: 'bad' })).toBe(false);
  expect(validReportReceipt(200, null)).toBe(false);
});
it.each([400, 401, 403, 404, 409, 429, 503, 0, 500])('safe error for %s', (status) => {
  expect(reportError(status)).toBeTruthy();
  expect(reportError(status)).not.toContain('SQL');
});
it('retains retry key after unknown result, rotates on payload edit, escapes title, and acknowledges duplicate', async () => {
  const report = vi
    .spyOn(publicProjectsApi, 'report')
    .mockResolvedValueOnce({
      ok: false,
      status: 0,
      error: { code: 'network', message: 'SQL secret' },
    })
    .mockResolvedValueOnce({
      ok: false,
      status: 503,
      error: { code: 'server', message: 'SQL secret' },
    })
    .mockResolvedValueOnce({ ok: true, status: 200, data: { ...receipt, duplicate: true } });
  await open();
  expect(host.querySelector('img')).toBeNull();
  await submit();
  await submit();
  expect(report.mock.calls[0]?.[2]).toBe(report.mock.calls[1]?.[2]);
  expect(host.textContent).not.toContain('SQL secret');
  const select = host.querySelector('select')!;
  await act(async () => {
    select.value = 'other';
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await submit();
  expect(report.mock.calls[2]?.[2]).not.toBe(report.mock.calls[0]?.[2]);
  expect(report.mock.calls[2]?.[1]).toEqual({
    revisionId: 'revision',
    reason: 'other',
    comment: '',
  });
  expect(host.querySelector('[role=status]')?.textContent).toBe('Жалоба уже получена.');
});
it('fences double submit and ignores a late success after closing', async () => {
  let finish!: (value: { ok: true; status: number; data: typeof receipt }) => void;
  const report = vi.spyOn(publicProjectsApi, 'report').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await open();
  await submit();
  await submit();
  expect(report).toHaveBeenCalledTimes(1);
  await act(async () =>
    (host.querySelector('.public-report-buttons button') as HTMLButtonElement).click(),
  );
  await act(async () => finish({ ok: true, status: 200, data: receipt }));
  expect(host.querySelector('dialog')).toBeNull();
});

it.each([400, 401, 403, 404, 409, 429, 503, 500])(
  'renders safe %s denial without acknowledging success',
  async (status) => {
    vi.spyOn(publicProjectsApi, 'report').mockResolvedValue({
      ok: false,
      status,
      error: { code: 'private', message: 'SQL reporter secret' },
    });
    await open();
    await submit();
    expect(host.querySelector('[role=alert]')?.textContent).toBe(reportError(status));
    expect(host.textContent).not.toContain('SQL reporter secret');
    expect(host.querySelector('[role=status]')).toBeNull();
    expect((host.querySelector('[type=submit]') as HTMLButtonElement).disabled).toBe(
      [401, 403, 404, 409].includes(status),
    );
  },
);
it('rejects malformed success and retries with the same key', async () => {
  const report = vi
    .spyOn(publicProjectsApi, 'report')
    .mockResolvedValue({ ok: true, status: 200, data: { ...receipt, reportId: 'invalid' } });
  await open();
  await submit();
  await submit();
  expect(host.querySelector('[role=status]')).toBeNull();
  expect(report.mock.calls[0]?.[2]).toBe(report.mock.calls[1]?.[2]);
});
it('retires a pending report when authentication continuity changes', async () => {
  let finish!: (value: { ok: true; status: number; data: typeof receipt }) => void;
  vi.spyOn(publicProjectsApi, 'report').mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await open();
  await submit();
  await act(async () => setTelemetryContext(null, false, 'public'));
  await act(async () => finish({ ok: true, status: 200, data: receipt }));
  expect(host.querySelector('[role=status]')).toBeNull();
  expect(host.textContent).toContain('Контекст входа изменился');
});

it('counts Unicode codepoints, preserves meaningful whitespace, and blocks oversized comments', async () => {
  const report = vi
    .spyOn(publicProjectsApi, 'report')
    .mockResolvedValue({ ok: true, status: 200, data: receipt });
  await open();
  const textarea = host.querySelector('textarea')!;
  const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
  await act(async () => {
    setValue.call(textarea, '  ' + '🚀'.repeat(501) + '  ');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('small')?.textContent).toBe('501/500');
  await submit();
  expect(report).not.toHaveBeenCalled();
  await act(async () => {
    setValue.call(textarea, '  ' + '🚀'.repeat(500) + '  ');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(host.querySelector('small')?.textContent).toBe('500/500');
  await submit();
  expect(report.mock.calls[0]?.[1].comment).toBe('🚀'.repeat(500));
});
it('Escape closes the modal and restores keyboard focus to the visible menu', async () => {
  await open();
  await act(async () =>
    host.querySelector('dialog')!.dispatchEvent(new Event('cancel', { cancelable: true })),
  );
  expect(host.querySelector('dialog')).toBeNull();
  expect(document.activeElement).toBe(host.querySelector('summary'));
});
