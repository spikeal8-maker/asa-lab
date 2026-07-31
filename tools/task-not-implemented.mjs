#!/usr/bin/env node

const name = process.argv[2] ?? 'unknown-task-test';

console.error(
  `BLOCKED: ${name} is registered in the Account C1 quality contract but its real suite has not been implemented yet. Replace this command with the focused Vitest/Playwright suite before claiming PASS.`,
);

process.exit(78);
