import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { readFile, readdir } from 'node:fs/promises';
import { endianness } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { URL } from 'node:url';

// Imported full UI workload: PR993, not an assertion that PR993 was accepted.
// These pins bind this adapter to the original 420-operation N30 experiment.
export const OFFICIAL_SCALE_SCENARIO = Object.freeze({
  sourceSha: '30a7c78e4c774a944d4b30e369ef51ff701a364d',
  e2eSha256: 'c1a0ea8ba9cbbadfe4cb18d7b4250073bbe1f8ca4edfb72bb3dbc712baf605b6',
  profileHash: '3d8cea39cb6d87ff45476c4ed37471b8056debf139879c3b3d500d6fe8aeef8f',
  operations: 420,
});
export const OFFICIAL_SCALE_BASELINE = Object.freeze({
  deploymentDigest: 'sha256:598604051f862c65e5b7d2198c4fb4c21f10229a5f6bb1c2311a6b868d1fe035',
  revision: '98d7fbb42ae9e53113cb45ada4b4301334de9c27',
  schema: 304,
});
export const OFFICIAL_SCALE_AFTER = Object.freeze({
  deploymentDigest: 'sha256:6cfed43761aff188c8d73b553fcbc48b3da9e2a5c78c33d0e6d1af16df26940a',
  revision: '8358997da3919f431e1f41456f7eabcbef685e0b',
  schema: 304,
});
export const OFFICIAL_SCALE_POSTGRES =
  'public.ecr.aws/docker/library/postgres@sha256:e9243ab06e47223dedeb3c129fa9ece8d37f506bdc6ee943afb9335f98bb4854';
const officialServices = ['api', 'web', 'scratch', 'minio', 'search'];
const officialDigest = (value) => /^sha256:[a-f0-9]{64}$/.test(value || '');

/** Native work is an explicit canonical main dispatch, never a PR or local fallback. */
export function assertOfficialScaleDispatch(env) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'spikeal8-maker/asa-lab' ||
    env.GITHUB_EVENT_NAME !== 'workflow_dispatch' ||
    env.GITHUB_REF !== 'refs/heads/main' ||
    env.GITHUB_WORKFLOW_REF !==
      'spikeal8-maker/asa-lab/.github/workflows/classroom-official-n30.yml@refs/heads/main' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    env.RUNNER_OS !== 'Linux' ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
    !/^[a-f0-9]{40}$/.test(env.ASA_SCALE_HARNESS_SHA || '') ||
    env.GITHUB_SHA !== env.ASA_SCALE_HARNESS_SHA ||
    env.GITHUB_WORKFLOW_SHA !== env.ASA_SCALE_HARNESS_SHA ||
    env.DOCKER_HOST ||
    env.DOCKER_CONTEXT
  )
    throw Error('Official N30 requires the exact canonical main dispatch on hosted Linux');
  return {
    harnessSha: env.ASA_SCALE_HARNESS_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
  };
}

export function officialScaleAfterSelector(env) {
  const value = {
    deploymentDigest: env.ASA_SCALE_AFTER_DEPLOYMENT_DIGEST,
    revision: env.ASA_SCALE_AFTER_REVISION,
    schema: Number(env.ASA_SCALE_AFTER_SCHEMA),
  };
  if (
    !officialDigest(value.deploymentDigest) ||
    !/^[a-f0-9]{40}$/.test(value.revision || '') ||
    !/^[1-9][0-9]*$/.test(env.ASA_SCALE_AFTER_SCHEMA || '') ||
    !Number.isSafeInteger(value.schema) ||
    value.schema > 999999999 ||
    value.deploymentDigest === OFFICIAL_SCALE_BASELINE.deploymentDigest ||
    value.revision === OFFICIAL_SCALE_BASELINE.revision ||
    ((value.revision === OFFICIAL_SCALE_AFTER.revision ||
      value.deploymentDigest === OFFICIAL_SCALE_AFTER.deploymentDigest) &&
      Object.keys(OFFICIAL_SCALE_AFTER).some((key) => value[key] !== OFFICIAL_SCALE_AFTER[key]))
  )
    throw Error('After release requires an explicit distinct official digest, SHA and schema');
  return value;
}

/** The Python bridge performs canonical discovery/CI/pulls; this binds its receipt to this run. */
export function assertOfficialScaleReleaseProof(proof, env) {
  const identity = assertOfficialScaleDispatch(env);
  const selected = { baseline: OFFICIAL_SCALE_BASELINE, after: officialScaleAfterSelector(env) };
  if (
    proof?.format !== 'asa-official-n30-releases-v1' ||
    Object.keys(identity).some((key) => proof[key] !== identity[key]) ||
    proof.runToken !== env.ASA_SCALE_RUN_TOKEN ||
    !/^[a-f0-9]{32}$/.test(proof.runToken || '') ||
    proof.harnessGeneralCi !== 'PASS' ||
    proof.scenarioSha256 !== OFFICIAL_SCALE_SCENARIO.e2eSha256 ||
    proof.postgres?.reference !== OFFICIAL_SCALE_POSTGRES ||
    proof.postgres.platform !== 'linux/amd64' ||
    !officialDigest(proof.postgres.id)
  )
    throw Error('Missing or stale official release verification');
  for (const variant of ['baseline', 'after']) {
    const record = proof[variant];
    const manifest = record?.manifest;
    if (
      record?.deploymentDigest !== selected[variant].deploymentDigest ||
      record?.ci !== 'PASS' ||
      manifest?.format !== 'asa-deployment-v2' ||
      manifest.repository !== 'spikeal8-maker/asa-lab' ||
      manifest.revision !== selected[variant].revision ||
      manifest.schema !== selected[variant].schema ||
      manifest.platform !== 'linux/amd64' ||
      !Number.isSafeInteger(manifest.publicationRunId) ||
      manifest.publicationRunId < 1 ||
      Object.keys(manifest.images || {})
        .sort()
        .join(',') !== [...officialServices].sort().join(',') ||
      !Array.isArray(record.images) ||
      record.images.length !== officialServices.length ||
      new Set(record.images.map((item) => item.service)).size !== officialServices.length
    )
      throw Error('Invalid or unqualified official ' + variant + ' manifest');
    for (const service of officialServices) {
      const image = record.images.find((item) => item.service === service);
      if (
        !new RegExp('^ghcr\\.io/spikeal8-maker/asa-lab/' + service + '@sha256:[a-f0-9]{64}$').test(
          manifest.images[service],
        ) ||
        image?.reference !== manifest.images[service] ||
        !officialDigest(image.id) ||
        image.platform !== 'linux/amd64' ||
        (service !== 'minio' && image.revision !== manifest.revision)
      )
        throw Error('Missing immutable official image attestation: ' + service);
    }
  }
  return proof;
}

export function assertOfficialScaleImage(image, expected) {
  if (
    image?.Id !== expected.id ||
    !officialDigest(image.Id) ||
    image.Os !== 'linux' ||
    image.Architecture !== 'amd64' ||
    !image.RepoDigests?.includes(expected.reference) ||
    (expected.service !== 'minio' &&
      image.Config?.Labels?.['org.opencontainers.image.revision'] !== expected.revision)
  )
    throw Error('Local image differs from its official immutable attestation');
}

export function assertOfficialScaleRunner(image, reference, harnessSha, previousId) {
  if (
    !officialDigest(image?.Id) ||
    image.Os !== 'linux' ||
    image.Architecture !== 'amd64' ||
    !image.RepoTags?.includes(reference) ||
    image.Config?.Labels?.['io.asalab.scale.harness'] !== harnessSha ||
    image.Config?.Labels?.['io.asalab.scale.scenario'] !== OFFICIAL_SCALE_SCENARIO.e2eSha256 ||
    (previousId && image.Id !== previousId)
  )
    throw Error('The measurement image must be the same exact harness in both variants');
  return image.Id;
}

export function assertOfficialScaleCompose(config, release, context) {
  const { project, runToken, runnerReference, reports, root } = context;
  if (!/^asa-scale-\d+-\d+-(?:baseline|after)$/.test(project || '') || config.name !== project)
    throw Error('Official N30 requires a fresh variant namespace');
  const expectedImages = {
    ...release.manifest.images,
    migration: release.manifest.images.api,
    'minio-init': release.manifest.images.minio,
    postgres: OFFICIAL_SCALE_POSTGRES,
    'test-runner': runnerReference,
  };
  for (const [service, reference] of Object.entries(expectedImages)) {
    const definition = config.services?.[service];
    if (
      !definition ||
      definition.image !== reference ||
      (service !== 'test-runner' && definition.build) ||
      definition.labels?.['io.asalab.scale.run'] !== runToken ||
      definition.network_mode === 'host'
    )
      throw Error('Unpinned, buildable or unowned official service: ' + service);
  }
  if (
    config.services.migration.environment?.ASA_SEED_DEV !== 'false' ||
    String(config.services.api.environment?.ASA_EXPECTED_SCHEMA_VERSION) !==
      String(release.manifest.schema)
  )
    throw Error('The official API must migrate its own schema without development seeding');
  for (const [kind, resources] of [
    ['network', config.networks],
    ['volume', config.volumes],
  ]) {
    for (const [name, resource] of Object.entries(resources || {})) {
      if (resource.external || resource.name !== project + '_' + name)
        throw Error('An external or shared ' + kind + ' is forbidden');
    }
  }
  for (const service of Object.keys(expectedImages)) {
    for (const mount of config.services[service].volumes || []) {
      if (mount.type === 'volume') {
        if (config.volumes[mount.source]?.labels?.['io.asalab.scale.run'] !== runToken)
          throw Error('Unowned persistent fixture volume');
      } else if (
        mount.type !== 'bind' ||
        !(service === 'api'
          ? mount.source === root + '/.asa/diagnostics/store' && mount.read_only === true
          : service === 'test-runner' &&
            ((mount.source === reports && mount.target === '/workspace/reports/classroom-scale') ||
              (mount.source === reports + '/artifacts' &&
                mount.target === '/workspace/e2e/artifacts')))
      )
        throw Error('Unexpected host mount in the isolated fixture');
    }
  }
  for (const network of Object.values(config.networks || {}))
    if (network.labels?.['io.asalab.scale.run'] !== runToken)
      throw Error('Unowned fixture network');
  return expectedImages;
}

/** Playwright clears its output directory; keep it below this phase's owned bind mount. */
export function officialScaleBrowserInvocation(config, { reports, users, mode }) {
  const phase =
    mode === 'calibration' && users === 2
      ? 'calibration'
      : mode === 'capacity' && users === 30
        ? 'level-30'
        : undefined;
  const definition = config.services?.['test-runner'];
  const command = definition?.command;
  const expected = [
    'corepack',
    'pnpm',
    'exec',
    'playwright',
    'test',
    'e2e/classroom-scale.spec.ts',
    '--workers=1',
    '--reporter=line',
  ];
  const target = '/workspace/reports/classroom-scale';
  const mounts = Array.isArray(definition?.volumes)
    ? definition.volumes.filter((mount) => mount.target === target)
    : [];
  if (
    !phase ||
    definition?.read_only !== true ||
    !Array.isArray(command) ||
    command.length !== expected.length ||
    command.some((argument, index) => argument !== expected[index]) ||
    typeof reports !== 'string' ||
    !reports.startsWith('/') ||
    mounts.length !== 1 ||
    mounts[0].type !== 'bind' ||
    mounts[0].source !== reports ||
    (mounts[0].read_only !== undefined && mounts[0].read_only !== false)
  )
    throw Error(
      'Official N30 browser output requires the fixed command and owned writable report mount',
    );
  const outputDir = target + '/' + phase + '/playwright';
  return { phase, outputDir, command: [...command, '--output=' + outputDir] };
}

function officialScaleResourceDefinitions(kind, context) {
  if (
    !['volume', 'network'].includes(kind) ||
    !/^asa-scale-\d+-\d+-(?:baseline|after)$/.test(context?.project || '') ||
    !/^[a-f0-9]{32}$/.test(context?.runToken || '') ||
    context.config?.name !== context.project
  )
    throw Error('Invalid official fixture resource context');
  const definitions = context.config[kind === 'volume' ? 'volumes' : 'networks'];
  if (!definitions || typeof definitions !== 'object' || Array.isArray(definitions))
    throw Error('Missing official fixture resource configuration');
  return definitions;
}

export function officialScaleResourceListArgs(kind, project) {
  if (
    !['volume', 'network'].includes(kind) ||
    !/^asa-scale-\d+-\d+-(?:baseline|after)$/.test(project || '')
  )
    throw Error('Invalid official fixture resource query');
  // Docker volume ls -q emits names; network ls -q emits IDs, normally truncated.
  return [
    kind,
    'ls',
    '-q',
    ...(kind === 'network' ? ['--no-trunc'] : []),
    '--filter',
    'label=com.docker.compose.project=' + project,
  ];
}

export function assertOfficialScaleOwnedResource(kind, reference, records, context) {
  const definitions = officialScaleResourceDefinitions(kind, context);
  if (!Array.isArray(records) || records.length !== 1)
    throw Error('Refusing fixture ' + kind + ': inspect_count');
  const value = records[0];
  const key = value?.Labels?.['com.docker.compose.' + kind];
  if (typeof key !== 'string' || !Object.hasOwn(definitions, key))
    throw Error('Refusing fixture ' + kind + ': unknown_config_key');
  const definition = definitions[key];
  if (
    !definition ||
    definition.external ||
    definition.name !== context.project + '_' + key ||
    definition.labels?.['io.asalab.scale.run'] !== context.runToken
  )
    throw Error('Refusing fixture ' + kind + ': unowned_config');
  if (value.Name !== definition.name) throw Error('Refusing fixture ' + kind + ': name_mismatch');
  if (value.Labels['com.docker.compose.project'] !== context.project)
    throw Error('Refusing fixture ' + kind + ': project_mismatch');
  if (value.Labels['io.asalab.scale.run'] !== context.runToken)
    throw Error('Refusing fixture ' + kind + ': run_token_mismatch');
  if (kind === 'network') {
    if (!/^[a-f0-9]{64}$/.test(reference || '') || value.Id !== reference)
      throw Error('Refusing fixture network: full_id_mismatch');
    return Object.freeze({ kind, key, name: value.Name, id: value.Id });
  }
  if (value.Name !== reference) throw Error('Refusing fixture volume: listed_name_mismatch');
  return Object.freeze({ kind, key, name: value.Name });
}

/** A partial-startup receipt permits cleanup only; a complete snapshot precedes all browsers. */
export function assertOfficialScaleResourceInventory(resources, previous, context) {
  const { project, runToken, config, completeNetworks = false } = context;
  const networks = officialScaleResourceDefinitions('network', context);
  officialScaleResourceDefinitions('volume', context);
  if (!Array.isArray(resources) || typeof completeNetworks !== 'boolean')
    throw Error('Invalid official fixture inventory');
  const keys = new Set();
  const ids = new Set();
  for (const resource of resources) {
    const definitions = officialScaleResourceDefinitions(resource?.kind, context);
    const identity = resource.kind + ':' + resource.key;
    if (
      typeof resource.key !== 'string' ||
      !Object.hasOwn(definitions, resource.key) ||
      definitions[resource.key].name !== resource.name ||
      keys.has(identity) ||
      (resource.kind === 'network' &&
        (!/^[a-f0-9]{64}$/.test(resource.id || '') || ids.has(resource.id))) ||
      (resource.kind === 'volume' && resource.id !== undefined)
    )
      throw Error('Invalid or duplicate official fixture inventory entry');
    keys.add(identity);
    if (resource.kind === 'network') ids.add(resource.id);
  }
  if (completeNetworks && Object.keys(networks).some((key) => !keys.has('network:' + key)))
    throw Error('Incomplete official fixture networks before browser execution');
  const configurationHash = scaleHash({ networks: config.networks, volumes: config.volumes });
  if (previous) {
    if (
      previous.schemaVersion !== 1 ||
      previous.project !== project ||
      previous.runToken !== runToken ||
      previous.configurationHash !== configurationHash ||
      previous.completeNetworks !== completeNetworks ||
      !Array.isArray(previous.resources) ||
      previous.resources.length !== resources.length ||
      previous.resources.some((saved) => {
        const live = resources.find((item) => item.kind === saved.kind && item.key === saved.key);
        return !live || live.name !== saved.name || live.id !== saved.id;
      })
    )
      throw Error('Refusing changed, missing or replaced fixture resource inventory');
  }
  return Object.freeze({
    schemaVersion: 1,
    project,
    runToken,
    configurationHash,
    completeNetworks,
    resources: Object.freeze(resources.map((resource) => Object.freeze({ ...resource }))),
  });
}

export function assertOfficialScaleOwnedContainer(metadata, expected) {
  const labels = metadata?.Config?.Labels || {};
  const service = labels['com.docker.compose.service'];
  if (
    !/^asa-scale-\d+-\d+-(?:baseline|after)$/.test(expected?.project || '') ||
    !/^[a-f0-9]{32}$/.test(expected?.runToken || '') ||
    !/^[a-f0-9]{64}$/.test(metadata?.Id || '') ||
    labels['com.docker.compose.project'] !== expected.project ||
    labels['io.asalab.scale.run'] !== expected.runToken ||
    labels['com.docker.compose.project.working_dir'] !== expected.root ||
    labels['com.docker.compose.project.config_files'] !== expected.configFiles ||
    !expected.images[service] ||
    metadata.Config.Image !== expected.images[service].reference ||
    metadata.Image !== expected.images[service].id
  )
    throw Error('Refusing foreign, replaced or mixed-image Docker resource');
  return metadata;
}

export function assertOfficialScaleRuntime(ready, web, scratchRevision, manifest) {
  if (
    ready?.status !== 'ready' ||
    ready.deployment?.revision !== manifest.revision ||
    ready.deployment.schemaVersion !== manifest.schema ||
    ready.deployment.expectedSchemaVersion !== manifest.schema ||
    ready.deployment.synchronized !== true ||
    web?.revision !== manifest.revision ||
    scratchRevision !== manifest.revision
  )
    throw Error('Live API, Web, Scratch or database differs from the official release');
  return {
    apiRevision: ready.deployment.revision,
    webRevision: web.revision,
    scratchRevision,
    schema: ready.deployment.schemaVersion,
    synchronized: true,
  };
}

/** Native entry point intentionally has no route to the historical ladder or ABBA. */
export async function runOfficialScaleN30(identity, runLevel, onReceipt) {
  const calibration = await runLevel(2, 'calibration');
  const validate = (receipt, users) => {
    if (
      receipt?.users !== users ||
      Object.keys(identity).some((key) => receipt[key] !== identity[key]) ||
      !(
        users === 2
          ? ['VALID_FIXTURE', 'INVALID_FIXTURE', 'BLOCKED_BY_RUNNER']
          : ['PASS', 'FAIL', 'INVALID', 'BLOCKED_BY_RUNNER']
      ).includes(receipt.status)
    )
      throw Error('Mixed or unexpected official N30 receipt');
  };
  validate(calibration, 2);
  await onReceipt(calibration, 'calibration');
  const level =
    calibration.status === 'VALID_FIXTURE'
      ? await runLevel(30, 'capacity')
      : { users: 30, status: 'NOT_RUN', reasons: ['calibration_unconfirmed'] };
  if (level.status !== 'NOT_RUN') {
    validate(level, 30);
    await onReceipt(level, 'level-30');
  }
  return {
    ...identity,
    profile: SCALE_PROFILE,
    scenario: OFFICIAL_SCALE_SCENARIO,
    calibration,
    levels: [level],
    maximumConfirmedUsers: level.status === 'PASS' ? 30 : 0,
    absoluteCapacityEstablished: false,
    limitations: SCALE_PROFILE.limitations,
  };
}

export const SCALE_LEVELS = Object.freeze([30, 60, 100, 150, 200]);
export const SCALE_ORIGIN = 'http://127.0.0.1:8080';
export const SCALE_DATABASE = 'asalab_test';
export const SCALE_CRYPTO_CHALLENGE = 'asa-classroom-scale-secure-context-v1';
// The public header's "Проекты" link opens the gallery. The measured Seat
// journey must click the native personal-project link instead.
export const SCALE_PROJECTS_LINK_SELECTOR =
  'nav[aria-label="Личные и рабочие разделы"] a[aria-label="Мои проекты"][href="/#/projects"]';

// Collection happens after the failed workload, never in its measured request
// path. These bounds do not change SCALE_PROFILE or any acceptance threshold.
export const SCALE_FAILURE_DIAGNOSTIC_LIMITS = Object.freeze({
  ioTimeoutMs: 5000,
  totalTimeoutMs: 20000,
  inspectBytes: 65536,
  streamBytes: 4 * 1024 ** 2,
  lines: 20000,
  lineBytes: 16384,
  serverErrors: 512,
  requestEvents: 1536,
  poolErrors: 16,
});
const diagnosticKinds = new Set([
  'server_error',
  'http_request_started',
  'http_response',
  'http_request_ended',
  'database_pool_error',
]);
const diagnosticCodes = new Set([
  'database_query_timeout',
  'database_connection_timeout',
  'upstream_connection_failed',
  'internal_error',
  'pool_acquire_timeout',
  'client_query_timeout',
  'database_error',
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
]);
const diagnosticClasses = new Set([
  'Error',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'DatabaseError',
  'QueryError',
  'ConnectionError',
  'HttpException',
  'InternalServerErrorException',
  'ServiceUnavailableException',
  'GatewayTimeoutException',
]);
const diagnosticUuid = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const diagnosticTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z$/;
const diagnosticNumber = (value, integer = false) => {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > Number.MAX_SAFE_INTEGER ||
    (integer && !Number.isSafeInteger(value))
  )
    throw Error('invalid_diagnostic_record');
  return value;
};
const diagnosticCode = (value) =>
  typeof value === 'string' &&
  (diagnosticCodes.has(value) ||
    /^(?:08|22|23|25|28|40|42|53|54|55|57|58|XX)[A-Z0-9]{3}$/.test(value))
    ? value
    : 'unclassified_error';

/** Never return an exception message, command, stdout/stderr, or arbitrary code. */
export function scaleFailureDiagnosticError(error) {
  const code = [
    'ENOENT',
    'EACCES',
    'EPERM',
    'ETIMEDOUT',
    'EPIPE',
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
  ].includes(error?.code)
    ? error.code
    : [
          'diagnostic_deadline',
          'diagnostic_identity_mismatch',
          'diagnostic_identity_changed',
          'invalid_diagnostic_context',
        ].includes(error?.message)
      ? error.message
      : 'diagnostic_transport_failed';
  return {
    code,
    exitCode:
      Number.isInteger(error?.code) && error.code >= 0 && error.code <= 255
        ? error.code
        : Number.isInteger(error?.exitCode) && error.exitCode >= 0 && error.exitCode <= 255
          ? error.exitCode
          : null,
    signal: ['SIGTERM', 'SIGKILL'].includes(error?.signal) ? error.signal : null,
  };
}

/** Inspect output stays private. Only this projection can enter an artifact. */
export function assertScaleFailureContainer(metadata, expected) {
  const labels = metadata?.Config?.Labels || {};
  if (
    !/^[a-f0-9]{64}$/.test(expected?.id || '') ||
    !/^sha256:[a-f0-9]{64}$/.test(expected?.image || '') ||
    !/^[a-f0-9]{40}$/.test(expected?.sourceSha || '') ||
    !/^asa-scale-\d+-\d+(?:-(?:baseline|after))?$/.test(expected?.project || '') ||
    !/^[a-f0-9]{32}$/.test(expected?.runToken || '') ||
    !diagnosticTime.test(expected?.startedAt || '') ||
    !Number.isSafeInteger(expected?.restartCount) ||
    expected.restartCount < 0 ||
    typeof expected?.root !== 'string' ||
    !expected.root.startsWith('/') ||
    metadata?.Id !== expected.id ||
    metadata.Image !== expected.image ||
    metadata.State?.StartedAt !== expected.startedAt ||
    metadata.RestartCount !== expected.restartCount ||
    labels['com.docker.compose.project'] !== expected.project ||
    labels['com.docker.compose.service'] !== 'api' ||
    labels['com.docker.compose.project.working_dir'] !== expected.root ||
    labels['io.asalab.scale.run'] !== expected.runToken ||
    labels['org.opencontainers.image.revision'] !== expected.sourceSha ||
    !diagnosticTime.test(metadata.State?.StartedAt || '') ||
    !Number.isFinite(Date.parse(metadata.State.StartedAt)) ||
    !Number.isSafeInteger(metadata.RestartCount) ||
    metadata.RestartCount < 0 ||
    typeof metadata.State.Running !== 'boolean' ||
    typeof metadata.State.OOMKilled !== 'boolean'
  )
    throw Error('diagnostic_identity_mismatch');
  return {
    id: metadata.Id,
    image: metadata.Image,
    sourceSha: expected.sourceSha,
    startedAt: metadata.State.StartedAt,
    restartCount: metadata.RestartCount,
    running: metadata.State.Running,
    oomKilled: metadata.State.OOMKilled,
  };
}

function diagnosticSessionDatabase(value) {
  if (value === undefined) return undefined;
  if (!value || value.operation !== 'identity.session.resolve')
    throw Error('invalid_diagnostic_record');
  const projected = {
    operation: 'identity.session.resolve',
    calls: diagnosticNumber(value.calls, true),
    failures: diagnosticNumber(value.failures, true),
    poolAcquireMs: diagnosticNumber(value.poolAcquireMs),
    queryRoundTripMs: diagnosticNumber(value.queryRoundTripMs),
  };
  if (projected.failures > projected.calls) throw Error('invalid_diagnostic_record');
  if (projected.failures) {
    if (!['acquire', 'query'].includes(value.lastFailurePhase))
      throw Error('invalid_diagnostic_record');
    return {
      ...projected,
      lastFailurePhase: value.lastFailurePhase,
      lastErrorCode: diagnosticCode(value.lastErrorCode),
    };
  }
  return projected;
}

function diagnosticRecord(value, sourceSha) {
  if (!value || !diagnosticKinds.has(value.kind)) return null;
  if (!diagnosticTime.test(value.time || '') || !Number.isFinite(Date.parse(value.time)))
    throw Error('invalid_diagnostic_record');
  if (value.kind === 'database_pool_error') {
    if (!['main', 'analytics', 'acquisition'].includes(value.role))
      throw Error('invalid_diagnostic_record');
    return {
      kind: value.kind,
      time: value.time,
      role: value.role,
      count: diagnosticNumber(value.count, true),
      errorCode: diagnosticCode(value.errorCode),
      errorClass: diagnosticClasses.has(value.errorClass) ? value.errorClass : 'unknown',
    };
  }
  if (value.revision !== sourceSha) throw Error('diagnostic_foreign_revision');
  if (
    !diagnosticUuid.test(value.requestId || '') ||
    !['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(value.method)
  )
    throw Error('invalid_diagnostic_record');
  const common = {
    kind: value.kind,
    time: value.time,
    requestId: value.requestId,
    revision: sourceSha,
    method: value.method,
    ...(value.sessionDatabase === undefined
      ? {}
      : { sessionDatabase: diagnosticSessionDatabase(value.sessionDatabase) }),
  };
  if (value.kind === 'http_request_started') return common;
  if (value.kind === 'http_request_ended' || value.kind === 'http_response') {
    if (
      value.kind === 'http_response' &&
      (!Number.isInteger(value.status) || value.status < 100 || value.status > 599)
    )
      throw Error('invalid_diagnostic_record');
    const loop = value.eventLoopDelaySinceStartMs;
    return {
      ...common,
      ...(value.kind === 'http_response' ? { status: value.status } : {}),
      durationMs: diagnosticNumber(value.durationMs),
      ...(value.errorCode === undefined ? {} : { errorCode: diagnosticCode(value.errorCode) }),
      ...(loop === undefined
        ? {}
        : {
            eventLoopDelaySinceStartMs: {
              p50: diagnosticNumber(loop?.p50),
              p99: diagnosticNumber(loop?.p99),
              max: diagnosticNumber(loop?.max),
            },
          }),
    };
  }
  if (
    !Number.isInteger(value.status) ||
    value.status < 500 ||
    value.status > 599 ||
    !Array.isArray(value.frames) ||
    value.frames.length > 10
  )
    throw Error('invalid_diagnostic_record');
  // Keep source locations, not arbitrary function names or exception messages.
  const frames = value.frames.map((line) => {
    const match =
      typeof line === 'string' &&
      line.length <= 240 &&
      !/[?="'\r\n]/.test(line) &&
      line.match(
        /((?:\/app\/(?:dist|node_modules)\/[A-Za-z0-9_@./+-]+\.(?:[cm]?js|ts)|node:[A-Za-z0-9_./-]+):\d+:\d+)\)?$/,
      );
    if (!match) throw Error('invalid_diagnostic_record');
    return match[1];
  });
  const runtime = value.runtime;
  const pool = runtime?.pool;
  if (pool !== null && (!pool || pool.idle > pool.total)) throw Error('invalid_diagnostic_record');
  return {
    ...common,
    status: value.status,
    errorCode: diagnosticCode(value.errorCode),
    errorClass: diagnosticClasses.has(value.errorClass) ? value.errorClass : 'unknown',
    frames,
    runtime: {
      rssBytes: diagnosticNumber(runtime?.rssBytes, true),
      heapUsedBytes: diagnosticNumber(runtime?.heapUsedBytes, true),
      cpuMicros: {
        user: diagnosticNumber(runtime?.cpuMicros?.user, true),
        system: diagnosticNumber(runtime?.cpuMicros?.system, true),
      },
      pool:
        pool === null
          ? null
          : {
              total: diagnosticNumber(pool.total, true),
              idle: diagnosticNumber(pool.idle, true),
              waiting: diagnosticNumber(pool.waiting, true),
            },
    },
  };
}

/** Raw Docker output is bounded in memory and is never written or returned. */
export function projectScaleFailureLogs(streams, context, secrets = []) {
  const limits = SCALE_FAILURE_DIAGNOSTIC_LIMITS;
  if (
    !/^[a-f0-9]{40}$/.test(context?.sourceSha || '') ||
    !Number.isSafeInteger(context?.startedAtMs) ||
    !Number.isSafeInteger(context?.endedAtMs) ||
    context.startedAtMs > context.endedAtMs
  )
    throw Error('invalid_diagnostic_context');
  const counts = {
    stdoutBytes: 0,
    stderrBytes: 0,
    lines: 0,
    ignoredLines: 0,
    invalidStreams: 0,
    outsideWindow: 0,
    invalidRecords: 0,
    foreignRevision: 0,
    redactedRecords: 0,
    truncatedStreams: 0,
    unterminatedLines: 0,
    lineLimitHit: false,
    serverErrors: 0,
    requestEvents: 0,
    poolErrors: 0,
    duplicateServerErrorIds: 0,
    droppedRecords: 0,
  };
  const serverErrors = [];
  const requestCandidates = [];
  const poolErrors = [];
  const errorIds = new Set();
  for (const stream of ['stdout', 'stderr']) {
    if (typeof streams?.[stream] !== 'string') counts.invalidStreams++;
    const input = typeof streams?.[stream] === 'string' ? streams[stream] : '';
    const bytes = Buffer.from(input, 'utf8');
    counts[stream + 'Bytes'] = bytes.length;
    if (bytes.length > limits.streamBytes) counts.truncatedStreams++;
    const lines = bytes.subarray(0, limits.streamBytes).toString('utf8').split('\n');
    if (lines.at(-1)) counts.unterminatedLines++;
    else lines.pop();
    for (const line of lines) {
      if (counts.lines >= limits.lines) {
        counts.lineLimitHit = true;
        break;
      }
      counts.lines++;
      if (Buffer.byteLength(line, 'utf8') > limits.lineBytes) {
        counts.invalidRecords++;
        continue;
      }
      if (
        secrets.some(
          (secret) => typeof secret === 'string' && secret.length >= 8 && line.includes(secret),
        )
      ) {
        counts.redactedRecords++;
        continue;
      }
      const stamped = line.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,9}Z) (.+)$/);
      if (!stamped) {
        counts.ignoredLines++;
        continue;
      }
      try {
        const value = JSON.parse(stamped[2]);
        const record = diagnosticRecord(value, context.sourceSha);
        if (!record) {
          counts.ignoredLines++;
          continue;
        }
        if (
          !Number.isFinite(Date.parse(stamped[1])) ||
          Date.parse(stamped[1]) < context.startedAtMs ||
          Date.parse(stamped[1]) > context.endedAtMs ||
          Date.parse(record.time) < context.startedAtMs ||
          Date.parse(record.time) > context.endedAtMs
        ) {
          counts.outsideWindow++;
          continue;
        }
        const projected = { ...record, stream, dockerTime: stamped[1] };
        if (record.kind === 'server_error') {
          counts.serverErrors++;
          if (errorIds.has(record.requestId)) counts.duplicateServerErrorIds++;
          errorIds.add(record.requestId);
          if (serverErrors.length < limits.serverErrors) serverErrors.push(projected);
          else counts.droppedRecords++;
        } else if (record.kind === 'database_pool_error') {
          counts.poolErrors++;
          if (poolErrors.length < limits.poolErrors) poolErrors.push(projected);
          else counts.droppedRecords++;
        } else requestCandidates.push(projected);
      } catch (error) {
        if (error?.message === 'diagnostic_foreign_revision') counts.foreignRevision++;
        else counts.invalidRecords++;
      }
    }
  }
  const matching = requestCandidates.filter((record) => errorIds.has(record.requestId));
  counts.requestEvents = matching.length;
  const requestEvents = matching.slice(0, limits.requestEvents);
  counts.droppedRecords += matching.length - requestEvents.length;
  const expected = context.expectedApi5xx;
  const expectedKnown =
    Number.isSafeInteger(expected) &&
    expected >= 0 &&
    expected <= SCALE_PROFILE.maximumHttpObservations + SCALE_PROFILE.maximumControlObservations;
  const missingByCount = expectedKnown ? Math.max(0, expected - errorIds.size) : null;
  const transport = ['completed', 'failed', 'timeout', 'truncated'].includes(streams?.transport)
    ? streams.transport
    : 'failed';
  const incomplete =
    transport !== 'completed' ||
    counts.invalidStreams > 0 ||
    counts.truncatedStreams > 0 ||
    counts.unterminatedLines > 0 ||
    counts.lineLimitHit ||
    counts.lines >= limits.lines ||
    counts.invalidRecords > 0 ||
    counts.foreignRevision > 0 ||
    counts.redactedRecords > 0 ||
    counts.duplicateServerErrorIds > 0 ||
    counts.droppedRecords > 0 ||
    !expectedKnown ||
    missingByCount > 0;
  return {
    status: incomplete ? 'INCOMPLETE' : 'CAPTURED',
    transport,
    ...(transport === 'completed'
      ? {}
      : { transportError: scaleFailureDiagnosticError(streams?.error) }),
    counts,
    expectedApi5xx: expectedKnown ? expected : null,
    missingByCount,
    correlation:
      'Request IDs still require an independent join with the existing browser trace; matching counts alone do not prove complete correlation.',
    serverErrors,
    requestEvents,
    poolErrors,
  };
}

/** Fixed owned-container IO; a collection failure is separate from load verdict. */
export async function captureScaleFailureDiagnostics(context, io, secrets = []) {
  const limits = SCALE_FAILURE_DIAGNOSTIC_LIMITS;
  const clock = io.now || Date.now;
  const startedAtMs = clock();
  const deadline = startedAtMs + limits.totalTimeoutMs;
  let stage = 'context';
  let before;
  const remaining = () => {
    const time = Math.min(limits.ioTimeoutMs, deadline - clock());
    if (time <= 0) throw Error('diagnostic_deadline');
    return time;
  };
  try {
    if (
      !/^(?:calibration|level-(?:30|60|100|150|200))$/.test(context?.phase || '') ||
      !Number.isSafeInteger(context.startedAtMs) ||
      !Number.isSafeInteger(context.endedAtMs) ||
      context.startedAtMs < 0 ||
      context.startedAtMs > context.endedAtMs ||
      context.endedAtMs > startedAtMs ||
      context.endedAtMs - context.startedAtMs > SCALE_PROFILE.levelTimeoutMs + 30000 ||
      !/^[a-f0-9]{64}$/.test(context?.container?.id || '')
    )
      throw Error('invalid_diagnostic_context');
    stage = 'pre-inspect';
    before = assertScaleFailureContainer(
      await io.inspect(context.container.id, remaining()),
      context.container,
    );
    stage = 'logs';
    const streams = await io.logs(before.id, context, remaining());
    stage = 'post-inspect';
    const after = assertScaleFailureContainer(
      await io.inspect(before.id, remaining()),
      context.container,
    );
    if (
      before.id !== after.id ||
      before.image !== after.image ||
      before.startedAt !== after.startedAt ||
      before.restartCount !== after.restartCount
    )
      throw Error('diagnostic_identity_changed');
    stage = 'projection';
    remaining();
    const projected = projectScaleFailureLogs(
      streams,
      {
        sourceSha: context.container.sourceSha,
        startedAtMs: context.startedAtMs,
        endedAtMs: context.endedAtMs,
        expectedApi5xx: context.expectedApi5xx,
      },
      secrets,
    );
    remaining();
    return {
      schemaVersion: 1,
      collector: 'owned-api-failure-only-v1',
      sourceSha: context.container.sourceSha,
      phase: context.phase,
      window: { startedAtMs: context.startedAtMs, endedAtMs: context.endedAtMs },
      collection: { startedAtMs, endedAtMs: clock(), limits },
      container: { before, after },
      ...projected,
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      collector: 'owned-api-failure-only-v1',
      status: 'UNAVAILABLE',
      stage,
      error: scaleFailureDiagnosticError(error),
      collection: { startedAtMs, endedAtMs: clock(), limits },
      ...(before ? { container: { before } } : {}),
      serverErrors: [],
      requestEvents: [],
      poolErrors: [],
    };
  }
}

/** Preserve machine-readable causes without persisting URLs, SQL, credentials,
 * request bodies or arbitrary exception messages. The count remains unbounded
 * evidence even when the bounded diagnostic details are full. */
export function createScaleObserverJournal() {
  const state = {
    count: 0,
    dropped: 0,
    details: /** @type {Array<Record<string, string | number | boolean | null>>} */ ([]),
  };
  const codes = new Set([
    'ENOENT',
    'EACCES',
    'EPERM',
    'ETIMEDOUT',
    'ECONNREFUSED',
    'ECONNRESET',
    'EPIPE',
    'EIO',
    'ENOSPC',
    'ABORT_ERR',
    'ERR_CHILD_PROCESS_STDIO_MAXBUFFER',
    'served_script_incomplete',
    'served_script_differs_from_image',
    'served_script_not_in_manifest',
    'invalid_proc_clock',
    'invalid_proc_stat',
    'invalid_proc_status',
    'missing_proc_owner',
    'missing_owned_chromium',
    'unsupported_proc_architecture',
    'proc_process_bound',
  ]);
  const categories = new Map([
    ['Query read timeout', 'query_read_timeout'],
    ['timeout exceeded when trying to connect', 'connection_timeout'],
    ['Connection terminated unexpectedly', 'connection_terminated'],
    ['Invalid Chromium process sample', 'invalid_chromium_process_sample'],
    ['Live Chromium has no owned process samples', 'no_owned_chromium_process_sample'],
  ]);
  return {
    state,
    record(stage, phase, error, atMs = Date.now()) {
      state.count++;
      if (state.details.length >= 32) {
        state.dropped++;
        return;
      }
      const cause = error && typeof error === 'object' ? error : {};
      const label = (value) =>
        typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/.test(value) ? value : 'unknown';
      state.details.push({
        atMs,
        stage: label(stage),
        phase: label(phase),
        name: [
          'Error',
          'TypeError',
          'RangeError',
          'TimeoutError',
          'AbortError',
          'FixtureFailure',
        ].includes(cause.name)
          ? cause.name
          : 'Error',
        code:
          typeof cause.code === 'string' &&
          (codes.has(cause.code) || /^[0-9][A-Z0-9]{4}$/.test(cause.code))
            ? cause.code
            : 'unknown',
        syscall: ['spawn ps', 'read', 'open', 'connect'].includes(cause.syscall)
          ? cause.syscall
          : null,
        command: cause.path === 'ps' ? 'ps' : null,
        errno:
          Number.isSafeInteger(cause.errno) && Math.abs(cause.errno) <= 4095 ? cause.errno : null,
        signal: ['SIGTERM', 'SIGKILL', 'SIGABRT'].includes(cause.signal) ? cause.signal : null,
        killed: cause.killed === true,
        messageCategory: categories.get(cause.message) ?? 'unclassified',
      });
    },
  };
}

/** The pinned slim test image has no procps/ps. Read the same process fields
 * directly: RSS is KiB from status; lifetime CPU uses stat ticks and the actual
 * AT_CLKTCK value, never an assumed100Hz or an unavailable-data zero fallback. */
export async function readScaleChromiumResources(ownerPid, browserLive, procRoot = '/proc') {
  const signal = globalThis.AbortSignal.timeout(2000);
  const fail = (code) => {
    throw Object.assign(new Error(code), { code });
  };
  if (!['x64', 'arm64'].includes(process.arch) || endianness() !== 'LE')
    fail('unsupported_proc_architecture');
  const auxv = await readFile(join(procRoot, 'self/auxv'), { signal });
  let ticksPerSecond = 0;
  if (auxv.length % 16 !== 0) fail('invalid_proc_clock');
  for (let offset = 0; offset < auxv.length; offset += 16) {
    const type = auxv.readBigUInt64LE(offset);
    if (type === 0n) break;
    // Linux AT_CLKTCK (auxvec.h): frequency at which times() increments.
    if (type === 17n) ticksPerSecond = Number(auxv.readBigUInt64LE(offset + 8));
  }
  if (!Number.isSafeInteger(ticksPerSecond) || ticksPerSecond <= 0) fail('invalid_proc_clock');
  const pids = (await readdir(procRoot)).filter((entry) => /^[1-9][0-9]*$/.test(entry));
  if (pids.length > 16384) fail('proc_process_bound');
  const number = (value) => {
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) fail('invalid_proc_stat');
    return Number(value);
  };
  const rows = [];
  // Keep simultaneous filesystem reads bounded at higher learner counts.
  for (let offset = 0; offset < pids.length; offset += 32) {
    const chunk = await Promise.all(
      pids.slice(offset, offset + 32).map(async (pid) => {
        let stat;
        try {
          stat = await readFile(join(procRoot, pid, 'stat'), { encoding: 'utf8', signal });
        } catch (error) {
          if (error?.code === 'ENOENT') return null; // A process exited during enumeration.
          throw error;
        }
        const first = stat.indexOf(' (');
        const last = stat.lastIndexOf(') ');
        if (first < 0 || last <= first || stat.slice(0, first) !== pid) fail('invalid_proc_stat');
        const fields = stat
          .slice(last + 2)
          .trim()
          .split(/\s+/);
        if (fields.length < 20 || !/^[RSDZTWtXxKWPIN]$/.test(fields[0])) fail('invalid_proc_stat');
        return {
          pid: number(pid),
          parent: number(fields[1]),
          name: stat.slice(first + 2, last),
          state: fields[0],
          cpuTicks: number(fields[11]) + number(fields[12]),
          startedTicks: number(fields[19]),
        };
      }),
    );
    rows.push(...chunk.filter(Boolean));
  }
  if (!rows.some((row) => row.pid === ownerPid)) fail('missing_proc_owner');
  const owned = new Set([ownerPid]);
  const pending = [ownerPid];
  for (let index = 0; index < pending.length; index++)
    for (const row of rows)
      if (row.parent === pending[index] && !owned.has(row.pid)) {
        owned.add(row.pid);
        pending.push(row.pid);
      }
  const chromium = rows.filter(
    (row) =>
      owned.has(row.pid) &&
      !['Z', 'X', 'x'].includes(row.state) &&
      /^(?:chrome|chromium|headless_shell)(?:$|[-_])/.test(row.name),
  );
  const samples = [];
  for (let offset = 0; offset < chromium.length; offset += 32) {
    const chunk = await Promise.all(
      chromium.slice(offset, offset + 32).map(async (row) => {
        let status;
        try {
          status = await readFile(join(procRoot, String(row.pid), 'status'), {
            encoding: 'utf8',
            signal,
          });
        } catch (error) {
          if (error?.code === 'ENOENT') return null;
          throw error;
        }
        const pid = /^Pid:\s*(\d+)\s*$/m.exec(status);
        const rss = /^VmRSS:\s*(\d+)\s+kB\s*$/m.exec(status);
        if (/^State:\s*[ZXx]\b/m.test(status)) return null; // Exited after the stat read.
        if (!pid || Number(pid[1]) !== row.pid || !rss) fail('invalid_proc_status');
        return { ...row, rssBytes: number(rss[1]) * 1024 };
      }),
    );
    samples.push(...chunk.filter(Boolean));
  }
  const uptime = Number(
    (await readFile(join(procRoot, 'uptime'), { encoding: 'utf8', signal })).trim().split(/\s+/)[0],
  );
  if (!Number.isFinite(uptime) || uptime <= 0) fail('invalid_proc_clock');
  let lifetimeCpuPercentSum = 0;
  for (const sample of samples) {
    const lifetime = uptime - sample.startedTicks / ticksPerSecond;
    if (lifetime <= 0) fail('invalid_proc_clock');
    lifetimeCpuPercentSum += (100 * sample.cpuTicks) / ticksPerSecond / lifetime;
  }
  const rssSumBytes = samples.reduce((sum, sample) => sum + sample.rssBytes, 0);
  if (browserLive && (!samples.length || !rssSumBytes)) fail('missing_owned_chromium');
  return {
    supported: true,
    source: 'linux-procfs',
    scope: 'workload-process-descendants',
    processes: samples.length,
    rssSumBytes,
    lifetimeCpuPercentSum,
    ticksPerSecond,
  };
}

export const SCALE_OPERATIONS = Object.freeze([
  'login',
  'portal',
  'electronics-open',
  'electronics-save',
  'electronics-reload',
  'electronics-outage-save',
  'electronics-offline-edit',
  'electronics-recovery',
  'scratch-open',
  'scratch-save',
  'scratch-reload',
  'scratch-outage-save',
  'scratch-offline-edit',
  'scratch-recovery',
]);

const freeze = (value) => {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
};

// These thresholds are source-controlled before the first workload. No environment
// variable changes the SLO, editor profile or safety floors after seeing a result.
export const SCALE_PROFILE = freeze({
  schemaVersion: 1,
  id: 'P0-CLASSROOM-FULL-UI-V1',
  levels: SCALE_LEVELS,
  calibration: { users: 2, result: 'VALID_FIXTURE', capacityEvidence: false },
  classrooms: {
    maximumSeats: 30,
    distribution: Object.fromEntries(
      [2, ...SCALE_LEVELS].map((users) => [
        users,
        Array.from({ length: Math.ceil(users / 30) }, (_, index) =>
          Math.min(30, users - index * 30),
        ),
      ]),
    ),
    assignment:
      'contiguous independent cohorts; each Seat authenticates with its own classroom join code',
  },
  users: 'independent StudentSeat browser contexts; account control is separate',
  ingress: {
    origin: SCALE_ORIGIN,
    nodeEnv: 'test',
    database: SCALE_DATABASE,
    runtimeRole: 'asalab_app',
    topology: 'owned Docker Web reverse proxy to API; all clients share the same proxy peer/NAT',
    auth: 'actual native UI bot challenge, normal codes/passwords and cookie sessions; no injected identity or privilege',
    enforcementDifference:
      'NODE_ENV=test does not force production Secure cookies or production-only botProof enforcement; no production auth equivalence is claimed',
    admission: 'unchanged application rate/admission limits and RLS; no trusted-source-wide bypass',
    qualification: 'fixed isolated test ingress only; no FRP or public production capacity claim',
  },
  editors: ['electronics', 'scratch'],
  editorConcurrency: 'all N learners in each editor, in separate sequential phases',
  electronics:
    'one resistor-axial placed in the real blank circuit; resistance 1000+10*client+step ohms for steps1,2,3; no wires or simulation load',
  scratch:
    'native Apple library sprite added to the default project; renamed Scale-{client}-{step}, x=(client%80)+step,y=0 for steps1,2,3; actual costume/object-store persistence and native minute autosave; no script blocks added',
  telemetryOutage:
    'native editor reload observes actual telemetry503 before editing; this fault preparation is outside save timing',
  portalDefinition: 'projects navigation to visible usable project list, after login',
  slo: {
    authSuccessRatio: 1,
    saveSuccessRatio: 1,
    unexpected5xx: 0,
    unexpected429: 0,
    portalP95Ms: 2000,
  },
  deadlinesMs: { login: 30000, portal: 15000, editor: 60000, save: 90000, recovery: 90000 },
  healthyObservationMs: 15000,
  maximumHttpObservations: 200000,
  maximumControlObservations: 50000,
  retainedState:
    'fresh owned database per workflow; earlier-level synthetic rows remain, earlier browser contexts are closed',
  setupRetryBudgetMs: 120000,
  setupMaximumRetriesPerOperation: 3,
  offlineMs: 10000,
  levelTimeoutMs: 720000,
  resources: {
    minimumAvailableBytes: 2 * 1024 ** 3,
    minimumAvailableFraction: 0.15,
    minimumDiskBytes: 10 * 1024 ** 3,
    maximumContainerMemoryFraction: 0.85,
    maximumSampleGapMs: 10000,
    driverMemoryLimitBytes: 8 * 1024 ** 3,
  },
  operationNames: SCALE_OPERATIONS,
  server: {
    apiPoolMax: 10,
    apiConnectionTimeoutMs: 5000,
    apiStatementAndQueryTimeoutMs: 15000,
    analyticsPoolMax: 1,
    acquisitionPoolMax: 1,
    uvThreadpoolSize: 8,
    postgres:
      'pinned official image defaults; actual max_connections/shared_buffers/work_mem captured before calibration',
  },
  limitations: [
    'Generator and server share this isolated hosted runner; report generator limitations separately.',
    'A maximum passing tested level is a lower bound for this exact profile, not absolute product capacity.',
    'Loopback/Compose evidence does not qualify Windows, public FRP, VPN or production topology.',
    'Chromium summed RSS may double-count shared pages; safety uses available/cgroup memory.',
  ],
});

export function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonicalJson(value[key]))
        .join(',') +
      '}'
    );
  const result = JSON.stringify(value);
  if (result === undefined || (typeof value === 'number' && !Number.isFinite(value)))
    throw Error('Only finite JSON evidence is allowed');
  return result;
}

export const scaleHash = (value) =>
  createHash('sha256')
    .update(typeof value === 'string' ? value : canonicalJson(value))
    .digest('hex');
export const SCALE_PROFILE_HASH = scaleHash(SCALE_PROFILE);
const sha = (value) => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const digest = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = (value) => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const integer = (value) => Number.isSafeInteger(value) && value >= 0;

/** Validate the resolved Compose configuration, before creating any resources.
 * The ordinary canonical loopback origin policy remains the application guard;
 * the old web:8080-only isolated-origin exception must be unset. Compose model
 * null is not runtime absence; assertScaleApiIngressEnvironment checks the latter.
 * @param {object} config
 * @param {(evidence: object) => void} [recordEvidence] Synchronous durable sink, before rejection.
 */
export function assertScaleIngressConfig(config, recordEvidence, official = false) {
  const networkNames = ['application', 'scratch-runtime', 'database'];
  const requirements = [
    ['services.api.environment.NODE_ENV', 'test'],
    ['services.api.environment.ASA_WEB_PORT', '8080'],
    ['services.api.environment.ASA_WEB_ORIGIN', SCALE_ORIGIN],
    ['services.api.environment.ASA_ISOLATED_TEST_WEB_ORIGIN', 'absent-or-null'],
    ['services.api.environment.ASA_BLOCKS_RUNTIME_ORIGIN', SCALE_ORIGIN],
    official
      ? ['services.web.build', 'absent-or-null']
      : ['services.web.build.args.ASA_BLOCKS_RUNTIME_ORIGIN', SCALE_ORIGIN],
    ['services.web.environment.ASA_BLOCKS_RUNTIME_ORIGIN', SCALE_ORIGIN],
    official
      ? ['services.scratch.build', 'absent-or-null']
      : ['services.scratch.build.args.ASA_BLOCKS_PARENT_ORIGIN', SCALE_ORIGIN],
    ['services.scratch.environment.ASA_BLOCKS_PARENT_ORIGIN', SCALE_ORIGIN],
    ['services.test-runner.environment.ASA_E2E_BASE_URL', SCALE_ORIGIN],
    ['services.test-runner.network_mode', 'service:web'],
    ['services.test-runner.networks', 'empty-or-absent'],
    ['services.web.networks', 'application,scratch-runtime,database'],
  ];
  // Unexpected values can themselves contain credentials. Only these public
  // constants are printable; all other values retain presence/type/match only.
  const publicValues = new Set([
    'test',
    'production',
    'development',
    '',
    '8080',
    8080,
    SCALE_ORIGIN,
    'http://web:8080',
    'http://127.0.0.1:4610',
    'service:web',
    'host',
    'none',
    'bridge',
    null,
    true,
    false,
  ]);
  const fields = requirements.map(([path, expected]) => {
    const parts = path.split('.');
    const key = parts.pop();
    const parent = parts.reduce((value, part) => value?.[part], config);
    const present = parent !== null && typeof parent === 'object' && Object.hasOwn(parent, key);
    const value = present ? parent[key] : undefined;
    const type = !present
      ? 'missing'
      : value === null
        ? 'null'
        : Array.isArray(value)
          ? 'array'
          : typeof value;
    const isNetworks = key === 'networks';
    const names = value && typeof value === 'object' ? Object.keys(value) : [];
    const matches =
      expected === 'absent-or-null'
        ? !present || value === null
        : path === 'services.api.environment.ASA_WEB_PORT'
          ? String(value) === expected
          : path === 'services.test-runner.networks'
            ? !value || Object.keys(value).length === 0
            : path === 'services.web.networks'
              ? networkNames.every((name) => names.includes(name))
              : value === expected;
    return {
      path,
      expected,
      present,
      type,
      matches,
      ...(isNetworks
        ? {
            knownNames: networkNames.filter((name) => names.includes(name)),
            entryCount: names.length,
            otherNameCount: names.filter((name) => !networkNames.includes(name)).length,
          }
        : publicValues.has(value)
          ? { value }
          : present
            ? { redacted: true }
            : {}),
    };
  });
  const mismatches = fields.filter((field) => !field.matches).map((field) => field.path);
  const failure = mismatches.join(', ');
  const valid = mismatches.length === 0;
  const evidence = { schemaVersion: 1, valid, mismatches, fields };
  recordEvidence?.(evidence);
  if (!valid)
    throw Error('Capacity requires its exact owned Web loopback namespace and origin: ' + failure);
  return evidence;
}

/** Fixed public projection; never returns arbitrary environment values. */
export function summarizeScaleApiEnvironment(raw) {
  const validShape = Array.isArray(raw) && raw.every((entry) => typeof entry === 'string');
  const entries = validShape ? raw : [];
  const key = 'ASA_ISOLATED_TEST_WEB_ORIGIN';
  const bare = entries.filter((entry) => entry === key).length;
  const assignedEmpty = entries.filter((entry) => entry === key + '=').length;
  const assignedNonempty = entries.filter(
    (entry) => entry.startsWith(key + '=') && entry !== key + '=',
  ).length;
  const count = bare + assignedEmpty + assignedNonempty;
  return {
    validShape,
    target: {
      count,
      bare,
      assignedEmpty,
      assignedNonempty,
      absent: count === 0,
      duplicate: count > 1,
    },
    fields: [
      ['NODE_ENV', 'test'],
      ['ASA_WEB_PORT', '8080'],
      ['ASA_WEB_ORIGIN', SCALE_ORIGIN],
      ['ASA_BLOCKS_RUNTIME_ORIGIN', SCALE_ORIGIN],
    ].map(([name, expected]) => {
      const values = entries.filter((entry) => entry === name || entry.startsWith(name + '='));
      return {
        key: name,
        expected,
        count: values.length,
        matches: values.length === 1 && values[0] === name + '=' + expected,
      };
    }),
  };
}

// Fixed, read-only builtin program. /proc/<pid>/environ is explicitly startup
// environment, not a claim to read another Node process's current process.env.
// The API has init:true and api-entrypoint.sh execs node dist/main.js in /app.
export const SCALE_API_ENV_PROBE_SCRIPT = `
const fs = require('node:fs');
const path = require('node:path');
const SCALE_ORIGIN = ${JSON.stringify(SCALE_ORIGIN)};
const summarize = ${summarizeScaleApiEnvironment.toString()};
const [containerId, nonce] = process.argv.slice(1);
let stage = 'arguments';
function boundedRead(file, limit) {
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(limit + 1);
  let size = 0;
  try {
    while (size <= limit) {
      const count = fs.readSync(fd, buffer, size, buffer.length - size, null);
      if (!count) return buffer.subarray(0, size);
      size += count;
    }
    throw Error('bound');
  } finally { fs.closeSync(fd); }
}
function nullRecords(file, limit) {
  const bytes = boundedRead(file, limit);
  if (!bytes.length) return [];
  const end = bytes[bytes.length - 1] === 0 ? bytes.length - 1 : bytes.length;
  return bytes.subarray(0, end).toString('utf8').split('\\0');
}
function startTime(pid) {
  const stat = boundedRead('/proc/' + pid + '/stat', 8192).toString('utf8');
  const tail = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\\s+/);
  if (!/^[1-9][0-9]{0,19}$/.test(tail[19] || '')) throw Error('stat');
  return tail[19];
}
function children() {
  const text = boundedRead('/proc/1/task/1/children', 512).toString('utf8').trim();
  const values = text ? text.split(/\\s+/) : [];
  if (!values.length || values.length > 16 || values.some((value) => !/^[1-9][0-9]*$/.test(value))) throw Error('children');
  return values.map(Number);
}
let ownNode;
function isApi(pid) {
  const args = nullRecords('/proc/' + pid + '/cmdline', 8192);
  return args.length === 2 && args[0] === 'node' && args[1] === 'dist/main.js' &&
    fs.readlinkSync('/proc/' + pid + '/cwd') === '/app' &&
    fs.readlinkSync('/proc/' + pid + '/exe') === ownNode;
}
try {
  if (!/^[a-f0-9]{64}$/.test(containerId || '') || !/^[a-f0-9]{32}$/.test(nonce || '')) throw Error('arguments');
  stage = 'pid1-identity';
  ownNode = fs.realpathSync(process.execPath);
  const initExecutable = path.basename(fs.readlinkSync('/proc/1/exe'));
  if (!['docker-init', 'tini'].includes(initExecutable)) throw Error('init');
  const initStart = startTime(1);
  stage = 'api-identity';
  const candidates = [];
  for (const pid of children()) {
    if (pid === process.pid) continue;
    try { if (isApi(pid)) candidates.push(pid); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (candidates.length !== 1) throw Error('ambiguous-api');
  const apiPid = candidates[0];
  const apiStart = startTime(apiPid);
  stage = 'startup-environments';
  const pid1Startup = summarize(nullRecords('/proc/1/environ', 65536));
  const apiStartup = summarize(nullRecords('/proc/' + apiPid + '/environ', 65536));
  stage = 'exec-environment';
  const execEnvironment = summarize(Object.entries(process.env).map(([key, value]) => key + '=' + value));
  const target = 'ASA_ISOLATED_TEST_WEB_ORIGIN';
  const execTargetOwn = Object.hasOwn(process.env, target);
  const execTargetType = typeof process.env[target];
  stage = 'identity-recheck';
  if (startTime(1) !== initStart || startTime(apiPid) !== apiStart || !children().includes(apiPid) || !isApi(apiPid)) throw Error('changed-process');
  process.stdout.write(JSON.stringify({
    schemaVersion: 1, status: 'ok', containerId, nonce, observedAtMs: Date.now(),
    pid1: { pid: 1, executable: initExecutable, startTimeTicks: initStart, startupEnvironment: pid1Startup },
    api: { pid: apiPid, startTimeTicks: apiStart, directChild: true, identityStable: true, startupEnvironment: apiStartup },
    exec: { pid: process.pid, targetOwn: execTargetOwn, targetType: execTargetType, environment: execEnvironment },
  }));
} catch (error) {
  process.stdout.write(JSON.stringify({ schemaVersion: 1, status: 'error', containerId, nonce,
    stage, code: ['EACCES','EPERM','ENOENT'].includes(error.code) ? error.code : 'probe_failed' }));
  process.exitCode = 1;
}
`;

const scaleProbeNonce = (value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const scaleProcessTicks = (value) => typeof value === 'string' && /^[1-9][0-9]{0,19}$/.test(value);

function safeNativeEnvironment(value) {
  const expected = summarizeScaleApiEnvironment([
    'NODE_ENV=test',
    'ASA_WEB_PORT=8080',
    'ASA_WEB_ORIGIN=' + SCALE_ORIGIN,
    'ASA_BLOCKS_RUNTIME_ORIGIN=' + SCALE_ORIGIN,
  ]);
  const target = Object.fromEntries(
    ['count', 'bare', 'assignedEmpty', 'assignedNonempty'].map((key) => [
      key,
      integer(value?.target?.[key]) ? value.target[key] : null,
    ]),
  );
  const fields = expected.fields.map((field, index) => ({
    key: field.key,
    count: integer(value?.fields?.[index]?.count) ? value.fields[index].count : null,
    matches:
      value?.fields?.[index]?.key === field.key &&
      value.fields[index].expected === field.expected &&
      value.fields[index].count === 1 &&
      value.fields[index].matches === true,
  }));
  return {
    valid:
      value?.validShape === true &&
      value?.target?.absent === true &&
      value.target.duplicate === false &&
      Object.values(target).every((count) => count === 0) &&
      Array.isArray(value?.fields) &&
      value.fields.length === 4 &&
      fields.every((field) => field.matches),
    target,
    fields,
  };
}

/** Ownership is checked by the controller before and after the bounded exec.
 * Even absent metadata requires a fresh, matching actual-process observation.
 * @param {object} metadata
 * @param {object} [proof]
 * @param {(evidence: object) => void} [recordEvidence]
 */
export function assertScaleApiIngressEnvironment(metadata, proof, recordEvidence) {
  const environment = summarizeScaleApiEnvironment(metadata?.Config?.Env);
  const containerId = digest(metadata?.Id) ? metadata.Id : null;
  const apiService = metadata?.Config?.Labels?.['com.docker.compose.service'] === 'api';
  const result = proof?.result;
  const after = proof?.after;
  const nonceMatches = scaleProbeNonce(proof?.nonce) && result?.nonce === proof.nonce;
  const sameContainer =
    containerId !== null &&
    result?.containerId === containerId &&
    after?.Id === containerId &&
    metadata.State?.Running === true &&
    after.State?.Running === true &&
    typeof metadata.State.StartedAt === 'string' &&
    Number.isFinite(Date.parse(metadata.State.StartedAt)) &&
    after.State.StartedAt === metadata.State.StartedAt &&
    integer(metadata.RestartCount) &&
    after.RestartCount === metadata.RestartCount &&
    metadata.HostConfig?.Init === true &&
    after.HostConfig?.Init === true &&
    [
      'com.docker.compose.project',
      'io.asalab.scale.run',
      'com.docker.compose.project.working_dir',
      'com.docker.compose.service',
    ].every(
      (key) =>
        typeof metadata.Config?.Labels?.[key] === 'string' &&
        metadata.Config.Labels[key].length > 0 &&
        after.Config?.Labels?.[key] === metadata.Config.Labels[key],
    );
  const fresh =
    integer(proof?.requestedAtMs) &&
    integer(proof?.completedAtMs) &&
    integer(result?.observedAtMs) &&
    proof.completedAtMs >= proof.requestedAtMs &&
    proof.completedAtMs - proof.requestedAtMs <= 5000 &&
    result.observedAtMs >= proof.requestedAtMs &&
    result.observedAtMs <= proof.completedAtMs;
  const pid1 = safeNativeEnvironment(result?.pid1?.startupEnvironment);
  const api = safeNativeEnvironment(result?.api?.startupEnvironment);
  const exec = safeNativeEnvironment(result?.exec?.environment);
  const nativeIdentity =
    result?.schemaVersion === 1 &&
    result?.status === 'ok' &&
    result?.pid1?.pid === 1 &&
    ['docker-init', 'tini'].includes(result?.pid1?.executable) &&
    scaleProcessTicks(result?.pid1?.startTimeTicks) &&
    integer(result?.api?.pid) &&
    result.api.pid > 1 &&
    scaleProcessTicks(result?.api?.startTimeTicks) &&
    result.api.directChild === true &&
    result.api.identityStable === true &&
    integer(result?.exec?.pid) &&
    result.exec.pid > 1 &&
    result.exec.pid !== result.api.pid &&
    result.exec.targetOwn === false &&
    result.exec.targetType === 'undefined';
  const metadataUnset =
    environment.target.count === 0 ||
    (environment.target.count === 1 && environment.target.bare === 1);
  const mismatches = [
    ...(!containerId ? ['Id'] : []),
    ...(!apiService ? ['Config.Labels.com.docker.compose.service'] : []),
    ...(!environment.validShape ? ['Config.Env'] : []),
    ...(!metadataUnset ? ['Config.Env.ASA_ISOLATED_TEST_WEB_ORIGIN'] : []),
    ...environment.fields
      .filter((field) => !field.matches)
      .map((field) => 'Config.Env.' + field.key),
    ...(!nonceMatches ? ['probe.nonce'] : []),
    ...(!sameContainer ? ['probe.container'] : []),
    ...(!fresh ? ['probe.freshness'] : []),
    ...(!nativeIdentity ? ['probe.processIdentity'] : []),
    ...(!pid1.valid ? ['probe.pid1Startup'] : []),
    ...(!api.valid ? ['probe.apiStartup'] : []),
    ...(!exec.valid ? ['probe.execEnvironment'] : []),
    ...(proof?.transport !== 'completed' ? ['probe.transport'] : []),
  ];
  const failure = mismatches.join(', ');
  const valid = mismatches.length === 0;
  const evidence = {
    schemaVersion: 2,
    valid,
    containerId,
    apiService,
    validEnvironmentShape: environment.validShape,
    isolatedKeyCount: environment.target.count,
    targetForms: environment.target,
    fields: environment.fields,
    probe: {
      scriptSha256: scaleHash(SCALE_API_ENV_PROBE_SCRIPT),
      nonceMatches,
      sameContainer,
      fresh,
      nativeIdentity,
      nonce: scaleProbeNonce(proof?.nonce) ? proof.nonce : null,
      observedNonce: scaleProbeNonce(result?.nonce) ? result.nonce : null,
      requestedAtMs: integer(proof?.requestedAtMs) ? proof.requestedAtMs : null,
      completedAtMs: integer(proof?.completedAtMs) ? proof.completedAtMs : null,
      transport: ['completed', 'exec_failed', 'parse_failed', 'inspect_failed'].includes(
        proof?.transport,
      )
        ? proof.transport
        : 'missing-or-invalid',
      errorStage: [
        'arguments',
        'pid1-identity',
        'api-identity',
        'startup-environments',
        'exec-environment',
        'identity-recheck',
      ].includes(result?.stage)
        ? result.stage
        : null,
      errorCode: ['EACCES', 'EPERM', 'ENOENT', 'probe_failed'].includes(result?.code)
        ? result.code
        : null,
      completed: proof?.transport === 'completed',
      pid1Startup: pid1,
      apiStartup: api,
      execEnvironment: exec,
      observedAtMs: integer(result?.observedAtMs) ? result.observedAtMs : null,
      apiPid: integer(result?.api?.pid) ? result.api.pid : null,
      observedContainerId: digest(result?.containerId) ? result.containerId : null,
      afterContainerId: digest(after?.Id) ? after.Id : null,
      pid1Pid: integer(result?.pid1?.pid) ? result.pid1.pid : null,
      pid1Executable: ['docker-init', 'tini'].includes(result?.pid1?.executable)
        ? result.pid1.executable
        : null,
      apiDirectChild: typeof result?.api?.directChild === 'boolean' ? result.api.directChild : null,
      apiIdentityStable:
        typeof result?.api?.identityStable === 'boolean' ? result.api.identityStable : null,
      execPid: integer(result?.exec?.pid) ? result.exec.pid : null,
      execTargetOwn: typeof result?.exec?.targetOwn === 'boolean' ? result.exec.targetOwn : null,
      execTargetType: ['undefined', 'string'].includes(result?.exec?.targetType)
        ? result.exec.targetType
        : null,
      pid1StartTimeTicks: scaleProcessTicks(result?.pid1?.startTimeTicks)
        ? result.pid1.startTimeTicks
        : null,
      apiStartTimeTicks: scaleProcessTicks(result?.api?.startTimeTicks)
        ? result.api.startTimeTicks
        : null,
    },
    mismatches,
  };
  recordEvidence?.(evidence);
  if (!valid) throw Error('Owned API runtime ingress environment mismatch: ' + failure);
  return evidence;
}

/** This is used only after the controller has checked both containers' project,
 * run-token and working-directory labels. A service name alone is not proof. */
export function assertScaleDriverNetwork(driver, web) {
  if (
    !/^[a-f0-9]{64}$/.test(driver?.Id || '') ||
    !/^[a-f0-9]{64}$/.test(web?.Id || '') ||
    driver.Id === web.Id ||
    driver.HostConfig?.NetworkMode !== 'container:' + web.Id ||
    Object.keys(driver.NetworkSettings?.Networks || {}).length
  )
    throw Error('Browser runner does not share the exact owned Web network namespace');
  return { driverId: driver.Id, webId: web.Id, networkMode: driver.HostConfig.NetworkMode };
}

/** The browser computes the digest itself in the actual top document/iframe.
 * A trustworthy-looking URL or Node-side crypto availability is insufficient. */
export function assertScaleSecureContext(proof) {
  if (
    !proof ||
    !['top', 'scratch'].includes(proof.context) ||
    proof.origin !== SCALE_ORIGIN ||
    proof.isSecureContext !== true ||
    proof.hasSubtle !== true ||
    proof.topLevel !== (proof.context === 'top') ||
    proof.sha256 !== scaleHash(SCALE_CRYPTO_CHALLENGE) ||
    proof.error !== null
  )
    throw Error('Actual browser secure context and SHA-256 are required');
}

export function validateScaleSecureContexts(proofs, users) {
  if (!Array.isArray(proofs) || proofs.length > 1 + users * 8)
    throw Error('Missing or unbounded browser secure-context evidence');
  for (const proof of proofs) {
    assertScaleSecureContext(proof);
    if (
      !Number.isSafeInteger(proof.client) ||
      proof.client < -1 ||
      proof.client >= users ||
      !finite(proof.atMs)
    )
      throw Error('Invalid browser secure-context attribution');
  }
  if (
    !proofs.some(
      (proof) => proof.client === -1 && proof.context === 'top' && proof.stage === 'setup',
    )
  )
    throw Error('Missing early secure-context prerequisite');
  for (let client = 0; client < users; client++)
    for (const [context, stage] of [
      ['top', 'seat-entry'],
      ['scratch', 'scratch-open'],
    ])
      if (
        !proofs.some(
          (proof) => proof.client === client && proof.context === context && proof.stage === stage,
        )
      )
        throw Error('Every learner requires actual top-page and Scratch-frame crypto evidence');
}

export const SCALE_SERVICE_WORKER_PROBE_PATH = '/__asa_scale_service_worker_probe__.js';
export const SCALE_SERVICE_WORKER_MARKER = '__asaScaleServiceWorkerBlocker';

/** Serialized unchanged into context.addInitScript before any page exists.
 * Playwright 1.55.1's built-in blocker reads this getter without handling the
 * native opaque-sandbox denial. No pageerror is filtered by this replacement. */
export function installScaleServiceWorkerBlocker(contextId) {
  const realm = globalThis;
  const marker = '__asaScaleServiceWorkerBlocker';
  let state = 'unavailable';
  let blockedRegistrations = 0;
  let container;
  try {
    container = realm.navigator.serviceWorker;
  } catch (error) {
    if (
      !(error instanceof realm.DOMException) ||
      error.name !== 'SecurityError' ||
      error.message !==
        "Failed to read the 'serviceWorker' property from 'Navigator': Service worker is disabled because the context is sandboxed and lacks the 'allow-same-origin' flag." ||
      realm.origin !== 'null' ||
      realm.top === realm
    )
      throw error;
    // This document already has a native registration prohibition. Do not
    // change its origin, sandbox or navigator getter to make it accessible.
    state = 'opaque-denied';
  }
  const prototype = container && realm.ServiceWorkerContainer?.prototype;
  const blocked = async () => {
    blockedRegistrations++;
    // Match Playwright's fulfilled-undefined registration blocker.
  };
  if (container) {
    if (typeof container.register !== 'function' || typeof prototype?.register !== 'function')
      throw Error('Service worker registration surface is unavailable');
    for (const target of [prototype, container])
      Object.defineProperty(target, 'register', {
        value: blocked,
        writable: false,
        configurable: false,
      });
    state = 'blocked';
  }
  Object.defineProperty(realm, marker, {
    configurable: false,
    writable: false,
    value: () => ({
      version: 1,
      contextId,
      state,
      blockedRegistrations,
      instanceBlocked: Boolean(container && container.register === blocked),
      prototypeBlocked: Boolean(prototype && prototype.register === blocked),
    }),
  });
}

export function assertScaleServiceWorkerProof(proof) {
  if (
    !proof ||
    proof.origin !== SCALE_ORIGIN ||
    !['top', 'scratch'].includes(proof.context) ||
    proof.topLevel !== (proof.context === 'top') ||
    !finite(proof.atMs) ||
    typeof proof.stage !== 'string' ||
    !proof.stage ||
    proof.version !== 1 ||
    proof.state !== 'blocked' ||
    proof.instanceBlocked !== true ||
    proof.prototypeBlocked !== true ||
    proof.interceptedCalls !== 2 ||
    !integer(proof.blockedRegistrations) ||
    proof.blockedRegistrations < 2 ||
    proof.fulfilledUndefined !== true ||
    proof.registrationCount !== 0 ||
    proof.hasController !== false
  )
    throw Error('Actual document service worker registration blocking is unproven');
}

export function validateScaleServiceWorkers(contexts, users) {
  if (
    !Array.isArray(contexts) ||
    contexts.length !== users + 2 ||
    new Set(contexts.map((context) => context.client)).size !== users + 2 ||
    new Set(contexts.map((context) => context.contextId)).size !== users + 2
  )
    throw Error('Every actor requires its own service worker lifetime evidence');
  for (const context of contexts) {
    if (
      !Number.isSafeInteger(context.client) ||
      context.client < -2 ||
      context.client >= users ||
      typeof context.contextId !== 'string' ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        context.contextId,
      ) ||
      context.installedBeforePages !== true ||
      !finite(context.preparedAtMs) ||
      !finite(context.finalizedAtMs) ||
      context.finalizedAtMs < context.preparedAtMs ||
      context.initialWorkers !== 0 ||
      context.finalWorkers !== 0 ||
      context.workerEvents !== 0 ||
      context.observedWorkerRequests !== 0 ||
      context.probeRequests !== 0 ||
      !Array.isArray(context.proofs) ||
      !context.proofs.length ||
      context.proofs.length > SCALE_PROFILE.maximumHttpObservations
    )
      throw Error('Service worker escaped the fixture or lifetime evidence is incomplete');
    for (const proof of context.proofs) {
      assertScaleServiceWorkerProof(proof);
      if (
        proof.contextId !== context.contextId ||
        proof.client !== context.client ||
        proof.atMs < context.preparedAtMs ||
        proof.atMs > context.finalizedAtMs
      )
        throw Error('Service worker proof is outside its actor lifetime');
    }
    const required =
      context.client === -1
        ? [['top', 'setup']]
        : context.client === -2
          ? [
              ['top', 'account-entry'],
              ['top', 'account-reload'],
            ]
          : [
              ['top', 'seat-entry'],
              ['scratch', 'scratch-open'],
            ];
    for (const [kind, stage] of required)
      if (!context.proofs.some((proof) => proof.context === kind && proof.stage === stage))
        throw Error('Fresh actor/document service worker proof is missing');
  }
}

const protocolId = (value) => typeof value === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(value);
const samePage = (failure, window) =>
  failure.client === window.client && failure.pageId === window.pageId;
const completedWindow = (window) =>
  integer(window.id) &&
  window.completed === true &&
  finite(window.startedAtMs) &&
  finite(window.endedAtMs) &&
  window.endedAtMs >= window.startedAtMs;
const reloadTelemetry = new Set([
  '/api/analytics/v2/module-session',
  '/api/analytics/v2/quality',
  '/api/diagnostics/quality',
]);

/** Classify from passive protocol evidence and completed, harness-owned actions.
 * Phase labels and the old navigationWindow boolean cannot grant an exception. */
export function classifyScaleNetworkFailure(failure, navigationWindows, offlineWindows) {
  const result = (reason, boundaryId = null) => ({
    expected: reason !== 'unexpected_network_failure',
    reason,
    boundaryId,
  });
  if (failure.error === 'net::ERR_INTERNET_DISCONNECTED') {
    const matches = offlineWindows.filter(
      (window) =>
        samePage(failure, window) &&
        completedWindow(window) &&
        window.offlineApplied === true &&
        window.onlineAcknowledged === true &&
        finite(window.appliedAtMs) &&
        finite(window.onlineRequestedAtMs) &&
        window.startedAtMs <= window.appliedAtMs &&
        window.appliedAtMs <= window.onlineRequestedAtMs &&
        window.onlineRequestedAtMs <= window.endedAtMs &&
        failure.startedAtMs <= window.endedAtMs &&
        failure.failedAtMs >= window.startedAtMs,
    );
    if (matches.length === 1) return result('deliberate_context_offline', matches[0].id);
  }
  if (failure.error === 'net::ERR_ABORTED' && failure.canceled === true) {
    const matches = navigationWindows.filter(
      (window) =>
        samePage(failure, window) &&
        completedWindow(window) &&
        failure.failedAtMs >= window.startedAtMs &&
        failure.failedAtMs <= window.endedAtMs,
    );
    if (matches.length === 1) {
      const window = matches[0];
      if (['GET', 'HEAD'].includes(failure.method))
        return result('explicit_native_navigation', window.id);
      if (
        failure.method === 'POST' &&
        reloadTelemetry.has(failure.route) &&
        ['native-reload-electronics', 'native-reload-scratch'].includes(window.action) &&
        failure.startedAtMs >= window.startedAtMs &&
        failure.redirected === false &&
        protocolId(failure.requestId) &&
        protocolId(window.previousLoaderId) &&
        protocolId(window.frameId) &&
        protocolId(window.committedLoaderId) &&
        window.commits === 1 &&
        window.previousLoaderId !== window.committedLoaderId &&
        finite(window.committedAtMs) &&
        window.committedAtMs >= window.startedAtMs &&
        window.committedAtMs <= window.endedAtMs &&
        failure.frameId === window.frameId &&
        failure.loaderId === window.previousLoaderId
      )
        return result('explicit_native_reload_telemetry', window.id);
    }
  }
  return result('unexpected_network_failure');
}

/** Playwright failures are retained independently. Compare per-page multisets,
 * not one global count: duplicate identical failures are still counted, while
 * missing/extra/foreign-page CDP events cannot manufacture complete evidence. */
export function summarizeScaleNetworkEvidence(raw) {
  for (const key of [
    'networkFailures',
    'playwrightNetworkFailures',
    'navigationWindows',
    'offlineWindows',
  ])
    if (!Array.isArray(raw[key]) || raw[key].length > SCALE_PROFILE.maximumHttpObservations)
      throw Error('Missing or unbounded browser network evidence');
  const multiset = (failures) => {
    const counts = new Map();
    for (const failure of failures) {
      if (
        !integer(failure.client) ||
        failure.client >= raw.users ||
        !integer(failure.pageId) ||
        typeof failure.method !== 'string' ||
        typeof failure.route !== 'string' ||
        typeof failure.error !== 'string'
      )
        throw Error('Unattributed browser network failure');
      const key = JSON.stringify([
        failure.client,
        failure.pageId,
        failure.method,
        failure.route,
        failure.error,
      ]);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return canonicalJson([...counts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  };
  if (multiset(raw.networkFailures) !== multiset(raw.playwrightNetworkFailures))
    throw Error('Playwright and passive CDP failure observations disagree');
  const seen = new Set();
  const counts = {
    failures: raw.networkFailures.length,
    playwrightFailures: raw.playwrightNetworkFailures.length,
    expectedNavigationAborts: 0,
    expectedReloadTelemetryAborts: 0,
    expectedOfflineFailures: 0,
    unexpectedFailures: 0,
  };
  for (const failure of raw.networkFailures) {
    const key = failure.pageId + ':' + failure.requestId;
    if (
      !protocolId(failure.requestId) ||
      seen.has(key) ||
      !finite(failure.startedAtMs) ||
      !finite(failure.failedAtMs) ||
      failure.failedAtMs < failure.startedAtMs ||
      typeof failure.canceled !== 'boolean'
    )
      throw Error('Missing or ambiguous protocol request witness');
    seen.add(key);
    const classified = classifyScaleNetworkFailure(
      failure,
      raw.navigationWindows,
      raw.offlineWindows,
    );
    if (
      failure.expected === true &&
      (!classified.expected ||
        failure.reason !== classified.reason ||
        failure.boundaryId !== classified.boundaryId)
    )
      throw Error('A generic network failure was incorrectly exempted');
    if (failure.expected !== true) counts.unexpectedFailures++;
    else if (classified.reason === 'deliberate_context_offline') counts.expectedOfflineFailures++;
    else if (classified.reason === 'explicit_native_reload_telemetry')
      counts.expectedReloadTelemetryAborts++;
    else counts.expectedNavigationAborts++;
  }
  return counts;
}

export function assertScaleEnvironment(env, browser = false) {
  if (
    env.GITHUB_ACTIONS !== 'true' ||
    env.GITHUB_REPOSITORY !== 'spikeal8-maker/asa-lab' ||
    env.RUNNER_ENVIRONMENT !== 'github-hosted' ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') ||
    !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') ||
    !sha(env.ASA_SCALE_SHA) ||
    !/^[a-f0-9]{32}$/.test(env.ASA_SCALE_RUN_TOKEN || '') ||
    env.ASA_SCALE_PROFILE_HASH !== SCALE_PROFILE_HASH ||
    env.DOCKER_HOST ||
    env.DOCKER_CONTEXT
  )
    throw Error('Explicit exact-source hosted GitHub capacity fixture required');
  if (browser) {
    if (env.ASA_E2E_EXTERNAL !== 'true' || env.ASA_E2E_BASE_URL !== SCALE_ORIGIN)
      throw Error('Capacity browser requires the owned Compose Web origin');
    for (const key of ['TEST_DATABASE_URL', 'APP_TEST_DATABASE_URL']) {
      const url = new URL(env[key] || '');
      if (
        !['postgres:', 'postgresql:'].includes(url.protocol) ||
        url.hostname !== 'postgres' ||
        (url.port && url.port !== '5432') ||
        url.pathname !== '/' + SCALE_DATABASE ||
        url.search ||
        url.hash ||
        url.username !== (key === 'TEST_DATABASE_URL' ? 'postgres' : 'asalab_app')
      )
        throw Error('Capacity browser only accepts its isolated test database');
    }
    const mode = env.ASA_SCALE_MODE;
    if (
      !['capacity', 'calibration'].includes(mode) ||
      (mode === 'calibration'
        ? Number(env.ASA_SCALE_USERS) !== 2
        : !SCALE_LEVELS.includes(Number(env.ASA_SCALE_USERS)))
    )
      throw Error('Unknown capacity/calibration level');
  }
  const official = env.ASA_SCALE_OFFICIAL === 'true';
  if (official) {
    assertOfficialScaleDispatch(env);
    if (
      !['baseline', 'after'].includes(env.ASA_SCALE_VARIANT) ||
      env.ASA_SCALE_RELEASE_SHA !== env.ASA_SCALE_SHA ||
      !/^sha256:[a-f0-9]{64}$/.test(env.ASA_SCALE_DEPLOYMENT_DIGEST || '') ||
      (browser && Number(env.ASA_SCALE_USERS) !== (env.ASA_SCALE_MODE === 'calibration' ? 2 : 30))
    )
      throw Error('Official capacity requires an independent release identity and only N30');
  }
  return {
    schemaVersion: 1,
    sourceSha: env.ASA_SCALE_SHA,
    runId: env.GITHUB_RUN_ID,
    attempt: Number(env.GITHUB_RUN_ATTEMPT),
    runToken: env.ASA_SCALE_RUN_TOKEN,
    profileHash: SCALE_PROFILE_HASH,
    ...(official
      ? {
          harnessSha: env.ASA_SCALE_HARNESS_SHA,
          releaseSha: env.ASA_SCALE_RELEASE_SHA,
          deploymentDigest: env.ASA_SCALE_DEPLOYMENT_DIGEST,
          variant: env.ASA_SCALE_VARIANT,
        }
      : {}),
  };
}

export function assertScaleDockerContext(value) {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0]?.Name !== 'default' ||
    value[0]?.Endpoints?.docker?.Host !== 'unix:///var/run/docker.sock'
  )
    throw Error('Capacity Docker must be the hosted runner local default socket');
}

export function assertScaleImages(images, sourceSha) {
  if (!sha(sourceSha)) throw Error('Invalid source revision');
  for (const service of ['api', 'web', 'scratch']) {
    const image = images.find((item) => item.service === service);
    if (!image || !/^sha256:[a-f0-9]{64}$/.test(image.id || '') || image.revision !== sourceSha)
      throw Error('Missing or mixed exact-source production image: ' + service);
  }
  if (new Set(images.map((item) => item.service)).size !== images.length)
    throw Error('Duplicate image service evidence');
  return scaleHash(images);
}

export function assertPriorScaleLevels(previous, users, identity) {
  const index = SCALE_LEVELS.indexOf(users);
  if (index < 0 || previous.length !== index)
    throw Error('Capacity levels cannot be skipped or repeated');
  previous.forEach((receipt, position) => {
    if (receipt.users !== SCALE_LEVELS[position] || receipt.status !== 'PASS')
      throw Error('Previous capacity level is not fully confirmed');
    for (const key of [
      'sourceSha',
      'runId',
      'attempt',
      'runToken',
      'profileHash',
      'environmentHash',
      'imageManifestHash',
    ])
      if (!identity[key] || receipt[key] !== identity[key])
        throw Error('Stale or mixed previous level receipt: ' + key);
  });
}

export function createScaleLedger(users, calibration = false) {
  if (calibration ? users !== 2 : !SCALE_LEVELS.includes(users))
    throw Error('Unknown capacity level');
  return SCALE_OPERATIONS.flatMap((name) =>
    Array.from({ length: users }, (_, client) => ({
      id: name + ':' + client,
      client,
      name,
      status: 'NOT_STARTED',
      startedAtMs: null,
      endedAtMs: null,
      durationMs: null,
      attempts: 0,
    })),
  );
}

/** @returns {{cohort: number, planned: number, clients: number[]}[]} */
export function scaleCohortPlan(users, calibration = false) {
  if (calibration ? users !== 2 : !SCALE_LEVELS.includes(users))
    throw Error('Unknown classroom cohort level');
  const distribution = SCALE_PROFILE.classrooms.distribution[users];
  let first = 0;
  return distribution.map((planned, cohort) => {
    const result = {
      cohort,
      planned,
      clients: Array.from({ length: planned }, (_, offset) => first + offset),
    };
    first += planned;
    return result;
  });
}

export function scaleQuantiles(values) {
  if (values.some((value) => !finite(value))) throw Error('Non-finite latency evidence');
  const sorted = [...values].sort((a, b) => a - b);
  const at = (q) =>
    sorted.length ? Math.round(sorted[Math.ceil(sorted.length * q) - 1] * 100) / 100 : null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99) };
}

export const scaleIsSave = (name) => name.endsWith('-save') || name.endsWith('-recovery');
export const scaleNeedsReadback = (name) => scaleIsSave(name) || name.endsWith('-reload');

function validateLedger(operations, users, calibration) {
  const expected = createScaleLedger(users, calibration);
  if (
    !Array.isArray(operations) ||
    operations.length !== expected.length ||
    new Set(operations.map((operation) => operation.id)).size !== expected.length
  )
    throw Error('Every planned operation must remain in the denominator');
  const byId = new Map(operations.map((operation) => [operation.id, operation]));
  for (const planned of expected) {
    const operation = byId.get(planned.id);
    if (
      !operation ||
      operation.client !== planned.client ||
      operation.name !== planned.name ||
      !['NOT_STARTED', 'STARTED', 'ACKNOWLEDGED', 'VERIFIED', 'FAILED', 'TIMED_OUT'].includes(
        operation.status,
      ) ||
      !integer(operation.attempts)
    )
      throw Error('Invalid operation ledger');
    if (operation.status === 'VERIFIED') {
      if (
        !finite(operation.startedAtMs) ||
        !finite(operation.endedAtMs) ||
        !finite(operation.durationMs) ||
        operation.endedAtMs < operation.startedAtMs ||
        operation.attempts < 1 ||
        Math.abs(operation.endedAtMs - operation.startedAtMs - operation.durationMs) > 2
      )
        throw Error('Verified operation lacks coherent timing');
      if (scaleNeedsReadback(operation.name)) {
        const proof = operation.verification;
        if (
          !proof ||
          proof.kind !== 'independent-authenticated-api-readback' ||
          proof.httpStatus !== 200 ||
          proof.identityMatched !== true ||
          !digest(proof.expectedContentHash) ||
          proof.expectedContentHash !== proof.actualContentHash ||
          !digest(proof.documentHash) ||
          !integer(proof.revisionBefore) ||
          !integer(proof.revisionAfter) ||
          proof.revisionAfter < proof.revisionBefore ||
          (scaleIsSave(operation.name) &&
            (proof.revisionAfter <= proof.revisionBefore || proof.changeObserved !== true))
        )
          throw Error(
            'Save/reload success requires independent identity/content/revision evidence',
          );
      }
    }
  }
  return expected.map((planned) => byId.get(planned.id));
}

export function readScaleMemInfo(text) {
  const read = (key) => {
    const match = String(text).match(new RegExp('^' + key + ':\\s+(\\d+) kB$', 'm'));
    if (!match) throw Error('Missing Linux memory observation: ' + key);
    return Number(match[1]) * 1024;
  };
  const totalBytes = read('MemTotal');
  const availableBytes = read('MemAvailable');
  if (totalBytes <= 0 || availableBytes > totalBytes)
    throw Error('Invalid Linux memory observation');
  return { totalBytes, availableBytes };
}

export function scaleResourceViolation(sample) {
  if (
    !finite(sample.atMs) ||
    !finite(sample.totalBytes) ||
    sample.totalBytes <= 0 ||
    !finite(sample.availableBytes) ||
    sample.availableBytes > sample.totalBytes ||
    !finite(sample.diskFreeBytes)
  )
    throw Error('Missing or invalid runner resource evidence');
  if (
    sample.availableBytes <
    Math.max(
      SCALE_PROFILE.resources.minimumAvailableBytes,
      sample.totalBytes * SCALE_PROFILE.resources.minimumAvailableFraction,
    )
  )
    return 'runner_memory_floor';
  if (sample.diskFreeBytes < SCALE_PROFILE.resources.minimumDiskBytes) return 'runner_disk_floor';
  for (const container of sample.containers || []) {
    if (
      !finite(container.memoryBytes) ||
      !finite(container.memoryLimitBytes) ||
      !integer(container.oomKills) ||
      !integer(container.restarts)
    )
      throw Error('Invalid container observation');
    if (container.oomKills || container.restarts) return 'owned_container_oom_or_restart';
    if (
      container.memoryLimitBytes > 0 &&
      container.memoryBytes / container.memoryLimitBytes >
        SCALE_PROFILE.resources.maximumContainerMemoryFraction
    )
      return 'owned_container_memory_floor';
  }
  return null;
}

export function validateScaleAssets(provenance, expected) {
  if (
    !provenance ||
    provenance.sourceSha !== expected.sourceSha ||
    provenance.imageManifestHash !== expected.imageManifestHash ||
    !Array.isArray(provenance.assets)
  )
    throw Error('Exact served image/source evidence is required');
  for (const service of ['web', 'scratch']) {
    const assets = provenance.assets.filter(
      (asset) => asset.service === service && asset.path.endsWith('.js'),
    );
    if (
      !assets.length ||
      assets.some(
        (asset) =>
          asset.executed !== true ||
          !digest(asset.expectedHash) ||
          asset.expectedHash !== asset.actualHash ||
          !integer(asset.bytes) ||
          asset.bytes === 0 ||
          !asset.path.startsWith('/'),
      )
    )
      throw Error('Served ' + service + ' bytes differ from the inspected image');
  }
}

export function summarizeScaleRequests(requests, elapsedMs, users) {
  if (!Array.isArray(requests) || !finite(elapsedMs) || elapsedMs <= 0)
    throw Error('Invalid HTTP evidence');
  const measured = requests.filter((record) => record.client >= 0 && record.client < users);
  for (const record of measured)
    if (
      !integer(record.status) ||
      !finite(record.durationMs) ||
      !finite(record.startedAtMs) ||
      typeof record.injected !== 'boolean' ||
      typeof record.completed !== 'boolean' ||
      typeof record.phase !== 'string' ||
      typeof record.route !== 'string'
    )
      throw Error('Malformed HTTP observation');
  const injected = measured.filter((record) => record.injected);
  if (
    injected.some(
      (record) =>
        record.status !== 503 ||
        !record.phase.includes('telemetry-outage') ||
        !/^\/api\/(analytics|diagnostics)\//.test(record.route),
    )
  )
    throw Error('Unexpected response cannot be relabelled as injected');
  const ordinary = measured.filter((record) => !record.injected);
  const healthy = ordinary.filter(
    (record) =>
      record.completed &&
      record.status >= 200 &&
      record.status < 400 &&
      record.route.startsWith('/api/') &&
      !/offline|recovery|telemetry-outage/.test(record.phase) &&
      !/^\/api\/(analytics|diagnostics)\//.test(record.route),
  );
  const byPhase = {};
  for (const record of measured) byPhase[record.phase] = (byPhase[record.phase] || 0) + 1;
  return {
    requests: measured.length,
    requestsPerSecond: (measured.length * 1000) / elapsedMs,
    requestsPerClient: measured.length / users,
    apiRequests: measured.filter((record) => record.route.startsWith('/api/')).length,
    staticRequests: measured.filter((record) => !record.route.startsWith('/api/')).length,
    notificationRequests: measured.filter((record) =>
      /^\/api\/games\/(chess|checkers)\/notifications$/.test(record.route),
    ).length,
    diagnosticRequests: measured.filter((record) => /^\/api\/diagnostics\//.test(record.route))
      .length,
    injected503: injected.length,
    unexpected5xx: ordinary.filter((record) => record.status >= 500).length,
    unexpected429: ordinary.filter((record) => record.status === 429).length,
    incomplete: measured.filter((record) => !record.completed).length,
    healthyProductLatencyMs: scaleQuantiles(healthy.map((record) => record.durationMs)),
    healthyProductFilter:
      'completed HTTP2xx/3xx under /api/, excluding analytics/diagnostics and phases containing offline/recovery/telemetry-outage',
    wholeNonInjectedLatencyMs: scaleQuantiles(ordinary.map((record) => record.durationMs)),
    byPhase,
  };
}

function evaluateScaleWorkload(raw, identity, resources, calibration) {
  const receipt = {
    ...identity,
    schemaVersion: 1,
    users: raw?.users,
    status: 'INVALID',
    reasons: [],
  };
  try {
    if (
      !raw ||
      raw.schemaVersion !== 1 ||
      raw.sourceSha !== identity.sourceSha ||
      raw.profileHash !== SCALE_PROFILE_HASH ||
      raw.runToken !== identity.runToken ||
      raw.mode !== (calibration ? 'calibration' : 'capacity') ||
      (calibration ? raw.users !== 2 : !SCALE_LEVELS.includes(raw.users))
    )
      throw Error('Wrong workload identity');
    if (
      identity.harnessSha &&
      ['harnessSha', 'releaseSha', 'deploymentDigest', 'variant'].some(
        (key) => raw[key] !== identity[key],
      )
    )
      throw Error('Wrong official harness or release identity');
    const operations = validateLedger(raw.operations, raw.users, calibration);
    receipt.operations = Object.fromEntries(
      SCALE_OPERATIONS.map((name) => {
        const group = operations.filter((operation) => operation.name === name);
        const verified = group.filter((operation) => operation.status === 'VERIFIED');
        return [
          name,
          {
            planned: raw.users,
            started: group.filter((operation) => operation.attempts > 0).length,
            verified: verified.length,
            successRatio: verified.length / raw.users,
            latencyMs: scaleQuantiles(verified.map((operation) => operation.durationMs)),
          },
        ];
      }),
    );
    if (raw.integrityFailures?.length) {
      receipt.status = 'FAIL';
      receipt.reasons.push('document_or_identity_integrity_failure');
      return receipt;
    }
    if (!Array.isArray(resources) || !resources.length) throw Error('No runner resource samples');
    const violations = resources.map(scaleResourceViolation).filter(Boolean);
    if (violations.length || raw.runnerBlocked) {
      if (!violations.length) throw Error('Runner blocker has no measured resource violation');
      receipt.status = 'BLOCKED_BY_RUNNER';
      receipt.reasons.push(...new Set(violations));
      return receipt;
    }
    if (
      resources.some(
        (sample, index) =>
          index &&
          (sample.atMs <= resources[index - 1].atMs ||
            sample.atMs - resources[index - 1].atMs > SCALE_PROFILE.resources.maximumSampleGapMs),
      )
    )
      throw Error('Non-monotonic or missing runner samples');
    validateScaleAssets(raw.provenance, identity);
    validateScaleSecureContexts(raw.secureContexts, raw.users);
    validateScaleServiceWorkers(raw.serviceWorkers, raw.users);
    const plannedCohorts = scaleCohortPlan(raw.users, calibration);
    if (
      raw.classCount !== plannedCohorts.length ||
      !Array.isArray(raw.cohorts) ||
      raw.cohorts.length !== plannedCohorts.length ||
      new Set(raw.cohorts.map((cohort) => cohort.classroomHash)).size !== plannedCohorts.length
    )
      throw Error('The workload did not provision the fixed classroom distribution');
    for (const [index, planned] of plannedCohorts.entries()) {
      const actual = raw.cohorts[index];
      if (
        actual.cohort !== planned.cohort ||
        actual.planned !== planned.planned ||
        actual.provisioned !== planned.planned ||
        !digest(actual.classroomHash) ||
        canonicalJson(actual.clients) !== canonicalJson(planned.clients)
      )
        throw Error('Classroom cohort identities or denominators changed');
    }
    receipt.classCount = raw.classCount;
    receipt.cohortDistribution = raw.cohorts.map((cohort) => cohort.provisioned);
    if (
      raw.observerErrors !== 0 ||
      raw.droppedObservations !== 0 ||
      !Array.isArray(raw.browserSamples) ||
      !raw.browserSamples.length ||
      raw.browserSamples.some(
        (sample) =>
          !integer(sample.chromiumProcesses) ||
          sample.chromiumProcesses < 1 ||
          !finite(sample.chromiumRssBytes) ||
          sample.chromiumRssBytes === 0,
      )
    )
      throw Error('Browser/process evidence incomplete');
    receipt.http = summarizeScaleRequests(raw.requests, raw.elapsedMs, raw.users);
    if (!Array.isArray(raw.observerRequests))
      throw Error('Missing independent control observations');
    receipt.verificationHttp = summarizeScaleRequests(
      raw.observerRequests.filter((record) => record.phase !== 'setup'),
      raw.elapsedMs,
      raw.users,
    );
    const failures = operations.filter((operation) => operation.status !== 'VERIFIED');
    if (failures.length) receipt.reasons.push('required_operations_unconfirmed');
    if (raw.workloadComplete !== true || raw.failure)
      receipt.reasons.push('workload_not_completed');
    if (
      !calibration &&
      (receipt.operations.portal.latencyMs.p95 === null ||
        receipt.operations.portal.latencyMs.p95 > SCALE_PROFILE.slo.portalP95Ms)
    )
      receipt.reasons.push('portal_p95_exceeds_2000ms');
    if (receipt.http.unexpected5xx) receipt.reasons.push('unexpected_5xx');
    if (receipt.http.unexpected429) receipt.reasons.push('unexpected_429');
    if (receipt.verificationHttp.unexpected5xx) receipt.reasons.push('verification_5xx');
    if (receipt.verificationHttp.unexpected429) receipt.reasons.push('verification_429');
    if (!Array.isArray(raw.javascriptErrors) || raw.javascriptErrors.length)
      receipt.reasons.push('javascript_errors');
    receipt.network = summarizeScaleNetworkEvidence(raw);
    if (receipt.network.unexpectedFailures) receipt.reasons.push('unexpected_network_failure');
    if (raw.accountControl?.status !== 'VERIFIED')
      receipt.reasons.push('ordinary_account_login_unconfirmed');
    if (
      raw.games?.chessInvitations !== 1 ||
      raw.games?.checkersInvitations !== 1 ||
      raw.games?.chessMatches !== 1 ||
      raw.games?.checkersMatches !== 1
    )
      receipt.reasons.push('game_controls_unconfirmed');
    receipt.status = receipt.reasons.length ? 'FAIL' : 'PASS';
    receipt.confirmedUsers = receipt.status === 'PASS' ? raw.users : null;
  } catch (error) {
    receipt.status = 'INVALID';
    receipt.reasons.push(error instanceof Error ? error.message : 'Invalid evidence');
  }
  return receipt;
}

export function evaluateScaleLevel(raw, identity, resources) {
  return evaluateScaleWorkload(raw, identity, resources, false);
}

export function evaluateScaleCalibration(raw, identity, resources) {
  const receipt = evaluateScaleWorkload(raw, identity, resources, true);
  return {
    ...receipt,
    mode: 'calibration',
    capacityEvidence: false,
    confirmedUsers: null,
    status:
      receipt.status === 'PASS'
        ? 'VALID_FIXTURE'
        : receipt.status === 'BLOCKED_BY_RUNNER'
          ? receipt.status
          : 'INVALID_FIXTURE',
  };
}

export function scaleLadderSummary(receipts, identity) {
  const levels = [];
  let halted = false;
  for (const users of SCALE_LEVELS) {
    const found = receipts.find((receipt) => receipt.users === users);
    if (halted && found) throw Error('A higher level ran after an unconfirmed level');
    if (!found) {
      halted = true;
      levels.push({ users, status: 'NOT_RUN' });
      continue;
    }
    if (found.sourceSha !== identity.sourceSha || found.profileHash !== SCALE_PROFILE_HASH)
      throw Error('Mixed ladder evidence');
    levels.push(found);
    if (found.status !== 'PASS') halted = true;
  }
  return {
    ...identity,
    schemaVersion: 1,
    profile: SCALE_PROFILE,
    levels,
    maximumConfirmedUsers: Math.max(
      0,
      ...levels.filter((level) => level.status === 'PASS').map((level) => level.users),
    ),
    absoluteCapacityEstablished: false,
    limitations: SCALE_PROFILE.limitations,
  };
}

/** The orchestrator and its regression tests execute this same sequential gate. */
export async function runScaleLadder(identity, runLevel, persistReceipt) {
  const receipts = [];
  for (const users of SCALE_LEVELS) {
    assertPriorScaleLevels(receipts, users, identity);
    const receipt = await runLevel(users);
    if (
      !receipt ||
      receipt.users !== users ||
      !['PASS', 'FAIL', 'BLOCKED_BY_RUNNER', 'INVALID'].includes(receipt.status) ||
      [
        'sourceSha',
        'runId',
        'attempt',
        'runToken',
        'profileHash',
        'environmentHash',
        'imageManifestHash',
      ].some((key) => receipt[key] !== identity[key])
    )
      throw Error('Invalid level runner receipt');
    receipts.push(receipt);
    await persistReceipt(receipt);
    if (receipt.status !== 'PASS') break;
  }
  return scaleLadderSummary(receipts, identity);
}

export function assertLatencyScenario(value) {
  if (value !== undefined && value !== 'full' && value !== 'latency')
    throw Error('Unknown request-storm scenario');
  return value || 'full';
}

export function assertLatencySample(value) {
  if (!['ab-a', 'ab-b', 'ba-b', 'ba-a'].includes(value))
    throw Error('Exact counterbalanced latency sample required');
  return value;
}

// Separate browser-local and proxy-local durations. Absolute clocks across
// Chromium/Node are retained for correlation, never subtracted as network time.
export function summarizeLatencyTimings(clients, records, users = 30) {
  if (
    !integer(users) ||
    users < 1 ||
    !Array.isArray(clients) ||
    clients.length !== users ||
    !Array.isArray(records)
  )
    throw Error('Missing latency clients or proxy observations');
  const groups = Object.fromEntries(
    ['login', 'healthy-save', 'telemetry-outage-save'].map((name) => [name, []]),
  );
  const seen = new Set();
  for (const client of clients) {
    if (
      client.dropped !== 0 ||
      !Array.isArray(client.operations) ||
      client.operations.length !== 3 ||
      !Array.isArray(client.fetches)
    )
      throw Error('Incomplete bounded timing observer');
    for (const operation of client.operations) {
      if (
        !groups[operation.name] ||
        !integer(operation.client) ||
        operation.client >= users ||
        operation.status !== 'VERIFIED' ||
        seen.has(operation.name + ':' + operation.client)
      )
        throw Error('Invalid or duplicated timing operation');
      seen.add(operation.name + ':' + operation.client);
      const chain = [operation.startedAtMs, operation.apiCompletedAtMs, operation.completedAtMs];
      if (chain.some((value, index) => !finite(value) || (index && value < chain[index - 1])))
        throw Error('Unfinished or non-monotonic browser operation');
      const fetches = client.fetches.filter((fetch) => fetch.operationId === operation.id);
      const write = fetches.filter(
        (fetch) => fetch.method === (operation.name === 'login' ? 'POST' : 'PUT'),
      );
      const readback = fetches.filter((fetch) => fetch.method === 'GET');
      if (write.length !== 1 || (operation.name !== 'login' && readback.length !== 1))
        throw Error('Ambiguous write/readback timing; inspect raw attempts');
      const fetch = write[0];
      const steps = [
        operation.startedAtMs,
        fetch.nativeFetchAtMs,
        fetch.headersAtMs,
        fetch.jsonStartedAtMs,
        fetch.jsonCompletedAtMs,
        operation.apiCompletedAtMs,
      ];
      if (
        steps.some((value, index) => !finite(value) || (index && value < steps[index - 1])) ||
        fetch.status < 200 ||
        fetch.status >= 300
      )
        throw Error('Missing native-fetch/JSON boundary');
      if (
        readback.length &&
        (!finite(readback[0].jsonCompletedAtMs) ||
          readback[0].nativeFetchAtMs < operation.apiCompletedAtMs ||
          readback[0].jsonCompletedAtMs > operation.completedAtMs ||
          readback[0].status !== 200)
      )
        throw Error('Missing completed save readback boundary');
      const matches = records.filter(
        (record) =>
          record.client === operation.client &&
          record.requestId === fetch.id &&
          record.operationId === operation.id,
      );
      if (matches.length !== 1)
        throw Error('Native request cannot be joined to exactly one proxy observation');
      const proxy = matches[0];
      const proxySteps = [
        proxy.proxyReceivedAtMs,
        proxy.upstreamDispatchedAtMs,
        proxy.upstreamHeadersAtMs,
        proxy.proxyFinishedAtMs,
      ];
      if (
        !proxy.completed ||
        proxy.injected ||
        proxy.status < 200 ||
        proxy.status >= 300 ||
        proxySteps.some(
          (value, index) => !finite(value) || (index && value < proxySteps[index - 1]),
        )
      )
        throw Error('Missing successful upstream timing boundaries');
      groups[operation.name].push({
        client: operation.client,
        operationMs: operation.completedAtMs - operation.startedAtMs,
        beforeNativeFetchMs: fetch.nativeFetchAtMs - operation.startedAtMs,
        nativeFetchToHeadersMs: fetch.headersAtMs - fetch.nativeFetchAtMs,
        headersToJsonStartMs: fetch.jsonStartedAtMs - fetch.headersAtMs,
        bodyAndJsonMs: fetch.jsonCompletedAtMs - fetch.jsonStartedAtMs,
        jsonToApiResultMs: operation.apiCompletedAtMs - fetch.jsonCompletedAtMs,
        afterApiResultMs: operation.completedAtMs - operation.apiCompletedAtMs,
        proxyDispatchToHeadersMs: proxy.upstreamHeadersAtMs - proxy.upstreamDispatchedAtMs,
        proxyTotalMs: proxy.proxyFinishedAtMs - proxy.proxyReceivedAtMs,
        proxyReceivedAtMs: proxy.proxyReceivedAtMs,
      });
    }
  }
  return Object.fromEntries(
    Object.entries(groups).map(([name, values]) => {
      if (values.length !== users) throw Error('Timing denominator changed');
      const metrics = Object.fromEntries(
        Object.keys(values[0])
          .filter((key) => key.endsWith('Ms') && key !== 'proxyReceivedAtMs')
          .map((key) => [key, scaleQuantiles(values.map((value) => value[key]))]),
      );
      return [
        name,
        {
          count: users,
          proxyArrivalSpreadMs:
            Math.max(...values.map((value) => value.proxyReceivedAtMs)) -
            Math.min(...values.map((value) => value.proxyReceivedAtMs)),
          metrics,
        },
      ];
    }),
  );
}
