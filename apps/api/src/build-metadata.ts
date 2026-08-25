export interface RuntimeBuildMetadata {
  readonly revision: string;
  readonly builtAt: string | null;
  readonly expectedSchemaVersion: number | null;
  readonly artifactIntegrity: 'verified' | 'unknown';
  readonly artifactVerifiedAt: string | null;
}

function safeSchemaVersion(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const value = Number.parseInt(raw, 10);
  return Number.isSafeInteger(value) ? value : null;
}

export function runtimeBuildMetadata(): RuntimeBuildMetadata {
  const builtAt = process.env['ASA_BUILT_AT'];
  const artifactVerifiedAt = process.env['ASA_ARTIFACT_VERIFIED_AT'];
  return {
    revision: process.env['ASA_BUILD_REVISION']?.trim() || 'development',
    builtAt: builtAt && !Number.isNaN(Date.parse(builtAt)) ? builtAt : null,
    expectedSchemaVersion: safeSchemaVersion(process.env['ASA_EXPECTED_SCHEMA_VERSION']),
    artifactIntegrity:
      process.env['ASA_ARTIFACT_INTEGRITY'] === 'verified' ? 'verified' : 'unknown',
    artifactVerifiedAt:
      artifactVerifiedAt && !Number.isNaN(Date.parse(artifactVerifiedAt))
        ? artifactVerifiedAt
        : null,
  };
}
