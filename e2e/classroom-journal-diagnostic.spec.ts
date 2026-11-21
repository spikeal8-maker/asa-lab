import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import {
  expect,
  request,
  test,
  type APIRequestContext,
  type APIResponse,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import pg from 'pg';
import { edit } from '../tests/capacity/documents';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

const enabled = process.env.ASA_CLASSROOM_JOURNAL_DIAGNOSTIC === '1';
const database = '/asa_classroom_journal_diagnostic_test';
const origin = 'http://127.0.0.1:4612';
const month = '2026-10';
const repetitions = 10;
const cohortSizes = [0, 30, 40] as const;
const uuid = /^[a-f0-9-]{36}$/i;
const reportDirectory = 'reports/classroom-journal-diagnostic';

type Operation = 'create-grade' | 'correct-grade' | 'clear-grade' | 'rename-column';
type PupilOperation = 'read-project' | 'write-project' | 'read-own-results';
type TeacherSample = {
  operation: Operation;
  began: number;
  ended?: number;
  requestAt?: number;
  responseAt?: number;
  httpCompletedAt?: number;
  commandId?: string;
  requestId?: string;
  status?: number;
  transportFailed?: boolean;
  verified: boolean;
};
type PupilSample = {
  pupil: number;
  operation: PupilOperation;
  began: number;
  ended?: number;
  status?: number;
};
type DatabaseSample = {
  time: number;
  active: number;
  waitingForLock: number;
  activeJournalWriters: number;
  journalWritersWaitingForLock: number;
};
type Classroom = { id: string; joinCode: string };
type Pupil = { id: string; name: string; code: string };
type ActivePupil = { client: APIRequestContext; project: string; revision: number };

test.skip(!enabled, 'Opt-in synthetic classroom journal characterization');
test.use({ trace: 'off', screenshot: 'off', video: 'off' });

function assertIsolatedRun(baseURL: string | undefined): string {
  const adminUrl = new URL(process.env.TEST_DATABASE_URL ?? 'http://invalid');
  const appUrl = new URL(process.env.APP_TEST_DATABASE_URL ?? 'http://invalid');
  if (
    process.env.GITHUB_ACTIONS !== 'true' ||
    process.env.ASA_E2E_EXTERNAL !== 'true' ||
    baseURL !== origin ||
    !/^[a-f0-9]{40}$/.test(process.env.ASA_BUILD_REVISION ?? '') ||
    [adminUrl, appUrl].some(
      (url) =>
        url.protocol !== 'postgresql:' ||
        url.hostname !== '127.0.0.1' ||
        url.port !== '5432' ||
        url.pathname !== database,
    ) ||
    adminUrl.username !== 'postgres' ||
    appUrl.username !== 'asalab_app'
  ) {
    throw Error('Diagnostic requires its dedicated GitHub runner fixture');
  }
  return adminUrl.href;
}

async function json<T>(response: APIResponse, status: number, action: string): Promise<T> {
  try {
    expect(response.status(), action).toBe(status);
    return (await response.json()) as T;
  } finally {
    await response.dispose();
  }
}

async function prepareClass(page: Page, count: number) {
  const title = 'Journal diagnostic ' + randomUUID().slice(0, 8);
  const created = await json<{ classroom: { id: string } }>(
    await page.request.post('/api/classrooms', {
      headers: { origin },
      data: { title },
    }),
    201,
    'create diagnostic classroom',
  );
  const classroomPath = '/api/classrooms/' + created.classroom.id;
  const { classroom } = await json<{ classroom: Classroom }>(
    await page.request.get(classroomPath),
    200,
    'read diagnostic classroom',
  );
  expect(classroom.id).toBe(created.classroom.id);
  expect(classroom.joinCode).toBeTruthy();
  // All cohorts use the same roster size. Only the number of active sessions changes.
  const students = Array.from({ length: 40 }, (_, index) => ({
    displayLabel: 'Diagnostic pupil ' + String(index + 1).padStart(2, '0'),
    safeMode: true,
  }));
  const batch = await json<{
    created: number;
    results: { seatId: string; displayLabel: string; studentCode: string; status: string }[];
  }>(
    await page.request.post(classroomPath + '/seats/batch', {
      headers: { origin },
      data: { students, requestId: randomUUID() },
    }),
    201,
    'create diagnostic roster',
  );
  expect(batch.created).toBe(students.length);
  const pupils: Pupil[] = batch.results.map(({ seatId, displayLabel, studentCode, status }) => {
    expect(status).toBe('created');
    expect(seatId).toMatch(uuid);
    return { id: seatId, name: displayLabel, code: studentCode };
  });
  expect(new Set(pupils.map(({ id }) => id)).size).toBe(students.length);
  expect(pupils.map(({ name }) => name)).toEqual(students.map(({ displayLabel }) => displayLabel));
  await page.getByRole('link', { name: 'Классы', exact: true }).click();
  await page
    .getByTestId('classroom-card')
    .filter({ hasText: title })
    .locator('.classroom-row-title')
    .click();
  await page.getByRole('button', { name: 'Журнал', exact: true }).click();
  const journal = page.getByRole('region', { name: 'Ручной журнал', exact: true });
  await journal.getByLabel('Месяц журнала', { exact: true }).fill(month);
  await expect(journal.getByRole('rowheader')).toHaveCount(40);
  await expect(journal.getByRole('columnheader')).toHaveCount(11);
  return { classroom, journal, gradedPupil: pupils[0]!, pupils: pupils.slice(0, count) };
}

async function preparePupil(client: APIRequestContext, pupil: Pupil, classroom: Classroom) {
  await json(
    await client.post('/api/class-join/studentseat', {
      data: { code: classroom.joinCode, studentCode: pupil.code },
    }),
    200,
    'open learner session',
  );
  const me = await json<{ authenticated: boolean; student: { seatId: string } }>(
    await client.get('/api/class-join/me'),
    200,
    'check learner identity',
  );
  expect(me.authenticated).toBe(true);
  expect(me.student.seatId).toBe(pupil.id);
  const created = await json<{ project: { id: string } }>(
    await client.post('/api/projects', {
      data: { module: 'electronics', scope: 'personal', title: 'Synthetic journal diagnostic' },
    }),
    201,
    'create a learner draft',
  );
  const project = '/api/projects/' + created.project.id;
  const initial = await json<{ draft: { revision: number } }>(
    await client.get(project),
    200,
    'read initial learner draft',
  );
  expect(Number.isSafeInteger(initial.draft.revision)).toBe(true);
  return { client, project, revision: initial.draft.revision };
}

async function measurePupil<T>(
  samples: PupilSample[],
  pupil: number,
  operation: PupilOperation,
  action: () => Promise<APIResponse>,
): Promise<T> {
  const sample: PupilSample = { pupil, operation, began: performance.now() };
  samples.push(sample);
  try {
    const response = await action();
    sample.status = response.status();
    return await json<T>(response, 200, operation);
  } finally {
    sample.ended = performance.now();
  }
}

async function loadPupil(
  pupil: ActivePupil,
  index: number,
  samples: PupilSample[],
  signal: AbortSignal,
) {
  // A staggered, fixed per-user cadence avoids synchronized bursts or a busy loop.
  await pause(index * 13);
  for (let cycle = 1; !signal.aborted; cycle++) {
    const draft = await measurePupil<{ draft: { revision: number } }>(
      samples,
      index,
      'read-project',
      () => pupil.client.get(pupil.project),
    );
    expect(draft.draft.revision).toBe(pupil.revision);
    if (signal.aborted) return;
    const saved = await measurePupil<{ draft: { revision: number } }>(
      samples,
      index,
      'write-project',
      () =>
        pupil.client.put(pupil.project + '/draft', {
          data: {
            baseRevision: pupil.revision,
            mutationId: randomUUID(),
            document: edit('electronics', cycle),
          },
        }),
    );
    expect(saved.draft.revision).toBe(pupil.revision + 1);
    pupil.revision = saved.draft.revision;
    if (signal.aborted) return;
    await measurePupil(samples, index, 'read-own-results', () =>
      pupil.client.get('/api/class-join/journal/results?from=2026-10-01&to=2026-10-31'),
    );
    await pause(350);
  }
}

function observeJournal(page: Page, classroomId: string) {
  const path = '/api/classrooms/' + classroomId + '/journal/quick';
  const requests = new Map<Request, TeacherSample>();
  let active: TeacherSample | undefined;
  let duplicates = 0;
  const onRequest = (req: Request) => {
    if (req.method() !== 'POST' || new URL(req.url()).pathname !== path || !active) return;
    if (active.requestAt !== undefined) {
      duplicates++;
      return;
    }
    requests.set(req, active);
    active.requestAt = performance.now();
    const commandId = req.postDataJSON()?.requestId;
    if (typeof commandId === 'string' && uuid.test(commandId)) active.commandId = commandId;
  };
  const finish = (req: Request, failed: boolean) => {
    const sample = requests.get(req);
    if (!sample) return;
    sample.httpCompletedAt = performance.now();
    sample.transportFailed = failed;
    requests.delete(req);
  };
  const onResponse = (response: import('@playwright/test').Response) => {
    const sample = requests.get(response.request());
    if (!sample) return;
    sample.status = response.status();
    sample.responseAt = performance.now();
    const id = response.headers()['x-request-id'];
    if (id && uuid.test(id)) sample.requestId = id;
  };
  const onFinished = (req: Request) => finish(req, false);
  const onFailed = (req: Request) => finish(req, true);

  page.on('request', onRequest);
  page.on('response', onResponse);
  page.on('requestfinished', onFinished);
  page.on('requestfailed', onFailed);

  return {
    async measure(sample: TeacherSample, action: () => Promise<void>, editor: Locator) {
      active = sample;
      sample.began = performance.now();
      try {
        await action();
        await expect(editor).toBeHidden();
        sample.ended = performance.now();
        await expect.poll(() => sample.httpCompletedAt !== undefined).toBe(true);
        expect(sample.status).toBe(200);
        expect(sample.transportFailed).toBe(false);
        expect(sample.commandId).toMatch(uuid);
        expect(sample.requestId).toMatch(uuid);
        expect(duplicates, 'unexpected duplicate teacher mutation').toBe(0);
      } finally {
        sample.ended ??= performance.now();
        active = undefined;
      }
    },
    close() {
      page.off('request', onRequest);
      page.off('response', onResponse);
      page.off('requestfinished', onFinished);
      page.off('requestfailed', onFailed);
    },
  };
}

async function verifyGrade(
  reader: pg.Pool,
  classId: string,
  pupilId: string,
  slot: number,
  revision: number,
  value: number | null,
) {
  const result = await reader.query(
    `SELECT rev.revision,rev.value
     FROM classroom_journal_slots slot
     JOIN classroom_journal_revisions rev ON rev.column_id=slot.column_id
     WHERE slot.classroom_id=$1 AND slot.slot_key=$2 AND rev.seat_id=$3
     ORDER BY rev.revision`,
    [classId, month + ':' + slot, pupilId],
  );
  expect(result.rows).toHaveLength(revision);
  expect(result.rows.at(-1)).toEqual({ revision, value });
}

async function verifyHeader(reader: pg.Pool, classId: string, slot: number, category: string) {
  const result = await reader.query(
    `SELECT h.revision,h.category
     FROM classroom_journal_slots slot
     JOIN classroom_journal_headers h ON h.column_id=slot.column_id
     WHERE slot.classroom_id=$1 AND slot.slot_key=$2
     ORDER BY h.revision`,
    [classId, month + ':' + slot],
  );
  expect(result.rows).toEqual([{ revision: 1, category }]);
}

async function sampleDatabase(reader: pg.Pool, samples: DatabaseSample[], signal: AbortSignal) {
  while (!signal.aborted) {
    const time = performance.now();
    const result = await reader.query<Omit<DatabaseSample, 'time'>>(
      `SELECT count(*) FILTER(WHERE state='active')::int AS active,
         count(*) FILTER(WHERE wait_event_type='Lock')::int AS "waitingForLock",
         count(*) FILTER(WHERE state='active' AND query LIKE 'SELECT classroom_journal_quick_write(%')::int AS "activeJournalWriters",
         count(*) FILTER(WHERE state='active' AND wait_event_type='Lock' AND query LIKE 'SELECT classroom_journal_quick_write(%')::int AS "journalWritersWaitingForLock"
       FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`,
    );
    samples.push({ time, ...result.rows[0]! });
    await pause(200);
  }
}

function summarizeTeacher(samples: TeacherSample[], background: PupilSample[], startedAt: number) {
  return samples.map((sample) => {
    const overlap = background.filter(
      (pupil) =>
        sample.requestAt !== undefined &&
        sample.httpCompletedAt !== undefined &&
        pupil.began <= sample.httpCompletedAt &&
        (pupil.ended ?? Number.POSITIVE_INFINITY) >= sample.requestAt,
    );
    return {
      ...sample,
      began: sample.began - startedAt,
      ended: sample.ended === undefined ? undefined : sample.ended - startedAt,
      requestAt: sample.requestAt === undefined ? undefined : sample.requestAt - startedAt,
      responseAt: sample.responseAt === undefined ? undefined : sample.responseAt - startedAt,
      httpCompletedAt:
        sample.httpCompletedAt === undefined ? undefined : sample.httpCompletedAt - startedAt,
      overlappingPupilRequests: overlap.length,
      overlappingPupilOperations: Object.fromEntries(
        pupilOperations.map((operation) => [
          operation,
          overlap.filter((pupil) => pupil.operation === operation).length,
        ]),
      ),
    };
  });
}

const operations: Operation[] = ['create-grade', 'correct-grade', 'clear-grade', 'rename-column'];
const pupilOperations: PupilOperation[] = ['read-project', 'write-project', 'read-own-results'];

for (const count of cohortSizes) {
  test(
    'manual grade and column latency with ' + count + ' active pupil API clients',
    async ({ page, baseURL }) => {
      test.setTimeout(300_000);
      const isolatedUrl = assertIsolatedRun(baseURL);
      const { quantiles } = await import('../tools/capacity/contracts.mjs');
      const admin = e2eAdminPool();
      const reader = new pg.Pool({
        connectionString: isolatedUrl,
        max: 2,
        connectionTimeoutMillis: 2000,
        statement_timeout: 1500,
        options: '-c default_transaction_read_only=on',
      });
      const clients: APIRequestContext[] = [];
      const stop = new AbortController();
      const background: PupilSample[] = [];
      const teacher: TeacherSample[] = [];
      const databaseSamples: DatabaseSample[] = [];
      const workloadErrors: number[] = [];
      let databaseSampleFailed = false;
      let work: Promise<unknown>[] = [];
      let observe: ReturnType<typeof observeJournal> | undefined;
      let startedAt = performance.now();
      let complete = false;
      mkdirSync(reportDirectory, { recursive: true });
      try {
        await page.setViewportSize({ width: 1366, height: 900 });
        await loginWithOrganization(page, await seedTeacher(admin, 'journal-diagnostic'));
        const { classroom, journal, gradedPupil, pupils } = await prepareClass(page, count);
        const active: ActivePupil[] = [];
        for (const pupil of pupils) {
          const client = await request.newContext({
            baseURL: origin,
            extraHTTPHeaders: { origin },
            timeout: 15_000,
          });
          clients.push(client);
          active.push(await preparePupil(client, pupil, classroom));
        }

        observe = observeJournal(page, classroom.id);
        startedAt = performance.now();
        work = active.map((pupil, index) =>
          loadPupil(pupil, index, background, stop.signal).catch(() => {
            workloadErrors.push(index);
            stop.abort();
          }),
        );
        work.push(
          sampleDatabase(reader, databaseSamples, stop.signal).catch(() => {
            databaseSampleFailed = true;
            stop.abort();
          }),
        );
        await expect
          .poll(
            () =>
              new Set(
                background
                  .filter(
                    (sample) => sample.operation === 'read-own-results' && sample.status === 200,
                  )
                  .map(({ pupil }) => pupil),
              ).size,
            { timeout: 20_000 },
          )
          .toBe(count);

        async function measure(operation: Operation, button: Locator, editor: Locator) {
          expect(stop.signal.aborted, 'background or observer failed').toBe(false);
          const sample: TeacherSample = { operation, began: 0, verified: false };
          teacher.push(sample);
          await observe!.measure(sample, () => button.click(), editor);
          return sample;
        }

        for (let slot = 1; slot <= repetitions; slot++) {
          const cell = journal.getByRole('button', {
            name: new RegExp('^' + gradedPupil.name + ', .*?, Работа ' + slot + ':'),
          });
          const grade = journal.getByRole('region', { name: 'Оценка: ' + gradedPupil.name });
          const choose = (value: string) =>
            grade
              .getByRole('group', { name: 'Оценка' })
              .getByRole('button', { name: value, exact: true });

          await cell.click();
          const created = await measure('create-grade', choose('0'), grade);
          await expect(cell).toHaveText('0');
          await verifyGrade(reader, classroom.id, gradedPupil.id, slot, 1, 0);
          created.verified = true;

          await cell.click();
          await grade.getByLabel('Причина изменения').fill('Изменение в диагностическом сценарии');
          const corrected = await measure('correct-grade', choose('4'), grade);
          await expect(cell).toHaveText('4');
          await verifyGrade(reader, classroom.id, gradedPupil.id, slot, 2, 4);
          corrected.verified = true;

          await cell.click();
          await grade.getByLabel('Причина изменения').fill('Очистка в диагностическом сценарии');
          const cleared = await measure(
            'clear-grade',
            grade.getByRole('button', { name: 'Очистить оценку', exact: true }),
            grade,
          );
          await expect(cell).toHaveText('—');
          await verifyGrade(reader, classroom.id, gradedPupil.id, slot, 3, null);
          cleared.verified = true;

          const category = 'Diagnostic renamed ' + slot;
          await journal
            .getByRole('button', { name: new RegExp('^Изменить столбец: Работа ' + slot + ',') })
            .click();
          const editor = journal.getByRole('dialog', { name: 'Столбец журнала' });
          await editor.getByLabel('Категория занятия').fill(category);
          const renamed = await measure(
            'rename-column',
            editor.getByRole('button', { name: 'Сохранить столбец', exact: true }),
            editor,
          );
          await expect(
            journal.getByRole('button', {
              name: new RegExp('^Изменить столбец: ' + category + ','),
            }),
          ).toBeVisible();
          await verifyHeader(reader, classroom.id, slot, category);
          renamed.verified = true;
        }

        stop.abort();
        await Promise.all(work);
        expect(workloadErrors).toEqual([]);
        expect(databaseSampleFailed).toBe(false);
        expect(databaseSamples.length).toBeGreaterThan(0);
        const samples = summarizeTeacher(teacher, background, startedAt);
        for (const operation of operations) {
          const measured = samples.filter((sample) => sample.operation === operation);
          expect(measured).toHaveLength(repetitions);
          expect(measured.every((item) => item.verified)).toBe(true);
          expect(measured.some((item) => item.overlappingPupilRequests > 0)).toBe(count > 0);
        }
        if (count > 0) {
          for (const operation of pupilOperations) {
            expect(
              new Set(
                background
                  .filter((sample) => sample.operation === operation && sample.status === 200)
                  .map(({ pupil }) => pupil),
              ).size,
            ).toBe(count);
          }
        }
        complete = true;
      } finally {
        stop.abort();
        await Promise.allSettled(work);
        observe?.close();
        try {
          const samples = summarizeTeacher(teacher, background, startedAt);
          const summaries = operations.map((operation) => {
            const verified = samples.filter(
              (sample) => sample.operation === operation && sample.verified,
            );
            return {
              operation,
              confirmedUiMs: quantiles(verified.map((item) => item.ended! - item.began)),
              httpMs: quantiles(verified.map((item) => item.httpCompletedAt! - item.requestAt!)),
            };
          });
          const pupilStatuses = pupilOperations.map((operation) => {
            const statuses: Record<string, number> = {};
            for (const sample of background.filter((sample) => sample.operation === operation)) {
              const key = String(sample.status ?? 'transport-failure');
              statuses[key] = (statuses[key] ?? 0) + 1;
            }
            return { operation, statuses };
          });
          writeFileSync(
            reportDirectory + '/cohort-' + count + '.json',
            JSON.stringify(
              {
                sourceSha: process.env.ASA_BUILD_REVISION,
                cohort: count,
                complete,
                fixture: '1 real teacher Chromium page, independent StudentSeat HTTP contexts',
                limits: [
                  'Synthetic data and small Electronics drafts; pupil browser rendering is not measured.',
                  'Database samples provide aggregate lock context, not causal phase attribution.',
                  'Pool acquisition, SQL subphases, notifications and rendering are not individually instrumented.',
                  'UI completion is observed by Playwright after the editor closes. It includes automation polling.',
                  'Percentiles characterize the sample count only, not a latency SLO.',
                ],
                machine: {
                  platform: process.platform,
                  logicalCpus: availableParallelism(),
                  memoryBytes: totalmem(),
                },
                repetitionsPerOperation: repetitions,
                teacher: samples,
                summaries,
                pupilStatuses,
                workloadErrors,
                databaseSampleFailed,
                database: databaseSamples.map((sample) => ({
                  ...sample,
                  time: sample.time - startedAt,
                })),
              },
              null,
              2,
            ) + '\n',
          );
        } finally {
          await Promise.allSettled(clients.map((client) => client.dispose()));
          await Promise.allSettled([reader.end(), admin.end()]);
        }
      }
    },
  );
}
