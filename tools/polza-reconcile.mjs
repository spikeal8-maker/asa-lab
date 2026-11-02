#!/usr/bin/env node
/**
 * Run inside the published ASA API container. No secrets or catalog snapshots are
 * accepted on the command line, and checking never modifies PostgreSQL.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { AiPolzaService } from '../dist/ai-polza.service.js';
import {
  parsePolzaOptions,
  inspectPolzaState,
  reconcilePolza,
  PolzaSetupError,
  credentialDecryptable,
} from './polza-reconcile-core.mjs';

const USAGE = [
  'Usage:',
  '  node tools/polza-reconcile.mjs --check --model polza/deepseek/deepseek-v4.1-flash',
  '  node tools/polza-reconcile.mjs --apply --model polza/deepseek/deepseek-v4.1-flash --actor "$ASA_POLZA_ACTOR" [--enable-stt]',
  'Check is strictly read-only. Apply requires an existing encrypted key and a platform administrator.',
  'The catalog refresh only reads provider model metadata; no chat, audio or image generation is sent.',
].join('\n');

function summary(model, report, changes = []) {
  return {
    model,
    providerEnabled: report.providerEnabled,
    keyConfigured: report.keyConfigured,
    encryptionReady: report.encryptionReady,
    transcriptionEnabled: report.transcriptionEnabled,
    catalogCurrent: report.catalogCurrent,
    modelCount: report.modelCount,
    selectedCount: report.selectedCount,
    modelActive: report.modelActive,
    selected: report.selected,
    allowed: report.allowed,
    modelAvailable: report.available,
    chatReady: report.chatReady,
    applied: changes,
  };
}

async function main() {
  if (process.argv.slice(2).includes('--help')) {
    console.log(USAGE);
    return;
  }
  const options = parsePolzaOptions(process.argv.slice(2));
  if (!process.env.APP_DATABASE_URL) throw new PolzaSetupError('DATABASE_NOT_CONFIGURED');

  const pool = new pg.Pool({
    connectionString: process.env.APP_DATABASE_URL,
    max: 1,
    connectionTimeoutMillis: 10000,
    idleTimeoutMillis: 5000,
    query_timeout: 20000,
  });
  try {
    const service = new AiPolzaService(pool);
    const read = async () => {
      const [runtimeResult, catalogResult, policyResult, availabilityResult] = await Promise.all([
        pool.query(
          'SELECT enabled, transcription_enabled, api_key_ciphertext, api_key_iv, api_key_auth_tag FROM public.ai_polza_runtime()',
        ),
        pool.query('SELECT public.ai_polza_catalog_runtime() AS value'),
        pool.query('SELECT public.ai_generation_policy_runtime() AS value'),
        pool.query(
          "SELECT public.ai_model_available('polza', $1::varchar, statement_timestamp()) AS available",
          [options.model],
        ),
      ]);
      const runtime = runtimeResult.rows[0];
      if (!runtime) throw new PolzaSetupError('POLZA_RUNTIME_MISSING');
      return {
        provider: {
          enabled: runtime.enabled,
          transcriptionEnabled: runtime.transcription_enabled,
          keyConfigured: typeof runtime.api_key_ciphertext === 'string',
          encryptionReady: credentialDecryptable(
            runtime,
            process.env.ASA_SETTINGS_ENCRYPTION_KEY,
          ),
        },
        catalog: catalogResult.rows[0]?.value,
        policy: policyResult.rows[0]?.value,
        modelAvailable: availabilityResult.rows[0]?.available === true,
      };
    };
    const initial = await read();

    if (options.mode === 'check') {
      const report = inspectPolzaState(initial, options.model);
      console.log('POLZA_READ_ONLY ' + JSON.stringify(summary(options.model, report)));
      if (!report.chatReady) process.exitCode = 2;
      return;
    }

    // The stored procedure checks platform_admin again for each mutation.
    const actor = options.actor;
    const admin = await service.admin(actor);
    if (!admin.enabled || !admin.apiKeyConfigured || !admin.encryptionReady) {
      throw new PolzaSetupError('CREDENTIAL_NOT_READY');
    }
    const operations = {
      read,
      refresh: async () => {
        await service.refreshCatalog(actor);
      },
      select: async (ids, version) => {
        await service.selectModels(actor, { ids, version });
      },
      allow: async (payload) => {
        await pool.query(
          'SELECT public.ai_generation_policy_set($1::uuid, $2::jsonb, $3::uuid)',
          [actor, JSON.stringify(payload), randomUUID()],
        );
      },
      enableStt: async () => {
        const current = await service.admin(actor);
        if (current.transcriptionEnabled) return;
        await service.save(actor, {
          configurationVersion: current.configurationVersion,
          enabled: current.enabled,
          transcriptionEnabled: true,
          dailySecondsLimit: current.dailySecondsLimit,
          globalDailySecondsLimit: current.globalDailySecondsLimit,
          maxAudioSeconds: current.maxAudioSeconds,
        });
      },
    };

    const result = await reconcilePolza(options, operations);
    console.log('POLZA_RECONCILED ' + JSON.stringify(summary(options.model, result.report, result.changes)));
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  // Do not print SQL query text, authorization headers, stored key material,
  // connection URLs, provider response bodies or private user metadata.
  const code = error instanceof PolzaSetupError ? error.code : 'PROVISIONING_OPERATION_FAILED';
  console.error('POLZA_SETUP_BLOCKED ' + code);
  console.error(USAGE);
  process.exitCode = 1;
});
