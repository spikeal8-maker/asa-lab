import { readFileSync } from 'node:fs';
import { format, resolveConfig } from 'prettier';
import { it } from 'vitest';

// Temporary, read-only CI formatter diagnostic. Remove after applying exact
// Prettier output to the workbench files. Never edits the workspace.
it('report the exact Prettier hunks for the bounded image workbench', async () => {
  const paths = [
    'apps/web/src/admin/AdminAiImages.tsx',
    'apps/web/src/admin/AdminComfyImageTest.tsx',
    'apps/web/src/admin/AdminComfyUiPage.tsx',
    'apps/web/src/admin/ai-image-workbench.css',
    'apps/web/src/admin/testing/ai-image-workbench.spec.ts',
  ];
  for (const path of paths) {
    const actual = readFileSync(path, 'utf8');
    const formatted = await format(actual, {
      ...(await resolveConfig(path)),
      filepath: path,
    });
    const before = actual.split('\n');
    const after = formatted.split('\n');
    const n = before.length;
    const m = after.length;
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i]![j] = before[i] === after[j] ? dp[i + 1]![j + 1]! + 1 :
          Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
    let i = 0;
    let j = 0;
    const patches: { start: number; deleteCount: number; added: string[] }[] = [];
    let current: (typeof patches)[number] | null = null;
    const emit = () => {
      if (current) patches.push(current);
      current = null;
    };
    while (i < n || j < m) {
      if (i < n && j < m && before[i] === after[j]) {
        emit();
        i++;
        j++;
      } else if (j < m && (i === n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
        if (!current) current = { start: i, deleteCount: 0, added: [] };
        current.added.push(after[j]!);
        j++;
      } else {
        if (!current) current = { start: i, deleteCount: 0, added: [] };
        current.deleteCount++;
        i++;
      }
    }
    emit();
    console.log('ASA_FORMAT_PATCH=' + JSON.stringify({ path, patches }));
  }
});
