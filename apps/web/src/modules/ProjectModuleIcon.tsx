import { useId } from 'react';

/** Owner-supplied artwork, clipped to a circle with transparent outer corners. */
const MODULE_ICON_CENTERS: Record<string, readonly [number, number]> = {
  'three-d': [170, 338],
  cad: [468, 338],
  electronics: [768, 338],
  blocks: [1066, 338],
  programming: [1370, 338],
  robotics: [170, 700],
  drawing: [468, 700],
  vector: [768, 700],
  ai: [1066, 700],
  all: [1370, 700],
};
export function ProjectModuleIcon({
  moduleKey,
  size = 28,
}: {
  readonly moduleKey: string;
  readonly size?: number;
}) {
  const [x, y] = MODULE_ICON_CENTERS[moduleKey] ?? MODULE_ICON_CENTERS.all;
  const clipId = useId();
  return (
    <svg
      className="project-module-artwork"
      width={size}
      height={size}
      style={{ display: 'block', flexShrink: 0 }}
      viewBox={`${x - 150} ${y - 150} 300 300`}
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <clipPath id={clipId}>
          <circle cx={x} cy={y} r="150" />
        </clipPath>
      </defs>
      <image
        href="/assets/module-icons/module-icons-sheet.png"
        width="1536"
        height="1024"
        clipPath={`url(#${clipId})`}
      />
    </svg>
  );
}
