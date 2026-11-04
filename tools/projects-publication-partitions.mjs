// Separate fixture lifecycles, not relaxed request budgets. Each synchronous
// Playwright invocation owns e2e/server.mjs (reuseExistingServer=false).
import process from 'node:process';
export const publicationBrowserPartitions = [
  'publication-comments',
  'student-project-policy',
  'public-projects',
  'public-project-electronics-viewer',
  'public-project-electronics-player',
  'public-project-copy',
  'public-project-admin-moderation',
  'gallery',
  'project-hub',
  'publication-likes',
].map((name) => ({ name, files: [`e2e/${name}.spec.ts`] }));

export function runPublicationBrowserPartitions(run, env = process.env) {
  if (env.ASA_E2E_EXTERNAL === 'true') {
    throw new Error('Publication fixture isolation requires an owned Playwright API server');
  }
  for (const partition of publicationBrowserPartitions) {
    const status = run([
      'exec',
      'playwright',
      'test',
      ...partition.files,
      '--workers=1',
      '--retries=0',
      '--reporter=list',
      `--output=reports/playwright/projects-publication/${partition.name}`,
    ]);
    if (status !== 0) throw new Error('Publication browser partition failed: ' + partition.name);
  }
}
