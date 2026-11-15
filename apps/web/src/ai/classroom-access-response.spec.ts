// @vitest-environment jsdom
import { act, createElement, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { call, type ApiResult } from '../api-call';
import { ClassroomAiAccess } from '../components/ClassroomAiAccess';
import {
  isClassroomAccessSaved,
  isClassroomAccessSettings,
  type ClassroomAccessSettings,
} from './classroom-access-response';

vi.mock('../api-call', () => ({ call: vi.fn() }));

const CLASS = '10000000-0000-4000-8000-000000000001';
const OTHER_CLASS = '10000000-0000-4000-8000-000000000002';
const SEAT = '40000000-aaaa-4aaa-8aaa-000000000001';
const settings = (): ClassroomAccessSettings => ({
  classroomId: CLASS,
  mode: 'rating',
  minimumRating: 70,
  revision: 4,
  readOnly: false,
  students: [
    {
      seatId: SEAT,
      displayName: 'Александра',
      status: 'active',
      override: 'inherit',
      rating: 73.5,
      canGenerate: true,
    },
  ],
});
const withStudent = (field: string, value: unknown) => ({
  ...settings(),
  students: [{ ...settings().students[0], [field]: value }],
});
const ok = (data: unknown): ApiResult<unknown> => ({ ok: true, status: 200, data });

let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.replaceChildren();
  vi.mocked(call).mockReset();
  vi.unstubAllGlobals();
});

describe('classroom access response boundary', () => {
  it('accepts the server projection, closed enums and numeric endpoints without coercion', () => {
    const original = settings();
    const before = structuredClone(original);
    expect(isClassroomAccessSettings(original, CLASS)).toBe(true);
    expect(original).toEqual(before);
    for (const mode of ['deny', 'allow', 'rating'])
      expect(isClassroomAccessSettings({ ...original, mode }, CLASS)).toBe(true);
    for (const status of ['issued', 'active', 'suspended'])
      expect(isClassroomAccessSettings(withStudent('status', status), CLASS)).toBe(true);
    for (const override of ['inherit', 'allow', 'deny'])
      expect(isClassroomAccessSettings(withStudent('override', override), CLASS)).toBe(true);
    for (const rating of [null, 0, 73.5, 100])
      expect(isClassroomAccessSettings(withStudent('rating', rating), CLASS)).toBe(true);
    for (const minimumRating of [0, 100])
      expect(isClassroomAccessSettings({ ...original, minimumRating }, CLASS)).toBe(true);
    for (const revision of [0, 999_999_999_999_999])
      expect(isClassroomAccessSettings({ ...original, revision }, CLASS)).toBe(true);
    expect(isClassroomAccessSettings({ ...original, students: [], readOnly: true }, CLASS)).toBe(
      true,
    );
    expect(isClassroomAccessSettings(withStudent('displayName', '😀'.repeat(120)), CLASS)).toBe(
      true,
    );
  });

  it.each([
    ['missing body', undefined],
    ['non-JSON body', null],
    ['boolean body', true],
    ['array body', []],
    ['generic successful fixture', { items: [], meta: { total: 0 } }],
    ['missing class', { ...settings(), classroomId: undefined }],
    ['invalid class', { ...settings(), classroomId: 'class-1' }],
    ['foreign class', { ...settings(), classroomId: OTHER_CLASS }],
    ['unknown mode', { ...settings(), mode: 'permitted' }],
    ['array mode', { ...settings(), mode: ['allow'] }],
    ['object mode', { ...settings(), mode: { toString: 'allow' } }],
    ['string minimum', { ...settings(), minimumRating: '70' }],
    ['fractional minimum', { ...settings(), minimumRating: 70.5 }],
    ['negative minimum', { ...settings(), minimumRating: -1 }],
    ['minimum above 100', { ...settings(), minimumRating: 101 }],
    ['infinite minimum', { ...settings(), minimumRating: Infinity }],
    ['missing revision', { ...settings(), revision: undefined }],
    ['negative revision', { ...settings(), revision: -1 }],
    ['fractional revision', { ...settings(), revision: 1.5 }],
    ['string revision', { ...settings(), revision: '4' }],
    ['NaN revision', { ...settings(), revision: NaN }],
    ['revision outside mutation range', { ...settings(), revision: 1_000_000_000_000_000 }],
    ['unsafe revision', { ...settings(), revision: Number.MAX_SAFE_INTEGER + 1 }],
    ['nonboolean readOnly', { ...settings(), readOnly: 'false' }],
    ['missing students', { ...settings(), students: undefined }],
    ['null students', { ...settings(), students: null }],
    ['object students', { ...settings(), students: {} }],
    ['null student', { ...settings(), students: [null] }],
    ['array student', { ...settings(), students: [[]] }],
    ['missing seat', withStudent('seatId', undefined)],
    ['invalid seat', withStudent('seatId', 'seat-1')],
    ['missing name', withStudent('displayName', undefined)],
    ['object name', withStudent('displayName', {})],
    ['empty name', withStudent('displayName', '  ')],
    ['overlong name', withStudent('displayName', 'а'.repeat(121))],
    ['unknown status', withStudent('status', 'invited')],
    ['removed seat', withStudent('status', 'removed')],
    ['array status', withStudent('status', ['active'])],
    ['unknown override', withStudent('override', 'allowed')],
    ['array override', withStudent('override', ['allow'])],
    ['missing rating', withStudent('rating', undefined)],
    ['string rating', withStudent('rating', '73.5')],
    ['negative rating', withStudent('rating', -0.01)],
    ['rating above 100', withStudent('rating', 100.01)],
    ['NaN rating', withStudent('rating', NaN)],
    ['infinite rating', withStudent('rating', Infinity)],
    ['missing permission', withStudent('canGenerate', undefined)],
    ['truthy permission', withStudent('canGenerate', 1)],
    [
      'duplicate seat identity',
      {
        ...settings(),
        students: [
          settings().students[0],
          { ...settings().students[0], seatId: SEAT.toUpperCase() },
        ],
      },
    ],
  ])('rejects %s before editable state exists', (_label, value) => {
    expect(isClassroomAccessSettings(value, CLASS)).toBe(false);
  });

  it('requires the selected class to be a UUID too', () => {
    expect(isClassroomAccessSettings(settings(), 'class-1')).toBe(false);
  });

  it('accepts only the exact committed revision or its idempotent replay', () => {
    expect(isClassroomAccessSaved({ saved: true, revision: 5 }, 4)).toBe(true);
    expect(isClassroomAccessSaved({ saved: true, revision: 1 }, 0)).toBe(true);
    expect(
      isClassroomAccessSaved({ saved: true, revision: 1_000_000_000_000_000 }, 999_999_999_999_999),
    ).toBe(true);
    expect(isClassroomAccessSaved({ saved: true, revision: 5 }, -1)).toBe(false);
    expect(isClassroomAccessSaved({ saved: true, revision: 5 }, 4.5)).toBe(false);
  });

  it.each([
    null,
    true,
    [],
    {},
    { items: [] },
    { saved: false, revision: 5 },
    { saved: 'true', revision: 5 },
    { saved: true },
    { saved: true, revision: '5' },
    { saved: true, revision: 4 },
    { saved: true, revision: 6 },
    { saved: true, revision: 5.5 },
    { saved: true, revision: NaN },
    { saved: true, revision: Infinity },
  ])('rejects an unconfirmed mutation receipt: %j', (value) => {
    expect(isClassroomAccessSaved(value, 4)).toBe(false);
  });
});

async function render(classroomId: string, readOnly = false, strict = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  if (!root) {
    const container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  }
  const component = createElement(ClassroomAiAccess, { key: classroomId, classroomId, readOnly });
  await act(async () =>
    root!.render(strict ? createElement(StrictMode, null, component) : component),
  );
}

describe('classroom access response lifecycle', () => {
  it('ignores a late response after the classroom key changes', async () => {
    let resolveOld!: (value: ApiResult<unknown>) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveOld = resolve;
        }),
    );
    vi.mocked(call).mockResolvedValue(
      ok({ ...settings(), classroomId: OTHER_CLASS, mode: 'deny' }),
    );
    await render(CLASS);
    await render(OTHER_CLASS);
    await act(async () => resolveOld(ok({ ...settings(), mode: 'allow' })));
    expect(document.querySelector('select')?.value).toBe('deny');
    expect(vi.mocked(call).mock.calls.map(([path]) => path)).toEqual([
      '/api/ai/classrooms/' + CLASS + '/access',
      '/api/ai/classrooms/' + OTHER_CLASS + '/access',
    ]);
  });

  it('ignores the first StrictMode request when it completes after its replacement', async () => {
    let resolveFirst!: (value: ApiResult<unknown>) => void;
    vi.mocked(call).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    vi.mocked(call).mockResolvedValue(ok({ ...settings(), mode: 'deny' }));
    await render(CLASS, false, true);
    await act(async () => resolveFirst(ok({ ...settings(), mode: 'allow' })));
    expect(document.querySelector('select')?.value).toBe('deny');
    expect(vi.mocked(call).mock.calls).toHaveLength(2);
    expect(vi.mocked(call).mock.calls.every(([, init]) => init === undefined)).toBe(true);
  });

  it.each(['archived prop', 'server readOnly'] as const)(
    'keeps %s non-writable',
    async (source) => {
      vi.mocked(call).mockResolvedValue(
        ok({ ...settings(), readOnly: source === 'server readOnly' }),
      );
      await render(CLASS, source === 'archived prop');
      expect(document.querySelector('select')?.disabled).toBe(true);
      await act(async () => {
        document
          .querySelector('form')!
          .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });
      expect(vi.mocked(call).mock.calls.every(([, init]) => init === undefined)).toBe(true);
    },
  );

  it('keeps suspended Seat controls disabled after accepting a valid projection', async () => {
    vi.mocked(call).mockResolvedValue(ok(withStudent('status', 'suspended')));
    await render(CLASS);
    expect(document.querySelectorAll('select')[0]?.disabled).toBe(false);
    expect(document.querySelectorAll('select')[1]?.disabled).toBe(true);
  });
});
