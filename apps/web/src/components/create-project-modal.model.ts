const CREATE_PROJECT_ORDER: Readonly<Record<string, number>> = {
  electronics: 0,
  'three-d': 1,
  checkers: 2,
  chess: 3,
};

/** The creation chooser has a deliberate learning order; the global catalog does not. */
export function orderModulesForCreation<
  T extends { readonly moduleKey: string; readonly displayName: string },
>(modules: readonly T[]): T[] {
  return [...modules].sort((left, right) => {
    const priority =
      (CREATE_PROJECT_ORDER[left.moduleKey] ?? 100) -
      (CREATE_PROJECT_ORDER[right.moduleKey] ?? 100);
    return priority || left.displayName.localeCompare(right.displayName, 'ru');
  });
}
