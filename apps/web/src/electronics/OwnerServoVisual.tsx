export function servoVisualRotation(angleDegrees: number): number {
  const angle = Math.min(180, Math.max(0, Number.isFinite(angleDegrees) ? angleDegrees : 90));
  return angle - 90;
}

export function OwnerServoVisual({
  asset,
  width,
  height,
  angleDegrees,
}: {
  readonly asset: string;
  readonly width: number;
  readonly height: number;
  readonly angleDegrees: number;
}): JSX.Element {
  const rotation = servoVisualRotation(angleDegrees);
  return (
    <svg
      data-testid="servo-motor-runtime"
      data-servo-angle-degrees={angleDegrees}
      data-servo-visual-rotation={rotation}
      x="0"
      y="0"
      width={width}
      height={height}
      viewBox="0 0 241 621"
      preserveAspectRatio="xMidYMid meet"
      pointerEvents="none"
      aria-hidden="true"
    >
      <use href={`${asset}#wires`} />
      <use href={`${asset}#connector`} />
      <use href={`${asset}#body`} />
      <use href={`${asset}#gears`} />
      <use
        data-testid="servo-motor-horn"
        href={`${asset}#horn`}
        transform={`rotate(${rotation} 114.5 314)`}
      />
    </svg>
  );
}
