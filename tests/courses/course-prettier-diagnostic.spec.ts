import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { describe, it } from 'vitest';
import { format, resolveConfig } from 'prettier';

describe('temporary course formatter diagnostic', () => {
  it('prints exact Prettier diff for the PostgreSQL regression file', async () => {
    const path = 'tests/courses/course-activity-blocks.pg.spec.ts';
    const source = readFileSync(path, 'utf8');
    const options = (await resolveConfig(path)) ?? {};
    const formatted = await format(source, { ...options, filepath: path });
    if (formatted !== source) {
      const destination = '/tmp/asa-course-activity-prettier-expected.ts';
      writeFileSync(destination, formatted);
      const result = spawnSync('diff', ['-u', path, destination], { encoding: 'utf8' });
      console.log('COURSE_PRETTIER_DIFF_START\n' + result.stdout.slice(0, 28000) + '\nCOURSE_PRETTIER_DIFF_END');
    }
  });
});
