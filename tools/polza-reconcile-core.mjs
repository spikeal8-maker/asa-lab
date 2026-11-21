import { createDecipheriv } from 'node:crypto';

/** Reconcile one Polza chat model without cloning another installation's secrets or data. */
export const POLZA_MODEL_ID = /^polza\/[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,119}$/;
const ACTOR_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class PolzaSetupError extends Error {
  constructor(code) {
    super(code);
    this.name = 'PolzaSetupError';
    this.code = code;
  }
}

/**
 * An encrypted key copied from another host is not usable without its original
 * encryption key. Verify authenticated decryption in memory, never print secrets.
 */
export function credentialDecryptable(runtime, rawKey) {
  const value = String(rawKey ?? '').trim();
  const key = /^[a-f0-9]{64}$/i.test(value)
    ? Buffer.from(value, 'hex')
    : /^[A-Za-z0-9_-]{43}$/.test(value)
      ? Buffer.from(value, 'base64url')
      : Buffer.alloc(0);
  try {
    if (
      key.length !== 32 ||
      !runtime ||
      typeof runtime.api_key_ciphertext !== 'string' ||
      typeof runtime.api_key_iv !== 'string' ||
      typeof runtime.api_key_auth_tag !== 'string'
    ) {
      return false;
    }
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      Buffer.from(runtime.api_key_iv, 'base64url'),
    );
    decipher.setAuthTag(Buffer.from(runtime.api_key_auth_tag, 'base64url'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(runtime.api_key_ciphertext, 'base64url')),
      decipher.final(),
    ]);
    try {
      return /^pza_[A-Za-z0-9_-]{8,2040}$/.test(plaintext.toString('utf8'));
    } finally {
      plaintext.fill(0);
    }
  } catch {
    return false;
  } finally {
    key.fill(0);
  }
}

function requireValid(value, code) {
  if (!value) throw new PolzaSetupError(code);
}

export function parsePolzaOptions(argv) {
  const options = { mode: 'check', model: null, actor: null, enableStt: false };
  const seen = new Set();
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    requireValid(
      ['--check', '--apply', '--model', '--actor', '--enable-stt'].includes(flag),
      'UNKNOWN_ARGUMENT',
    );
    requireValid(!seen.has(flag), 'DUPLICATE_ARGUMENT');
    seen.add(flag);
    if (flag === '--apply') options.mode = 'apply';
    else if (flag === '--check') options.mode = 'check';
    else if (flag === '--enable-stt') options.enableStt = true;
    else {
      requireValid(i + 1 < argv.length, 'MISSING_ARGUMENT_VALUE');
      options[flag === '--model' ? 'model' : 'actor'] = argv[++i];
    }
  }
  requireValid(!(seen.has('--apply') && seen.has('--check')), 'CONFLICTING_MODE');
  requireValid(
    typeof options.model === 'string' && POLZA_MODEL_ID.test(options.model),
    'MODEL_ID_INVALID',
  );
  if (options.mode === 'apply') {
    requireValid(
      typeof options.actor === 'string' && ACTOR_ID.test(options.actor),
      'ADMIN_ACTOR_REQUIRED',
    );
  } else {
    requireValid(options.actor === null && !options.enableStt, 'CHECK_MUST_BE_READ_ONLY');
  }
  return options;
}

export function inspectPolzaState(state, model) {
  requireValid(state && typeof state === 'object', 'STATE_INVALID');
  const { provider, catalog, policy } = state;
  requireValid(
    provider &&
      typeof provider.enabled === 'boolean' &&
      typeof provider.transcriptionEnabled === 'boolean' &&
      typeof provider.keyConfigured === 'boolean' &&
      typeof provider.encryptionReady === 'boolean',
    'PROVIDER_STATE_INVALID',
  );
  requireValid(
    catalog &&
      typeof catalog.credentialCurrent === 'boolean' &&
      Number.isSafeInteger(catalog.version) &&
      Array.isArray(catalog.items) &&
      catalog.items.length <= 1200,
    'CATALOG_STATE_INVALID',
  );
  requireValid(
    policy &&
      Number.isSafeInteger(policy.revision) &&
      policy.revision >= 1 &&
      Array.isArray(policy.allowedModels) &&
      Array.isArray(policy.modelPreferences) &&
      policy.providerOrder &&
      !Array.isArray(policy.providerOrder) &&
      typeof policy.providerOrder === 'object' &&
      typeof policy.systemPrompt === 'string' &&
      policy.systemPrompt.length > 0 &&
      policy.systemPrompt.length <= 12000,
    'GENERATION_POLICY_INVALID',
  );
  const modelEntry = catalog.items.find((item) => item.id === model);
  const modelActive = modelEntry?.active === true && modelEntry?.kind === 'chat';
  const selected = modelActive && modelEntry.selected === true;
  const allowed = policy.allowedModels.includes(model);
  return {
    providerEnabled: provider.enabled,
    keyConfigured: provider.keyConfigured,
    encryptionReady: provider.encryptionReady,
    transcriptionEnabled: provider.transcriptionEnabled,
    catalogCurrent: catalog.credentialCurrent,
    modelActive,
    selected,
    allowed,
    available: state.modelAvailable === true,
    modelCount: catalog.items.length,
    selectedCount: catalog.items.filter((item) => item.selected === true).length,
    chatReady:
      provider.enabled &&
      provider.keyConfigured &&
      provider.encryptionReady &&
      catalog.credentialCurrent &&
      modelActive &&
      selected &&
      allowed &&
      state.modelAvailable === true,
  };
}

/** Leave other selected models untouched. No implicit reset of owner policies. */
export function selectedModelIds(catalog, model) {
  requireValid(
    !catalog.items.some((item) => item.selected === true && (!item.active || item.kind !== 'chat')),
    'EXISTING_SELECTION_INCOMPATIBLE',
  );
  const kept = catalog.items
    .filter((item) => item.selected === true && item.active === true && item.kind === 'chat')
    .map((item) => item.id);
  if (!kept.includes(model)) kept.push(model);
  return kept;
}

/** Use the existing revision-checked, audited DB setter, not direct table UPDATE. */
export function extendGenerationPolicy(policy, model) {
  requireValid(Array.isArray(policy.allowedModels), 'GENERATION_POLICY_INVALID');
  if (policy.allowedModels.includes(model)) return null;
  return {
    configurationVersion: policy.revision,
    systemPrompt: policy.systemPrompt,
    allowedModels: [...policy.allowedModels, model],
    defaultModel: policy.defaultModel,
    modelPreferences: policy.modelPreferences,
    providerOrder: policy.providerOrder,
  };
}

/** The operations are injectable so failures and idempotency can be tested offline. */
export async function reconcilePolza(options, operations) {
  const changes = [];
  let state = await operations.read();
  let report = inspectPolzaState(state, options.model);
  requireValid(
    report.providerEnabled && report.keyConfigured && report.encryptionReady,
    'CREDENTIAL_NOT_READY',
  );

  if (!report.catalogCurrent || !report.modelActive) {
    await operations.refresh();
    changes.push('catalog');
    state = await operations.read();
    report = inspectPolzaState(state, options.model);
  }
  requireValid(report.catalogCurrent && report.modelActive, 'REQUESTED_MODEL_UNAVAILABLE');

  if (!report.selected) {
    await operations.select(selectedModelIds(state.catalog, options.model), state.catalog.version);
    changes.push('selection');
    state = await operations.read();
    report = inspectPolzaState(state, options.model);
  }
  requireValid(report.selected, 'MODEL_SELECTION_NOT_PERSISTED');

  if (!report.allowed) {
    const payload = extendGenerationPolicy(state.policy, options.model);
    requireValid(payload, 'GENERATION_POLICY_INVALID');
    await operations.allow(payload);
    changes.push('policy');
    state = await operations.read();
    report = inspectPolzaState(state, options.model);
  }
  requireValid(report.allowed, 'MODEL_POLICY_NOT_PERSISTED');

  if (options.enableStt && !report.transcriptionEnabled) {
    await operations.enableStt();
    changes.push('stt');
  }

  state = await operations.read();
  report = inspectPolzaState(state, options.model);
  requireValid(report.chatReady, 'CHAT_NOT_READY');
  if (options.enableStt) requireValid(report.transcriptionEnabled, 'STT_NOT_ENABLED');
  return { changes, report };
}
