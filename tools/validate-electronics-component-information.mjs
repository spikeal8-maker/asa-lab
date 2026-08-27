#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const SPEC_PATH = 'docs/product/electronics/README.md';
const LEDGER_PATH = 'docs/product/electronics/contracts/information-requirements.yaml';
const CAPABILITIES_PATH = 'docs/product/electronics/contracts/capabilities.yaml';
const PLANNED_TESTS_PATH = 'docs/testing/planned-test-catalog.yaml';
const SCHEMA_PATHS = [
  'docs/product/electronics/contracts/schemas/inspector-profile.schema.json',
  'docs/product/electronics/contracts/schemas/help-content.schema.json',
  'docs/product/electronics/contracts/schemas/help-approval.schema.json',
  'docs/product/electronics/contracts/schemas/information-requirements.schema.json',
];

const failures = [];

function fail(message) {
  failures.push(message);
}

function loadJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return null;
  }
}

function loadYaml(path) {
  try {
    return parseYaml(readFileSync(path, 'utf8'), { uniqueKeys: true });
  } catch (error) {
    fail(`${path}: ${error.message}`);
    return null;
  }
}

const schemas = new Map();
for (const path of SCHEMA_PATHS) {
  const schema = loadJson(path);
  if (!schema) continue;
  try {
    const ajv = new Ajv2020({ allErrors: true, strict: true });
    addFormats(ajv);
    ajv.compile(schema);
    schemas.set(path, schema);
  } catch (error) {
    fail(`${path}: invalid Draft 2020-12 schema: ${error.message}`);
  }
}

const ledger = loadYaml(LEDGER_PATH);
const capabilities = loadYaml(CAPABILITIES_PATH);
const ledgerSchema = schemas.get(
  'docs/product/electronics/contracts/schemas/information-requirements.schema.json',
);
if (ledger && ledgerSchema) {
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validate = ajv.compile(ledgerSchema);
  if (!validate(ledger)) {
    for (const error of validate.errors ?? []) {
      fail(`${LEDGER_PATH}${error.instancePath || '/'} ${error.message}`);
    }
  }
}

if (ledger) {
  const decisionIds = new Set();
  for (const decision of ledger.decisions ?? []) {
    if (decisionIds.has(decision.id)) fail(`duplicate decision id ${decision.id}`);
    decisionIds.add(decision.id);
  }

  const requirementIds = new Set();
  for (const requirement of ledger.requirements ?? []) {
    if (requirementIds.has(requirement.id)) fail(`duplicate requirement id ${requirement.id}`);
    requirementIds.add(requirement.id);
  }

  const plannedCatalog = loadYaml(PLANNED_TESTS_PATH);
  const plannedTestIds = new Set((plannedCatalog?.tests ?? []).map((test) => test.id));
  for (const requirement of ledger.requirements ?? []) {
    for (const decisionId of requirement.depends_on_decisions ?? []) {
      if (!decisionIds.has(decisionId)) {
        fail(`${requirement.id}: unknown decision dependency ${decisionId}`);
      }
    }
    for (const dependencyId of requirement.blocked_by_requirements ?? []) {
      if (!requirementIds.has(dependencyId)) {
        fail(`${requirement.id}: unknown requirement dependency ${dependencyId}`);
      }
    }
    for (const testId of requirement.planned_test_ids ?? []) {
      if (!plannedTestIds.has(testId)) {
        fail(`${requirement.id}: planned test ${testId} is absent from ${PLANNED_TESTS_PATH}`);
      }
    }
    if (requirement.status === 'blocked' && !String(requirement.blocked_reason ?? '').trim()) {
      fail(`${requirement.id}: blocked requirement needs blocked_reason`);
    }
    if (requirement.status === 'implemented' || requirement.status === 'verified') {
      if (!existsSync(requirement.planned_fixture_path)) {
        fail(
          `${requirement.id}: ${requirement.status} fixture does not exist: ${requirement.planned_fixture_path}`,
        );
      }
    }
    if (requirement.status === 'verified') {
      const evidence = requirement.evidence ?? {};
      if (evidence.result !== 'pass' || !evidence.verified_sha || !evidence.artifacts?.length) {
        fail(`${requirement.id}: verified status requires pass, verified_sha and artifacts`);
      }
    }
  }

  const spec = readFileSync(SPEC_PATH, 'utf8');
  const specDecisionIds = new Set(spec.match(/DEC-INFO-\d{3}/g) ?? []);
  for (const decisionId of decisionIds) {
    if (!specDecisionIds.has(decisionId)) fail(`${decisionId}: absent from ${SPEC_PATH}`);
  }
  for (const decisionId of specDecisionIds) {
    if (!decisionIds.has(decisionId)) fail(`${decisionId}: absent from ${LEDGER_PATH}`);
  }
}

if (capabilities) {
  const spec = readFileSync(SPEC_PATH, 'utf8');
  const declaredMathDecisions = new Set(capabilities.engineering_decisions ?? []);
  const documentedMathDecisions = new Set(spec.match(/DEC-MATH-\d{3}/g) ?? []);
  for (const decisionId of declaredMathDecisions) {
    if (!documentedMathDecisions.has(decisionId)) {
      fail(`${decisionId}: absent from ${SPEC_PATH}`);
    }
  }
  for (const decisionId of documentedMathDecisions) {
    if (!declaredMathDecisions.has(decisionId)) {
      fail(`${decisionId}: absent from ${CAPABILITIES_PATH}`);
    }
  }

  const resultContract = capabilities.simulation_result_contract;
  const solverSourcePath = resultContract?.source;
  if (!solverSourcePath || !existsSync(solverSourcePath)) {
    fail(`${CAPABILITIES_PATH}: simulation result source is missing`);
  } else {
    const solverSource = readFileSync(solverSourcePath, 'utf8');
    for (const [typeName, expectedValues] of Object.entries(resultContract.unions ?? {})) {
      const match = solverSource.match(new RegExp(`export type ${typeName}\\s*=([\\s\\S]*?);`));
      if (!match) {
        fail(`${solverSourcePath}: cannot find exported union ${typeName}`);
        continue;
      }
      const actualValues = [...match[1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
      if (JSON.stringify(actualValues) !== JSON.stringify(expectedValues)) {
        fail(
          `${typeName}: contract ${JSON.stringify(expectedValues)} differs from source ${JSON.stringify(actualValues)}`,
        );
      }
    }
    for (const field of [resultContract.status_field, resultContract.compatibility_boolean]) {
      if (!field || !new RegExp(`readonly ${field}\\s*:`).test(solverSource)) {
        fail(`${solverSourcePath}: SolveResult field ${String(field)} is absent`);
      }
    }
  }

  const coverage = capabilities.generated_component_coverage;
  if (!coverage?.source_layers?.length || !coverage?.required_dimensions?.length) {
    fail(`${CAPABILITIES_PATH}: generated component coverage contract is incomplete`);
  }
}

const inspectorSchemaText = readFileSync(SCHEMA_PATHS[0], 'utf8');
for (const forbidden of ['propertyPath', 'sourcePath', 'optionsSource\"']) {
  if (inspectorSchemaText.includes(forbidden)) {
    fail(`${SCHEMA_PATHS[0]}: forbidden untyped binding ${forbidden}`);
  }
}

if (failures.length) {
  for (const message of failures) console.error(`component-information: ${message}`);
  console.error(`component-information FAIL (${failures.length} problem(s))`);
  process.exit(1);
}

console.log(
  `component-information PASS (${schemas.size} schemas, ${ledger?.decisions?.length ?? 0} information decisions, ${capabilities?.engineering_decisions?.length ?? 0} math decisions, ${ledger?.requirements?.length ?? 0} requirements)`,
);
