import { describe, expect, it } from 'vitest';
import { createInitialRoboticsProject } from '@asa-lab/robotics/document';
import { createApiModuleRegistry } from './module-registry.js';
import { validatePortableProjectCopyDocument } from './private-project-copy-document.js';

const registry = createApiModuleRegistry();
const provider = registry.get('robotics')!.provider!;
const copyDocument = (source: unknown) =>
  validatePortableProjectCopyDocument(registry, 'robotics', source);
const embeddedImage = {
  kind: 'image',
  id: 'inline-mark',
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

function savedRobot() {
  const initial = createInitialRoboticsProject();
  const validated = provider.validate({
    ...initial,
    world: { ...initial.world, field: { ...initial.world.field, visuals: [embeddedImage] } },
  });
  if (!validated.ok) throw new Error('robot fixture is not a saved canonical document');
  return validated.payload as ReturnType<typeof createInitialRoboticsProject>;
}

describe('portable private Robotics source', () => {
  it('retains geometry, embedded raster bytes, circuit bindings and editable Arduino state exactly', () => {
    const robot = savedRobot();
    const board = robot.circuit.components.find(({ id }) => id === robot.world.bindings.boardId)!;
    expect(board.stateProperties?.arduinoSource).toEqual(expect.any(String));
    expect(board.stateProperties?.arduinoWorkspace).toEqual(expect.any(String));
    expect(copyDocument(robot)).toMatchObject({
      document: robot,
      preview: { digest: expect.any(String) },
    });
  });

  it('rejects unknown structured fields and external media aliases', () => {
    const robot = savedRobot();
    expect(copyDocument({ ...robot, tenantAssetId: 'unscoped-id' })).toBeNull();
    expect(
      copyDocument({
        ...robot,
        world: {
          ...robot.world,
          field: {
            ...robot.world.field,
            visuals: [{ ...embeddedImage, imageData: '/private/asset.png' }],
          },
        },
      }),
    ).toBeNull();
    expect(
      copyDocument({
        ...robot,
        circuit: {
          ...robot.circuit,
          components: robot.circuit.components.map((component, index) =>
            index === 0
              ? {
                  ...component,
                  stateProperties: {
                    ...component.stateProperties,
                    externalLibrary: '/private/library',
                  },
                }
              : component,
          ),
        },
      }),
    ).toBeNull();
  });

  it('retains ordinary switch settings and requires a local light source reference', () => {
    const robot = savedRobot();
    const parts = [
      {
        id: 'toggle',
        kind: 'visual',
        componentTypeId: 'switch-spst',
        variantId: 'switch-spst',
        position: { x: 20, y: 20 },
        value: 0,
        stateProperties: { contactState: 'open' },
      },
      {
        id: 'sensor',
        kind: 'visual',
        componentTypeId: 'photoresistor',
        variantId: 'photoresistor',
        position: { x: 30, y: 20 },
        value: 100,
        stateProperties: { lightSourceComponentId: '' },
      },
    ];
    const draft = (lightSourceComponentId: string) => {
      const parsed = provider.validate({
        ...robot,
        circuit: {
          ...robot.circuit,
          components: [
            ...robot.circuit.components,
            parts[0],
            { ...parts[1], stateProperties: { lightSourceComponentId } },
          ],
        },
      });
      if (!parsed.ok) throw new Error('robot circuit must validate');
      return parsed.payload;
    };
    const local = draft('');
    expect(copyDocument(local)?.document).toEqual(local);
    expect(copyDocument(draft('external-circuit-component'))).toBeNull();
  });
});
