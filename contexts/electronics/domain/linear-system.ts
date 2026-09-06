/** Deterministic partial-pivot Gaussian elimination, shared by MNA and constraint recovery. */
export function solveLinear(matrix: number[][], rhs: number[]): number[] | null {
  const size = rhs.length;
  const augmented = matrix.map((row, index) => [...row, rhs[index] as number]);
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(augmented[row]?.[column] ?? 0) > Math.abs(augmented[pivot]?.[column] ?? 0)) {
        pivot = row;
      }
    }
    if (Math.abs(augmented[pivot]?.[column] ?? 0) < 1e-14) return null;
    [augmented[column], augmented[pivot]] = [
      augmented[pivot] as number[],
      augmented[column] as number[],
    ];
    const divisor = augmented[column]?.[column] as number;
    for (let cell = column; cell <= size; cell += 1) {
      (augmented[column] as number[])[cell] = (augmented[column]?.[cell] as number) / divisor;
    }
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = augmented[row]?.[column] as number;
      if (Math.abs(factor) < 1e-18) continue;
      for (let cell = column; cell <= size; cell += 1) {
        (augmented[row] as number[])[cell] =
          (augmented[row]?.[cell] as number) - factor * (augmented[column]?.[cell] as number);
      }
    }
  }
  return augmented.map((row) => row[size] as number);
}
