import { describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import { EMPTY_DOCUMENT } from '@asa-lab/electronics';
import { createEmptyThreeDDocument, createThreeDNode } from '@asa-lab/three-d';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { createApiModuleRegistry } from './module-registry.js';
import {
  createStudentPublicationReview,
  createStudentPublicationReviewArtifact,
  readStudentPublicationReviewArtifact,
} from './student-publication-review.js';

const projectId = '123e4567-e89b-42d3-a456-426614174001';
const requestId = '123e4567-e89b-42d3-a456-426614174002';
const classroomId = '123e4567-e89b-42d3-a456-426614174003';
const registry = createApiModuleRegistry();
const savedShape = {
  ...createEmptyThreeDDocument(),
  nodes: [{ ...createThreeDNode('box', 'actual-saved-shape'), name: 'Saved item' }],
};

describe('exact private publication review artifact', () => {
  it('creates read-only 3D geometry from canonical saved content and denies unknown source data', () => {
    expect(
      createStudentPublicationReviewArtifact(registry, 'three-d', savedShape, projectId, 6),
    ).toMatchObject({
      schemaVersion: 4,
      viewerFamily: 'three-d',
      capabilities: { readOnly: true, interactive: true, download: false },
      nodes: [{ id: 'actual-saved-shape', name: 'Saved item' }],
    });
    expect(
      createStudentPublicationReviewArtifact(
        registry,
        'three-d',
        { ...savedShape, privateMediaPath: '/private/source' },
        projectId,
        6,
      ),
    ).toBeNull();
  });

  it('requires the full canonical Electronics simulation and refuses the inert fallback', () => {
    expect(
      createStudentPublicationReviewArtifact(registry, 'electronics', EMPTY_DOCUMENT, projectId, 1),
    ).toMatchObject({ viewerFamily: 'electronics', schemaVersion: 3, status: 'simulation' });
    const firmware = 'void setup() {}\nvoid loop() {}';
    const board = registry.get('electronics')!.provider!.validate({
      ...EMPTY_DOCUMENT,
      components: [
        {
          id: 'controller',
          kind: 'visual',
          componentTypeId: 'arduino-uno',
          variantId: 'arduino-uno',
          position: { x: 20, y: 30 },
          value: 0,
          stateProperties: { arduinoCodeMode: 'text', arduinoSource: firmware },
        },
      ],
    });
    if (!board.ok) throw new Error('saved Arduino fixture must validate');
    expect(
      createStudentPublicationReviewArtifact(registry, 'electronics', board.payload, projectId, 1),
    ).toMatchObject({
      components: [{ id: 'controller', stateProperties: { arduinoSource: firmware } }],
    });
    const part = { id: 'r', kind: 'resistor', position: { x: 0, y: 0 }, value: 330 };
    const withUnknownState = registry.get('electronics')!.provider!.validate({
      ...EMPTY_DOCUMENT,
      components: [{ ...part, stateProperties: { novelPhysicalSetting: 100 } }],
    });
    if (!withUnknownState.ok) throw new Error('unknown raw physical fixture must validate');
    expect(
      createStudentPublicationReviewArtifact(
        registry,
        'electronics',
        withUnknownState.payload,
        projectId,
        1,
      ),
    ).toBeNull();
    const blocks = registry.get('blocks')?.provider?.createEmptyProject();
    expect(
      createStudentPublicationReviewArtifact(registry, 'blocks', blocks, projectId, 1),
    ).toBeNull();
  });

  it('retains the saved robot circuit, sensor bindings, Blockly and bounded raster on the field', () => {
    const source = createInitialRoboticsProject();
    const photo = {
      kind: 'image',
      id: 'review-mark',
      xMeters: 0.1,
      yMeters: 0.1,
      widthMeters: 0.15,
      heightMeters: 0.15,
      strokeColor: '#333333',
      fillColor: '#ffffff',
      fillEnabled: false,
      rotationRadians: 0,
      imageData:
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jS9sAAAAASUVORK5CYII=',
    };
    const doc = (imageData: string, bindings = source.world.bindings) => {
      const parsed = registry.get('robotics')!.provider!.validate({
        ...source,
        world: {
          ...source.world,
          bindings,
          field: { ...source.world.field, visuals: [{ ...photo, imageData }] },
        },
      });
      if (!parsed.ok) throw new Error('review robot fixture must validate');
      return parsed.payload;
    };
    const good = createStudentPublicationReviewArtifact(
      registry,
      'robotics',
      doc(photo.imageData),
      projectId,
      4,
    );
    expect(good).toMatchObject({
      schemaVersion: 7,
      robotVersion: 3,
      viewerFamily: 'robotics',
      capabilities: { download: false, readOnly: true, interactive: true },
      world: { bindings: source.world.bindings, field: { visuals: [photo] } },
      circuit: {
        components: expect.arrayContaining([
          expect.objectContaining({
            id: source.world.bindings.boardId,
            stateProperties: expect.objectContaining({
              arduinoSource: expect.stringContaining('void setup'),
              arduinoWorkspace: expect.stringContaining('asa_loop'),
              arduinoInputPins: ['2'],
            }),
          }),
        ]),
        connections: source.circuit.connections,
      },
    });
    expect(JSON.stringify(good)).not.toMatch(
      /arduinoSerialOpen|arduinoBaudRate|"viewport"|"title"/,
    );
    expect(
      createStudentPublicationReviewArtifact(
        registry,
        'robotics',
        doc('data:image/png;base64,PHN2Zz4='),
        projectId,
        4,
      ),
    ).toBeNull();
    expect(
      createStudentPublicationReviewArtifact(
        registry,
        'robotics',
        doc(photo.imageData, { ...source.world.bindings, boardId: 'external-board' }),
        projectId,
        4,
      ),
    ).toBeNull();
    const unsupportedControl = registry.get('robotics')!.provider!.validate({
      ...source,
      circuit: {
        ...source.circuit,
        components: source.circuit.components.map((component) =>
          component.id === source.world.bindings.boardId
            ? {
                ...component,
                stateProperties: { ...component.stateProperties, unreviewedMotorControl: 1 },
              }
            : component,
        ),
      },
    });
    if (!unsupportedControl.ok) throw new Error('raw Robotics fixture must validate');
    expect(
      createStudentPublicationReviewArtifact(
        registry,
        'robotics',
        unsupportedControl.payload,
        projectId,
        4,
      ),
    ).toBeNull();
  });

  it('derives stored geometry from the authoritative draft rather than a harmless cover', async () => {
    const seal = Buffer.alloc(32, 4);
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            module_key: 'three-d',
            document_json: savedShape,
            source_seal: seal,
            cover: { nodes: [] },
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ data: { requestId, state: 'waiting_teacher' } }] });
    const pool = { query } as unknown as pg.Pool;
    expect(
      await createStudentPublicationReview(
        pool,
        registry,
        requestId,
        projectId,
        'hash',
        6,
        {},
        requestId,
      ),
    ).toEqual({ requestId, state: 'waiting_teacher' });
    expect(query.mock.calls[1]?.[1][6]).toBe(seal);
    const artifact = JSON.parse(query.mock.calls[1]?.[1][7] as string);
    expect(artifact.nodes).toMatchObject([{ id: 'actual-saved-shape' }]);
    expect(artifact).not.toHaveProperty('cover');
  });

  it('fails closed when a scoped review row cannot prove its bound request and revision', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          data: {
            requestId,
            sourceRevision: 6,
            artifact: createStudentPublicationReviewArtifact(
              registry,
              'three-d',
              savedShape,
              projectId,
              6,
            ),
          },
        },
      ],
    });
    const pool = { query } as unknown as pg.Pool;
    await expect(
      readStudentPublicationReviewArtifact(
        pool,
        { role: 'teacher', actor: projectId, classroomId },
        requestId,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(query.mock.calls[0]?.[1]).toEqual([projectId, 'teacher', classroomId, requestId]);
  });
});
