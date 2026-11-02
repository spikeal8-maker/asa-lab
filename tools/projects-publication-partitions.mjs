// Separate fixture lifecycles, not relaxed request budgets. Each synchronous
// Playwright invocation owns e2e/server.mjs (reuseExistingServer=false).
import process from 'node:process';
export const publicationBrowserPartitions = [
  {
    name: 'core',
    files: [
      'e2e/publication-comments.spec.ts',
      'e2e/student-project-policy.spec.ts',
      'e2e/public-projects.spec.ts',
      'e2e/public-project-electronics-viewer.spec.ts',
      'e2e/public-project-electronics-player.spec.ts',
      'e2e/public-project-copy.spec.ts',
      'e2e/public-project-admin-moderation.spec.ts',
      'e2e/gallery.spec.ts',
      'e2e/project-hub.spec.ts',
    ],
  },
  { name: 'likes', files: ['e2e/publication-likes.spec.ts'] },
];

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
