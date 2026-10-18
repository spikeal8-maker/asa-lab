// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';
import vm from 'node:vm';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { FastifyRequest } from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import { BlocksEditor } from '../../apps/web/src/blocks/BlocksEditor';
import { ClientDiagnosticsController } from '../../apps/api/src/client-diagnostics.controller';

describe('ordinary Scratch save failure to structured diagnostics', () => {
  it.each(['asset', 'draft', 'prepare'] as const)(
    'delivers a privacy-safe %s failure without an exit or fatal editor transition',
    async (stage) => {
      const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
      const previousAct = testGlobal.IS_REACT_ACT_ENVIRONMENT;
      testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
      const logs: Array<Record<string, unknown>> = [];
      const out = vi.spyOn(process.stdout, 'write').mockImplementation((value) => {
        const text = String(value);
        if (text.includes('"kind":"client_diagnostic"')) logs.push(JSON.parse(text));
        return true;
      });
      const container = document.body.appendChild(document.createElement('div'));
      const root = createRoot(container);
      const controller = new ClientDiagnosticsController();
      const projectId = '11111111-1111-4111-8111-111111111111';
      const relatedRequestId = '22222222-2222-4222-8222-222222222222';
      const request = {
        id: '33333333-3333-4333-8333-333333333333',
        ip: '127.0.0.1',
        headers: {},
        raw: { socket: { remoteAddress: '127.0.0.1' } },
      } as unknown as FastifyRequest;
      const reply = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json', date: new Date().toUTCString() },
        });
      const flush = async () => {
        for (let i = 0; i < 30; i++) await Promise.resolve();
      };
      vi.stubGlobal(
        'fetch',
        vi.fn<typeof fetch>(async (path, init) => {
          if (String(path) === '/api/diagnostics/client')
            return reply(controller.report(request, JSON.parse(init!.body as string)), 202);
          if (String(path).includes('/api/diagnostics/quality'))
            return reply({ accepted: true }, 202);
          return reply({
            runtimeOrigin: window.location.origin,
            runtimeToken: 'header.payload.signature',
            expiresAt: Date.now() + 3_600_000,
            draftRevision: 17,
            projectJson: null,
            assets: [],
          });
        }),
      );
      try {
        const onBack = vi.fn(),
          onHome = vi.fn();
        await act(async () => {
          root.render(
            createElement(BlocksEditor, {
              projectId,
              recoveryPrincipalKey: 'principal',
              onBack,
              onHomeClick: onHome,
              accountLabel: 'Fixture',
              accountInitials: 'F',
              onAccountClick: vi.fn(),
            }),
          );
          await flush();
        });
        const frame = container.querySelector('iframe')!;
        const post = vi
          .spyOn(frame.contentWindow!, 'postMessage')
          .mockImplementation(() => undefined);
        await act(async () => {
          frame.dispatchEvent(new Event('load'));
          await flush();
        });
        const init = post.mock.calls.find(
          ([message]) => message.messageType === 'ASA_BLOCKS_INIT',
        )![0];
        const parentWindow = {
          postMessage(message: unknown, targetOrigin: string) {
            expect(targetOrigin).toBe(window.location.origin);
            const event = new MessageEvent('message', {
              data: structuredClone(message),
              origin: window.location.origin,
            });
            Object.defineProperty(event, 'source', { value: frame.contentWindow });
            window.dispatchEvent(event);
          },
        };
        const context = vm.createContext({
          TextEncoder,
          TextDecoder,
          ArrayBuffer,
          Uint8Array,
          URL,
          crypto: webcrypto,
          fetch: async () =>
            new Response('{}', {
              status: stage === 'asset' ? 400 : 503,
              headers: { 'x-request-id': relatedRequestId },
            }),
        });
        vm.runInContext(readFileSync('infra/scratch-editor/host/storage.js', 'utf8'), context);
        vm.runInContext(readFileSync('infra/scratch-editor/host/status.js', 'utf8'), context);
        const reporter = context.AsaBlocksStatus.createStatusReporter({
          parentWindow,
          targetOrigin: window.location.origin,
          getBinding: () => ({
            protocolVersion: init.protocolVersion,
            projectId,
            sessionNonce: init.sessionNonce,
          }),
        });
        class Storage {
          AssetType = Object.fromEntries(
            ['Project', 'ImageVector', 'ImageBitmap', 'Sound'].map((name) => [name, { name }]),
          );
          DataFormat = { JSON: 'json', SVG: 'svg', PNG: 'png', JPG: 'jpg', WAV: 'wav', MP3: 'mp3' };
          webStore!: (asset: ReturnType<Storage['createAsset']>) => { url: string };
          createAsset(assetType: unknown, dataFormat: string, data: Uint8Array, assetId: string) {
            return { assetType, dataFormat, data, assetId, clean: false };
          }
          addHelper() {}
          addWebStore(
            _types: unknown,
            _get: unknown,
            _create: unknown,
            update: Storage['webStore'],
          ) {
            this.webStore = update;
          }
          async store(assetType: unknown, dataFormat: string, data: Uint8Array, assetId: string) {
            const request = this.webStore(this.createAsset(assetType, dataFormat, data, assetId));
            const response = await context.fetch(request.url, { ...request, body: data });
            if (!response.ok) throw response.status; // The pinned FetchTool's rejection contract.
            return response.json();
          }
        }
        const id = 'a'.repeat(32);
        const storage: {
          scratchStorage: { AssetType: Record<string, unknown> };
          saveProject(projectId: string, json: string): Promise<unknown>;
          getConfirmedRevision(): number;
        } = context.AsaBlocksStorage.createReadOnlyStorage(
          {
            ScratchStorage: Storage,
            buildDefaultProject: () => [
              {
                assetType: 'Project',
                dataFormat: 'JSON',
                id: 0,
                data: '{"targets":[],"monitors":[],"extensions":[]}',
              },
            ],
          },
          {
            projectId,
            apiOrigin: window.location.origin,
            canSave: true,
            draftRevision: 17,
            projectJson: null,
            assets: [],
            getRuntimeToken: () => 'PRIVATE_CAPABILITY',
            getProjectGeneration: () => 1,
            getProjectAssets: () => [
              {
                assetId: id,
                dataFormat: 'svg',
                data: Uint8Array.of(1),
                assetType: storage.scratchStorage.AssetType.ImageVector,
              },
            ],
            onSaveFailure: (detail: unknown) => reporter.saveFailed(detail),
          },
        );
        const project = {
          targets: [
            {
              name: 'PRIVATE_PUPIL_WORK',
              costumes: stage === 'asset' ? [{ assetId: id, dataFormat: 'svg' }] : [],
              sounds: [],
              blocks: { secret: 'PRIVATE_CODE' },
            },
          ],
          monitors: [],
          extensions: [],
        };
        await act(async () => {
          reporter.status('editor-ready');
          await expect(
            storage.saveProject(
              projectId,
              stage === 'prepare' ? 'PRIVATE_INVALID_JSON' : JSON.stringify(project),
            ),
          ).rejects.toBeDefined();
          await flush();
        });
        const failed = logs.filter((entry) => entry.code === 'autosave_failed');
        expect(failed).toHaveLength(1);
        expect(failed[0]).toMatchObject({
          module: 'scratch',
          phase: 'save',
          category: 'technical',
          failureCode: `scratch-save-${stage}`,
          level: 'error',
          untrustedClientReport: true,
        });
        if (stage === 'draft')
          expect(failed[0]).toMatchObject({ httpStatus: 503, relatedRequestId });
        if (stage === 'asset') expect(failed[0]).toMatchObject({ httpStatus: 400 });
        if (stage === 'prepare') expect(failed[0]).not.toHaveProperty('httpStatus');
        expect(JSON.stringify(failed)).not.toMatch(
          /PRIVATE_|header\.payload|runtimeToken|projectJson|assetId/,
        );
        expect(onBack).not.toHaveBeenCalled();
        expect(onHome).not.toHaveBeenCalled();
        expect(container.querySelector('iframe')).toBe(frame);
        expect(container.textContent).not.toContain('Не удалось загрузить');
        expect(storage.getConfirmedRevision()).toBe(17);
      } finally {
        await act(async () => root.unmount());
        container.remove();
        out.mockRestore();
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
        window.sessionStorage.clear();
        testGlobal.IS_REACT_ACT_ENVIRONMENT = previousAct;
      }
    },
  );
});
