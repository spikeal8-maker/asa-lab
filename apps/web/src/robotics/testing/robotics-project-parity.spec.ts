/* @vitest-environment jsdom */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  createInitialRoboticsProject,
  parseRoboticsProject as parseSharedProject,
} from '@asa-lab/robotics/document';
import {
  configureProductionLibrary,
  type OwnerCatalogManifest,
} from '../../electronics/production-manifest-adapter';
import { createRoboticsProgramPreset } from '../robotics-program-presets';
import {
  createDefaultRoboticsProject,
  parseRoboticsProject,
  ROBOTICS_ARDUINO_SOURCE,
  toRoboticsWebProject,
  validateRoboticsBindings,
} from '../robotics-project';

beforeAll(() => {
  configureProductionLibrary(
    JSON.parse(
      readFileSync(
        resolve(
          process.cwd(),
          'apps/web/public/assets/electronics/component-database/catalog.json',
        ),
        'utf8',
      ),
    ) as OwnerCatalogManifest,
  );
});

describe('shared Robotics starter and browser authoring parity', () => {
  it('matches the actual catalog component factory and current Blockly generator', () => {
    const generated = createDefaultRoboticsProject(createRoboticsProgramPreset('safe-rover'));
    const server = createInitialRoboticsProject();
    expect(server).toEqual(generated);
    expect(parseSharedProject(generated)).toEqual({ ok: true, project: server });
    expect(validateRoboticsBindings(toRoboticsWebProject(server))).toBeNull();
  });

  it('retains the legacy no-argument text factory independently of the account starter', () => {
    const legacy = createDefaultRoboticsProject();
    expect(legacy.circuit.components.find(({ id }) => id === 'uno')?.stateProperties).toMatchObject(
      {
        arduinoCodeMode: 'text',
        arduinoSource: ROBOTICS_ARDUINO_SOURCE,
        arduinoSerialOpen: true,
      },
    );
    expect(
      createInitialRoboticsProject().circuit.components.find(({ id }) => id === 'uno')
        ?.stateProperties?.arduinoCodeMode,
    ).toBe('blocks');
  });

  it('adapts a validated circuit into independent mutable editor data', () => {
    const shared = createInitialRoboticsProject();
    const adapted = toRoboticsWebProject(shared);
    adapted.circuit.components[0]!.position.x += 99;
    adapted.circuit.connections.splice(0, 1);
    expect(adapted.circuit).not.toEqual(shared.circuit);
    expect(shared).toEqual(createInitialRoboticsProject());
    expect(parseRoboticsProject(shared)).toEqual({ ok: true, project: shared });
  });

  it('can save disconnected work while Run still rejects the missing drive binding', () => {
    const shared = createInitialRoboticsProject();
    const incomplete = {
      ...shared,
      circuit: {
        ...shared.circuit,
        components: shared.circuit.components.filter(({ id }) => id !== 'left-motor'),
        connections: shared.circuit.connections.filter(
          (wire) => wire.from.componentId !== 'left-motor' && wire.to.componentId !== 'left-motor',
        ),
      },
    };
    const parsed = parseRoboticsProject(incomplete);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error(parsed.message);
    expect(validateRoboticsBindings(parsed.project)).toMatch(/Левый мотор/);
  });
});
