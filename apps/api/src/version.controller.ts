import { Controller, Get, Inject, Optional } from '@nestjs/common';
import type pg from 'pg';
import { runtimeBuildMetadata } from './build-metadata.js';
import { TOKENS } from './tokens.js';

@Controller('api/version')
export class VersionController {
  constructor(@Optional() @Inject(TOKENS.pool) private readonly pool: pg.Pool | null) {}

  @Get()
  async version(): Promise<{
    readonly revision: string;
    readonly builtAt: string | null;
    readonly schemaVersion: number | null;
    readonly expectedSchemaVersion: number | null;
    readonly synchronized: boolean | null;
  }> {
    const build = runtimeBuildMetadata();
    let schemaVersion: number | null = null;
    if (this.pool) {
      try {
        const result = await this.pool.query<{ version: number | string }>(
          'SELECT version FROM runtime_schema_version()',
        );
        const rawVersion = result.rows[0]?.version;
        const parsed = rawVersion === undefined ? Number.NaN : Number(rawVersion);
        schemaVersion = Number.isSafeInteger(parsed) ? parsed : null;
      } catch {
        schemaVersion = null;
      }
    }
    return {
      revision: build.revision,
      builtAt: build.builtAt,
      schemaVersion,
      expectedSchemaVersion: build.expectedSchemaVersion,
      synchronized:
        schemaVersion === null || build.expectedSchemaVersion === null
          ? null
          : schemaVersion === build.expectedSchemaVersion,
    };
  }
}
