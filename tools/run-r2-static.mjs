#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const commands = [
  ["pnpm", ["format:check"]],
  ["pnpm", ["lint"]],
  ["pnpm", ["typecheck"]],
  ["pnpm", ["boundaries:check"]],
  ["pnpm", ["contracts:check"]],
  ["pnpm", ["build"]],
  ["pnpm", ["test"]],
];

for (const [command, args] of commands) {
  console.log(`\n[R2 static gate] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) {
    console.error(result.error.message);
    process.exit(78);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

console.log("\nR2 static and regression gate: PASS");
