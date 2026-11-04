/** Scan every numeric occurrence in a complete worker result without traced assertions. */
export function scanFiniteNumbers(value: unknown) {
  let numericLeafCount = 0;
  const nonFiniteLeaves: { path: string; value: number }[] = [];
  function visit(item: unknown, path: string): void {
    if (typeof item === 'number') {
      numericLeafCount++;
      if (!Number.isFinite(item)) nonFiniteLeaves.push({ path, value: item });
    } else if (Array.isArray(item)) {
      for (let index = 0; index < item.length; index++) visit(item[index], `${path}[${index}]`);
    } else if (item && typeof item === 'object') {
      for (const [key, child] of Object.entries(item))
        visit(child, `${path}[${JSON.stringify(key)}]`);
    }
  }
  // Worker results are structured data. Do not deduplicate repeated subtrees:
  // each occurrence had its own numeric checks in the original traversal.
  visit(value, '$');
  return { numericLeafCount, nonFiniteLeaves };
}
