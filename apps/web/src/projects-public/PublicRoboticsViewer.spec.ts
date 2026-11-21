// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createRoboticsWorldDocument } from '@asa-lab/robotics/world-document';
import {
  validatePublicRoboticsArtifact,
  validatePublicRoboticsArtifactV6,
  type PublicRoboticsArtifact,
} from '@asa-lab/contracts';
import { PublicRoboticsViewer } from './PublicRoboticsViewer';

let host: HTMLDivElement;
let root: Root;
let artifact: PublicRoboticsArtifact;
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const source = createRoboticsWorldDocument();
  const result = validatePublicRoboticsArtifact({
    schemaVersion: 5,
    status: 'display',
    viewerFamily: 'robotics',
    provenance: { publicationId: '123e4567-e89b-42d3-a456-426614174001', revisionNumber: 4 },
    capabilities: { readOnly: true, interactive: true, download: false },
    world: {
      field: {
        ...source.field,
        balls: [{ id: 'published-ball', xMeters: 0.8, yMeters: 0.8, radiusMeters: 0.06 }],
      },
      robot: source.robot,
      initialPose: source.initialPose,
    },
  });
  if (!result.ok) throw Error('public geometry fixture rejected');
  artifact = result.artifact;
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function render() {
  await act(async () => root.render(createElement(PublicRoboticsViewer, { artifact })));
}
function button(name: string) {
  const match = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
    (element) => (element.getAttribute('aria-label') ?? element.textContent?.trim()) === name,
  );
  if (!match) throw Error(`Button not found: ${name}`);
  return match;
}

it('shows the immutable source geometry with no editing, program or fabricated runtime readings', async () => {
  await render();
  expect(
    host
      .querySelector('[data-testid="public-robotics-viewer"]')
      ?.getAttribute('data-revision-number'),
  ).toBe('4');
  expect(
    host.querySelector('[data-testid="public-robotics-field"]')?.getAttribute('data-editable'),
  ).toBe('false');
  const robot = host.querySelector('[data-testid="public-robotics-robot"]')!;
  expect(Number(robot.getAttribute('data-x-meters'))).toBe(artifact.world.initialPose.xMeters);
  expect(Number(robot.getAttribute('data-y-meters'))).toBe(artifact.world.initialPose.yMeters);
  expect(host.querySelector('[data-ball-id="published-ball"]')).not.toBeNull();
  expect(host.querySelector('[data-velocity-x], [data-velocity-y], polyline')).toBeNull();
  expect(host.textContent).toContain('Сохранённая сцена и начальное положение робота');
  expect(host.textContent).not.toMatch(/Запустить|Сохранить|Редактировать|Скачать|C\+\+|RPM/);
});

it('changes the viewport with real zoom, fit, construction and grid controls without mutating geometry', async () => {
  await render();
  const before = JSON.stringify(artifact);
  const scene = host.querySelector<HTMLDivElement>('.public-robotics-scene')!;
  const stage = host.querySelector<HTMLDivElement>('[data-testid="public-robotics-stage"]')!;
  const field = host.querySelector<SVGSVGElement>('[data-testid="public-robotics-field"]')!;
  const fieldViewBox = field.getAttribute('viewBox');
  expect(button('Отдалить поле').disabled).toBe(true);
  await act(async () => button('Приблизить поле').click());
  expect(scene.style.width).toBe('125%');
  expect(scene.style.height).toBe('125%');
  expect(host.querySelector('output')?.textContent).toBe('125%');
  stage.scrollLeft = 40;
  stage.scrollTop = 25;
  await act(async () => button('Показать целиком').click());
  expect(scene.style.width).toBe('100%');
  expect(stage.scrollLeft).toBe(0);
  expect(stage.scrollTop).toBe(0);
  await act(async () => button('Конструкция').click());
  expect(button('Конструкция').getAttribute('aria-pressed')).toBe('true');
  expect(field.getAttribute('viewBox')).not.toBe(fieldViewBox);
  expect(host.querySelector('input')?.disabled).toBe(true);
  expect(host.querySelector('[data-ball-id="published-ball"]')).toBeNull();
  await act(async () => button('Поле').click());
  expect(field.getAttribute('viewBox')).toBe(fieldViewBox);
  const grid = host.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  expect(grid.checked).toBe(true);
  await act(async () => grid.click());
  expect(grid.checked).toBe(false);
  expect(host.querySelector('rect[fill^="url(#robotics-grid-"]')).toBeNull();
  expect(JSON.stringify(artifact)).toBe(before);
});

it('supports keyboard zoom and Home, with bounded controls', async () => {
  await render();
  const stage = host.querySelector<HTMLDivElement>('[data-testid="public-robotics-stage"]')!;
  for (let index = 0; index < 8; index++)
    await act(async () =>
      stage.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true })),
    );
  expect(host.querySelector('output')?.textContent).toBe('300%');
  expect(button('Приблизить поле').disabled).toBe(true);
  await act(async () =>
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: '-', bubbles: true })),
  );
  expect(host.querySelector('output')?.textContent).toBe('200%');
  await act(async () =>
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })),
  );
  expect(host.querySelector('output')?.textContent).toBe('100%');
});

it('renders frozen v6 tiles, curves, can and block with geometry only, while retaining the v5 path', async () => {
  expect(artifact.schemaVersion).toBe(5);
  const result = validatePublicRoboticsArtifactV6({
    ...artifact,
    schemaVersion: 6,
    world: {
      ...artifact.world,
      field: {
        ...artifact.world.field,
        widthMeters: 6 * 0.3,
        tiles: { enabled: true, sizeMeters: 0.3 },
        surface: 'wood',
        bodies: [
          {
            id: 'can-public',
            label: 'Металлическая банка',
            kind: 'can',
            xMeters: 0.8,
            yMeters: 1.2,
            headingRadians: 0.3,
            radiusMeters: 0.033,
            heightMeters: 0.115,
          },
          {
            id: 'box-public',
            label: 'Деревянный брусок',
            kind: 'box',
            xMeters: 1.2,
            yMeters: 1.2,
            headingRadians: 0.5,
            widthMeters: 0.12,
            depthMeters: 0.08,
            heightMeters: 0.04,
          },
        ],
        floorMarks: [
          {
            id: 'curve-public',
            kind: 'curve',
            start: { xMeters: 0, yMeters: 0.15 },
            control: { xMeters: 0.15, yMeters: 0.15 },
            end: { xMeters: 0.15, yMeters: 0.3 },
            widthMeters: 0.02,
            color: '#1e293b',
          },
        ],
      },
    },
  });
  if (!result.ok) throw Error('v6 geometry fixture rejected');
  const frozen = JSON.stringify(result.artifact);
  await act(async () =>
    root.render(createElement(PublicRoboticsViewer, { artifact: result.artifact })),
  );
  expect(host.querySelector('[data-testid="public-robotics-tiles"]')).not.toBeNull();
  expect(host.querySelectorAll('[data-body-id]')).toHaveLength(2);
  expect(
    host.querySelector('[data-body-id="can-public"]')?.getAttribute('data-heading-radians'),
  ).toBe('0.3');
  expect(host.querySelector('[data-body-id="box-public"]')?.getAttribute('transform')).toContain(
    'rotate(',
  );
  expect(host.querySelector('[data-floor-mark-id="curve-public"]')?.getAttribute('d')).toContain(
    'Q',
  );
  expect(host.querySelector('g[clip-path]')).not.toBeNull();
  expect(host.querySelector('[data-velocity-x], [data-velocity-y], polyline')).toBeNull();
  expect(host.textContent).toContain('1800 мм');
  expect(host.textContent).not.toContain('1799.999');
  expect(host.textContent).not.toMatch(/Масса|Тяга|Сохранить|Изменить|Программа/);
  await act(async () => button('Конструкция').click());
  expect(
    host.querySelector(
      '[data-body-id], [data-floor-mark-id], [data-testid="public-robotics-tiles"]',
    ),
  ).toBeNull();
  await act(async () => button('Поле').click());
  expect(host.querySelectorAll('[data-body-id]')).toHaveLength(2);
  expect(JSON.stringify(result.artifact)).toBe(frozen);
});
