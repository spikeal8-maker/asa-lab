#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import pg from 'pg';

const EX_CONFIG = 78;

function fail(message) {
  throw Object.assign(new Error(message), { exitCode: EX_CONFIG });
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) fail(`unknown_argument:${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, character) => character.toUpperCase());
    const value = argv[++index];
    if (!value || value.startsWith('--')) fail(`missing_value:${token}`);
    args[key] = value;
  }
  for (const key of ['environment', 'preReport', 'output', 'markdown', 'batchKey', 'asOf']) {
    if (!args[key]) fail(`${key}_required`);
  }
  if (args.environment !== 'test') fail('only_isolated_test_environment_allowed');
  if (Number.isNaN(Date.parse(args.asOf))) fail('invalid_as_of');
  return args;
}

function safeDatabaseName(databaseUrl) {
  try {
    return new URL(databaseUrl).pathname.slice(1);
  } catch {
    fail('invalid_database_url');
  }
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function readPreReport(path, asOf) {
  const bytes = readFileSync(resolve(path));
  const report = JSON.parse(bytes.toString('utf8'));
  if (report?.schema !== 'asa-learning-migration-dry-run/v1') fail('invalid_pre_report_schema');
  if (report?.metadata?.environmentKind !== 'test') fail('pre_report_not_test');
  if (report?.metadata?.asOf !== new Date(asOf).toISOString()) fail('pre_report_as_of_mismatch');
  if (!report?.deterministic?.classifications) fail('invalid_pre_report_payload');
  return { report, digest: sha256(bytes) };
}

function zeroCounts() {
  return {
    learnerIdentities: 0,
    seatLinks: 0,
    accountLinks: 0,
    activities: 0,
    activityVersions: 0,
    activityMappings: 0,
    attempts: 0,
    submissions: 0,
  };
}

function addCounts(target, source) {
  for (const key of Object.keys(target)) target[key] += Number(source?.[key] || 0);
}

function renderMarkdown(result) {
  const before = result.before;
  const after = result.after;
  return `# ASA Learning M0 Additive Backfill — isolated test evidence

Environment: \`test\`

As-of: \`${result.asOf}\`

Migration: \`${result.migrationVersion}\`

This report is redacted. It contains aggregate counts only. Production was not read or written.

| Metric | Before | After | Delta |
|---|---:|---:|---:|
| learner identities | 0 | ${after.learnerIdentities} | ${after.learnerIdentities} |
| seat links | 0 | ${after.seatLinks} | ${after.seatLinks} |
| account links | 0 | ${after.accountLinks} | ${after.accountLinks} |
| activities mapped | ${before.mappedActivities} | ${after.activityMappings} | ${after.activityMappings - before.mappedActivities} |
| exact Attempts backfilled | 0 | ${after.attemptsBackfilled} | ${after.attemptsBackfilled} |
| exact Submissions backfilled | 0 | ${after.submissionsBackfilled} | ${after.submissionsBackfilled} |
| legacy unresolved | ${before.legacyUnresolved} | ${after.legacyUnresolved} | ${after.legacyUnresolved - before.legacyUnresolved} |
| selection conflicts | ${before.selectionConflicts} | ${after.selectionConflicts} | ${after.selectionConflicts - before.selectionConflicts} |
| feedback preserved | ${before.feedbackPreserved} | ${after.feedbackPreserved} | ${after.feedbackPreserved - before.feedbackPreserved} |
| grade conversions | 0 | ${after.gradeConversions} | ${after.gradeConversions} |

Second-run duplicate creations: ${result.idempotency.secondRunCreated}.

Production status: untouched.
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.LEARNING_BACKFILL_DATABASE_URL;
  if (!databaseUrl) fail('LEARNING_BACKFILL_DATABASE_URL_required');
  const databaseName = safeDatabaseName(databaseUrl);
  if (!databaseName.endsWith('_test')) fail('unsafe_test_database');
  const { report: preReport, digest } = readPreReport(args.preReport, args.asOf);
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const versions = await client.query(
      'SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1',
    );
    if (Number.parseInt(versions.rows[0]?.version || '0', 10) < 87) fail('migration_0087_required');
    const schools = await client.query('SELECT id FROM schools ORDER BY id');
    const firstCreated = zeroCounts();
    let exactExisting = 0;
    let legacyUnresolved = 0;
    let feedbackPreserved = 0;
    const batchIds = [];
    for (const school of schools.rows) {
      const applied = await client.query(
        'SELECT learning_m0_convergence_apply($1,$2,$3,$4) AS result',
        [`${args.batchKey}:${school.id}`, school.id, digest, args.asOf],
      );
      const result = applied.rows[0].result;
      batchIds.push(result.batchId);
      addCounts(firstCreated, result.created);
      exactExisting += Number(result.classified.existingExactSubmissions || 0);
      legacyUnresolved += Number(result.classified.legacyUnresolved || 0);
      feedbackPreserved += Number(result.classified.feedbackPreserved || 0);
    }

    const secondCreated = zeroCounts();
    for (const school of schools.rows) {
      const applied = await client.query(
        'SELECT learning_m0_convergence_apply($1,$2,$3,$4) AS result',
        [`${args.batchKey}:${school.id}`, school.id, digest, args.asOf],
      );
      addCounts(secondCreated, applied.rows[0].result.created);
    }

    const aggregate = {
      learnerIdentities: 0,
      seatLinks: 0,
      accountLinks: 0,
      activityMappings: 0,
      attemptsBackfilled: 0,
      submissionsBackfilled: 0,
      existingExactSubmissions: 0,
      legacyUnresolved: 0,
      feedbackPreserved: 0,
      gradeConversions: 0,
    };
    for (const batchId of batchIds) {
      const reported = await client.query('SELECT learning_m0_convergence_report($1) AS result', [
        batchId,
      ]);
      for (const key of Object.keys(aggregate)) {
        aggregate[key] += Number(reported.rows[0].result[key] || 0);
      }
    }
    const result = {
      schema: 'asa-learning-additive-backfill/v1',
      environment: 'test',
      asOf: new Date(args.asOf).toISOString(),
      migrationVersion: versions.rows[0].version,
      before: {
        mappedActivities: preReport.deterministic.totals.mappedActivities,
        legacyUnresolved: preReport.deterministic.classifications.legacy_unresolved,
        selectionConflicts: preReport.deterministic.classifications.selection_conflict,
        feedbackPreserved: preReport.deterministic.feedback.total,
      },
      firstRunCreated: firstCreated,
      after: {
        ...aggregate,
        activityMappings:
          preReport.deterministic.totals.mappedActivities + firstCreated.activityMappings,
        selectionConflicts: preReport.deterministic.classifications.selection_conflict,
      },
      canaries: { exactExisting, legacyUnresolved, feedbackPreserved },
      idempotency: {
        secondRunCreated: Object.values(secondCreated).reduce((sum, value) => sum + value, 0),
        secondRunBreakdown: secondCreated,
      },
      productionTouched: false,
    };
    writeFileSync(resolve(args.output), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(resolve(args.markdown), renderMarkdown(result), { flag: 'wx' });
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  process.stderr.write(`learning additive backfill failed: ${error.message}\n`);
  process.exitCode = error.exitCode || 1;
});
