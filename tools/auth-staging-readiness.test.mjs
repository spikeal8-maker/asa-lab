import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs, probeStaging, safeOrigin } from './auth-staging-readiness.mjs';

const ready = (id, available = true, live = true) => ({
  id, available, reason: available ? 'ready' : 'disabled',
  enforcementEligible: live,
  enforcementReason: live ? 'ready' : 'delivery_unverified',
  // An accidentally added secret must never appear in output.
  botToken: 'DO_NOT_LOG_THIS_VALUE',
  launchUrl: 'https://max.ru/bot?start=secret-value',
});

function network(providers, statuses = {}) {
  const calls = [];
  async function fetchImpl(url, options) {
    calls.push({ url, options });
    if (url.endsWith('/api/auth/providers')) {
      return new Response(JSON.stringify({ providers }), {
        status: statuses.api ?? 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('<html>test application</html>', {
      status: statuses.web ?? 200,
      headers: { 'content-type': 'text/html' },
    });
  }
  return { fetchImpl, calls };
}

test('only intended test origin and loopback are accepted', () => {
  assert.equal(safeOrigin(), 'https://test.asa-lab.ru');
  assert.equal(safeOrigin('http://127.0.0.1:4612/'), 'http://127.0.0.1:4612');
  for (const unsafe of [
    'https://asa-lab.ru',
    'https://test.asa-lab.ru.evil.example',
    'http://test.asa-lab.ru',
    'https://test.asa-lab.ru/path',
    'https://user:password@test.asa-lab.ru',
    'https://test.asa-lab.ru?secret=yes',
  ]) assert.throws(() => safeOrigin(unsafe));
});

test('inventory accepts an intentionally disabled provider but reports it', async () => {
  const { fetchImpl, calls } = network([ready('max', false, false), ready('telegram', false, false)]);
  const result = await probeStaging({ fetchImpl, clock: () => new Date('2026-10-21T12:00:00Z') });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.assessment.providersReady, false);
  assert.equal(result.report.providers.find((p) => p.id === 'max').reason, 'disabled');
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.options.method, 'GET');
    assert.equal(call.options.redirect, 'error');
    assert.equal(call.options.credentials, 'omit');
    assert.equal(call.options.headers['cache-control'], 'no-cache');
  }
  assert.doesNotMatch(JSON.stringify(result.report), /DO_NOT_LOG_THIS_VALUE|secret-value/);
});

test('required availability and full confirmation are separate checks', async () => {
  const list = [ready('max', true, false), ready('telegram', true, false)];
  assert.equal((await probeStaging({ fetchImpl: network(list).fetchImpl, expectReady: true })).exitCode, 0);
  const proof = await probeStaging({ fetchImpl: network(list).fetchImpl, expectLiveProof: true });
  assert.equal(proof.exitCode, 2);
  assert.equal(proof.report.assessment.providersReady, true);
  assert.equal(proof.report.assessment.liveConfirmationRecorded, false);
  assert.equal((await probeStaging({ fetchImpl: network(list.map((p) => ({
    ...p, enforcementEligible: true, enforcementReason: 'ready',
  }))).fetchImpl, expectLiveProof: true })).exitCode, 0);
});

test('unexpected API content and HTTP failures cannot be mistaken for success', async () => {
  const bad = await probeStaging({ fetchImpl: network([], { api: 403 }).fetchImpl });
  assert.equal(bad.exitCode, 2);
  assert.equal(bad.report.api.httpStatus, 403);
  const invalid = await probeStaging({ fetchImpl: async () => new Response('{}') });
  assert.equal(invalid.exitCode, 2);
  assert.equal(invalid.report.api.providerSchema, 'invalid');
});

test('network errors are sanitized, with no raw URL or exception message', async () => {
  const result = await probeStaging({ fetchImpl: async () => {
    throw new Error('token DO_NOT_LOG_THIS_VALUE');
  }});
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.web.status, 'network_error');
  assert.equal(result.report.api.status, 'network_error');
  assert.doesNotMatch(JSON.stringify(result.report), /DO_NOT_LOG_THIS_VALUE/);
});

test('unrecognized response values are not reflected verbatim', async () => {
  const result = await probeStaging({ fetchImpl: network([
    { id: 'max', available: true, reason: 'secret=DO_NOT_LOG_THIS_VALUE',
      enforcementEligible: true, enforcementReason: 'ready' },
    ready('telegram'),
  ]).fetchImpl });
  assert.equal(result.report.providers[0].reason, 'unrecognized');
  assert.doesNotMatch(JSON.stringify(result.report), /DO_NOT_LOG_THIS_VALUE/);
});

test('argument parsing rejects production, unknown arguments, and missing values', () => {
  assert.deepEqual(parseArgs(['--expect-ready', '--expect-live-proof']).expectLiveProof, true);
  for (const args of [['--origin', 'https://asa-lab.ru'], ['--bad'], ['--origin']]) {
    assert.throws(() => parseArgs(args));
  }
});
