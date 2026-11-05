import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { availableParallelism, cpus, freemem, totalmem } from 'node:os';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { build, type Plugin } from 'vite';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { FixtureCookieJar } from '../../tools/capacity/contracts.mjs';
import {
  assertStormEnvironment,
  documentDigest,
  STORM_ORIGIN,
  STORM_API_ORIGIN,
  stormQuantiles,
  stormRoute,
  summarizeStorm,
} from '../../tools/capacity/request-storm-contracts.mjs';
import { edit } from './documents';
import type { storm } from './request-storm-client';

declare global {
  interface Window {
    __asaStorm: typeof storm;
  }
}
type Data = Record<string, unknown>;
type ApiFactory = typeof import('../../apps/api/dist/app.factory.js');
type Observation = {
  client: number;
  phase: string;
  route: string;
  method: string;
  status: number;
  durationMs: number;
  injected: boolean;
  completed: boolean;
};
const wait = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const execute = promisify(execFile);
const hostCpu = () =>
  cpus().reduce(
    (sum, cpu) => ({
      idle: sum.idle + cpu.times.idle,
      total: sum.total + Object.values(cpu.times).reduce((a, b) => a + b, 0),
    }),
    { idle: 0, total: 0 },
  );
const object = (value: unknown): Data => {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw Error('Invalid fixture response');
  return value as Data;
};
const text = (value: unknown): string => {
  if (typeof value !== 'string' || !value) throw Error('Missing fixture string');
  return value;
};

describe.skipIf(process.env.ASA_REQUEST_STORM !== '1')(
  'isolated real classroom request-storm workload',
  () => {
    it('runs independent browser identities through the real API and PostgreSQL', async () => {
      const fixture = assertStormEnvironment(process.env);
      const sourceRoot = resolve(process.env.ASA_STORM_SOURCE_ROOT || '.');
      const sourceFactory = (await import(
        /* @vite-ignore */ pathToFileURL(resolve(sourceRoot, 'apps/api/dist/app.factory.js')).href
      )) as ApiFactory;
      const runtime = new pg.Pool({
        connectionString: process.env.APP_TEST_DATABASE_URL,
        ...sourceFactory.poolSettings(),
      });
      const analytics = new pg.Pool({
        connectionString: process.env.APP_TEST_DATABASE_URL,
        ...sourceFactory.analyticsPoolSettings(),
      });
      const observer = new pg.Pool({
        connectionString: process.env.TEST_DATABASE_URL,
        max: 1,
        connectionTimeoutMillis: 2000,
        statement_timeout: 1500,
        query_timeout: 2000,
        options: '-c default_transaction_read_only=on',
      });
      let app: Awaited<ReturnType<ApiFactory['createApiApp']>> | undefined;
      let proxy: Server | undefined;
      let browser: Browser | undefined;
      const contexts: BrowserContext[] = [];
      const pages: Page[] = [];
      const records: Observation[] = [];
      const samples: Data[] = [];
      const javascriptErrors: string[] = [];
      const loginMs: number[] = [];
      const projectMs: number[] = [];
      const correctness = {
        independentIdentities: 0,
        savesVerified: 0,
        reloadIdentities: 0,
        recoveryIdentities: 0,
        gameNotifications: 0,
        gameMatches: 0,
        crossIdentityDenied: 0,
      };
      let phase = 'setup';
      let fault: 'none' | 'diagnostic-errors' | 'telemetry503' | 'notifications503' | 'slow-chess' =
        'none';
      let started = performance.now();
      let peakHttp = 0;
      let activeHttp = 0;
      let peakBusinessPerInstance = 0;
      let peakNotificationsPerChannel = 0;
      const activeBusiness = new Map<number, number>();
      const activeChannels = new Map<string, number>();
      const phaseTimes: Record<string, { startedMs: number; endedMs?: number }> = {};
      let sampler: ReturnType<typeof setInterval> | undefined;
      let samplePending: Promise<void> | undefined;
      let sampleErrors = 0;
      let success = false;
      const loop = monitorEventLoopDelay({ resolution: 20 });
      let cpu = process.cpuUsage();
      let previousHostCpu = hostCpu();
      const startPhase = (name: string) => {
        if (phaseTimes[phase]) phaseTimes[phase]!.endedMs = performance.now() - started;
        phase = name;
        phaseTimes[name] = { startedMs: performance.now() - started };
        console.log(`[request-storm] ${fixture.variant}/${fixture.users}: ${name}`);
      };
      const sample = () => {
        if (samplePending) return;
        samplePending = (async () => {
          try {
            const data = await observer.query(`SELECT count(*)::int AS connections,
            count(*) FILTER (WHERE state = 'active')::int AS active,
            count(*) FILTER (WHERE wait_event_type = 'Lock')::int AS lock_waiters
            FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`);
            const currentHostCpu = hostCpu();
            const hostTicks = currentHostCpu.total - previousHostCpu.total;
            const hostBusyPercent =
              hostTicks > 0
                ? 100 * (1 - (currentHostCpu.idle - previousHostCpu.idle) / hostTicks)
                : 0;
            previousHostCpu = currentHostCpu;
            let chromiumResources: Data = { supported: false };
            if (process.platform === 'linux') {
              const { stdout } = await execute('ps', ['-eo', 'comm=,rss=,pcpu='], {
                timeout: 1500,
                maxBuffer: 1048576,
              });
              const processes = stdout
                .trim()
                .split('\n')
                .map((row) => row.trim().split(/\s+/))
                .filter(([name]) => /^(?:chrome|chromium)/.test(name ?? ''));
              chromiumResources = {
                supported: true,
                processes: processes.length,
                rssSumBytes: processes.reduce((sum, row) => sum + Number(row[1]) * 1024, 0),
                lifetimeCpuPercentSum: processes.reduce((sum, row) => sum + Number(row[2]), 0),
              };
            }
            samples.push({
              elapsedMs: Math.round(performance.now() - started),
              phase,
              ...data.rows[0],
              apiPoolWaiting: runtime.waitingCount,
              analyticsPoolWaiting: analytics.waitingCount,
              nodeRssBytes: process.memoryUsage().rss,
              hostBusyPercent,
              hostFreeMemoryBytes: freemem(),
              chromiumResources,
            });
          } catch {
            sampleErrors++;
          }
        })().finally(() => {
          samplePending = undefined;
        });
      };
      async function setupCall(
        jar: InstanceType<typeof FixtureCookieJar>,
        method: string,
        path: string,
        data?: unknown,
        expected = [200],
      ): Promise<Data> {
        const response = await fetch(`${STORM_ORIGIN}${path}`, {
          method,
          redirect: 'error',
          signal: AbortSignal.timeout(15000),
          headers: {
            origin: STORM_ORIGIN,
            cookie: jar.header(path),
            'content-type': 'application/json',
            'idempotency-key': randomUUID(),
          },
          ...(data === undefined ? {} : { body: JSON.stringify(data) }),
        });
        jar.receive(response.headers.getSetCookie(), path);
        const body = object(await response.json());
        if (!expected.includes(response.status))
          throw Error(
            `Fixture setup ${method} ${stormRoute(path)}: HTTP${response.status} ${JSON.stringify(body.error)}`,
          );
        return body;
      }
      try {
        const identity = await observer.query(
          'SELECT current_database() AS name, current_user AS actor',
        );
        expect(identity.rows[0].name).toBe(fixture.database);
        const entry = resolve('tests/capacity/request-storm-client.tsx');
        const remap: Plugin = {
          name: 'exact-request-storm-client-source',
          resolveId(source, importer) {
            if (importer?.split('?')[0] === entry && source.startsWith('../../apps/'))
              return this.resolve(resolve(sourceRoot, source.slice(6)), importer, {
                skipSelf: true,
              });
            return null;
          },
        };
        const built = await build({
          configFile: false,
          logLevel: 'warn',
          plugins: [remap],
          resolve: { dedupe: ['react', 'react-dom'] },
          define: {
            'process.env.NODE_ENV': '"production"',
            __ASA_BUILD_REVISION__: JSON.stringify(fixture.source),
            'import.meta.env.VITE_ASA_BUILD_REVISION': JSON.stringify(fixture.source),
          },
          // Vitest sets NODE_ENV=test; match JSX output to the production React above.
          esbuild: { jsx: 'automatic', jsxDev: false },
          build: {
            write: false,
            minify: false,
            lib: { entry, formats: ['iife'], name: 'AsaStormFixture' },
          },
        });
        const bundles = Array.isArray(built) ? built : [built];
        const script = bundles
          .flatMap((bundle) => ('output' in bundle ? bundle.output : []))
          .find((item) => item.type === 'chunk');
        if (!script || script.type !== 'chunk') throw Error('Missing real client bundle');
        app = await sourceFactory.createApiApp({
          pool: runtime,
          analyticsPool: analytics,
          webDist: null,
          allowedWebOrigin: STORM_ORIGIN,
          localApiPort: 4611,
          logRequests: false,
        });
        await app.listen(4611, '127.0.0.1');
        proxy = createServer((request, response) => {
          const url = new URL(request.url || '/', STORM_ORIGIN);
          if (url.pathname === '/__storm') {
            response.writeHead(200, {
              'content-type': 'text/html; charset=utf-8',
              'cache-control': 'no-store',
            });
            response.end(
              '<!doctype html><html lang="ru"><meta charset="utf-8"><title>Synthetic request-storm fixture</title><div id="root"></div><script src="/__storm.js"></script></html>',
            );
            return;
          }
          if (url.pathname === '/__storm.js') {
            response.writeHead(200, {
              'content-type': 'text/javascript',
              'cache-control': 'no-store',
            });
            response.end(script.code);
            return;
          }
          if (!url.pathname.startsWith('/api/')) {
            response.writeHead(404);
            response.end();
            return;
          }
          const tag = request.headers['x-asa-storm-client'];
          // Page setup precedes the measurement clock. Preserve it as observer traffic,
          // including requests that finish after the simultaneous-login barrier.
          const client =
            phase !== 'setup' && typeof tag === 'string' && /^\d+$/.test(tag) ? Number(tag) : -1;
          const telemetry = /^\/api\/(?:diagnostics|analytics)\//.test(url.pathname);
          const notification = /^\/api\/games\/(chess|checkers)\/notifications$/.test(url.pathname);
          const key = `${client}:${url.pathname}`;
          const began = performance.now();
          const record: Observation = {
            client,
            phase,
            route: stormRoute(url.pathname),
            method: request.method || 'GET',
            status: 0,
            durationMs: 0,
            injected: false,
            completed: false,
          };
          if (client >= 0) {
            activeHttp++;
            peakHttp = Math.max(peakHttp, activeHttp);
            if (!telemetry) {
              activeBusiness.set(client, (activeBusiness.get(client) || 0) + 1);
              peakBusinessPerInstance = Math.max(
                peakBusinessPerInstance,
                activeBusiness.get(client)!,
              );
            }
            if (notification) {
              activeChannels.set(key, (activeChannels.get(key) || 0) + 1);
              peakNotificationsPerChannel = Math.max(
                peakNotificationsPerChannel,
                activeChannels.get(key)!,
              );
            }
          }
          let finished = false;
          const finish = () => {
            if (finished) return;
            finished = true;
            record.status = response.writableFinished ? response.statusCode : 499;
            record.completed = response.writableFinished;
            record.durationMs = performance.now() - began;
            records.push(record);
            if (client >= 0) {
              activeHttp--;
              if (!telemetry) activeBusiness.set(client, activeBusiness.get(client)! - 1);
              if (notification) activeChannels.set(key, activeChannels.get(key)! - 1);
            }
          };
          response.on('finish', finish);
          response.on('close', finish);
          const injected =
            (fault === 'diagnostic-errors' && url.searchParams.has('stormFailure')) ||
            (fault === 'telemetry503' && telemetry) ||
            (fault === 'notifications503' && notification);
          if (injected) {
            record.injected = true;
            request.resume();
            response.writeHead(503, { 'content-type': 'application/json', 'retry-after': '2' });
            response.end(JSON.stringify({ error: { code: 'fixture_unavailable' } }));
            return;
          }
          const forward = () => {
            if (response.destroyed) return;
            const upstream = httpRequest(
              `${STORM_API_ORIGIN}${request.url}`,
              { method: request.method, headers: request.headers },
              (result) => {
                response.writeHead(result.statusCode || 502, result.headers);
                result.pipe(response);
              },
            );
            upstream.on('error', () => {
              if (!response.destroyed) {
                response.writeHead(502);
                response.end();
              }
            });
            response.on('close', () => upstream.destroy());
            request.pipe(upstream);
          };
          if (fault === 'slow-chess' && url.pathname === '/api/games/chess/notifications') {
            const timer = setTimeout(forward, 8000);
            response.on('close', () => clearTimeout(timer));
          } else forward();
        });
        await new Promise<void>((done, fail) => {
          proxy!.once('error', fail);
          proxy!.listen(4612, '127.0.0.1', done);
        });
        const teacher = new FixtureCookieJar();
        const suffix = fixture.run.replaceAll('-', '').slice(0, 16);
        await setupCall(
          teacher,
          'POST',
          '/api/auth/register',
          {
            email: `storm-${suffix}@example.invalid`,
            username: `storm_${suffix}`,
            displayName: 'Synthetic storm teacher',
            password: `Fixture-${randomUUID()}-Only`,
            birthDate: '1990-01-01',
            country: 'RU',
          },
          [201],
        );
        await setupCall(teacher, 'POST', '/api/capabilities/educator/self-attest', {}, [201]);
        const classroom = object(
          (
            await setupCall(
              teacher,
              'POST',
              '/api/classrooms',
              { title: 'Synthetic request-storm class', safeModeDefault: true },
              [201],
            )
          ).classroom,
        );
        const details = object(
          (await setupCall(teacher, 'GET', `/api/classrooms/${classroom.id}`)).classroom,
        );
        for (const game of ['chess', 'checkers']) {
          const policy = await setupCall(
            teacher,
            'GET',
            `/api/games/${game}/policy/${classroom.id}`,
          );
          await setupCall(teacher, 'PUT', `/api/games/${game}/policy/${classroom.id}`, {
            enabled: true,
            scope: 'classroom',
            expectedVersion: policy.version,
          });
        }
        const credentials: { code: string }[] = [];
        for (let index = 0; index < fixture.users; index++) {
          const issued = object(
            (
              await setupCall(
                teacher,
                'POST',
                `/api/classrooms/${classroom.id}/seats`,
                { displayLabel: `Synthetic learner${index}`, safeMode: true },
                [201],
              )
            ).student,
          );
          credentials.push({ code: text(issued.studentCode) });
        }
        browser = await chromium.launch({ headless: true });
        for (let index = 0; index < fixture.users; index++) {
          const context = await browser.newContext({ baseURL: STORM_ORIGIN });
          contexts.push(context);
          const page = await context.newPage();
          pages.push(page);
          page.on('pageerror', (error) => javascriptErrors.push(error.name));
          // Each context represents a separate pupil's focused computer, not60 background tabs.
          const cdp = await context.newCDPSession(page);
          await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
          await page.goto(`${STORM_ORIGIN}/__storm?client=${index}`);
          await page.waitForFunction(() => !!window.__asaStorm?.ready);
          expect(
            await page.evaluate(() => ({
              visible: document.visibilityState,
              focused: document.hasFocus(),
            })),
          ).toEqual({ visible: 'visible', focused: true });
        }
        started = performance.now();
        cpu = process.cpuUsage();
        previousHostCpu = hostCpu();
        loop.enable();
        sampler = setInterval(sample, 1000);
        sample();
        startPhase('simultaneous-login');
        const identities = await Promise.all(
          pages.map((page, index) =>
            page.evaluate(async ({ code, student }) => window.__asaStorm.login(code, student), {
              code: text(details.joinCode),
              student: credentials[index]!.code,
            }),
          ),
        );
        identities.forEach((identity) => loginMs.push(identity.durationMs));
        expect(new Set(identities.map((identity) => identity.seatId)).size).toBe(fixture.users);
        correctness.independentIdentities = identities.length;
        startPhase('duplicate-portal-bootstrap');
        projectMs.push(
          ...(await Promise.all(
            pages.map((page) => page.evaluate(() => window.__asaStorm.bootstrap())),
          )),
        );
        startPhase('electronics-save-reopen');
        const expectedDocument = edit('electronics', 1);
        const saved = await Promise.all(
          pages.map((page) =>
            page.evaluate(
              (document) => window.__asaStorm.createAndSave(document),
              expectedDocument,
            ),
          ),
        );
        saved.forEach((value) => {
          expect(documentDigest(value.document)).toBe(documentDigest(expectedDocument));
          correctness.savesVerified++;
        });
        const firstProject = await pages[0]!.evaluate(() => window.__asaStorm.projectId());
        expect([403, 404]).toContain(
          await pages[1]!.evaluate((id) => window.__asaStorm.foreignRead(id), firstProject),
        );
        correctness.crossIdentityDenied++;
        startPhase('healthy-notifications');
        await wait(12000);
        startPhase('portal-transitions');
        await Promise.all(
          pages.map((page) =>
            page.evaluate(async () => {
              for (const route of ['home', 'games', 'projects', 'editor.electronics'] as const)
                window.__asaStorm.route(route);
              await window.__asaStorm.requestBurst();
            }),
          ),
        );
        startPhase('diagnostic-error-burst');
        fault = 'diagnostic-errors';
        await Promise.all(pages.map((page) => page.evaluate(() => window.__asaStorm.failures())));
        await wait(3000);
        fault = 'none';
        startPhase('simultaneous-reload');
        const reopened = await Promise.all(
          pages.map(async (page) => {
            await page.reload();
            await page.waitForFunction(() => !!window.__asaStorm?.ready);
            return page.evaluate(() => window.__asaStorm.resume());
          }),
        );
        reopened.forEach((id, index) => expect(id).toBe(identities[index]!.seatId));
        correctness.reloadIdentities = reopened.length;
        startPhase('network-offline-10s');
        await Promise.all(contexts.map((context) => context.setOffline(true)));
        await Promise.all(
          pages.map((page) => page.evaluate(() => window.__asaStorm.requestBurst())),
        );
        await wait(10000);
        startPhase('network-restored');
        await Promise.all(contexts.map((context) => context.setOffline(false)));
        await wait(4000);
        const recovered = await Promise.all(
          pages.map((page) => page.evaluate(() => window.__asaStorm.resume())),
        );
        recovered.forEach((id, index) => expect(id).toBe(identities[index]!.seatId));
        correctness.recoveryIdentities = recovered.length;
        startPhase('slow-chess-independent-checkers');
        fault = 'slow-chess';
        await wait(15000);
        fault = 'none';
        startPhase('temporary-notification-503');
        fault = 'notifications503';
        for (let index = 0; index < 6; index++) {
          await Promise.all(
            pages.map((page) => page.evaluate(() => window.__asaStorm.contextBurst())),
          );
          await wait(2000);
        }
        fault = 'none';
        startPhase('notification-recovery');
        await wait(35000);
        startPhase('telemetry-outage-product-save');
        fault = 'telemetry503';
        await Promise.all(
          pages.map((page) => page.evaluate(() => window.__asaStorm.touchActivity())),
        );
        const changed = edit('electronics', 2);
        const duringOutage = await Promise.all(
          pages.map((page) =>
            page.evaluate((document) => window.__asaStorm.saveAgain(document), changed),
          ),
        );
        duringOutage.forEach((value) => {
          expect(documentDigest(value.document)).toBe(documentDigest(changed));
          correctness.savesVerified++;
        });
        for (let index = 0; index < 8; index++) {
          await Promise.all(
            pages.map((page) => page.evaluate(() => window.__asaStorm.contextBurst())),
          );
          await wait(500);
        }
        fault = 'none';
        startPhase('multiple-tabs');
        const secondary: Page[] = [];
        for (let index = 0; index < 3; index++) {
          const page = await contexts[index]!.newPage();
          secondary.push(page);
          page.on('pageerror', (error) => javascriptErrors.push(error.name));
          await page.goto(`${STORM_ORIGIN}/__storm?client=${fixture.users + index}`);
          await page.waitForFunction(() => !!window.__asaStorm?.ready);
          expect(await page.evaluate(() => window.__asaStorm.resume())).toBe(
            identities[index]!.seatId,
          );
        }
        await wait(12000);
        await Promise.all(secondary.map((page) => page.close()));
        startPhase('real-game-notification-and-match');
        for (const game of ['chess', 'checkers'] as const) {
          const target = await pages[1]!.evaluate(
            (game) => window.__asaStorm.game(game, 'access'),
            game,
          );
          const created = await pages[0]!.evaluate(
            ({ game, target }) =>
              window.__asaStorm.game(game, `players/${target}/challenge`, {
                scope: 'classroom',
                initialMs: 600000,
                incrementMs: 0,
                colorPreference: 'white',
              }),
            { game, target: text(object(target.player).playerId) },
          );
          const invite = object(created.invite);
          await pages[1]!.waitForFunction(
            ({ id, game }) =>
              window.__asaStorm
                .notifications()
                .some((value) => value.id === id && value.game === game),
            { id: invite.id, game },
            { timeout: 12000 },
          );
          correctness.gameNotifications++;
          const accepted = await pages[1]!.evaluate(
            ({ game, code }) => window.__asaStorm.game(game, `invites/${code}/accept`, {}),
            { game, code: invite.code },
          );
          const match = object(accepted.match);
          await pages[0]!.evaluate(
            ({ game, id, version }) =>
              window.__asaStorm.game(game, `matches/${id}/commands`, {
                expectedVersion: version,
                action: 'resign',
              }),
            { game, id: match.id, version: match.version },
          );
          correctness.gameMatches++;
        }
        startPhase('final-save-readback');
        const finals = await Promise.all(
          pages.map((page) => page.evaluate(() => window.__asaStorm.verifySaved())),
        );
        finals.forEach((value) => {
          expect(documentDigest(value.document)).toBe(documentDigest(changed));
          correctness.savesVerified++;
        });
        await Promise.all(pages.map((page) => page.evaluate(() => window.__asaStorm.stop())));
        await wait(1500);
        expect(javascriptErrors).toEqual([]);
        const measured = summarizeStorm(records, performance.now() - started, fixture.users);
        if (fixture.variant === 'candidate') {
          expect(measured.unexpected5xx).toBe(0);
          expect(measured.unexpected429).toBe(0);
          expect(peakNotificationsPerChannel).toBeLessThanOrEqual(1);
          // Four product requests plus independent identity-proof recovery reads can briefly overlap.
          expect(peakBusinessPerInstance).toBeLessThanOrEqual(6);
        }
        expect(correctness.gameMatches).toBe(2);
        expect(sampleErrors).toBe(0);
        success = true;
      } finally {
        if (phaseTimes[phase]) phaseTimes[phase]!.endedMs = performance.now() - started;
        if (sampler) clearInterval(sampler);
        await samplePending;
        loop.disable();
        const elapsedMs = performance.now() - started;
        const cpuUsed = process.cpuUsage(cpu);
        const report = {
          schemaVersion: 1,
          fixture: 'real-browser-client-api-postgresql',
          source: fixture.source,
          variant: fixture.variant,
          users: fixture.users,
          success,
          host: {
            platform: process.platform,
            availableCpus: availableParallelism(),
            memoryBytes: totalmem(),
            node: process.version,
          },
          summary: summarizeStorm(records, elapsedMs, fixture.users),
          correctness,
          loginLatencyMs: stormQuantiles(loginMs),
          portalBootstrapLatencyMs: stormQuantiles(projectMs),
          peakHttp,
          peakBusinessPerInstance,
          peakNotificationsPerChannel,
          javascriptErrors,
          sampleErrors,
          samples,
          phaseTimes,
          process: {
            cpuUserMs: cpuUsed.user / 1000,
            cpuSystemMs: cpuUsed.system / 1000,
            rssBytes: process.memoryUsage().rss,
            eventLoopP95Ms: loop.percentile(95) / 1e6,
          },
          limitations: [
            'lightweight client harness; full editor UI is verified separately',
            'loopback ingress; public FRP not loaded',
            'Node CPU includes workload controller and API; PostgreSQL container usage is a separate artifact',
            'Chromium RSS is the sum across processes and may count shared pages more than once; ps CPU is lifetime average, host CPU is interval utilization',
            'Latency includes the deliberately slow notification phase; use per-phase records for healthy-only latency',
          ],
          records,
        };
        mkdirSync('reports/request-storm', { recursive: true });
        writeFileSync(
          `reports/request-storm/${fixture.variant}-${fixture.users}.json`,
          JSON.stringify(report, null, 2),
        );
        await browser?.close();
        if (proxy)
          await new Promise<void>((done) => {
            proxy!.closeAllConnections();
            proxy!.close(() => done());
          });
        await app?.close();
        // createApiApp owns the supplied API pools and closes them on shutdown or failure.
        await Promise.all(
          [runtime, analytics, observer].filter((pool) => !pool.ending).map((pool) => pool.end()),
        );
      }
    }, 600000);
  },
);
