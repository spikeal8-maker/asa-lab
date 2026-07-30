#!/usr/bin/env node

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { extname, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_FILES = [
  'contexts/chess-live/package.json',
  'contexts/chess-live/project.json',
  'contexts/chess-live/tsconfig.json',
  'contexts/chess-live/index.ts',
  'contexts/chess-live/domain/model.ts',
  'contexts/chess-live/domain/challenge.ts',
  'contexts/chess-live/domain/game.ts',
  'contexts/chess-live/domain/matchmaking.ts',
  'contexts/chess-live/domain/rating.ts',
  'contexts/chess-live/domain/protocol.ts',
  'contexts/chess-live/application/ports.ts',
  'contexts/chess-live/application/service.ts',
  'contexts/chess-live/infrastructure/memory-repository.ts',
  'contexts/chess-live/infrastructure/pg-repository.ts',
  'contexts/chess-live/infrastructure/runtime.ts',
  'contexts/chess-live/testing/challenge.spec.ts',
  'contexts/chess-live/testing/game.spec.ts',
  'contexts/chess-live/testing/matchmaking.spec.ts',
  'contexts/chess-live/testing/rating.spec.ts',
  'contexts/chess-live/testing/protocol.spec.ts',
  'contexts/chess-live/testing/service.spec.ts',
  'apps/api/src/chess-live.controller.ts',
  'apps/api/src/chess-live.controller.spec.ts',
  'apps/web/src/chess/chess-live-api.ts',
  'apps/web/src/chess/ChessOnlineLobby.tsx',
  'apps/web/src/chess/chess-online.css',
  'tests/chess-live/pg-repository.spec.ts',
  'e2e/chess-live.spec.ts',
  'migrations/0006_chess_live.sql',
  'migrations/0007_chess_live_privilege_tightening.sql',
  'docs/product/ASA_CHESS_ONLINE_SPEC.md',
  'docs/testing/ASA_CHESS_ONLINE_TEST_MATRIX.yaml',
];
const SOURCE_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.mjs',
  '.json',
  '.css',
  '.md',
  '.yaml',
  '.sql',
]);
const FORBIDDEN_PORTS = ['3000', '3100', '5173'];
const failures = [];

function fail(message) {
  failures.push(message);
}

function text(path) {
  const absolute = resolve(ROOT, path);
  if (!existsSync(absolute)) {
    fail(`missing required file: ${path}`);
    return '';
  }
  return readFileSync(absolute, 'utf8');
}

function json(path) {
  const source = text(path);
  if (!source) return null;
  try {
    return JSON.parse(source);
  } catch (error) {
    fail(`${path} is invalid JSON: ${error.message}`);
    return null;
  }
}

function requireMarkers(path, markers) {
  const source = text(path);
  for (const marker of markers) {
    if (!source.includes(marker)) fail(`${path} misses required marker: ${marker}`);
  }
}

function walk(path) {
  const absolute = resolve(ROOT, path);
  if (!existsSync(absolute)) return [];
  const result = [];
  for (const entry of readdirSync(absolute)) {
    const child = resolve(absolute, entry);
    if (statSync(child).isDirectory()) result.push(...walk(relative(ROOT, child)));
    else if (SOURCE_EXTENSIONS.has(extname(child))) {
      result.push(relative(ROOT, child).replaceAll('\\', '/'));
    }
  }
  return result;
}

for (const file of REQUIRED_FILES) {
  if (!existsSync(resolve(ROOT, file))) fail(`missing required file: ${file}`);
}

const packageJson = json('contexts/chess-live/package.json');
if (packageJson) {
  if (packageJson.name !== '@asa-lab/chess-live') {
    fail('chess-live package name must be @asa-lab/chess-live');
  }
  if (packageJson.private !== true) fail('chess-live package must be private');
  for (const dependency of ['@asa-lab/chess', '@asa-lab/database']) {
    if (packageJson.dependencies?.[dependency] !== 'workspace:*') {
      fail(`chess-live must depend on ${dependency} via workspace:*`);
    }
  }
}

const projectJson = json('contexts/chess-live/project.json');
if (projectJson) {
  if (projectJson.name !== 'chess-live') fail('Nx project name must be chess-live');
  const tags = new Set(projectJson.tags ?? []);
  for (const tag of ['type:lib', 'scope:core', 'context:chess-live']) {
    if (!tags.has(tag)) fail(`chess-live project misses tag ${tag}`);
  }
  for (const target of ['build', 'typecheck', 'lint']) {
    if (!projectJson.targets?.[target]) fail(`chess-live project misses ${target} target`);
  }
}

const apiPackage = json('apps/api/package.json');
if (apiPackage?.dependencies?.['@asa-lab/chess-live'] !== 'workspace:*') {
  fail('apps/api must depend on @asa-lab/chess-live via workspace:*');
}

requireMarkers('contexts/chess-live/domain/game.ts', [
  'applyLegalMove',
  'settleClock',
  'positionKeys',
  'game_finished',
  'draw_agreement',
  'resignation',
  'timeout',
]);
requireMarkers('contexts/chess-live/domain/challenge.ts', [
  'challenge creator cannot accept own challenge',
  'only the creator can cancel the challenge',
  'challenge has expired',
  'validateLiveTimeControl',
]);
requireMarkers('contexts/chess-live/application/service.ts', [
  'checkReplay',
  'expectedVersion',
  'spectatorEvents',
  'SPECTATOR_DELAY_MS = 15_000',
  'joinMatchmaking',
  'applyRatingUpdate',
]);
requireMarkers('contexts/chess-live/domain/matchmaking.ts', [
  'matchmakingRatingWindow',
  'areMatchmakingTicketsCompatible',
  'findMatchmakingPair',
]);
requireMarkers('contexts/chess-live/domain/rating.ts', [
  "algorithm: 'asa-elo-v1'",
  'ASA_INITIAL_CHESS_RATING = 1200',
  'ASA_PROVISIONAL_GAMES = 10',
  'calculateChessRatingUpdate',
]);
requireMarkers('contexts/chess-live/domain/protocol.ts', [
  "CHESS_LIVE_PROTOCOL_VERSION = 'asa-chess-live-v1'",
  "type: 'client.hello'",
  "type: 'game.snapshot'",
  "type: 'game.command_ack'",
]);
requireMarkers('contexts/chess-live/infrastructure/pg-repository.ts', [
  "import { withTenantContext } from '@asa-lab/database'",
  'WHERE id = $1 AND version = $11',
  'INSERT INTO chess_live_events',
  'ON CONFLICT (tenant_id, player_id, rating_pool)',
  'rating ledger gameId does not match update gameId',
]);
requireMarkers('migrations/0006_chess_live.sql', [
  'CREATE TABLE IF NOT EXISTS chess_live_challenges',
  'CREATE TABLE IF NOT EXISTS chess_live_games',
  'CREATE TABLE IF NOT EXISTS chess_live_events',
  'CREATE TABLE IF NOT EXISTS chess_live_command_receipts',
  'CREATE TABLE IF NOT EXISTS chess_matchmaking_tickets',
  'CREATE TABLE IF NOT EXISTS chess_ratings',
  'CREATE TABLE IF NOT EXISTS chess_rating_ledger',
  'FORCE ROW LEVEL SECURITY',
  'chess_matchmaking_one_queued_player_idx',
  'UNIQUE (tenant_id, game_id, player_id)',
  'chess_live_append_only',
]);
requireMarkers('migrations/0007_chess_live_privilege_tightening.sql', [
  'REVOKE UPDATE ON chess_live_command_receipts FROM asalab_app',
]);
requireMarkers('apps/api/src/chess-live.controller.ts', [
  "@Controller('api/chess/live')",
  "checkBodyShape(rawBody, ['expectedVersion', 'uci'])",
  "@Headers('idempotency-key')",
  'tenantId: principal.tenantId',
  'userId: principal.userId',
]);
requireMarkers('apps/api/src/app.module.ts', [
  'ChessLiveController',
  'PgChessLiveRepository',
  'pool ? new PgChessLiveRepository(pool)',
  'new MemoryChessLiveRepository()',
  'TOKENS.chessLiveService',
]);
requireMarkers('apps/web/src/chess/ChessOnlineLobby.tsx', [
  'Вызовы и поиск соперника',
  'Создать код вызова',
  'Найти соперника',
  'Ходы, версия позиции, результат и часы определяются сервером',
  '<ChessBoard',
]);
requireMarkers('apps/web/src/chess/ChessModuleExperience.tsx', [
  "type ChessSurface = 'project' | 'training' | 'review' | 'online'",
  '<ChessOnlineLobby',
  'Открыть онлайн-шахматы',
]);
requireMarkers('tests/chess-live/pg-repository.spec.ts', [
  'persists a direct challenge, accepted game, moves and reconnect across repository instances',
  'isolates challenge codes, games and events across tenants at PostgreSQL RLS',
  'expected-version races',
  'immutable ledger exactly once',
  'append-only',
]);
requireMarkers('e2e/chess-live.spec.ts', [
  'two teachers create and play one server-authoritative direct challenge',
  'rated matchmaking pairs compatible teachers and writes rating after resignation',
  "tenantId: 'tenant:foreign'",
  'chess-online-white-desktop.png',
  'chess-online-black-mobile.png',
]);
requireMarkers('docs/product/ASA_CHESS_ONLINE_SPEC.md', [
  'server-authoritative',
  'PgChessLiveRepository',
  'not Chess.com rating parity',
  'do not merge before R0',
  'all local gates `NOT_RUN`',
]);
requireMarkers('docs/testing/ASA_CHESS_ONLINE_TEST_MATRIX.yaml', [
  'candidate_pull_request: 68',
  'TST-CHESS-LIVE-CHALLENGE-001',
  'TST-CHESS-LIVE-PG-001',
  'TST-CHESS-LIVE-RLS-001',
  'TST-CHESS-LIVE-E2E-001',
  'blocked_and_not_run_never_count_as_pass',
]);

const root = json('package.json');
if (root) {
  for (const script of [
    'chess-live:contract',
    'typecheck:chess-live',
    'test:chess-live',
    'test:chess-live:pg',
    'e2e:chess-live',
  ]) {
    if (!root.scripts?.[script]) fail(`root package.json misses script ${script}`);
  }
}

const lock = text('pnpm-lock.yaml');
for (const marker of [
  'contexts/chess-live:',
  "'@asa-lab/chess-live':",
  "'@asa-lab/database':",
]) {
  if (!lock.includes(marker)) {
    fail(`pnpm-lock.yaml is not synchronized; missing marker ${marker}`);
  }
}

for (const path of [
  ...walk('contexts/chess-live'),
  ...walk('apps/web/src/chess'),
  'apps/api/src/chess-live.controller.ts',
  'tests/chess-live/pg-repository.spec.ts',
  'e2e/chess-live.spec.ts',
]) {
  const source = text(path);
  for (const port of FORBIDDEN_PORTS) {
    if (new RegExp(`(?:localhost|127\\.0\\.0\\.1):${port}\\b`).test(source)) {
      fail(`${path} contains forbidden runtime port ${port}`);
    }
  }
  if (/https?:\/\/(?:www\.)?chess\.com/i.test(source)) {
    fail(`${path} contains a direct Chess.com runtime or asset URL`);
  }
  if (/from\s+['"](?:chess\.js|stockfish|@lichess|@chess)/i.test(source)) {
    fail(`${path} imports an unreviewed third-party chess runtime`);
  }
}

if (failures.length > 0) {
  console.error('ASA Chess Online candidate contract FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('ASA Chess Online candidate contract PASS');
console.log(`- required files: ${REQUIRED_FILES.length}`);
console.log('- server-authoritative challenge/game/matchmaking/rating contracts: present');
console.log('- durable forced-RLS PostgreSQL repository and migrations: present');
console.log('- REST candidate and transport-neutral websocket protocol: present');
console.log('- two-session direct and rated browser flows: present');
console.log('- client-authored FEN/result/clock/rating fields: rejected');
console.log('- package lock synchronized: true');
console.log('- local compile/unit/database/browser execution: NOT_PROVEN_BY_THIS_SOURCE_GATE');
console.log('- forbidden ports present: 0');
console.log('- complete Chess.com parity claimed: false');
