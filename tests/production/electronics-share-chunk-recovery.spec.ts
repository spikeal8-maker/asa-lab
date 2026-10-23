import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
  new URL('../../apps/web/src/pages/SchematicEditor.tsx', import.meta.url),
  'utf8',
);
const globalRecovery = readFileSync(
  new URL('../../apps/web/public/vite-preload-recovery.js', import.meta.url),
  'utf8',
);
const syntax = ts.createSourceFile(
  'SchematicEditor.tsx',
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const loaders: string[] = [];

function visit(node: ts.Node): void {
  if (
    ts.isVariableDeclaration(node) &&
    node.name.getText(syntax) === 'ShareDialog' &&
    node.initializer
  ) {
    loaders.push(node.initializer.getText(syntax));
  }
  ts.forEachChild(node, visit);
}
visit(syntax);
if (loaders.length !== 1) throw new Error('Missing actual ShareDialog lazy loader');

const importCall = "import('../electronics/WorkbenchShareDialog')";
if (loaders[0].split(importCall).length !== 2) throw new Error('Unexpected Share import');

interface Loader {
  load: () => Promise<{ default: unknown }>;
  fallback: unknown;
}

class OptionalPreloadEvent extends Event {
  readonly detail: unknown;

  constructor(type: string, options: { detail: unknown; cancelable: boolean }) {
    super(type, { cancelable: options.cancelable });
    this.detail = options.detail;
  }
}

function makeBrowser() {
  let reloads = 0;
  const sessionStorage = {
    getItem: (_key: string) => null,
    setItem: (_key: string, _val: string) => {},
  };
  const window = Object.assign(new EventTarget(), {
    location: {
      reload: () => {
        reloads += 1;
      },
    },
    sessionStorage,
  });
  runInNewContext(globalRecovery, {
    window,
    sessionStorage,
    CustomEvent: OptionalPreloadEvent,
    Date,
  });
  return { window, reloads: () => reloads };
}

function makeLoader(window: EventTarget, loadChunk: () => Promise<unknown>): Loader {
  // Transpile the real callback; replace only its network import.
  const actualCode = loaders[0].replace(importCall, 'loadChunk()');
  const compiled = ts.transpileModule(
    `const ShareLoadError = () => null;
const ShareDialog = ${actualCode};
exports.load = ShareDialog;
exports.fallback = ShareLoadError;`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports: Partial<Loader> = {};
  runInNewContext(compiled, {
    window,
    exports,
    loadChunk,
    lazy: (factory: Loader['load']) => factory,
  });
  if (!exports.load || !exports.fallback) throw new Error('Share loader not captured');
  return exports as Loader;
}

function emitFailure(window: EventTarget, error: Error): void {
  window.dispatchEvent(
    Object.assign(new Event('vite:preloadError', { cancelable: true }), { payload: error }),
  );
}

describe('actual optional Share loader and production Vite preload recovery', () => {
  for (const message of [
    'Importing a module script failed.',
    'Failed to fetch dynamically imported module: /assets/WorkbenchShareDialog-old.js',
  ]) {
    it(`preserves unsaved editor on failed Share import: ${message}`, async () => {
      const browser = makeBrowser();
      let rejectChunk: (error: Error) => void = () => {
        throw new Error('Import did not start');
      };
      const delayedImport = new Promise<never>((_resolve, reject) => {
        rejectChunk = reject;
      });
      const share = makeLoader(browser.window, () => delayedImport);
      const loading = share.load();
      const failedChunk = new TypeError(message);

      emitFailure(browser.window, failedChunk);
      expect(browser.reloads()).toBe(0);

      rejectChunk(failedChunk);
      await expect(loading).resolves.toEqual({ default: share.fallback });
      expect(browser.reloads()).toBe(0);

      emitFailure(browser.window, new Error('Later unrelated lazy import failed'));
      expect(browser.reloads(), 'Share listener removed when settled').toBe(1);
    });
  }
  it('restores normal recovery for a concurrent unrelated module failure', async () => {
    const browser = makeBrowser();
    let rejectChunk: (error: Error) => void = () => {
      throw new Error('Share import was not started');
    };
    const delayedImport = new Promise<never>((_resolve, reject) => {
      rejectChunk = reject;
    });
    const share = makeLoader(browser.window, () => delayedImport);
    const loading = share.load();

    // This error has exactly the generic text WebKit can report for Share.
    // Only the Error object rejected by Share belongs to this guarded import.
    emitFailure(browser.window, new TypeError('Importing a module script failed.'));
    expect(browser.reloads()).toBe(0);
    const shareFailure = new TypeError('Importing a module script failed.');
    emitFailure(browser.window, shareFailure);
    rejectChunk(shareFailure);
    await expect(loading).resolves.toEqual({ default: share.fallback });
    expect(browser.reloads(), 'concurrent unrelated error must still recover').toBe(1);
  });
});
