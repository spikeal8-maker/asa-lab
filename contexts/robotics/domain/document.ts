import {
  parseElectronicsEngineDocument,
  type ElectronicsEngineDocument,
} from '@asa-lab/electronics/engine';
import { parseRoboticsWorldDocument, type RoboticsWorldDocument } from './world.js';
import { extendRoboticsWorld, isRoboticsWorldV3 } from './world-document.js';

export { createInitialRoboticsProject } from './default-project.js';
export type { RoboticsWorldDocument } from './world.js';

/** Authored source only. Project Core owns identity, title, rights and revision. */
export interface RoboticsProject {
  readonly schemaVersion: 2 | 3;
  /** Legacy local-document label, independent of the account Project.title. */
  readonly title: string;
  readonly circuit: ElectronicsEngineDocument;
  readonly world: RoboticsWorldDocument;
}

export type RoboticsProjectParseResult =
  | { readonly ok: true; readonly project: RoboticsProject }
  | { readonly ok: false; readonly message: string };

/** Save validates editable source; readiness of bindings/programs belongs to Run. */
export function parseRoboticsProject(value: unknown): RoboticsProjectParseResult {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      throw new Error('Некорректный проект робототехники.');
    const source = value as Record<string, unknown>;
    if (source.schemaVersion !== 1 && source.schemaVersion !== 2 && source.schemaVersion !== 3)
      throw new Error('Эта версия проекта робототехники не поддерживается.');
    if (source.schemaVersion === 2 || source.schemaVersion === 3) {
      const scene = source.world as Partial<RoboticsWorldDocument> | null;
      if (
        !scene ||
        (source.schemaVersion === 2
          ? scene.physicsProfile !== 'kinematic-rover-discs-v1'
          : !isRoboticsWorldV3(scene as RoboticsWorldDocument)) ||
        !Array.isArray(scene.field?.balls) ||
        !Array.isArray(scene.field?.floorMarks)
      )
        throw new Error('Проект повреждён: отсутствуют обязательные данные поля.');
    }
    if (typeof source.title !== 'string' || source.title.trim() === '' || source.title.length > 80)
      throw new Error('Название проекта должно содержать от 1 до 80 символов.');
    const world = parseRoboticsWorldDocument(source.world);
    if (!world.ok) return world;
    if ((source.schemaVersion === 3) !== isRoboticsWorldV3(world.world))
      throw new Error('Версия проекта и физический профиль поля не совпадают.');
    const electrical = parseElectronicsEngineDocument(source.circuit);
    if (!electrical.ok) return { ok: false, message: `Схема: ${electrical.message}` };
    const circuit = structuredClone(electrical.document);
    return {
      ok: true,
      project: {
        schemaVersion: source.schemaVersion === 3 ? 3 : 2,
        title: source.title,
        circuit: { ...circuit, simulation: { ...circuit.simulation, running: false } },
        world: world.world,
      },
    };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : 'Не удалось прочитать проект робототехники.',
    };
  }
}

/** Only an explicit editor action upgrades legacy source. Server validation never calls this. */
export function upgradeRoboticsProjectToV3(project: RoboticsProject): RoboticsProject {
  if (project.schemaVersion === 3) return structuredClone(project);
  const upgraded = {
    ...structuredClone(project),
    schemaVersion: 3 as const,
    world: extendRoboticsWorld(project.world, 'educational'),
  };
  const parsed = parseRoboticsProject(upgraded);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.project;
}
