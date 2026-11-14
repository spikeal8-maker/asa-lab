#!/usr/bin/env node
/**
 * ASA-STUDENT-PROGRESS-001 / SP-05.
 * Pure, synthetic-only rating-rule qualification; no network or database writes.
 * The independent expected-totals.json file is read, never generated here.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const defaultRules = resolve(root, 'docs/product/student-progress/rating-rules');
function requireTrue(test, message) {
  if (!test) throw Error(message);
}
function record(value, label) {
  requireTrue(
    value !== null && typeof value === 'object' && !Array.isArray(value),
    label + ': expected object',
  );
  return value;
}
function exactKeys(value, keys, label) {
  record(value, label);
  const actual = Object.keys(value).sort();
  requireTrue(
    actual.join('|') === [...keys].sort().join('|'),
    label + ': invalid keys (' + actual.join(',') + ')',
  );
}
function nonempty(value, label) {
  requireTrue(
    typeof value === 'string' && value.length > 0 && value.length <= 256,
    label + ': invalid string',
  );
}
function integer(value, label, max = 100000000) {
  requireTrue(
    Number.isSafeInteger(value) && value >= 0 && value <= max,
    label + ': invalid nonnegative integer',
  );
}
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') {
    return (
      '{' +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ':' + canonical(value[key]))
        .join(',') +
      '}'
    );
  }
  return JSON.stringify(value);
}
function checksum(value) {
  return createHash('sha256').update(canonical(value)).digest('hex');
}
function json(dir, name) {
  return JSON.parse(readFileSync(resolve(dir, name), 'utf8'));
}
function validateConfig(config, expectedId) {
  const pre = 'candidate ' + expectedId;
  exactKeys(
    config,
    ['schemaVersion', 'id', 'version', 'precision', 'weights', 'credit', 'social'],
    pre,
  );
  requireTrue(
    config.schemaVersion === 1 &&
      config.id === expectedId &&
      config.version === 'SP05-' + expectedId + '-1.0.0',
    pre + ': schema/version mismatch',
  );
  exactKeys(config.precision, ['decimalPlaces', 'rounding', 'scoreType'], pre + ' precision');
  requireTrue(
    config.precision.decimalPlaces === 0 &&
      config.precision.rounding === 'half_up_each_publication_then_total' &&
      config.precision.scoreType === 'nonnegative_safe_integer',
    pre + ': precision mismatch',
  );
  exactKeys(
    config.weights,
    [
      'canonicalLearningCompletion',
      'firstPublication',
      'publicCopy',
      'technicalDuplicate',
      'customMerit',
      'comment',
      'login',
      'timeOnSite',
      'click',
      'rawSave',
    ],
    pre + ' weights',
  );
  for (const [key, value] of Object.entries(config.weights)) {
    integer(value, pre + ' weight:' + key);
    requireTrue(
      key === 'canonicalLearningCompletion' ? value === 100 : value === 0,
      pre + ' forbidden or unapproved weight:' + key,
    );
  }
  exactKeys(
    config.credit,
    [
      'learningKey',
      'publicationKey',
      'reactorKey',
      'identity',
      'withdrawal',
      'correction',
      'history',
      'calendarDecay',
    ],
    pre + ' credit',
  );
  requireTrue(
    config.credit.learningKey === 'canonical_completion_id' &&
      config.credit.publicationKey === 'first_eligible_publication_for_project' &&
      config.credit.reactorKey === 'verified_person_id_per_publication' &&
      config.credit.identity === 'verified_canonical_links_only' &&
      config.credit.withdrawal === 'current_qualified_state' &&
      config.credit.correction === 'latest_version_wins' &&
      config.credit.history === 'only_proven_evidence' &&
      config.credit.calendarDecay === false,
    pre + ': credit invariants violated',
  );
  record(config.social, pre + ' social');
  const social = config.social;
  integer(social.perPublicationUniqueReactorLimit, pre + ' per-publication limit', 1000);
  integer(social.perPublicationMaxPoints, pre + ' per-publication cap', 1000);
  exactKeys(social.aggregateCap, ['mode', 'numerator', 'denominator', 'base'], pre + ' aggregate');
  integer(social.aggregateCap.numerator, pre + ' cap numerator');
  integer(social.aggregateCap.denominator, pre + ' cap denominator');
  integer(social.aggregateCap.base, pre + ' cap base');
  requireTrue(social.aggregateCap.denominator > 0, pre + ': denominator is zero');
  if (expectedId === 'C') {
    exactKeys(
      social,
      [
        'mode',
        'numerator',
        'denominatorOffset',
        'perPublicationUniqueReactorLimit',
        'perPublicationMaxPoints',
        'aggregateCap',
      ],
      pre + ' social',
    );
    requireTrue(
      social.mode === 'rational' &&
        social.numerator === 60 &&
        social.denominatorOffset === 6 &&
        social.perPublicationUniqueReactorLimit === 100 &&
        social.perPublicationMaxPoints === 57,
      pre + ': wrong rational coefficients or bounds',
    );
  } else {
    exactKeys(
      social,
      [
        'mode',
        'pointsPerReaction',
        'perPublicationUniqueReactorLimit',
        'perPublicationMaxPoints',
        'aggregateCap',
      ],
      pre + ' social',
    );
    const points = expectedId === 'A' ? 6 : 8;
    requireTrue(
      social.mode === 'linear' &&
        social.pointsPerReaction === points &&
        social.perPublicationUniqueReactorLimit === 5 &&
        social.perPublicationMaxPoints === points * 5,
      pre + ': wrong linear coefficients or bounds',
    );
  }
  const cap = social.aggregateCap;
  if (expectedId === 'B') {
    requireTrue(
      cap.mode === 'learning_fraction_plus_base' &&
        cap.numerator === 2 &&
        cap.denominator === 5 &&
        cap.base === 80,
      pre + ': wrong aggregate cap',
    );
  } else {
    requireTrue(
      cap.mode === 'none' && cap.numerator === 0 && cap.denominator === 1 && cap.base === 0,
      pre + ': invalid aggregate cap',
    );
  }
}
function validateFixture(data) {
  exactKeys(data, ['schemaVersion', 'basis', 'cases'], 'fixtures');
  requireTrue(
    data.schemaVersion === 1 && data.basis === 'synthetic_only',
    'fixtures: wrong schema/basis',
  );
  requireTrue(
    Array.isArray(data.cases) && data.cases.length >= 20 && data.cases.length <= 100,
    'fixtures: case count must be 20..100',
  );
  const ids = new Set();
  for (const item of data.cases) {
    exactKeys(
      item,
      [
        'id',
        'personId',
        'identityLinks',
        'learning',
        'publications',
        'reactions',
        'copiesRecorded',
      ],
      'fixture',
    );
    nonempty(item.id, 'fixture id');
    nonempty(item.personId, item.id + ' person');
    requireTrue(!ids.has(item.id), 'fixture ID repeated: ' + item.id);
    ids.add(item.id);
    for (const field of ['identityLinks', 'learning', 'publications', 'reactions']) {
      requireTrue(
        Array.isArray(item[field]) && item[field].length <= 10000,
        item.id + ' invalid ' + field,
      );
    }
    integer(item.copiesRecorded, item.id + ' copies');
    for (const a of item.identityLinks) {
      exactKeys(a, ['principal', 'personId', 'verified'], item.id + ' identity link');
      nonempty(a.principal, 'identity principal');
      nonempty(a.personId, 'identity person');
      requireTrue(typeof a.verified === 'boolean', item.id + ' identity verification not boolean');
    }
    for (const a of item.learning) {
      exactKeys(
        a,
        ['completionId', 'principal', 'revision', 'state', 'groupId', 'completedAt', 'evidence'],
        item.id + ' learning',
      );
      nonempty(a.completionId, 'completionId');
      nonempty(a.principal, 'learning principal');
      nonempty(a.groupId, 'groupId');
      nonempty(a.completedAt, 'completedAt');
      integer(a.revision, 'learning revision');
      requireTrue(a.revision >= 1, 'learning revision missing');
      requireTrue(['confirmed', 'revoked'].includes(a.state), 'invalid learning state');
      requireTrue(
        ['canonical_verified', 'unverified'].includes(a.evidence),
        'invalid learning evidence',
      );
    }
    for (const a of item.publications) {
      exactKeys(
        a,
        [
          'publicationId',
          'projectId',
          'authorPrincipal',
          'origin',
          'state',
          'firstPublishOrder',
          'proof',
        ],
        item.id + ' publication',
      );
      nonempty(a.publicationId, 'publicationId');
      nonempty(a.projectId, 'projectId');
      nonempty(a.authorPrincipal, 'authorPrincipal');
      integer(a.firstPublishOrder, 'publication order');
      requireTrue(a.firstPublishOrder >= 1, 'invalid publication order');
      requireTrue(
        ['covered_native', 'known_copy', 'unknown'].includes(a.origin),
        'invalid provenance',
      );
      requireTrue(['active', 'hidden', 'withdrawn'].includes(a.state), 'invalid publication state');
      requireTrue(['server_verified', 'unverified'].includes(a.proof), 'invalid publication proof');
    }
    for (const a of item.reactions) {
      exactKeys(
        a,
        ['publicationId', 'actorPrincipal', 'revision', 'state', 'evidence'],
        item.id + ' reaction',
      );
      nonempty(a.publicationId, 'reaction publication');
      nonempty(a.actorPrincipal, 'reaction actor');
      integer(a.revision, 'reaction revision');
      requireTrue(a.revision >= 1, 'invalid reaction revision');
      requireTrue(['active', 'removed'].includes(a.state), 'invalid reaction state');
      requireTrue(
        ['canonical_current_state', 'unverified'].includes(a.evidence),
        'invalid reaction evidence',
      );
    }
  }
}
function mapIdentity(fixture) {
  const map = new Map();
  for (const link of fixture.identityLinks) {
    if (!link.verified) continue;
    if (map.has(link.principal))
      requireTrue(
        map.get(link.principal) === link.personId,
        fixture.id + ': conflicting verified identities',
      );
    else map.set(link.principal, link.personId);
  }
  return map;
}
function latest(target, key, revision, state, errorPrefix) {
  const prior = target.get(key);
  if (!prior || revision > prior.revision) target.set(key, { revision, state });
  else if (revision === prior.revision)
    requireTrue(state === prior.state, errorPrefix + ': inconsistent same-version replay');
}
function score(fixture, config) {
  const identities = mapIdentity(fixture);
  const personId = fixture.personId;
  const completions = new Map();
  for (const item of fixture.learning) {
    if (identities.get(item.principal) !== personId || item.evidence !== 'canonical_verified')
      continue;
    latest(
      completions,
      item.completionId,
      item.revision,
      item.state,
      fixture.id + ' completion ' + item.completionId,
    );
  }
  const countLearning = [...completions.values()].filter((x) => x.state === 'confirmed').length;
  const learningPoints = countLearning * config.weights.canonicalLearningCompletion;
  requireTrue(Number.isSafeInteger(learningPoints), fixture.id + ': learning overflow');
  const byProject = new Map();
  const byId = new Map();
  for (const publication of fixture.publications) {
    const existing = byId.get(publication.publicationId);
    requireTrue(
      !existing || canonical(existing) === canonical(publication),
      fixture.id + ': contradictory repeated publication ID',
    );
    byId.set(publication.publicationId, publication);
  }
  for (const publication of [...byId.values()].sort(
    (a, b) =>
      a.firstPublishOrder - b.firstPublishOrder || a.publicationId.localeCompare(b.publicationId),
  )) {
    if (!byProject.has(publication.projectId)) byProject.set(publication.projectId, publication);
  }
  let socialPoints = 0;
  for (const publication of byProject.values()) {
    if (
      identities.get(publication.authorPrincipal) !== personId ||
      publication.origin !== 'covered_native' ||
      publication.state !== 'active' ||
      publication.proof !== 'server_verified'
    )
      continue;
    const latestReactions = new Map();
    for (const reaction of fixture.reactions) {
      if (
        reaction.publicationId !== publication.publicationId ||
        reaction.evidence !== 'canonical_current_state'
      )
        continue;
      const actor = identities.get(reaction.actorPrincipal);
      if (!actor || actor === personId) continue;
      latest(
        latestReactions,
        actor,
        reaction.revision,
        reaction.state,
        fixture.id + ' reaction ' + actor,
      );
    }
    const active = [...latestReactions.values()].filter((x) => x.state === 'active').length;
    const bounded = Math.min(active, config.social.perPublicationUniqueReactorLimit);
    let contribution;
    if (config.social.mode === 'linear') contribution = bounded * config.social.pointsPerReaction;
    else
      contribution = Math.floor(
        (config.social.numerator * bounded) / (bounded + config.social.denominatorOffset) + 0.5,
      );
    requireTrue(
      contribution <= config.social.perPublicationMaxPoints,
      fixture.id + ': per-publication cap breached',
    );
    socialPoints += contribution;
    requireTrue(Number.isSafeInteger(socialPoints), fixture.id + ': social overflow');
  }
  if (config.social.aggregateCap.mode === 'learning_fraction_plus_base') {
    const cap =
      Math.floor(
        (learningPoints * config.social.aggregateCap.numerator) /
          config.social.aggregateCap.denominator,
      ) + config.social.aggregateCap.base;
    socialPoints = Math.min(socialPoints, cap);
  }
  const total = learningPoints + socialPoints;
  requireTrue(Number.isSafeInteger(total) && total >= 0, fixture.id + ': score overflow');
  return total;
}
function check(dir) {
  const config = new Map();
  for (const id of ['A', 'B', 'C']) {
    const data = json(dir, 'candidate-' + id.toLowerCase() + '.json');
    validateConfig(data, id);
    config.set(id, data);
  }
  const selection = json(dir, 'selected-rule.json');
  exactKeys(
    selection,
    ['schemaVersion', 'selected', 'version', 'checksum', 'approvalState'],
    'selected-rule',
  );
  requireTrue(
    selection.schemaVersion === 1 && ['A', 'B', 'C'].includes(selection.selected),
    'selected-rule: exactly one selected candidate required',
  );
  requireTrue(
    selection.approvalState === 'pending_independent_review',
    'selected-rule: unverified approval state',
  );
  nonempty(selection.checksum, 'selected checksum');
  requireTrue(/^[a-f0-9]{64}$/.test(selection.checksum), 'selected-rule: checksum syntax');
  const chosen = config.get(selection.selected);
  requireTrue(selection.version === chosen.version, 'selected-rule: version mismatch');
  requireTrue(selection.checksum === checksum(chosen), 'selected-rule: checksum mismatch');
  const mapping = json(dir, 'source-mapping.json');
  requireTrue(
    mapping.schemaVersion === 1 &&
      mapping.calibration === 'synthetic_only' &&
      mapping.status === 'requires_real_source_qualification_after_C3' &&
      Array.isArray(mapping.sources) &&
      mapping.sources.length === 6,
    'source mapping insufficient',
  );
  const fixtures = json(dir, 'fixtures.json');
  validateFixture(fixtures);
  const oracle = json(dir, 'expected-totals.json');
  exactKeys(
    oracle,
    ['schemaVersion', 'authority', 'candidateVersions', 'totals'],
    'expected-totals',
  );
  requireTrue(
    oracle.schemaVersion === 1 &&
      oracle.authority === 'fixed_manual_integer_oracle_not_calculator_generated',
    'oracle authority invalid',
  );
  exactKeys(oracle.candidateVersions, ['A', 'B', 'C'], 'oracle versions');
  for (const id of config.keys())
    requireTrue(
      oracle.candidateVersions[id] === config.get(id).version,
      'oracle version mismatch ' + id,
    );
  requireTrue(
    Array.isArray(oracle.totals) && oracle.totals.length === fixtures.cases.length,
    'oracle fixture count mismatch',
  );
  const expected = new Map();
  for (const item of oracle.totals) {
    exactKeys(item, ['id', 'A', 'B', 'C'], 'expected row');
    nonempty(item.id, 'expected ID');
    requireTrue(!expected.has(item.id), 'duplicate oracle row');
    for (const id of config.keys()) integer(item[id], 'expected ' + item.id + '/' + id);
    expected.set(item.id, item);
  }
  for (const item of fixtures.cases) {
    const ref = expected.get(item.id);
    requireTrue(ref !== undefined, 'missing oracle ' + item.id);
    for (const [id, rule] of config) {
      const actual = score(item, rule);
      requireTrue(
        actual === ref[id],
        'wrong total ' + item.id + '/' + id + ': actual=' + actual + ' expected=' + ref[id],
      );
    }
  }
  const result = {
    status: 'PASS',
    candidates: 3,
    fixtures: fixtures.cases.length,
    selected: chosen.version,
    checksum: selection.checksum,
    expectedTotalsChecksum: checksum(oracle),
    basis: 'synthetic_only',
    sourceAcceptance: 'BLOCKED_C3',
  };
  process.stdout.write('SP05_CHECK_PASS ' + JSON.stringify(result) + '\n');
  return result;
}
try {
  const args = process.argv.slice(2);
  requireTrue(args.includes('--check'), 'use --check');
  const position = args.indexOf('--dir');
  const folder = position < 0 ? defaultRules : args[position + 1];
  requireTrue(typeof folder === 'string' && folder.length > 0, '--dir expects a path');
  requireTrue(
    args.every((v, i) => v === '--check' || v === '--dir' || (position >= 0 && i === position + 1)),
    'unexpected CLI argument',
  );
  check(resolve(folder));
} catch (error) {
  process.stderr.write(
    'SP05_CHECK_FAIL ' + (error instanceof Error ? error.message : String(error)) + '\n',
  );
  process.exitCode = 1;
}
