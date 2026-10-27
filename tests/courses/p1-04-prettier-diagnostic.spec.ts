import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('temporary P1-04 Prettier diagnostic', () => {
  it('prints only the PostgreSQL fixture formatting diff', async () => {
    const path = 'tests/courses/course-activity-blocks.pg.spec.ts';
    const source = readFileSync(path, 'utf8');
    const options = (await resolveConfig(path)) ?? {};
    const formatted = await format(source, { ...options, filepath: path });
    if (formatted !== source) {
      const destination = '/tmp/asa739-prettier-expected.ts';
      writeFileSync(destination, formatted);
      const result = spawnSync('diff', ['-u', path, destination], { encoding: 'utf8' });
      console.log('ASA739_FORMAT_DIFF_START\n' + result.stdout.slice(0, 40000) + '\nASA739_FORMAT_DIFF_END');
    }
  });
});
