#!/usr/bin/env node

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { resolve, relative, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const REQUIRED_FILES = [
  'contexts/chess/package.json',
  'contexts/chess/project.json',
  'contexts/chess/tsconfig.json',
  'contexts/chess/index.ts',
  'contexts/chess/module.ts',
  'contexts/chess/domain/chess.ts',
  'contexts/chess/domain/document.ts',
  'contexts/chess/domain/game-control.ts',
  'contexts/chess/domain/bot.ts',
  'contexts/chess/domain/fair-play.ts',
  'contexts/chess/domain/pgn.ts',
  'contexts/chess/domain/puzzle.ts',
  'contexts/chess/domain/review.ts',
  'contexts/chess/domain/symbols.ts',
  'contexts/chess/testing/chess.spec.ts',
  'contexts/chess/testing/document.spec.ts',
  'contexts/chess/testing/game-control.spec.ts',
  'contexts/chess/testing/bot.spec.ts',
  'contexts/chess/testing/fair-play.spec.ts',
  'contexts/chess/testing/module.spec.ts',
  'contexts/chess/testing/pgn.spec.ts',
  'contexts/chess/testing/puzzle.spec.ts',
  'contexts/chess/testing/review.spec.ts',
  'apps/web/src/chess/ChessBoard.tsx',
  'apps/web/src/chess/ChessEditor.tsx',
  'apps/web/src/chess/ChessModuleExperience.tsx',
  'apps/web/src/chess/ChessPuzzleTrainer.tsx',
  'apps/web/src/chess/chess-puzzles.ts',
  'apps/web/src/chess/chess-ui.ts',
  'apps/web/src/chess/use-chess-project.ts',
  'apps/web/src/chess/chess.css',
  'apps/web/src/chess/chess-training.css',
  'tests/chess/chess-ui.spec.ts',
  'e2e/chess-module.spec.ts',
  'docs/product/ASA_CHESS_PLATFORM_SPEC.md',
  'docs/testing/ASA_CHESS_TEST_MATRIX.yaml',
];
const FORBIDDEN_PORTS = ['3000', '3100', '5173'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.mjs', '.json', '.css', '.md', '.yaml']);

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
    fail(`${path} is not valid JSON: ${error.message}`);
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
  const values = [];
  for (const entry of readdirSync(absolute)) {
    const child = resolve(absolute, entry);
    if (statSync(child).isDirectory()) values.push(...walk(relative(ROOT, child)));
    else if (SOURCE_EXTENSIONS.has(extname(child)))
      values.push(relative(ROOT, child).replaceAll('\\', '/'));
  }
  return values;
}

for (const file of REQUIRED_FILES) {
  if (!existsSync(resolve(ROOT, file))) fail(`missing required file: ${file}`);
}

const contextPackage = json('contexts/chess/package.json');
if (contextPackage) {
  if (contextPackage.name !== '@asa-lab/chess')
    fail('contexts/chess package name must be @asa-lab/chess');
  if (contextPackage.private !== true) fail('contexts/chess package must be private');
  if (contextPackage.dependencies?.['@asa-lab/module-sdk'] !== 'workspace:*') {
    fail('contexts/chess must depend on @asa-lab/module-sdk via workspace:*');
  }
}

const contextProject = json('contexts/chess/project.json');
if (contextProject) {
  if (contextProject.name !== 'chess') fail('Nx chess project name must be chess');
  const tags = new Set(contextProject.tags ?? []);
  for (const tag of ['type:lib', 'scope:core', 'context:chess']) {
    if (!tags.has(tag)) fail(`contexts/chess project misses tag ${tag}`);
  }
  for (const target of ['build', 'typecheck', 'lint']) {
    if (!contextProject.targets?.[target]) fail(`contexts/chess project misses ${target} target`);
  }
}

const apiPackage = json('apps/api/package.json');
if (apiPackage?.dependencies?.['@asa-lab/chess'] !== 'workspace:*') {
  fail('apps/api must depend on @asa-lab/chess via workspace:*');
}
const webPackage = json('apps/web/package.json');
if (webPackage?.dependencies?.['@asa-lab/chess'] !== 'workspace:*') {
  fail('apps/web must depend on @asa-lab/chess via workspace:*');
}

requireMarkers('contexts/chess/module.ts', [
  "moduleKey: 'chess'",
  "projectType: 'chess-game'",
  "availability: 'active'",
  'safeModeSupported: true',
  'validateChessDocument',
  'createPreview',
  'analyse:',
]);
requireMarkers('contexts/chess/domain/chess.ts', [
  'export const START_FEN',
  'generateLegalMoves',
  'isSquareAttacked',
  'isCastleKingSide',
  'isEnPassant',
  'promotion',
  'moveToSan',
  'parseFen',
  'toFen',
  'perft',
  'draw_threefold',
  'draw_insufficient_material',
]);
requireMarkers('contexts/chess/domain/document.ts', [
  "export type ChessMode = 'analysis' | 'local' | 'computer'",
  'ChessMoveRecord',
  'ChessClockState',
  'exportChessPgn',
  'validateChessDocument',
  'Chess document contains unsupported field',
]);
requireMarkers('contexts/chess/domain/pgn.ts', [
  'stripPgnLineComments',
  'importChessPgnBase(stripPgnLineComments(pgn))',
]);
requireMarkers('contexts/chess/domain/fair-play.ts', [
  "'protected_live_rated'",
  "'engine_analysis'",
  "'move_hints'",
  'serverAuthoritativeMoves: true',
  'serverAuthoritativeClock: true',
  'spectatorDelayMs: 15_000',
]);
requireMarkers('contexts/chess/domain/review.ts', [
  "algorithm: 'asa-review-v1'",
  'centipawnLoss',
  'asaMoveQuality',
  'not Chess.com Accuracy/CAPS',
]);
requireMarkers('contexts/chess/domain/puzzle.ts', [
  'validateChessPuzzle',
  'createChessPuzzleSession',
  'playChessPuzzleMove',
  'requestChessPuzzleHint',
]);
requireMarkers('apps/api/src/module-registry.ts', [
  "import { CHESS_MODULE } from '@asa-lab/chess'",
  'new ModuleRegistry([',
  'CHESS_MODULE,',
]);
requireMarkers('apps/web/src/modules/ModuleEditorHost.tsx', [
  "import { loadChessEditor } from '../chess/load-chess-editor'",
  'chess: lazy(loadChessEditor)',
]);
requireMarkers('apps/web/src/chess/load-chess-editor.ts', [
  "import('./ChessModuleExperience')",
  'default: module.ChessModuleExperience',
]);
requireMarkers('apps/web/src/chess/ChessModuleExperience.tsx', [
  '<ChessEditor',
  '<ChessPuzzleTrainer',
  'Открыть шахматные задачи',
]);
requireMarkers('apps/web/src/chess/ChessEditor.tsx', [
  'ASA Chess',
  '<ChessBoard',
  'Новая партия или позиция',
  'PGN партии',
  'fair play',
]);
requireMarkers('apps/web/src/chess/ChessPuzzleTrainer.tsx', [
  'ASA Chess · Тренировка',
  'playChessPuzzleMove',
  'requestChessPuzzleHint',
  'Следующая задача',
  'не является копией базы задач Chess.com',
]);
requireMarkers('apps/web/src/chess/chess-puzzles.ts', [
  'asa-mate-one-001',
  'asa-back-rank-001',
  'asa-development-001',
  'не скопирован',
]);
requireMarkers('apps/web/src/chess/ChessBoard.tsx', [
  'role="grid"',
  'data-testid="asa-chess-board"',
  'draggable={canDrag}',
  'legal-target',
  'king-in-check',
]);
requireMarkers('e2e/chess-module.spec.ts', [
  'teacher creates, plays, reloads and versions an ASA Chess project',
  'ASA Bot makes a legal persisted reply',
  'learner opens the original ASA puzzle trainer and solves a mate in one',
  'chess-analysis-desktop.png',
  'chess-analysis-mobile.png',
  'chess-puzzle-desktop.png',
]);
requireMarkers('docs/product/ASA_CHESS_PLATFORM_SPEC.md', [
  'не merge в `main` до принятия R0',
  'не Chess.com Accuracy/CAPS',
  'production realtime multiplayer',
  'StudentSeat',
]);
requireMarkers('docs/testing/ASA_CHESS_TEST_MATRIX.yaml', [
  'candidate_pull_request: 66',
  'TST-CHESS-PERFT-001',
  'TST-CHESS-PUZZLE-001',
  'TST-CHESS-FAIR-PLAY-001',
  'chess-puzzle-desktop.png',
  'blocked_and_not_run_never_count_as_pass',
]);

const rootPackage = json('package.json');
if (rootPackage) {
  for (const script of ['test:chess', 'typecheck:chess', 'e2e:chess', 'chess:contract']) {
    if (!rootPackage.scripts?.[script]) fail(`root package.json misses script ${script}`);
  }
}

const lock = text('pnpm-lock.yaml');
for (const marker of ['contexts/chess:', "'@asa-lab/module-sdk':", "'@asa-lab/chess':"]) {
  if (!lock.includes(marker)) {
    fail(`pnpm-lock.yaml is not synchronized; missing marker ${marker}`);
  }
}

const candidateFiles = [
  ...walk('contexts/chess'),
  ...walk('apps/web/src/chess'),
  'apps/api/src/module-registry.ts',
  'apps/web/src/modules/ModuleEditorHost.tsx',
  'apps/web/src/modules/ModuleGlyph.tsx',
  'e2e/chess-module.spec.ts',
];
for (const path of candidateFiles) {
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
  console.error('ASA Chess candidate contract FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('ASA Chess candidate contract PASS');
console.log(`- required files: ${REQUIRED_FILES.length}`);
console.log('- standard rules / FEN / SAN / PGN / bot / puzzle / review: present');
console.log('- shared Module Registry and Editor Host integration: present');
console.log('- protected live fair-play policy: present');
console.log('- project and playable puzzle UI surfaces: present');
console.log('- package lock synchronized: true');
console.log('- forbidden ports present: 0');
console.log('- direct Chess.com runtime/assets: 0');
console.log('- complete Chess.com parity claimed: false');
