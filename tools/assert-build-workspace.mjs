#!/usr/bin/env node
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

if (existsSync(resolve('.release-immutable')) || existsSync(resolve('release-manifest.json'))) {
  console.error('BLOCKED: build is forbidden inside an immutable ASA Lab release directory.');
  process.exit(78);
}
