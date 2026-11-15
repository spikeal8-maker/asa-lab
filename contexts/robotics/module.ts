import { ELECTRONICS_MODULE } from '@asa-lab/electronics';
import {
  defineModule,
  MODULE_PREVIEW_SHAPE_LIMIT,
  type ModuleDiagnostic,
  type ModulePreviewFigure,
  type ModulePreviewShape,
} from '@asa-lab/module-sdk';
import {
  createInitialRoboticsProject,
  parseRoboticsProject,
  type RoboticsProject,
} from './domain/document.js';

/** Preview units are 100 per metre; source and physics always retain SI units. */
const PREVIEW_SCALE = 100;

function roboticsPreviewFigure(payload: RoboticsProject): ModulePreviewFigure {
  const { field, initialPose: pose, robot } = payload.world;
  const x = (metres: number): number => metres * PREVIEW_SCALE;
  const y = (metres: number): number => (field.heightMeters - metres) * PREVIEW_SCALE;
  const shapes: ModulePreviewShape[] = [
    {
      shape: 'rect',
      x: 0,
      y: 0,
      width: x(field.widthMeters),
      height: x(field.heightMeters),
      fill: '#f8fbfd',
      stroke: '#94a3b8',
    },
  ];

  // A thumbnail cannot show every 2 cm grid cell. Reserve room for actual work.
  const grid = Math.max(field.gridMeters, Math.max(field.widthMeters, field.heightMeters) / 12);
  for (let at = grid; at < field.widthMeters; at += grid)
    shapes.push({
      shape: 'line',
      x1: x(at),
      y1: 0,
      x2: x(at),
      y2: x(field.heightMeters),
      stroke: '#e2e8f0',
      width: 0.3,
    });
  for (let at = grid; at < field.heightMeters; at += grid)
    shapes.push({
      shape: 'line',
      x1: 0,
      y1: y(at),
      x2: x(field.widthMeters),
      y2: y(at),
      stroke: '#e2e8f0',
      width: 0.3,
    });

  // Decorative grid lines are lowest priority. Authored objects must not vanish
  // from thumbnails merely because a 5-metre field needs more grid lines.
  const gridShapeCount = shapes.length;
  for (const mark of field.floorMarks) {
    if (mark.kind === 'curve') {
      const point = (t: number) => ({
        x:
          (1 - t) ** 2 * mark.start.xMeters +
          2 * (1 - t) * t * mark.control.xMeters +
          t ** 2 * mark.end.xMeters,
        y:
          (1 - t) ** 2 * mark.start.yMeters +
          2 * (1 - t) * t * mark.control.yMeters +
          t ** 2 * mark.end.yMeters,
      });
      for (let index = 0; index < 8; index++) {
        const from = point(index / 8),
          to = point((index + 1) / 8);
        shapes.push({
          shape: 'line',
          x1: x(from.x),
          y1: y(from.y),
          x2: x(to.x),
          y2: y(to.y),
          stroke: mark.color,
          width: x(mark.widthMeters),
        });
      }
      continue;
    }
    shapes.push(
      mark.kind === 'line'
        ? {
            shape: 'line',
            x1: x(mark.start.xMeters),
            y1: y(mark.start.yMeters),
            x2: x(mark.end.xMeters),
            y2: y(mark.end.yMeters),
            stroke: mark.color,
            width: x(mark.widthMeters),
          }
        : {
            shape: 'rect',
            x: x(mark.xMeters),
            y: y(mark.yMeters + mark.heightMeters),
            width: x(mark.widthMeters),
            height: x(mark.heightMeters),
            fill: mark.color,
          },
    );
  }

  const outline = (
    centreX: number,
    centreY: number,
    width: number,
    height: number,
    heading: number,
    stroke: string,
    strokeWidth: number,
  ): ModulePreviewShape[] => {
    const cosine = Math.cos(heading);
    const sine = Math.sin(heading);
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ].map(([sx, sy]) => ({
      x: x(centreX + ((sx * width) / 2) * cosine - ((sy * height) / 2) * sine),
      y: y(centreY + ((sx * width) / 2) * sine + ((sy * height) / 2) * cosine),
    }));
    return corners.map((from, index) => {
      const to = corners[(index + 1) % corners.length];
      return {
        shape: 'line',
        x1: from.x,
        y1: from.y,
        x2: to.x,
        y2: to.y,
        stroke,
        width: strokeWidth,
      };
    });
  };
  for (const wall of field.obstacles)
    shapes.push(
      ...outline(
        wall.xMeters + wall.widthMeters / 2,
        wall.yMeters + wall.heightMeters / 2,
        wall.widthMeters,
        wall.heightMeters,
        wall.headingRadians ?? 0,
        '#64748b',
        1.2,
      ),
    );
  for (const ball of field.balls)
    shapes.push({
      shape: 'circle',
      cx: x(ball.xMeters),
      cy: y(ball.yMeters),
      r: x(ball.radiusMeters),
      fill: '#f59e0b',
      stroke: '#b45309',
    });
  for (const body of field.bodies ?? []) {
    if (body.kind === 'can')
      shapes.push({
        shape: 'circle',
        cx: x(body.xMeters),
        cy: y(body.yMeters),
        r: x(body.radiusMeters),
        fill: '#cbd5e1',
        stroke: '#475569',
      });
    else
      shapes.push(
        ...outline(
          body.xMeters,
          body.yMeters,
          body.widthMeters,
          body.depthMeters,
          body.headingRadians,
          '#a16207',
          1.4,
        ),
      );
  }

  const robotShapes = outline(
    pose.xMeters,
    pose.yMeters,
    robot.bodyLengthMeters,
    robot.bodyWidthMeters,
    pose.headingRadians,
    '#087d9b',
    1.6,
  );
  const cosine = Math.cos(pose.headingRadians);
  const sine = Math.sin(pose.headingRadians);
  for (const side of [-1, 1])
    robotShapes.push(
      ...outline(
        pose.xMeters - (sine * side * robot.wheelTrackMeters) / 2,
        pose.yMeters + (cosine * side * robot.wheelTrackMeters) / 2,
        robot.wheelRadiusMeters * 2,
        robot.wheelWidthMeters,
        pose.headingRadians,
        '#334155',
        1.6,
      ),
    );
  robotShapes.push({
    shape: 'line',
    x1: x(pose.xMeters),
    y1: y(pose.yMeters),
    x2: x(pose.xMeters + (cosine * robot.bodyLengthMeters) / 2),
    y2: y(pose.yMeters + (sine * robot.bodyLengthMeters) / 2),
    stroke: '#087d9b',
    width: 2.2,
  });
  const sensorX =
    pose.xMeters + cosine * robot.sensorForwardMeters - sine * robot.sensorLateralMeters;
  const sensorY =
    pose.yMeters + sine * robot.sensorForwardMeters + cosine * robot.sensorLateralMeters;
  robotShapes.push({
    shape: 'line',
    x1: x(sensorX),
    y1: y(sensorY),
    x2: x(sensorX + Math.cos(pose.headingRadians + robot.sensorHeadingRadians) * 0.08),
    y2: y(sensorY + Math.sin(pose.headingRadians + robot.sensorHeadingRadians) * 0.08),
    stroke: '#0d9488',
    width: 1.2,
  });

  return {
    viewBox: { width: x(field.widthMeters), height: x(field.heightMeters) },
    background: '#f8fbfd',
    shapes: (() => {
      const available = Math.max(0, MODULE_PREVIEW_SHAPE_LIMIT - robotShapes.length);
      const authored = [shapes[0]!, ...shapes.slice(gridShapeCount)].slice(0, available);
      const gridBudget = Math.max(0, available - authored.length);
      return [...authored, ...shapes.slice(1, gridShapeCount).slice(0, gridBudget), ...robotShapes];
    })(),
  };
}

function invalidDocument(message: string, code: string): readonly ModuleDiagnostic[] {
  return [{ code, severity: 'error', message }];
}

const validateCircuitReplacement = ELECTRONICS_MODULE.provider?.validateReplacement;
if (!validateCircuitReplacement)
  throw new Error('Robotics requires the canonical Electronics replacement validator.');

export const ROBOTICS_MODULE = defineModule<RoboticsProject>(
  {
    moduleKey: 'robotics',
    moduleVersion: '0.3.0',
    displayName: 'Виртуальная робототехника',
    shortDescription: 'Роботы, поля, датчики и программы на основе общего ядра электроники.',
    defaultProjectTitlePrefix: 'Проект робототехники',
    projectType: 'robot-world',
    schemaVersion: 3,
    editorRoute: '/projects/:projectId/robotics',
    viewerRoute: '/view/projects/:versionId/robotics',
    safeModeSupported: true,
    availability: 'active',
    previewKind: 'scene',
    iconKey: 'robot',
    categories: ['robotics', 'coding'],
    learningCapabilities: {
      assignable: false,
      editableEvidence: false,
      submitProjectVersion: false,
      preview: 'none',
    },
  },
  {
    createEmptyProject: createInitialRoboticsProject,
    validate: (payload) => {
      const parsed = parseRoboticsProject(payload);
      return parsed.ok
        ? { ok: true, payload: parsed.project, diagnostics: [] }
        : { ok: false, diagnostics: invalidDocument(parsed.message, 'robotics_document_invalid') };
    },
    validateReplacement: (previous, payload) => {
      const source =
        previous !== null && typeof previous === 'object' && !Array.isArray(previous)
          ? (previous as Record<string, unknown>)
          : null;
      if (
        !source ||
        ![1, 2, 3].includes(source.schemaVersion as number) ||
        (source.schemaVersion === 3 && payload.schemaVersion !== 3)
      )
        return {
          ok: false,
          diagnostics: invalidDocument(
            'Формат проекта обновлён. Откройте его в новой версии редактора.',
            'robotics_document_version',
          ),
        };
      return validateCircuitReplacement(source.circuit, payload.circuit);
    },
    createPreview: (payload) => ({
      kind: 'scene',
      summary: `Поле ${payload.world.field.widthMeters} × ${payload.world.field.heightMeters} м · ${payload.circuit.components.length} компонентов`,
      figure: roboticsPreviewFigure(payload),
    }),
  },
);
