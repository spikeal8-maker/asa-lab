#!/usr/bin/env node
// Validate API and data contracts: OpenAPI document structure + reference
// resolution, and JSON Schema (draft 2020-12) compilation with a sample check.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import SwaggerParser from '@apidevtools/swagger-parser';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import { parse as parseYaml } from 'yaml';

const SCHEMAS_DIR = 'schemas';
const OPENAPI_PATH = join(SCHEMAS_DIR, 'openapi.yaml');
let failures = 0;

async function validateOpenApi() {
  const raw = parseYaml(readFileSync(OPENAPI_PATH, 'utf8'));
  if (typeof raw.openapi !== 'string' || !raw.openapi.startsWith('3.1')) {
    console.error(`OpenAPI must declare version 3.1.x, got ${raw.openapi}`);
    failures += 1;
    return;
  }
  const requiredSessionFields = [
    'authenticated',
    'user',
    'account',
    'capabilities',
    'workspaces',
    'activeWorkspace',
    'navigation',
  ];
  const userEnvelope = raw.components?.schemas?.UserEnvelope;
  const declaredFields = new Set(userEnvelope?.required ?? []);
  for (const field of requiredSessionFields) {
    if (!declaredFields.has(field) || userEnvelope?.properties?.[field] === undefined) {
      console.error(`OpenAPI UserEnvelope must declare required field ${field}`);
      failures += 1;
    }
  }
  for (const path of [
    '/api/auth/register',
    '/api/auth/login',
    '/api/auth/me',
    '/api/session/context',
  ]) {
    if (raw.paths?.[path] === undefined) {
      console.error(`OpenAPI must declare runtime path ${path}`);
      failures += 1;
    }
  }
  try {
    const api = await SwaggerParser.dereference(OPENAPI_PATH);
    const pathCount = Object.keys(api.paths ?? {}).length;
    console.log(`OpenAPI OK: ${api.info.title} ${api.info.version} (${pathCount} paths)`);
  } catch (error) {
    console.error(`OpenAPI reference resolution failed: ${error.message}`);
    failures += 1;
  }
}

function validateJsonSchemas() {
  const ajv = new Ajv2020({ strict: false, allErrors: true });
  addFormats(ajv);
  const files = readdirSync(SCHEMAS_DIR).filter((name) => name.endsWith('.schema.json'));
  for (const file of files) {
    try {
      const schema = JSON.parse(readFileSync(join(SCHEMAS_DIR, file), 'utf8'));
      ajv.compile(schema);
      console.log(`JSON Schema OK: ${file}`);
    } catch (error) {
      console.error(`JSON Schema invalid ${file}: ${error.message}`);
      failures += 1;
    }
  }

  // Sample-instance check reuses the schema already compiled above.
  try {
    const validate = ajv.getSchema('https://asa-lab.dev/schemas/health.schema.json');
    if (!validate) {
      console.error('health schema was not registered for the sample check');
      failures += 1;
    } else {
      if (!validate({ status: 'live' })) {
        console.error('health sample instance unexpectedly invalid');
        failures += 1;
      }
      if (validate({ status: 'nope' })) {
        console.error('health schema failed to reject an invalid status');
        failures += 1;
      }
    }
  } catch (error) {
    console.error(`health schema sample check failed: ${error.message}`);
    failures += 1;
  }
}

await validateOpenApi();
validateJsonSchemas();

if (failures > 0) {
  console.error(`contracts:check FAIL (${failures} problem(s))`);
  process.exit(1);
}
console.log('contracts:check PASS');
