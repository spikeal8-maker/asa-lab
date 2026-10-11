export function classJoinQrPath(code: {
  getModuleCount(): number;
  isDark(row: number, column: number): boolean;
}): { size: number; d: string } {
  const quietZone = 4;
  const count = code.getModuleCount();
  let d = '';
  // Contiguous runs avoid anti-aliased seams between adjacent dark modules.
  // Coordinates are integers on the encoder's module grid, including its quiet zone.
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      if (!code.isDark(row, column)) continue;
      const start = column;
      while (column + 1 < count && code.isDark(row, column + 1)) column += 1;
      const width = column - start + 1;
      d += `M${start + quietZone} ${row + quietZone}h${width}v1h-${width}z`;
    }
  }
  return { size: count + quietZone * 2, d };
}
