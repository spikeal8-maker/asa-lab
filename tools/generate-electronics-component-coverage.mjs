#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ELECTRONICS_CATALOG_PATH =
  'apps/web/public/assets/electronics/component-database/catalog.json';
export const MODEL_IDENTITY_PATH = 'contexts/electronics/domain/model-identity.ts';
export const MODEL_REGISTRY_PATH = 'contexts/electronics/domain/model-registry.ts';
export const INSPECTOR_PROFILE_PATH = 'apps/web/src/electronics/component-information.ts';
export const HELP_CONTENT_PATH = 'apps/web/src/electronics/component-help-content.ts';
export const COMPONENT_INFORMATION_TEST_PATH =
  'apps/web/src/electronics/testing/component-information.spec.ts';
export const BROWSER_EVIDENCE_PATH = 'e2e/electronics-simulation.spec.ts';
export const COVERAGE_OUTPUT_PATH = 'docs/product/electronics/generated/component-coverage.json';

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function ordinalCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function exactModelIdentities(source) {
  const block = source.match(/const EXACT_IDENTITIES:[\s\S]*?=\s*\{([\s\S]*?)\n\};/)?.[1];
  if (!block) throw new Error(`${MODEL_IDENTITY_PATH}: EXACT_IDENTITIES block is missing`);
  const identities = new Map();
  const entryPattern =
    /^\s*(?:'([^']+)'|([A-Za-z0-9_-]+)):\s*identity\('([^']+)',\s*'([^']+)'\),/gm;
  for (const match of block.matchAll(entryPattern)) {
    identities.set(match[1] ?? match[2], {
      electricalModelId: match[3],
      modelProfileId: match[4],
    });
  }
  return identities;
}

function isCatalogModelClaim(value) {
  return value !== 'unsupported_fail_closed' && value !== 'not_available';
}

export function buildElectronicsComponentCoverage() {
  const catalogSource = readFileSync(ELECTRONICS_CATALOG_PATH, 'utf8');
  const identitySource = readFileSync(MODEL_IDENTITY_PATH, 'utf8');
  const modelRegistrySource = readFileSync(MODEL_REGISTRY_PATH, 'utf8');
  const inspectorProfileSource = readFileSync(INSPECTOR_PROFILE_PATH, 'utf8');
  const helpContentSource = readFileSync(HELP_CONTENT_PATH, 'utf8');
  const componentInformationTestSource = readFileSync(COMPONENT_INFORMATION_TEST_PATH, 'utf8');
  const browserEvidenceSource = readFileSync(BROWSER_EVIDENCE_PATH, 'utf8');
  const catalog = JSON.parse(catalogSource);
  const identities = exactModelIdentities(identitySource);
  const breadboardIds = new Set((catalog.breadboards ?? []).map((entry) => entry.componentId));
  const fatalContradictions = [];

  const components = [...catalog.components]
    .sort(
      (left, right) =>
        Number(left.catalogOrder ?? Number.MAX_SAFE_INTEGER) -
          Number(right.catalogOrder ?? Number.MAX_SAFE_INTEGER) ||
        ordinalCompare(left.componentId, right.componentId),
    )
    .map((component) => {
      const enabled = component.status === 'enabled';
      const identity = identities.get(component.componentId) ?? null;
      const ownerArtwork =
        component.runtimePath &&
        component.runtimeSha256 &&
        component.provenance !== 'missing_owner_source'
          ? 'verified'
          : 'missing';
      const physicalScale =
        Number.isFinite(component.physicalWidthMm) &&
        component.physicalWidthMm > 0 &&
        Number.isFinite(component.physicalHeightMm) &&
        component.physicalHeightMm > 0
          ? 'verified'
          : 'missing';
      const terminals =
        (Array.isArray(component.pins) && component.pins.length > 0) ||
        breadboardIds.has(component.componentId)
          ? 'verified'
          : 'missing';
      const catalogClaimsModel = isCatalogModelClaim(component.simulationSupport);
      if (enabled && catalogClaimsModel && !identity) {
        fatalContradictions.push({
          componentId: component.componentId,
          code: 'catalog_claims_model_without_identity',
        });
      }
      if (enabled && ownerArtwork === 'missing') {
        fatalContradictions.push({
          componentId: component.componentId,
          code: 'enabled_component_missing_owner_artwork',
        });
      }
      if (enabled && physicalScale === 'missing') {
        fatalContradictions.push({
          componentId: component.componentId,
          code: 'enabled_component_missing_physical_scale',
        });
      }
      if (enabled && terminals === 'missing') {
        fatalContradictions.push({
          componentId: component.componentId,
          code: 'enabled_component_missing_terminals',
        });
      }

      return {
        componentId: component.componentId,
        familyId: component.familyId,
        variantId: component.variantId,
        catalogStatus: component.status,
        catalogSimulationSupport: component.simulationSupport,
        ownerArtwork,
        placement: enabled ? 'verified' : 'unavailable',
        physicalScale,
        terminals,
        breadboardFixture: component.footprint ? 'verified' : 'unverified',
        modelIdentity: identity ? 'verified' : 'missing',
        dcModel: !identity ? 'unsupported' : catalogClaimsModel ? 'verified' : 'unverified',
        transientModel: enabled ? 'unverified' : 'not_applicable',
        damageProfile: enabled ? 'unverified' : 'not_applicable',
        inspectorHelp: enabled ? 'unverified' : 'missing',
        browserEvidence: enabled ? 'unverified' : 'missing',
        ...(identity ?? {}),
      };
    });

  const count = (field, value) => components.filter((entry) => entry[field] === value).length;
  return {
    schema: 'asa-lab.electronics-component-coverage.v1',
    generatedFrom: {
      catalogPath: ELECTRONICS_CATALOG_PATH,
      catalogSha256: sha256(catalogSource),
      modelIdentityPath: MODEL_IDENTITY_PATH,
      modelIdentitySha256: sha256(identitySource),
      modelRegistryPath: MODEL_REGISTRY_PATH,
      modelRegistrySha256: sha256(modelRegistrySource),
      inspectorProfilePath: INSPECTOR_PROFILE_PATH,
      inspectorProfileSha256: sha256(inspectorProfileSource),
      helpContentPath: HELP_CONTENT_PATH,
      helpContentSha256: sha256(helpContentSource),
      componentInformationTestPath: COMPONENT_INFORMATION_TEST_PATH,
      componentInformationTestSha256: sha256(componentInformationTestSource),
      browserEvidencePath: BROWSER_EVIDENCE_PATH,
      browserEvidenceSha256: sha256(browserEvidenceSource),
    },
    summary: {
      total: components.length,
      enabled: components.filter((entry) => entry.catalogStatus === 'enabled').length,
      disabled: components.filter((entry) => entry.catalogStatus !== 'enabled').length,
      dcVerified: count('dcModel', 'verified'),
      dcUnsupported: count('dcModel', 'unsupported'),
      dcUnverified: count('dcModel', 'unverified'),
      breadboardUnverified: count('breadboardFixture', 'unverified'),
      transientUnverified: count('transientModel', 'unverified'),
      inspectorHelpUnverified: count('inspectorHelp', 'unverified'),
      browserEvidenceUnverified: count('browserEvidence', 'unverified'),
      fatalContradictions: fatalContradictions.length,
    },
    fatalContradictions,
    components,
  };
}

export function serializeElectronicsComponentCoverage(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = buildElectronicsComponentCoverage();
  const serialized = serializeElectronicsComponentCoverage(report);
  if (process.argv.includes('--write')) {
    writeFileSync(COVERAGE_OUTPUT_PATH, serialized);
    console.log(`electronics component coverage written: ${COVERAGE_OUTPUT_PATH}`);
  } else {
    process.stdout.write(serialized);
  }
}
