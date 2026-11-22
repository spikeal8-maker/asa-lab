/* @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  createRoboticsWorldV3Document,
  ROBOTICS_FIELD_PRESETS,
} from '@asa-lab/robotics/world-document';
import { RobotField } from '../RobotField';

function scene(presetId: (typeof ROBOTICS_FIELD_PRESETS)[number]['id']) {
  const world = createRoboticsWorldV3Document(presetId);
  const root = document.createElement('div');
  root.innerHTML = renderToStaticMarkup(
    createElement(RobotField, {
      world,
      showGrid: true,
      view: 'field',
      testIdPrefix: 'centered-field',
    }),
  );
  const marker = root.querySelector<SVGGElement>('[data-testid="centered-field-start-zone"]');
  const robot = root.querySelector<SVGGElement>('[data-testid="centered-field-robot"]');
  const zone = marker?.querySelector<SVGRectElement>('rect');
  return { world, root, marker, robot, zone };
}

describe('30 × 30 cm Robotics start square', () => {
  it.each(ROBOTICS_FIELD_PRESETS)(
    'places the robot and non-physical START marker exactly at the center of $id',
    (preset) => {
      const { world, marker, robot, zone } = scene(preset.id);
      const centerX = preset.widthMeters / 2;
      const centerY = preset.heightMeters / 2;
      expect(world.initialPose).toEqual({
        xMeters: centerX,
        yMeters: centerY,
        headingRadians: 0,
      });
      expect(marker).not.toBeNull();
      expect(marker?.getAttribute('pointer-events')).toBe('none');
      expect(marker?.getAttribute('data-zone-size-meters')).toBe('0.3');
      expect(marker?.getAttribute('data-center-x-meters')).toBe(String(centerX));
      expect(marker?.getAttribute('data-center-y-meters')).toBe(String(centerY));
      expect(marker?.querySelector('title')?.textContent).toContain('30 × 30 см');
      expect(marker?.querySelector('text')?.textContent).toBe('СТАРТ');
      expect(zone?.getAttribute('width')).toBe('300');
      expect(zone?.getAttribute('height')).toBe('300');
      expect(Number(zone?.getAttribute('x'))).toBeCloseTo(centerX * 1000 - 150, 8);
      expect(Number(zone?.getAttribute('y'))).toBeCloseTo(
        (preset.heightMeters - centerY) * 1000 - 150,
        8,
      );
      expect(robot?.getAttribute('data-x-meters')).toBe(String(centerX));
      expect(robot?.getAttribute('data-y-meters')).toBe(String(centerY));
      // Full drawn envelope of the default 20 cm chassis + HC-SR04 stays
      // within the start square: +112 mm forward, +/-88 mm across the axle.
      expect(world.robot.bodyLengthMeters * 500).toBeLessThan(150);
      expect(world.robot.sensorForwardMeters * 1000 + 10).toBeLessThan(150);
      expect(world.robot.wheelTrackMeters * 500 + world.robot.wheelWidthMeters * 500).toBeLessThan(
        150,
      );
    },
  );

  it('shows the zone on field/preview only; no duplicate marker in the robot close-up', () => {
    const world = createRoboticsWorldV3Document('arena');
    const html = renderToStaticMarkup(
      createElement(RobotField, { world, showGrid: false, view: 'robot' }),
    );
    expect(html).not.toContain('data-zone-size-meters');
    expect(html).not.toContain('robotics-start-zone');
  });

  it('uses the saved starting pose for existing documents without silently rewriting their source', () => {
    const old = createRoboticsWorldV3Document('practice');
    const moved = {
      ...old,
      initialPose: { ...old.initialPose, xMeters: 0.6, yMeters: 0.6 },
    };
    const root = document.createElement('div');
    root.innerHTML = renderToStaticMarkup(
      createElement(RobotField, { world: moved, showGrid: true }),
    );
    expect(
      root
        .querySelector('[data-testid="robotics-start-zone"]')
        ?.getAttribute('data-center-x-meters'),
    ).toBe('0.6');
    expect(old.initialPose.xMeters).toBe(0.9);
  });
});
