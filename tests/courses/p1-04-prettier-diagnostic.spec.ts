import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('temporary formatting evidence', () => {
  it('prints the exact PostgreSQL-test Prettier diff', async () => {
    const path = 'tests/courses/course-activity-blocks.pg.spec.ts';
    const source = readFileSync(path, 'utf8');
    const options = (await resolveConfig(path)) ?? {};
    const formatted = await format(source, { ...options, filepath: path });
    if (formatted !== source) {
      const destination = '/tmp/asa739-course-prettier-expected.ts';
      writeFileSync(destination, formatted);
      const result = spawnSync('diff', ['-u', path, destination], { encoding: 'utf8' });
      console.log('ASA739_PRETTIER_DIFF_START\n' + result.stdout.slice(0, 30000) + '\nASA739_PRETTIER_DIFF_END');
    }
  });
});
