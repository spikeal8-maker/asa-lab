#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import pg from 'pg';
import { planMigrations } from './migrate.mjs';

export const ANALYZER_VERSION = '1.0.0';
export const SCHEMA_ID = 'asa-learning-migration-dry-run/v1';
export const CLASSIFICATIONS = Object.freeze([
  'identity_unresolved',
  'legacy_unresolved',
  'selection_conflict',
  'visibility_only',
  'auto_reconcilable',
  'clean_canonical',
]);
export const KINDS = Object.freeze(['direct_project', 'course_project', 'quiz']);

const EX_CONFIG = 78;
const ATTEMPT_STATES = new Set([
  'in_progress',
  'submitted',
  'evaluating',
  'accepted',
  'changes_requested',
  'incomplete',
  'excused',
  'invalidated',
]);

const UNIT_QUERY = String.raw`
WITH latest_attempt AS (
  SELECT DISTINCT ON (a.classroom_assignment_id, a.seat_id)
         a.tenant_id, a.id, a.classroom_assignment_id, a.seat_id,
         a.learning_activity_version_id, a.attempt_number, a.state,
         a.submitted_at, a.evaluated_at, a.invalidated_at
    FROM learning_attempts a
   ORDER BY a.classroom_assignment_id, a.seat_id,
            a.attempt_number DESC, a.id DESC
), attempt_rollup AS (
  SELECT a.classroom_assignment_id, a.seat_id,
         count(*)::int AS attempt_count,
         count(DISTINCT r.id)::int AS result_count,
         count(DISTINCT s.id)::int AS submission_count,
         count(DISTINCT e.id)::int AS evaluation_count
    FROM learning_attempts a
    LEFT JOIN learning_submissions s ON s.attempt_id = a.id
    LEFT JOIN assessment_results r ON r.attempt_id = a.id
    LEFT JOIN learning_evaluations e ON e.attempt_id = a.id
   GROUP BY a.classroom_assignment_id, a.seat_id
)
SELECT c.tenant_id, c.school_id, c.id AS classroom_id, c.status AS classroom_status,
       ca.id AS assignment_id, ca.status AS assignment_status,
       ca.assignment_id AS direct_source_id, ca.course_run_id, ca.quiz_version_id,
       seat.id AS seat_id, seat.tenant_id AS seat_tenant_id,
       seat.classroom_id AS seat_classroom_id, seat.account_id, seat.status AS seat_status,
       work.project_id AS legacy_project_id, work.started_at AS legacy_started_at,
       work.submitted_at AS legacy_submitted_at,
       cav.learning_activity_version_id AS mapped_activity_version_id,
       la.id AS attempt_id, la.learning_activity_version_id AS attempt_activity_version_id,
       la.attempt_number, la.state AS attempt_state, la.submitted_at AS attempt_submitted_at,
       sub.id AS submission_id, sub.project_id AS submission_project_id,
       sub.project_version_id, sub.payload_manifest ->> 'kind' AS submission_kind,
       pv.project_id AS version_project_id,
       coalesce(ar.attempt_count, 0)::int AS attempt_count,
       coalesce(ar.submission_count, 0)::int AS submission_count,
       coalesce(ar.evaluation_count, 0)::int AS evaluation_count,
       coalesce(ar.result_count, 0)::int AS result_count,
       result.id AS latest_result_id,
       grade.id AS gradebook_entry_id,
       grade.accepted_attempt_id, grade.assessment_result_id AS selected_result_id,
       selected_result.attempt_id AS selected_result_attempt_id,
       selected_attempt.classroom_assignment_id AS selected_attempt_assignment_id,
       selected_attempt.seat_id AS selected_attempt_seat_id
  FROM classroom_assignments ca
  JOIN classrooms c ON c.tenant_id = ca.tenant_id AND c.id = ca.classroom_id
  JOIN classroom_student_seats seat ON seat.classroom_id = ca.classroom_id
  LEFT JOIN classroom_assignment_work work
    ON work.assignment_id = ca.id AND work.seat_id = seat.id
  LEFT JOIN classroom_activity_versions cav
    ON cav.classroom_assignment_id = ca.id
  LEFT JOIN latest_attempt la
    ON la.classroom_assignment_id = ca.id AND la.seat_id = seat.id
  LEFT JOIN learning_submissions sub ON sub.attempt_id = la.id
  LEFT JOIN project_versions pv ON pv.id = sub.project_version_id
  LEFT JOIN attempt_rollup ar
    ON ar.classroom_assignment_id = ca.id AND ar.seat_id = seat.id
  LEFT JOIN assessment_results result ON result.attempt_id = la.id
  LEFT JOIN gradebook_entries grade
    ON grade.classroom_assignment_id = ca.id AND grade.seat_id = seat.id
  LEFT JOIN assessment_results selected_result ON selected_result.id = grade.assessment_result_id
  LEFT JOIN learning_attempts selected_attempt ON selected_attempt.id = grade.accepted_attempt_id
 ORDER BY c.school_id, ca.id, seat.id`;

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function zeroMap(keys) {
  return Object.fromEntries(keys.map((key) => [key, 0]));
}

function bool(value) {
  return value === true || value === 'true';
}

export function normalizeUnit(row) {
  const kind = row.quiz_version_id
    ? 'quiz'
    : row.course_run_id
      ? 'course_project'
      : 'direct_project';
  const identityUnresolved =
    row.tenant_id !== row.seat_tenant_id ||
    row.classroom_id !== row.seat_classroom_id ||
    bool(row.identity_ambiguous);
  const exactSubmission = Boolean(
    row.attempt_id &&
    row.submission_id &&
    (kind === 'quiz' ||
      (row.project_version_id &&
        row.submission_project_id &&
        row.version_project_id === row.submission_project_id &&
        (!row.legacy_project_id || row.legacy_project_id === row.submission_project_id))),
  );
  const selectionConflict =
    (Number(row.result_count || 0) > 0 && !row.gradebook_entry_id) ||
    (Boolean(row.gradebook_entry_id) &&
      (!row.selected_result_id ||
        !row.accepted_attempt_id ||
        row.selected_result_attempt_id !== row.accepted_attempt_id ||
        row.selected_attempt_assignment_id !== row.assignment_id ||
        row.selected_attempt_seat_id !== row.seat_id));
  const lifecycleRestricted =
    row.seat_status !== 'active' ||
    row.classroom_status !== 'active' ||
    row.assignment_status === 'closed';
  const legacyClaim = Boolean(row.legacy_submitted_at);
  const legacyOnlyStart = Boolean(row.legacy_started_at && !row.attempt_id);
  const canonicalEvidence = Boolean(
    row.mapped_activity_version_id &&
    row.attempt_id &&
    row.attempt_activity_version_id === row.mapped_activity_version_id &&
    (!['submitted', 'evaluating', 'accepted', 'changes_requested'].includes(row.attempt_state) ||
      exactSubmission),
  );
  const legacyAuthoritative = legacyClaim || legacyOnlyStart;
  const autoReconcilable = !canonicalEvidence || legacyAuthoritative;
  return {
    ...row,
    kind,
    identityUnresolved,
    exactSubmission,
    selectionConflict,
    lifecycleRestricted,
    legacyClaim,
    legacyOnlyStart,
    canonicalEvidence,
    legacyAuthoritative,
    autoReconcilable,
  };
}

export function classifyUnit(input) {
  const unit = input.kind ? input : normalizeUnit(input);
  if (unit.attempt_state && !ATTEMPT_STATES.has(unit.attempt_state)) {
    throw new Error(`unsupported_attempt_state:${unit.attempt_state}`);
  }
  if (unit.identityUnresolved) return 'identity_unresolved';
  if (unit.legacyClaim && !unit.exactSubmission) return 'legacy_unresolved';
  if (unit.selectionConflict) return 'selection_conflict';
  if (unit.lifecycleRestricted && unit.canonicalEvidence) return 'visibility_only';
  if (unit.autoReconcilable) return 'auto_reconcilable';
  return 'clean_canonical';
}

export function buildDeterministicReport(rows, feedbackRows = []) {
  const classifications = zeroMap(CLASSIFICATIONS);
  const byKind = Object.fromEntries(
    KINDS.map((kind) => [
      kind,
      {
        total: 0,
        classifications: zeroMap(CLASSIFICATIONS),
      },
    ]),
  );
  const secondary = {
    statusConflicts: 0,
    exactSubmissionsRecoverable: 0,
    unresolvedSubmissions: 0,
    validOlderSelectionWithNewerAttempt: 0,
  };
  const selectionFacts = {
    resultExistsValidPointer: 0,
    resultExistsNoPointer: 0,
    brokenPointer: 0,
    pointerToOlderValidAttempt: 0,
    pointerAttemptResultLineageMismatch: 0,
    multipleResultsValidSelection: 0,
    oldSelectedResultNewerActiveAttempt: 0,
  };
  const visibilityFacts = {
    activeSeatHistory: 0,
    issuedSeatHistory: 0,
    suspendedSeatHistory: 0,
    removedSeatHistory: 0,
    endedClassroomHistory: 0,
    restrictedHistoricalUnits: 0,
  };
  const operations = {
    seedIdentityAndSeatLinks: 0,
    mapActivityVersionFromPersistedAssignment: 0,
    retainLegacyFeedbackMetadata: 0,
    retireLegacyAuthorityUsingExactEvidence: 0,
  };
  const identityKeys = new Set();
  const accountKeys = new Set();
  const accountSchools = new Map();
  const accountSeats = new Map();

  for (const raw of rows) {
    const unit = normalizeUnit(raw);
    const classification = classifyUnit(unit);
    classifications[classification] += 1;
    byKind[unit.kind].total += 1;
    byKind[unit.kind].classifications[classification] += 1;
    if (unit.legacyClaim && unit.exactSubmission) secondary.exactSubmissionsRecoverable += 1;
    if (unit.legacyClaim && !unit.exactSubmission) secondary.unresolvedSubmissions += 1;
    if (
      (unit.legacyClaim && !unit.attempt_id) ||
      (unit.attempt_id && unit.kind !== 'quiz' && !unit.legacy_started_at)
    ) {
      secondary.statusConflicts += 1;
    }
    if (
      unit.gradebook_entry_id &&
      unit.attempt_count > 1 &&
      unit.accepted_attempt_id !== unit.attempt_id
    ) {
      secondary.validOlderSelectionWithNewerAttempt += 1;
    }

    const pointerLineageValid = Boolean(
      unit.gradebook_entry_id &&
      unit.selected_result_id &&
      unit.accepted_attempt_id &&
      unit.selected_result_attempt_id === unit.accepted_attempt_id &&
      unit.selected_attempt_assignment_id === unit.assignment_id &&
      unit.selected_attempt_seat_id === unit.seat_id,
    );
    if (Number(unit.result_count || 0) > 0 && pointerLineageValid) {
      selectionFacts.resultExistsValidPointer += 1;
    }
    if (Number(unit.result_count || 0) > 0 && !unit.gradebook_entry_id) {
      selectionFacts.resultExistsNoPointer += 1;
    }
    if (unit.gradebook_entry_id && !pointerLineageValid) selectionFacts.brokenPointer += 1;
    if (pointerLineageValid && unit.accepted_attempt_id !== unit.attempt_id) {
      selectionFacts.pointerToOlderValidAttempt += 1;
      if (unit.attempt_state === 'in_progress') {
        selectionFacts.oldSelectedResultNewerActiveAttempt += 1;
      }
    }
    if (unit.gradebook_entry_id && unit.selected_result_attempt_id !== unit.accepted_attempt_id) {
      selectionFacts.pointerAttemptResultLineageMismatch += 1;
    }
    if (Number(unit.result_count || 0) > 1 && pointerLineageValid) {
      selectionFacts.multipleResultsValidSelection += 1;
    }

    if (unit.seat_status === 'active') visibilityFacts.activeSeatHistory += 1;
    else if (unit.seat_status === 'issued') visibilityFacts.issuedSeatHistory += 1;
    else if (unit.seat_status === 'suspended') visibilityFacts.suspendedSeatHistory += 1;
    else if (unit.seat_status === 'removed') visibilityFacts.removedSeatHistory += 1;
    if (unit.classroom_status !== 'active' || unit.assignment_status === 'closed') {
      visibilityFacts.endedClassroomHistory += 1;
    }
    if (classification === 'visibility_only') visibilityFacts.restrictedHistoricalUnits += 1;

    if (classification === 'auto_reconcilable') {
      operations.seedIdentityAndSeatLinks += 1;
      if (!unit.mapped_activity_version_id && unit.assignment_id) {
        operations.mapActivityVersionFromPersistedAssignment += 1;
      }
      if (unit.legacyClaim && unit.exactSubmission) {
        operations.retireLegacyAuthorityUsingExactEvidence += 1;
      }
    }

    const seatKey = `${unit.school_id}:${unit.seat_id}`;
    identityKeys.add(
      unit.account_id
        ? `${unit.school_id}:account:${unit.account_id}`
        : `${unit.school_id}:seat:${unit.seat_id}`,
    );
    if (unit.account_id) {
      const accountKey = `${unit.school_id}:${unit.account_id}`;
      accountKeys.add(accountKey);
      accountSchools.set(
        unit.account_id,
        (accountSchools.get(unit.account_id) || new Set()).add(unit.school_id),
      );
      accountSeats.set(accountKey, (accountSeats.get(accountKey) || new Set()).add(seatKey));
    }
  }

  const feedback = {
    metadataOnly: true,
    gradeConversions: 0,
    total: 0,
    byBadge: { excellent: 0, good: 0, progress: 0, redo: 0, none: 0 },
    orphaned: 0,
    linkedToWork: 0,
  };
  for (const row of feedbackRows) {
    const badge = row.badge || 'none';
    if (!(badge in feedback.byBadge)) throw new Error(`unsupported_feedback_badge:${badge}`);
    const count = Number(row.count || 0);
    feedback.byBadge[badge] += count;
    feedback.total += count;
    feedback.orphaned += Number(row.orphaned_count || 0);
    feedback.linkedToWork += Number(row.linked_count || 0);
  }
  operations.retainLegacyFeedbackMetadata = feedback.total;

  return {
    totals: {
      learningUnits: rows.length,
      totalLegacyAssignments: new Set(rows.map((r) => r.assignment_id)).size,
      mappedActivities: new Set(
        rows.filter((r) => r.mapped_activity_version_id).map((r) => r.assignment_id),
      ).size,
      mappedRuns: new Set(rows.filter((r) => r.course_run_id).map((r) => r.course_run_id)).size,
    },
    byKind,
    classifications,
    identity: {
      futureIdentitySeeds: identityKeys.size,
      seatLinks: new Set(rows.map((r) => r.seat_id)).size,
      accountLinks: accountKeys.size,
      emailFreeSeatSeeds: new Set(rows.filter((r) => !r.account_id).map((r) => r.seat_id)).size,
      sameSchoolMultiSeatAccounts: [...accountSeats.values()].filter((v) => v.size > 1).length,
      crossSchoolAccountSplits: [...accountSchools.values()].filter((v) => v.size > 1).length,
      unresolvedUnits: classifications.identity_unresolved,
    },
    legacySubmission: {
      exactSubmissionsRecoverable: secondary.exactSubmissionsRecoverable,
      unresolvedSubmissions: secondary.unresolvedSubmissions,
    },
    selection: {
      ...selectionFacts,
      conflicts: classifications.selection_conflict,
      validOlderSelectionWithNewerAttempt: secondary.validOlderSelectionWithNewerAttempt,
    },
    visibility: visibilityFacts,
    feedback,
    autoReconciliationPlan: {
      evidencePolicy: 'persisted_ids_only',
      guessedIdentityMerges: 0,
      fabricatedImmutableEvidence: 0,
      gradeConversions: 0,
      operations,
    },
    conflicts: {
      statusConflicts: secondary.statusConflicts,
      autoResolved: classifications.auto_reconcilable,
      manualReview:
        classifications.identity_unresolved +
        classifications.legacy_unresolved +
        classifications.selection_conflict,
    },
    errors: [],
    warnings: [],
  };
}

export async function withReadOnlyTransaction(client, callback, explicitAsOf) {
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  try {
    const readOnly = await client.query('SHOW transaction_read_only');
    if (readOnly.rows[0]?.transaction_read_only !== 'on') {
      throw new Error('read_only_transaction_not_proven');
    }
    if (explicitAsOf) await client.query('SELECT $1::timestamptz AS as_of', [explicitAsOf]);
    return await callback(client);
  } finally {
    await client.query('ROLLBACK');
  }
}

async function verifySchema(client) {
  const planned = planMigrations(resolve('migrations'));
  const applied = await client.query(
    'SELECT version, checksum FROM schema_migrations ORDER BY version',
  );
  if (applied.rows.length > planned.length || applied.rows.length === 0)
    throw new Error('unsupported_schema:migration_count');
  for (let index = 0; index < applied.rows.length; index += 1) {
    const expected = planned[index];
    const actual = applied.rows[index];
    if (actual.version !== expected.version || !expected.compatibleChecksums.has(actual.checksum)) {
      throw new Error(`unsupported_schema:migration_${expected.version}`);
    }
  }
  const latest = applied.rows.at(-1).version;
  if (Number.parseInt(latest, 10) < 85) throw new Error('unsupported_schema:before_0085');
  return latest;
}

export async function analyzeLearningData(
  client,
  { asOf, environmentKind, repositorySha, analyzerSha256 },
) {
  let queryCount = 0;
  const query = async (text, values) => {
    queryCount += 1;
    return client.query(text, values);
  };
  const started = performance.now();
  const migrationVersion = await verifySchema({ query });
  const stamp =
    asOf || (await query('SELECT transaction_timestamp() AS as_of')).rows[0].as_of.toISOString();
  const db = (
    await query("SELECT current_database() AS name, current_setting('server_version') AS version")
  ).rows[0];
  const units = (await query(UNIT_QUERY)).rows;
  const feedback = (
    await query(`
    SELECT pf.badge, count(*)::int AS count,
           count(*) FILTER (WHERE w.id IS NULL)::int AS orphaned_count,
           count(*) FILTER (WHERE w.id IS NOT NULL)::int AS linked_count
      FROM project_feedback pf
      LEFT JOIN classroom_assignment_work w
        ON w.project_id = pf.project_id AND w.seat_id = pf.seat_id
     GROUP BY pf.badge ORDER BY pf.badge NULLS LAST`)
  ).rows;
  const deterministic = buildDeterministicReport(units, feedback);
  const elapsedMs = Math.round((performance.now() - started) * 100) / 100;
  return {
    schema: SCHEMA_ID,
    metadata: {
      analyzerVersion: ANALYZER_VERSION,
      analyzerSha256,
      environmentKind,
      repositorySha,
      migrationVersion,
      generatedAt: new Date().toISOString(),
      asOf: new Date(stamp).toISOString(),
      database: { fingerprint: sha256(db.name).slice(0, 16), serverVersion: db.version },
      performance: { queryCount, scannedUnits: units.length, elapsedMs },
    },
    deterministic,
  };
}

export function renderMarkdown(report) {
  const d = report.deterministic;
  return (
    `# ASA Learning M0 Legacy Migration Dry Run\n\n` +
    `Schema: \`${report.schema}\`  \nEnvironment: \`${report.metadata.environmentKind}\`  \n` +
    `As-of: \`${report.metadata.asOf}\`  \nMigration: \`${report.metadata.migrationVersion}\`\n\n` +
    `This aggregate report is redacted. It contains no learner identifiers, names, handles, emails, project content, or credentials.\n\n` +
    `## Classification\n\n| Primary class | Count |\n|---|---:|\n` +
    CLASSIFICATIONS.map((key) => `| ${key} | ${d.classifications[key]} |`).join('\n') +
    '\n\n' +
    `## Kind breakdown\n\n| Kind | Total | identity_unresolved | legacy_unresolved | selection_conflict | visibility_only | auto_reconcilable | clean_canonical |\n|---|---:|---:|---:|---:|---:|---:|---:|\n` +
    KINDS.map((kind) => {
      const entry = d.byKind[kind];
      return `| ${kind} | ${entry.total} | ${CLASSIFICATIONS.map((key) => entry.classifications[key]).join(' | ')} |`;
    }).join('\n') +
    '\n\n' +
    `## Required migration facts\n\n` +
    `- Total legacy assignments: ${d.totals.totalLegacyAssignments}\n` +
    `- Mapped activities: ${d.totals.mappedActivities}\n` +
    `- Mapped runs: ${d.totals.mappedRuns}\n` +
    `- Exact submissions recoverable: ${d.legacySubmission.exactSubmissionsRecoverable}\n` +
    `- Unresolved submissions: ${d.legacySubmission.unresolvedSubmissions}\n` +
    `- Legacy feedback preserved: ${d.feedback.total}\n` +
    `- Grade conversions: ${d.feedback.gradeConversions}\n` +
    `- Status conflicts: ${d.conflicts.statusConflicts}\n` +
    `- Auto-resolved conflicts: ${d.conflicts.autoResolved}\n` +
    `- Manual-review conflicts: ${d.conflicts.manualReview}\n\n` +
    `## Identity, selection, lifecycle and feedback\n\n` +
    `- Future identity seeds: ${d.identity.futureIdentitySeeds}; seat links: ${d.identity.seatLinks}; account links: ${d.identity.accountLinks}; cross-school splits: ${d.identity.crossSchoolAccountSplits}.\n` +
    `- Result with valid pointer: ${d.selection.resultExistsValidPointer}; without pointer: ${d.selection.resultExistsNoPointer}; broken pointer: ${d.selection.brokenPointer}; older valid pointer: ${d.selection.pointerToOlderValidAttempt}.\n` +
    `- Seat history — active: ${d.visibility.activeSeatHistory}; issued: ${d.visibility.issuedSeatHistory}; suspended: ${d.visibility.suspendedSeatHistory}; removed: ${d.visibility.removedSeatHistory}; ended classroom/assignment: ${d.visibility.endedClassroomHistory}.\n` +
    `- Feedback linked to work: ${d.feedback.linkedToWork}; orphan/inconsistent: ${d.feedback.orphaned}; values remain metadata only.\n\n` +
    `## Auto-reconciliation boundary\n\n` +
    `Only persisted school/account/seat/assignment/activity/Attempt/Submission/ProjectVersion IDs are evidence. ` +
    `Guessed identity merges: ${d.autoReconciliationPlan.guessedIdentityMerges}; fabricated immutable evidence: ${d.autoReconciliationPlan.fabricatedImmutableEvidence}; grade conversions: ${d.autoReconciliationPlan.gradeConversions}.\n\n` +
    `## Safety and performance\n\n` +
    `Read-only repeatable-read transaction; ${report.metadata.performance.queryCount} set-based queries; ` +
    `${report.metadata.performance.scannedUnits} units in ${report.metadata.performance.elapsedMs} ms. ` +
    (report.metadata.environmentKind === 'production'
      ? 'Production was scanned under the explicit production invocation boundary.\n'
      : 'Production was not scanned.\n')
  );
}

function configurationError(message) {
  return Object.assign(new Error(message), { exitCode: EX_CONFIG });
}

export function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--allow-production') args.allowProduction = true;
    else if (token.startsWith('--')) {
      const key = token.slice(2).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
      args[key] = argv[++index];
    } else throw new Error(`unknown_argument:${token}`);
  }
  if (!['test', 'local-dev', 'production'].includes(args.environment))
    throw configurationError('environment_required');
  if (!args.output || !args.markdown) throw configurationError('output_paths_required');
  if (args.environment === 'production' && !args.allowProduction)
    throw configurationError('production_not_authorized');
  if (args.asOf && Number.isNaN(Date.parse(args.asOf))) throw new Error('invalid_as_of');
  return args;
}

function safeDatabaseName(databaseUrl) {
  try {
    return new URL(databaseUrl).pathname.slice(1);
  } catch {
    throw new Error('invalid_database_url');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.LEARNING_DRY_RUN_DATABASE_URL;
  if (!databaseUrl)
    throw Object.assign(new Error('LEARNING_DRY_RUN_DATABASE_URL_required'), {
      exitCode: EX_CONFIG,
    });
  const name = safeDatabaseName(databaseUrl);
  if (args.environment === 'test' && !name.endsWith('_test'))
    throw Object.assign(new Error('unsafe_test_database'), { exitCode: EX_CONFIG });
  if (args.environment === 'local-dev' && !(name.endsWith('_dev') || name === 'asalab_dev'))
    throw Object.assign(new Error('unsafe_local_dev_database'), { exitCode: EX_CONFIG });

  const analyzerBytes = readFileSync(new URL(import.meta.url));
  const repositorySha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const report = await withReadOnlyTransaction(
      client,
      (tx) =>
        analyzeLearningData(tx, {
          asOf: args.asOf,
          environmentKind: args.environment,
          repositorySha,
          analyzerSha256: sha256(analyzerBytes),
        }),
      args.asOf,
    );
    const schema = JSON.parse(
      readFileSync(new URL('./learning-migration-dry-run-v1.schema.json', import.meta.url), 'utf8'),
    );
    const ajv = new Ajv({ allErrors: true, strict: true });
    addFormats(ajv);
    const validate = ajv.compile(schema);
    if (!validate(report))
      throw new Error(`report_schema_invalid:${JSON.stringify(validate.errors)}`);
    writeFileSync(resolve(args.output), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    writeFileSync(resolve(args.markdown), renderMarkdown(report), { flag: 'wx' });
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((error) => {
    process.stderr.write(`learning migration dry-run failed: ${error.message}\n`);
    process.exitCode = error.exitCode || 1;
  });
}
