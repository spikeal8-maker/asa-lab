import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const source = readFileSync('e2e/electronics-simulation-time.spec.ts', 'utf8');
const parsed = ts.createSourceFile('clock.ts', source, ts.ScriptTarget.Latest, true);
const declaration = parsed.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'attributeClockPublication',
);
if (!declaration) throw new Error('Actual clock attribution callback is missing');
const javascript = ts.transpileModule(
  `${declaration.getText(parsed)}\nattributeClockPublication;`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  },
).outputText;
const frame = {
  documentId: 'document-a',
  workerId: 2,
  requestId: 'request-1',
  projectSessionId: 'project-a',
  matchedActiveRequest: true,
  generationId: 3,
  requestedMicroseconds: 1000600,
  committedMicroseconds: 1000600,
  status: 'ready',
  computeMs: 1,
  resultSolved: true,
  resultFinite: true,
  resultPassed: true,
  computeMsFinite: true,
  receivedAt: 5296.7,
};
const publication = {
  text: 'Время моделирования: 00:00:01',
  publishedAt: 5297.1,
  frame: null,
  startup: false,
  documentId: 'document-a',
  marker: '1000.6',
  mountId: 2,
  mountBindingStable: true,
  binding: { workerId: 2, generationId: 3, projectSessionId: 'project-a' },
};
type Frame = typeof frame;
type Publication = Omit<typeof publication, 'frame' | 'marker'> & {
  frame: Frame | null;
  marker: string | null;
  equivalentRequestIds?: string[];
};
const attribute = runInNewContext(javascript) as (p: Publication, frames: Frame[]) => Publication;

describe('actual clock DOM commit-input attribution', () => {
  it('accepts a legal delayed commit without associating it with latest ready', () => {
    const delayed = { ...publication, marker: '990', text: 'Время моделирования: 00:00:00' };
    const earlier = {
      ...frame,
      committedMicroseconds: 990000,
      requestedMicroseconds: 990000,
      requestId: 'earlier',
    };
    const result = attribute(delayed, [earlier, frame]);
    expect(result.frame?.requestId).toBe('earlier');
    expect(result.text).toBe(delayed.text);
    expect(result.equivalentRequestIds).toEqual(['earlier']);
  });
  it('retains all equivalent same-binding/horizon receipts, independent of request identity', () => {
    const frames = [frame, { ...frame, requestId: 'request-2', receivedAt: 5297 }];
    const result = attribute(publication, frames);
    expect(result.equivalentRequestIds).toEqual(['request-1', 'request-2']);
    expect(frames).toHaveLength(2);
  });
  it('preserves the wrong visible sample and rejects it instead of choosing a frame by text', () => {
    const wrong = { ...publication, text: 'Время моделирования: 00:00:00' };
    expect(() => attribute(wrong, [frame])).toThrow('input/text mismatch');
    expect(wrong.text).toBe('Время моделирования: 00:00:00');
    expect(wrong.frame).toBeNull();
  });
  it.each([null, '', ' ', 'NaN', 'Infinity', '-1'])(
    'rejects absent/nonfinite marker %s',
    (marker) => {
      expect(() => attribute({ ...publication, marker }, [frame])).toThrow();
    },
  );
  it.each(['documentId', 'workerId', 'generationId', 'projectSessionId'] as const)(
    'rejects cross-run alias through %s',
    (key) => {
      const foreign = { ...frame, [key]: typeof frame[key] === 'number' ? 99 : 'foreign' };
      expect(() => attribute(publication, [foreign] as Frame[])).toThrow('no equivalent');
    },
  );
  it.each([
    { receivedAt: 5300 },
    { status: 'yielded' },
    { matchedActiveRequest: false },
    { resultFinite: false },
    { resultPassed: false },
    { resultSolved: false },
    { computeMsFinite: false },
    { committedMicroseconds: NaN },
    { requestedMicroseconds: 1000601 },
    { committedMicroseconds: -1 },
  ])('rejects future/unqualified ready receipt %j', (patch) => {
    expect(() => attribute(publication, [{ ...frame, ...patch }])).toThrow('no equivalent');
  });
  it('accepts explicitly observed startup zero without claiming a React frame', () => {
    const result = attribute(
      { ...publication, startup: true, marker: '0', text: 'Время моделирования: 00:00:00' },
      [],
    );
    expect(result.frame).toBeNull();
    expect(result.equivalentRequestIds).toEqual([]);
  });
  it('rejects zero alias from a previous run once startup is over', () => {
    const current = { ...publication, marker: '0', text: 'Время моделирования: 00:00:00' };
    expect(() =>
      attribute(current, [
        {
          ...frame,
          workerId: 1,
          generationId: 1,
          requestedMicroseconds: 0,
          committedMicroseconds: 0,
        },
      ]),
    ).toThrow();
  });
  it('fails closed when mount provenance is unknown instead of assuming zero means reset', () => {
    expect(() =>
      attribute(
        {
          ...publication,
          mountBindingStable: false,
          startup: true,
          marker: '0',
          text: 'Время моделирования: 00:00:00',
        },
        [],
      ),
    ).toThrow('mount binding');
  });
  it('keeps full durable history and does not impose a browser-era 500-frame cap', () => {
    const frames = Array.from({ length: 1300 }, (_, index) => ({
      ...frame,
      requestId: `request-${index}`,
    }));
    expect(attribute(publication, frames).equivalentRequestIds).toHaveLength(1300);
    expect(frames).toHaveLength(1300);
  });
});

function sampleDeclaration(node: ts.Node): ts.Expression | undefined {
  if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === 'sample')
    return node.initializer;
  return ts.forEachChild(node, sampleDeclaration);
}
const sampleExpression = sampleDeclaration(parsed);
if (!sampleExpression) throw new Error('Actual browser sampler is missing');
const sampleJavaScript = ts.transpileModule(`(${sampleExpression.getText(parsed)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
function sampler() {
  const element = {
    textContent: 'Время моделирования: 00:00:00',
    marker: '0',
    getAttribute() {
      return this.marker;
    },
  };
  const context = {
    document: { querySelectorAll: () => [element] },
    documentId: 'document-a',
    nextMount: 0,
    activeBinding: null as Publication['binding'] | null,
    awaitingReady: true,
    errors: [] as string[],
    mounts: new WeakMap(),
    performance: { now: () => 5297.1 },
  };
  const sample = runInNewContext(sampleJavaScript, context) as () => Publication | null;
  return { element, context, sample };
}
describe('actual passive browser sampler', () => {
  it('reads actual marker independently of text and preserves malformed visible samples', () => {
    const { element, sample } = sampler();
    element.marker = '1000.6';
    const result = sample()!;
    expect(result.marker).toBe('1000.6');
    expect(result.text).toBe('Время моделирования: 00:00:00');
    expect(result.frame).toBeNull();
  });
  it('binds initial unbound mount to the first real preflight without a false failure', () => {
    const { context, sample } = sampler();
    expect(sample()!.mountBindingStable).toBe(true);
    context.activeBinding = publication.binding;
    context.awaitingReady = false;
    const result = sample()!;
    expect(result.mountId).toBe(1);
    expect(result.binding).toEqual(publication.binding);
    expect(result.mountBindingStable).toBe(true);
  });
  it('records a real replacement mount and rejects unexplained same-mount binding changes', () => {
    const { context, element, sample } = sampler();
    context.activeBinding = publication.binding;
    expect(sample()!.mountId).toBe(1);
    context.activeBinding = { ...publication.binding, generationId: 5 };
    expect(sample()!.mountBindingStable).toBe(false);
    context.document.querySelectorAll = () => [{ ...element }];
    const replacement = sample()!;
    expect(replacement.mountId).toBe(2);
    expect(replacement.mountBindingStable).toBe(true);
  });
  it('does not fabricate an absent marker or an absent DOM mount', () => {
    const { context, sample } = sampler();
    context.document.querySelectorAll = () => [];
    expect(sample()).toBeNull();
  });
  it('fails closed on duplicate clock elements', () => {
    const { context, element, sample } = sampler();
    context.document.querySelectorAll = () => [element, { ...element }];
    expect(sample()).toBeNull();
    expect(context.errors).toEqual(['Ambiguous clock DOM mount']);
  });
});

const observationDeclaration = parsed.statements.find(
  (node): node is ts.FunctionDeclaration =>
    ts.isFunctionDeclaration(node) && node.name?.text === 'observation',
);
if (!observationDeclaration) throw new Error('Actual Node observation callback is missing');
const observationJavaScript = ts.transpileModule(
  `${declaration.getText(parsed)}\n${observationDeclaration.getText(parsed)}\nobservation;`,
  {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  },
).outputText;
describe('actual full durable Node observation', () => {
  function observe(sample: Publication) {
    const frames = Array.from({ length: 1300 }, (_, index) => ({
      ...frame,
      requestId: `request-${index}`,
    }));
    const probe = {
      frames,
      requests: [{ unchanged: true }],
      actions: [{ name: 'Run' }],
      publications: [sample],
      settledSamples: [sample],
    };
    const store = {
      probe,
      errors: [],
      documents: new Map([['document-a', { sequence: 1, hashes: ['ack'], hash: 'ack' }]]),
    };
    const page = {
      evaluate: async () => ({
        documentId: 'document-a',
        sequence: 1,
        ack: { sequence: 1, hash: 'ack' },
        errors: [],
      }),
    };
    const callback = runInNewContext(observationJavaScript, {
      clockStores: { get: () => store },
      expect,
      structuredClone,
    }) as (page: unknown) => Promise<typeof probe>;
    return { result: callback(page), probe };
  }
  it('indexes equivalent provenance without dropping any frame or mutating durable originals', async () => {
    const { result, probe } = observe(publication);
    const after = await result;
    expect(after.frames).toHaveLength(1300);
    expect(after.publications[0].equivalentRequestIds).toHaveLength(1300);
    expect(after.settledSamples[0].equivalentRequestIds).toHaveLength(1300);
    expect(after.requests).toEqual(probe.requests);
    expect(after.actions).toEqual(probe.actions);
    expect(probe.publications[0].frame).toBeNull();
    expect(probe.publications[0].equivalentRequestIds).toBeUndefined();
  });
  it('rejects wrong text while retaining the full original durable wrong sample', async () => {
    const wrong = { ...publication, text: 'Время моделирования: 00:00:00' };
    const { result, probe } = observe(wrong);
    await expect(result).rejects.toThrow('input/text mismatch');
    expect(probe.frames).toHaveLength(1300);
    expect(probe.publications[0].text).toBe(wrong.text);
  });
});
