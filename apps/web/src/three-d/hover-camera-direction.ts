/** Move the camera opposite the pointer so the model follows it on screen. */
export function hoverCameraDirection(x: number, y: number) {
  const yaw = (-x * Math.PI) / 5;
  const pitch = Math.PI / 4 + (y * Math.PI) / 12;
  return {
    x: Math.sin(yaw) * Math.cos(pitch),
    y: Math.sin(pitch),
    z: Math.cos(yaw) * Math.cos(pitch),
  };
}
