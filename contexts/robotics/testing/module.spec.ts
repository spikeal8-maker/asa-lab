import { describe, expect, it } from 'vitest';
import { ModuleRegistry, MODULE_PREVIEW_SHAPE_LIMIT, previewDigest } from '@asa-lab/module-sdk';
import { ROBOTICS_MODULE } from '../module.js';
import { createInitialRoboticsProject, type RoboticsProject } from '../domain/document.js';
import {
  createRoboticsBall,
  createRoboticsFloorMark,
  createRoboticsWorldDocument,
} from '../domain/world.js';

const provider = ROBOTICS_MODULE.provider!;

describe('Robotics Project Core provider', () => {
  it('is a creatable project module without implicit learning capabilities', () => {
    const registry = new ModuleRegistry([ROBOTICS_MODULE]);
    expect(registry.list()).toEqual([
      expect.objectContaining({
        moduleKey: 'robotics',
        projectType: 'robot-world',
        schemaVersion: 3,
        availability: 'active',
        creatable: true,
        learningCapabilities: {
          assignable: false,
          editableEvidence: false,
          submitProjectVersion: false,
          preview: 'none',
        },
      }),
    ]);
    expect(registry.listLearningAssignable()).toEqual([]);
    const project = provider.createEmptyProject();
    expect(provider.validate(project)).toEqual({ ok: true, payload: project, diagnostics: [] });
  });

  it('validates editable incomplete work and reports invalid source without fallback', () => {
    const project = createInitialRoboticsProject();
    const unfinished = {
      ...project,
      circuit: { ...project.circuit, components: [], connections: [] },
    };
    expect(provider.validate(unfinished)).toEqual({
      ok: true,
      payload: unfinished,
      diagnostics: [],
    });
    expect(provider.validate({ schemaVersion: 2 })).toMatchObject({
      ok: false,
      diagnostics: [
        { code: 'robotics_document_invalid', severity: 'error', message: expect.any(String) },
      ],
    });
  });

  it.each([null, {}, [], { schemaVersion: 0 }, { schemaVersion: 4 }, { schemaVersion: '2' }])(
    'protects a previous unknown or future Robotics document: %j',
    (previous) => {
      expect(provider.validateReplacement!(previous, createInitialRoboticsProject())).toMatchObject(
        {
          ok: false,
          diagnostics: [{ code: 'robotics_document_version', severity: 'error' }],
        },
      );
    },
  );

  it('delegates protection of embedded Electronics annotation versions', () => {
    const initial = createInitialRoboticsProject();
    const annotated: RoboticsProject = {
      ...initial,
      circuit: {
        ...initial.circuit,
        schemaVersion: 5,
        annotations: [
          {
            id: 'note',
            text: 'Не терять',
            position: { x: 0, y: 0 },
            size: { width: 180, height: 80 },
            fontSize: 16,
          },
        ],
      },
    };
    expect(provider.validate(annotated).ok).toBe(true);
    expect(provider.validateReplacement!(annotated, initial)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'electronics_annotation_version' }],
    });
    expect(provider.validateReplacement!(annotated, annotated)).toEqual({ ok: true });
    expect(provider.validateReplacement!(initial, annotated)).toEqual({ ok: true });
    expect(provider.validateReplacement!({ ...initial, schemaVersion: 1 }, initial)).toEqual({
      ok: true,
    });
    expect(
      provider.validateReplacement!(
        { ...initial, circuit: { ...initial.circuit, schemaVersion: 6 } },
        annotated,
      ).ok,
    ).toBe(false);
  });
  it('preserves validated v2 identity and rejects old-client replacement of a v3 field', () => {
    const current = createInitialRoboticsProject();
    const legacy: RoboticsProject = {
      ...current,
      schemaVersion: 2,
      world: createRoboticsWorldDocument(),
    };
    const validated = provider.validate(legacy);
    expect(validated).toEqual({ ok: true, payload: legacy, diagnostics: [] });
    if (!validated.ok) throw new Error('Legacy source must remain valid');
    expect(provider.validateReplacement!(current, validated.payload)).toMatchObject({
      ok: false,
      diagnostics: [{ code: 'robotics_document_version' }],
    });
    expect(provider.validateReplacement!(legacy, current)).toEqual({ ok: true });
  });

  it('previews authored field geometry in consistent units without programs or private labels', () => {
    const initial = createInitialRoboticsProject();
    const project: RoboticsProject = {
      ...initial,
      world: {
        ...initial.world,
        field: {
          ...initial.world.field,
          balls: [createRoboticsBall('ball-private-label', { xMeters: 0.8, yMeters: 0.4 })],
        },
      },
    };
    const preview = provider.createPreview(project);
    expect(preview).toMatchObject({
      kind: 'scene',
      figure: { viewBox: { width: 500, height: 500 } },
    });
    const ballFigure = preview.figure?.shapes.find(
      (shape) => shape.shape === 'circle' && shape.cx === 80,
    );
    expect(ballFigure).toMatchObject({
      shape: 'circle',
      cx: 80,
      r: 6,
      fill: '#f59e0b',
      stroke: '#b45309',
    });
    if (!ballFigure || ballFigure.shape !== 'circle') throw new Error('Превью мяча отсутствует.');
    expect(ballFigure.cy).toBeCloseTo(460, 10);
    const changedProgram: RoboticsProject = {
      ...project,
      title: 'Приватное название',
      circuit: {
        ...project.circuit,
        components: project.circuit.components.map((component) => ({
          ...component,
          stateProperties: {
            ...component.stateProperties,
            arduinoSource: 'secret-source',
            arduinoWorkspace: 'secret-workspace',
          },
        })),
      },
    };
    expect(provider.createPreview(changedProgram)).toEqual(preview);
    expect(previewDigest(provider.createPreview(project))).toBe(previewDigest(preview));
    expect(JSON.stringify(preview)).not.toMatch(
      /arduino|Workspace|secret|Приватное|ball-private-label/,
    );
  });

  it('keeps the robot visible within the shared preview budget for a full scene', () => {
    const initial = createInitialRoboticsProject();
    const full: RoboticsProject = {
      ...initial,
      world: {
        ...initial.world,
        field: {
          ...initial.world.field,
          gridMeters: 0.02,
          obstacles: [
            ...initial.world.field.obstacles,
            ...Array.from({ length: 23 }, (_, index) => ({
              id: `wall-${index}`,
              xMeters: 0.4 + (index % 6) * 0.18,
              yMeters: 0.05 + Math.floor(index / 6) * 0.12,
              widthMeters: 0.04,
              heightMeters: 0.04,
              headingRadians: 0.1,
            })),
          ],
          balls: Array.from({ length: 12 }, (_, index) => ({
            ...createRoboticsBall(`ball-${index}`, { xMeters: 0.1 + index * 0.12, yMeters: 1.5 }),
            radiusMeters: 0.02,
          })),
          floorMarks: Array.from({ length: 48 }, (_, index) =>
            createRoboticsFloorMark('line', `mark-${index}`, {
              xMeters: 0.1,
              yMeters: 0.1 + index * 0.025,
            }),
          ),
        },
      },
    };
    expect(provider.validate(full).ok).toBe(true);
    const figure = provider.createPreview(full).figure!;
    expect(figure.shapes.length).toBeLessThanOrEqual(MODULE_PREVIEW_SHAPE_LIMIT);
    expect(
      figure.shapes.some((shape) => shape.shape === 'line' && shape.stroke === '#087d9b'),
    ).toBe(true);
    for (const shape of figure.shapes) {
      for (const value of Object.values(shape)) {
        if (typeof value === 'number') expect(Number.isFinite(value)).toBe(true);
      }
    }
  });
});
