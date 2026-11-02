import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  POLZA_MODEL_ID,
  PolzaSetupError,
  parsePolzaOptions,
  inspectPolzaState,
  selectedModelIds,
  extendGenerationPolicy,
  reconcilePolza,
} from './polza-reconcile-core.mjs';

const MODEL = 'polza/deepseek/deepseek-v4.1-flash';
const OTHER = 'polza/openai/gpt-4.1-mini';
const ACTOR = '40000000-0000-4000-8000-000000000001';

function fixture({ catalogCurrent = true, modelPresent = true, keyConfigured = true } = {}) {
  return {
    provider: {
      enabled: true,
      keyConfigured,
      encryptionReady: true,
      transcriptionEnabled: false,
    },
    catalog: {
      version: 2,
      credentialCurrent: catalogCurrent,
      items: [
        { id: OTHER, active: true, kind: 'chat', selected: true },
        ...(modelPresent ? [{ id: MODEL, active: true, kind: 'chat', selected: false }] : []),
      ],
    },
    policy: {
      revision: 7,
      systemPrompt: 'Existing operator policy remains unchanged.',
      allowedModels: ['ollama-local', OTHER],
      defaultModel: 'ollama-local',
      modelPreferences: [{ id: OTHER, eligible: true, order: 3 }],
      providerOrder: { ollama: 0, polza: 5 },
    },
    modelAvailable: false,
  };
}

function harness(initial, { missingOnRefresh = false, failAllow = false } = {}) {
  const state = structuredClone(initial);
  const calls = [];
  const operations = {
    async read() {
      calls.push('read');
      const requested = state.catalog.items.find((row) => row.id === MODEL);
      return {
        ...structuredClone(state),
        modelAvailable:
          state.provider.enabled &&
          state.provider.keyConfigured &&
          state.catalog.credentialCurrent &&
          requested?.active === true &&
          requested?.selected === true,
      };
    },
    async refresh() {
      calls.push('refresh');
      state.catalog.credentialCurrent = true;
      state.catalog.version += 1;
      if (!missingOnRefresh && !state.catalog.items.some((row) => row.id === MODEL)) {
        state.catalog.items.push({ id: MODEL, active: true, kind: 'chat', selected: false });
      }
    },
    async select(ids, version) {
      calls.push('select');
      assert.equal(version, state.catalog.version, 'use exact catalog CAS revision');
      assert.ok(ids.includes(OTHER), 'do not clear a previously selected model');
      for (const row of state.catalog.items) row.selected = ids.includes(row.id);
      state.catalog.version += 1;
    },
    async allow(payload) {
      calls.push('allow');
      assert.equal(payload.configurationVersion, state.policy.revision);
      assert.deepEqual(payload.modelPreferences, state.policy.modelPreferences);
      assert.deepEqual(payload.providerOrder, state.policy.providerOrder);
      assert.equal(payload.systemPrompt, state.policy.systemPrompt);
      assert.equal(payload.defaultModel, 'ollama-local');
      if (failAllow) throw new Error('CAS conflict');
      state.policy.allowedModels = payload.allowedModels;
      state.policy.revision += 1;
    },
    async enableStt() {
      calls.push('enableStt');
      state.provider.transcriptionEnabled = true;
    },
  };
  return { state, calls, operations };
}

const options = (enableStt = false) => ({
  mode: 'apply',
  model: MODEL,
  actor: ACTOR,
  enableStt,
});

test('explicit syntax rejects unknown models, ambiguous actions, duplicate flags and missing actor', () => {
  assert.equal(POLZA_MODEL_ID.test(MODEL), true);
  assert.equal(POLZA_MODEL_ID.test('https://polza.ai/models'), false);
  assert.deepEqual(parsePolzaOptions(['--check', '--model', MODEL]), {
    mode: 'check',
    model: MODEL,
    actor: null,
    enableStt: false,
  });
  const negative = [
    ['--apply', '--model', MODEL],
    ['--apply', '--check', '--model', MODEL, '--actor', ACTOR],
    ['--check', '--model', MODEL, '--enable-stt'],
    ['--check', '--model', MODEL, '--actor', ACTOR],
    ['--apply', '--model', '../escape', '--actor', ACTOR],
    ['--apply', '--model', MODEL, '--actor', 'administrator'],
    ['--apply', '--model', MODEL, '--actor', ACTOR, '--actor', ACTOR],
    ['--apply', '--model'],
    ['--check', '--model', MODEL, '--surprise'],
  ];
  for (const args of negative) {
    assert.throws(() => parsePolzaOptions(args), PolzaSetupError, JSON.stringify(args));
  }
});

test('check-only status never mutates; shows missing catalog and policy as not ready', async () => {
  const state = fixture({ catalogCurrent: false, modelPresent: false });
  const h = harness(state);
  const before = structuredClone(h.state);
  const report = inspectPolzaState(await h.operations.read(), MODEL);
  assert.equal(report.chatReady, false);
  assert.equal(report.modelCount, 1);
  assert.deepEqual(h.state, before);
  assert.deepEqual(h.calls, ['read']);
});

test('reconciles one model without removing other selected models, default or policy settings', async () => {
  const h = harness(fixture());
  const result = await reconcilePolza(options(), h.operations);
  assert.deepEqual(result.changes, ['selection', 'policy']);
  assert.equal(result.report.chatReady, true);
  assert.equal(result.report.transcriptionEnabled, false);
  assert.deepEqual(h.state.catalog.items.filter((m) => m.selected).map((m) => m.id), [
    OTHER,
    MODEL,
  ]);
  assert.deepEqual(h.state.policy.allowedModels, ['ollama-local', OTHER, MODEL]);
  assert.equal(h.state.policy.defaultModel, 'ollama-local');
  assert.deepEqual(h.state.policy.providerOrder, { ollama: 0, polza: 5 });
});

test('second application is a real no-op: no catalog request and no SQL mutation', async () => {
  const h = harness(fixture());
  await reconcilePolza(options(), h.operations);
  h.calls.length = 0;
  const result = await reconcilePolza(options(), h.operations);
  assert.deepEqual(result.changes, []);
  assert.deepEqual(h.calls, ['read', 'read']);
});

test('first installation refreshes only stale catalog and then verifies the selected model', async () => {
  const h = harness(fixture({ catalogCurrent: false, modelPresent: false }));
  const result = await reconcilePolza(options(), h.operations);
  assert.deepEqual(result.changes, ['catalog', 'selection', 'policy']);
  assert.equal(result.report.chatReady, true);
  assert.equal(h.calls.filter((call) => call === 'refresh').length, 1);
});

test('unknown upstream model stops before any selection, policy or STT mutation', async () => {
  const h = harness(fixture({ catalogCurrent: false, modelPresent: false }), {
    missingOnRefresh: true,
  });
  await assert.rejects(reconcilePolza(options(true), h.operations), {
    code: 'REQUESTED_MODEL_UNAVAILABLE',
  });
  assert.deepEqual(h.calls, ['read', 'refresh', 'read']);
  assert.equal(h.state.provider.transcriptionEnabled, false);
});

test('absent key, disabled provider and absent encryption fail closed without writes', async () => {
  for (const issue of ['keyConfigured', 'enabled', 'encryptionReady']) {
    const state = fixture();
    state.provider[issue] = false;
    const h = harness(state);
    await assert.rejects(reconcilePolza(options(true), h.operations), {
      code: 'CREDENTIAL_NOT_READY',
    });
    assert.deepEqual(h.calls, ['read']);
  }
});

test('STT is opt-in only; repeated explicit enable does not toggle it twice', async () => {
  const h = harness(fixture());
  const first = await reconcilePolza(options(true), h.operations);
  assert.deepEqual(first.changes, ['selection', 'policy', 'stt']);
  assert.equal(first.report.transcriptionEnabled, true);
  h.calls.length = 0;
  const next = await reconcilePolza(options(true), h.operations);
  assert.deepEqual(next.changes, []);
  assert.equal(h.calls.includes('enableStt'), false);
});

test('CAS conflicts remain visible; a retry preserves earlier successful selection', async () => {
  const h = harness(fixture(), { failAllow: true });
  await assert.rejects(reconcilePolza(options(), h.operations), /CAS conflict/);
  assert.ok(h.state.catalog.items.find((row) => row.id === MODEL)?.selected);
  assert.equal(h.state.policy.allowedModels.includes(MODEL), false);
  assert.equal(h.state.provider.transcriptionEnabled, false);
});

test('policy validation and selected ID merger reject incompatible state safely', () => {
  const state = fixture();
  assert.deepEqual(selectedModelIds(state.catalog, MODEL), [OTHER, MODEL]);
  const payload = extendGenerationPolicy(state.policy, MODEL);
  assert.deepEqual(payload.allowedModels, ['ollama-local', OTHER, MODEL]);
  assert.equal(extendGenerationPolicy({ ...state.policy, allowedModels: [MODEL] }, MODEL), null);
  assert.throws(
    () => inspectPolzaState({ ...state, policy: { ...state.policy, revision: '7' } }, MODEL),
    { code: 'GENERATION_POLICY_INVALID' },
  );
});
