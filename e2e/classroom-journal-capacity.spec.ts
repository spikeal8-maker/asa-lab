import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, totalmem } from 'node:os';
import { setTimeout as pause } from 'node:timers/promises';
import { isDeepStrictEqual } from 'node:util';
import {
  expect,
  test,
  type APIRequestContext,
  type Locator,
  type Page,
  type Request,
} from '@playwright/test';
import pg from 'pg';
import { assertJournalCapacityEnvironment } from '../playwright.classroom-journal-capacity.config';
import { edit } from '../tests/capacity/documents';
import { loginWithOrganization } from './organization-login';
import { e2eAdminPool, seedTeacher } from './seed';

test.skip(process.env.ASA_JOURNAL_CAPACITY !== '1', 'Opt-in disposable journal capacity job.');

const origin = 'http://127.0.0.1:4612';
const pupilCount = 30;
const dates = 'from=2026-10-01&to=2026-10-31';
const lessonDate = '2026-10-09';
const waveOffsetsMs = [0, 120, 240] as const;
const repetitions = 4;
const widths = [1440, 390] as const;
const phases = ['idle', 'loaded', 'electronics-saves'] as const;
const operations = ['grade', 'column'] as const;

function timingSummary(values: number[]) {
  const sorted = values.sort((a, b) => a - b);
  const percentile = (rank: number) =>
    sorted.length ? sorted[Math.ceil(sorted.length * rank) - 1] : null;
  return { count: sorted.length, p50: percentile(0.5), p95: percentile(0.95), max: percentile(1) };
}

interface PupilProject {
  request: APIRequestContext;
  path: string;
  revision: number;
}

interface ProjectSave {
  status: number | null;
  apiMs: number;
  readbackStatus: number | null;
  verified: boolean;
}

interface PupilWave {
  plannedOffsetMs: number;
  startedOffsetMs: number;
  startedBeforeAck: boolean;
  peakPupilsInFlight: number;
  successes: number;
  statuses: Record<string, number>;
  projectSaves: ProjectSave[];
}

interface Sample {
  width: number;
  phase: (typeof phases)[number];
  operation: (typeof operations)[number];
  apiMs: number | null;
  visibleMs: number | null;
  status: number | null;
  durable: boolean;
  waves: PupilWave[];
}

async function savePupilProject(project: PupilProject): Promise<ProjectSave> {
  // One write for this pupil in the wave. A subsequent action begins only
  // after all durable readbacks finish and carry forward the verified revision.
  const revision = project.revision;
  const document = edit('electronics', revision + 1);
  const started = performance.now();
  const sample: ProjectSave = { status: null, apiMs: 0, readbackStatus: null, verified: false };
  try {
    const response = await project.request.put(project.path + '/draft', {
      data: { document, baseRevision: revision, mutationId: randomUUID() },
    });
    sample.status = response.status();
    const saved = (await response.json()).draft;
    sample.apiMs = performance.now() - started;
    if (!response.ok() || saved?.revision !== revision + 1) return sample;
    const readback = await project.request.get(project.path);
    sample.readbackStatus = readback.status();
    const read = (await readback.json()).draft;
    sample.verified =
      readback.ok() &&
      read?.revision === saved.revision &&
      isDeepStrictEqual(read?.document, document);
    if (sample.verified) project.revision = saved.revision;
  } catch {
    sample.apiMs ||= performance.now() - started;
  }
  return sample;
}

async function browserSave(
  page: Page,
  button: Locator,
  quickPath: string,
  pupils: PupilProject[],
  sample: Sample,
  expected: { notice: string; cellPrefix: string; cellValue?: string },
) {
  // Arm the timing at the real browser event. Waiting for Playwright to deliver a
  // locator assertion back to the driver is outside the UI measurement.
  await button.evaluate((element, proof) => {
    const journal = element.closest('.manual-journal')!;
    journal.removeAttribute('data-capacity-visible-ms');
    element.addEventListener(
      'click',
      () => {
        const started = performance.now();
        const observer = new MutationObserver(() => {
          const notice = journal.querySelector('.manual-journal-notice');
          if (notice?.textContent?.trim() !== proof.notice || !notice.getClientRects().length)
            return;
          const updated = [...journal.querySelectorAll('button[aria-label]')].find(
            (cell) =>
              cell.getAttribute('aria-label')?.startsWith(proof.cellPrefix) &&
              (proof.cellValue === undefined || cell.textContent?.trim() === proof.cellValue),
          );
          if (!updated?.getClientRects().length) return;
          journal.setAttribute('data-capacity-visible-ms', String(performance.now() - started));
          observer.disconnect();
        });
        observer.observe(journal, {
          childList: true,
          attributes: true,
          characterData: true,
          subtree: true,
        });
        setTimeout(() => observer.disconnect(), 10_000);
      },
      { once: true, capture: true },
    );
  }, expected);

  const journalRequest = (request: Request) =>
    request.method() === 'POST' && new URL(request.url()).pathname === quickPath;
  let acknowledgedAt = Infinity;
  const background = page.waitForRequest(journalRequest, { timeout: 10_000 }).then(async () => {
    if (sample.phase === 'idle') return;
    const started = performance.now();
    await Promise.all(
      waveOffsetsMs.map(async (offset, waveIndex) => {
        if (offset) await pause(offset);
        const startedAt = performance.now();
        const saveProjects = sample.phase === 'electronics-saves' && waveIndex === 0;
        const wave: PupilWave = {
          plannedOffsetMs: offset,
          startedOffsetMs: startedAt - started,
          startedBeforeAck: startedAt < acknowledgedAt,
          peakPupilsInFlight: 0,
          successes: 0,
          statuses: {},
          projectSaves: [],
        };
        sample.waves.push(wave);
        let inFlight = 0;
        await Promise.all(
          pupils.map(async (pupil, index) => {
            // A synchronized class pulse with two authenticated learner read paths.
            const path =
              (index + waveIndex) % 2 === 0
                ? '/api/class-join/me/assignments'
                : '/api/class-join/journal/results?' + dates;
            inFlight++;
            wave.peakPupilsInFlight = Math.max(wave.peakPupilsInFlight, inFlight);
            try {
              if (saveProjects) {
                const saved = await savePupilProject(pupil);
                wave.projectSaves.push(saved);
                if (saved.verified) wave.successes++;
                const status = String(saved.status ?? 'transport_or_body_error');
                wave.statuses[status] = (wave.statuses[status] ?? 0) + 1;
                return;
              }
              const response = await pupil.request.get(path);
              const body = (await response.json()) as { items?: unknown[] };
              if (response.ok() && Array.isArray(body.items)) wave.successes++;
              const status = String(response.status());
              wave.statuses[status] = (wave.statuses[status] ?? 0) + 1;
            } catch {
              wave.statuses.transport_or_body_error =
                (wave.statuses.transport_or_body_error ?? 0) + 1;
            } finally {
              inFlight--;
            }
          }),
        );
      }),
    );
  });
  const reply = page.waitForResponse((response) => journalRequest(response.request()), {
    timeout: 10_000,
  });
  const backgroundSettled = Promise.allSettled([background]);
  try {
    const [, response] = await Promise.all([button.click(), reply]);
    sample.status = response.status();
    const responseError = await response.finished();
    acknowledgedAt = performance.now();
    expect(responseError).toBeNull();
    const timing = response.request().timing();
    expect(timing.responseEnd).toBeGreaterThanOrEqual(0);
    sample.apiMs = timing.responseEnd;
    expect(response.ok(), 'Journal mutation must be acknowledged').toBe(true);
    const marker = page.locator('.manual-journal');
    await expect(marker).toHaveAttribute('data-capacity-visible-ms', /^\d/, { timeout: 10_000 });
    const value = Number(await marker.getAttribute('data-capacity-visible-ms'));
    expect(Number.isFinite(value)).toBe(true);
    sample.visibleMs = value;
    return { input: response.request().postDataJSON(), receipt: await response.json() };
  } finally {
    await backgroundSettled;
  }
}

test('30 independent learners stay active while the teacher saves grades and column names', async ({
  page,
  playwright,
  baseURL,
}) => {
  assertJournalCapacityEnvironment();
  expect(baseURL).toBe(origin);
  const pupilRequests: APIRequestContext[] = [];
  const pupils: PupilProject[] = [];
  const samples: Sample[] = [];
  const distinctPupils = new Set<string>();
  const replayCount: Record<Sample['operation'], number> = { grade: 0, column: 0 };
  let outcome = 'FAIL';
  const admin = e2eAdminPool();
  const observer = new pg.Pool({
    connectionString: process.env.TEST_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 2_000,
    query_timeout: 1_500,
    statement_timeout: 1_000,
    options: '-c default_transaction_read_only=on',
  });
  const database = { samples: 0, errors: 0, peakActive: 0, peakLockWaiters: 0 };
  let stopSampling = false;
  let sampling: Promise<void> | undefined;
  try {
    const owner = await seedTeacher(admin, 'journal-capacity');
    await page.setViewportSize({ width: 1440, height: 900 });
    await loginWithOrganization(page, owner);
    const post = (path: string, data: unknown) =>
      page.request.post(path, { headers: { origin }, data });
    const created = await page.request.post('/api/classrooms', {
      headers: { origin, 'idempotency-key': randomUUID() },
      data: {
        title: 'Учебный класс для замера журнала',
        ageBand: 'mixed',
        topicKeys: [],
        safeModeDefault: true,
      },
    });
    expect(created.ok(), 'Create the disposable class').toBe(true);
    const classroom = (await created.json()).classroom as { id: string; joinCode: string };
    const classroomPath = '/api/classrooms/' + classroom.id;
    const quickPath = classroomPath + '/journal/quick';
    const studentNames = Array.from({ length: pupilCount }, (_, i) => 'Ученик теста ' + (i + 1));
    const batch = await post(classroomPath + '/seats/batch', {
      requestId: randomUUID(),
      students: studentNames.map((displayLabel) => ({ displayLabel, safeMode: true })),
    });
    expect(batch.ok(), 'Issue the 30 disposable seats').toBe(true);
    const students = (await batch.json()).results as {
      displayLabel: string;
      seatId: string;
      studentCode: string;
    }[];
    expect(students).toHaveLength(pupilCount);
    const firstSeat = students.find((student) => student.displayLabel === studentNames[0])!;
    for (const student of students) {
      const pupil = await playwright.request.newContext({
        baseURL: origin,
        extraHTTPHeaders: { origin },
        timeout: 6_000,
      });
      pupilRequests.push(pupil);
      const login = await pupil.post('/api/class-join/studentseat', {
        data: { code: classroom.joinCode, studentCode: student.studentCode },
      });
      expect(login.ok(), 'Authenticate an independent test pupil').toBe(true);
      const body = await login.json();
      expect(body.student?.seatId).toBe(student.seatId);
      expect(body.classroom?.id).toBe(classroom.id);
      distinctPupils.add(body.student.seatId);
      const project = await pupil.post('/api/projects', {
        headers: { 'idempotency-key': randomUUID() },
        data: { module: 'electronics', scope: 'personal', title: 'Synthetic workload' },
      });
      expect(project.status(), 'Create each pupil project outside timing').toBe(201);
      const path = '/api/projects/' + (await project.json()).project.id;
      const open = await pupil.get(path);
      expect(open.ok(), 'Open the pupil project outside timing').toBe(true);
      const revision = (await open.json()).draft.revision;
      expect(Number.isSafeInteger(revision)).toBe(true);
      pupils.push({ request: pupil, path, revision });
    }
    expect(distinctPupils.size).toBe(pupilCount);
    expect(new Set(pupils.map((pupil) => pupil.path)).size).toBe(pupilCount);

    const readJournal = async (columnId?: string) => {
      const snapshot = await page.request.get(
        classroomPath + '/journal?' + dates + (columnId ? '&columnId=' + columnId : ''),
      );
      expect(snapshot.ok(), 'Read the exact persisted journal view').toBe(true);
      return snapshot.json();
    };
    const initial = await readJournal();
    let category = 'Практическая работа';
    let grade = 2;
    const warmup = await post(quickPath, {
      slotKey: '2026-10:1',
      date: lessonDate,
      category,
      expectedScaleVersion: initial.scale.version,
      expectedHeaderRevision: 0,
      seatId: firstSeat.seatId,
      value: grade,
      expectedRevision: 0,
      reason: null,
      requestId: randomUUID(),
    });
    expect(warmup.ok(), 'Materialize the sample column outside timing').toBe(true);
    const columnId = (await warmup.json()).column.id as string;

    await page.goto('/#/classrooms/' + classroom.id);
    expect(new URL(page.url()).origin).toBe(origin);
    await page.getByRole('button', { name: 'Журнал', exact: true }).click();
    const journal = page.getByRole('region', { name: 'Ручной журнал', exact: true });
    await journal.getByLabel('Месяц журнала', { exact: true }).fill('2026-10');
    await expect(journal.getByRole('rowheader')).toHaveCount(pupilCount);
    const cell = () =>
      journal.getByRole('button', {
        name: new RegExp('^' + firstSeat.displayLabel + ', .*?, ' + category + ':'),
      });
    const header = () =>
      journal.getByRole('button', { name: new RegExp('^Изменить столбец: ' + category + ',') });
    await expect(cell()).toHaveText(String(grade));

    sampling = (async () => {
      while (!stopSampling) {
        try {
          const { rows } = await observer.query<{ active: number; lock_waiters: number }>(
            `SELECT count(*) FILTER (WHERE state = 'active')::int AS active,
                    count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waiters
               FROM pg_stat_activity
              WHERE datname = current_database() AND usename = 'asalab_app'`,
          );
          database.samples++;
          database.peakActive = Math.max(database.peakActive, rows[0]!.active);
          database.peakLockWaiters = Math.max(database.peakLockWaiters, rows[0]!.lock_waiters);
        } catch {
          database.errors++;
        }
        await pause(100);
      }
    })();

    for (const width of widths) {
      await page.setViewportSize({ width, height: width === 1440 ? 900 : 844 });
      for (const phase of phases) {
        for (let repetition = 0; repetition < repetitions; repetition++) {
          for (const operation of operations) {
            let button: Locator;
            let visible: Parameters<typeof browserSave>[5];
            if (operation === 'grade') {
              await cell().click();
              grade = grade === 3 ? 4 : 3;
              button = journal
                .getByRole('region', { name: 'Оценка: ' + firstSeat.displayLabel })
                .getByRole('group', { name: 'Оценка' })
                .getByRole('button', { name: String(grade), exact: true });
              visible = {
                notice: 'Оценка сохранена.',
                cellPrefix: firstSeat.displayLabel + ', ',
                cellValue: String(grade),
              };
            } else {
              await header().click();
              const editor = journal.getByRole('dialog', { name: 'Столбец журнала' });
              category = 'Практическая работа ' + (samples.length + 1);
              await editor.getByLabel('Категория занятия').fill(category);
              button = editor.getByRole('button', { name: 'Сохранить столбец', exact: true });
              visible = {
                notice: 'Столбец сохранён.',
                cellPrefix: 'Изменить столбец: ' + category + ',',
              };
            }
            const sample: Sample = {
              width,
              phase,
              operation,
              apiMs: null,
              visibleMs: null,
              status: null,
              durable: false,
              waves: [],
            };
            samples.push(sample);
            const { input, receipt } = await browserSave(
              page,
              button,
              quickPath,
              pupils,
              sample,
              visible,
            );
            const persisted = await readJournal(columnId);
            expect(persisted.columns).toContainEqual(
              expect.objectContaining({
                id: columnId,
                category,
                headerRevision: receipt.column.headerRevision,
              }),
            );
            if (operation === 'grade')
              expect(persisted.grades).toContainEqual(
                expect.objectContaining({
                  columnId,
                  seatId: firstSeat.seatId,
                  value: grade,
                  revision: receipt.grade.revision,
                }),
              );
            if (repetition === 0) {
              const reply = await post(quickPath, input);
              expect(reply.ok(), 'Replay the same mutation receipt').toBe(true);
              expect(await reply.json()).toEqual(receipt);
              replayCount[operation]++;
            }
            sample.durable = true;
            if (phase !== 'idle') {
              expect(sample.waves).toHaveLength(waveOffsetsMs.length);
              for (const wave of sample.waves) {
                expect(wave.successes).toBe(pupilCount);
                expect(wave.peakPupilsInFlight).toBe(pupilCount);
              }
              const saveWave = sample.waves.find((wave) => wave.plannedOffsetMs === 0);
              expect(saveWave?.startedBeforeAck).toBe(true);
              expect(saveWave?.projectSaves).toHaveLength(
                phase === 'electronics-saves' ? pupilCount : 0,
              );
            } else expect(sample.waves).toEqual([]);
          }
        }
      }
    }
    expect(samples).toHaveLength(repetitions * widths.length * phases.length * operations.length);
    expect(database.samples).toBeGreaterThan(0);
    expect(database.errors).toBe(0);
    outcome = 'PASS';
  } finally {
    stopSampling = true;
    await sampling;
    const buckets = widths.flatMap((width) =>
      phases.flatMap((phase) =>
        operations.map((operation) => {
          const selected = samples.filter(
            (s) => s.width === width && s.phase === phase && s.operation === operation,
          );
          const projectSaves = selected.flatMap((sample) =>
            sample.waves.flatMap((wave) => wave.projectSaves),
          );
          return {
            width,
            phase,
            operation,
            attempted: selected.length,
            durable: selected.filter((s) => s.durable).length,
            api: timingSummary(selected.flatMap((s) => (s.apiMs === null ? [] : [s.apiMs]))),
            clickToVisible: timingSummary(
              selected.flatMap((s) => (s.visibleMs === null ? [] : [s.visibleMs])),
            ),
            projectSaves: {
              api: timingSummary(projectSaves.map((save) => save.apiMs)),
              verified: projectSaves.filter((save) => save.verified).length,
            },
          };
        }),
      ),
    );
    mkdirSync('reports/capacity', { recursive: true });
    writeFileSync(
      'reports/capacity/classroom-journal.json',
      JSON.stringify(
        {
          schemaVersion: 2,
          sourceSha: process.env.ASA_BUILD_REVISION,
          outcome,
          profile: 'JOURNAL-ACTIVE-30-V2',
          environment: {
            cpus: availableParallelism(),
            memoryBytes: totalmem(),
            node: process.version,
          },
          pupils: { scheduled: pupilCount, admittedDistinct: distinctPupils.size, waveOffsetsMs },
          observations: buckets,
          replaysVerified: replayCount,
          database,
          samples,
        },
        null,
        2,
      ) + '\n',
    );
    await Promise.allSettled(pupilRequests.map((request) => request.dispose()));
    await Promise.all([admin.end(), observer.end()]);
  }
});
