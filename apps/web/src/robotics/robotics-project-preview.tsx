import { useLayoutEffect, useRef } from 'react';
import { registerProjectSnapshotSource, SNAPSHOT_WIDTH } from '../modules/project-snapshot';
import { rasteriseSvgStage } from '../modules/svg-snapshot';
import { RobotField } from './RobotField';
import type { RoboticsProject } from './robotics-project';

const SNAPSHOT_HEIGHT = (SNAPSHOT_WIDTH * 3) / 4;

/** A card has a fixed viewport; the complete source field is aspect-fitted
 * inside it, including very tall fields. No runtime position enters the image. */
export async function captureRoboticsSourcePreview(
  svg: SVGSVGElement,
): Promise<HTMLCanvasElement | null> {
  const box = svg.viewBox.baseVal;
  if (box.width <= 0 || box.height <= 0) return null;
  const image = await rasteriseSvgStage(
    svg,
    Math.min(SNAPSHOT_WIDTH, (SNAPSHOT_HEIGHT * box.width) / box.height),
  );
  if (!image) return null;
  const canvas = document.createElement('canvas');
  canvas.width = SNAPSHOT_WIDTH;
  canvas.height = SNAPSHOT_HEIGHT;
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#f4f8fb';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  return canvas;
}

export function RoboticsProjectPreview({
  projectId,
  project,
  getCurrentProject,
  getSavedRevision,
}: {
  readonly projectId: string;
  readonly project: RoboticsProject;
  readonly getCurrentProject: () => RoboticsProject;
  readonly getSavedRevision: () => number | null;
}): JSX.Element {
  const root = useRef<HTMLDivElement>(null);
  const committedWorld = useRef<string | null>(null);
  useLayoutEffect(() => {
    committedWorld.current = JSON.stringify(project.world);
  }, [project.world]);
  useLayoutEffect(() => {
    const revision = (): number | null =>
      committedWorld.current === JSON.stringify(getCurrentProject().world)
        ? getSavedRevision()
        : null;
    const release = registerProjectSnapshotSource(
      projectId,
      () => {
        const svg = root.current?.querySelector('svg');
        return svg && revision() !== null ? captureRoboticsSourcePreview(svg) : null;
      },
      revision,
    );
    // A preview is captured on explicit publication or exit only.
    // Never start the shared 4-second/60-second background snapshot timer here.
    return release;
  }, [projectId, getCurrentProject, getSavedRevision]);
  return (
    <div
      ref={root}
      className="robotics-project-snapshot"
      aria-hidden="true"
      data-testid="robotics-source-preview"
    >
      <RobotField world={project.world} showGrid testIdPrefix="robotics-source-preview" />
    </div>
  );
}
