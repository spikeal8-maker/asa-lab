export interface ClassNavigationItem {
  readonly id: string;
  readonly title: string;
  readonly status: 'active' | 'archived';
  readonly teacherRole: 'owner' | 'co_teacher';
}

export interface ClassNavigation {
  readonly items: readonly ClassNavigationItem[];
  readonly previous: ClassNavigationItem | null;
  readonly next: ClassNavigationItem | null;
}

const naturalRussian = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
const compareExact = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

function validItem(value: unknown): value is ClassNavigationItem {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    row.id.trim().length > 0 &&
    typeof row.title === 'string' &&
    row.title.trim().length > 0 &&
    (row.status === 'active' || row.status === 'archived') &&
    (row.teacherRole === 'owner' || row.teacherRole === 'co_teacher')
  );
}

/** Presentation filtering only; authorization belongs to /api/classrooms. */
export function classroomNavigation(
  values: unknown,
  current: { readonly id: string; readonly status: string; readonly teacherRole: string },
): ClassNavigation | null {
  if (!Array.isArray(values)) return null;
  const rows = new Map<string, ClassNavigationItem>();
  const conflicts = new Set<string>();
  for (const value of values) {
    if (!validItem(value)) continue;
    const row: ClassNavigationItem = {
      id: value.id,
      title: value.title,
      status: value.status,
      teacherRole: value.teacherRole,
    };
    const previous = rows.get(row.id);
    if (
      previous &&
      (previous.title !== row.title ||
        previous.status !== row.status ||
        previous.teacherRole !== row.teacherRole)
    )
      conflicts.add(row.id);
    else rows.set(row.id, row);
  }
  const items = [...rows.values()]
    .filter((row) => !conflicts.has(row.id) && row.status === current.status)
    .sort((a, b) => naturalRussian.compare(a.title, b.title) || compareExact(a.id, b.id));
  const index = items.findIndex(
    (row) => row.id === current.id && row.teacherRole === current.teacherRole,
  );
  if (index < 0) return null;
  return { items, previous: items[index - 1] ?? null, next: items[index + 1] ?? null };
}

/** A request ticket is invalid after cleanup, context replacement or logout. */
export function createClassNavigationGeneration() {
  let generation = 0;
  return {
    invalidate(): void {
      generation += 1;
    },
    begin(): () => boolean {
      const ticket = ++generation;
      return () => ticket === generation;
    },
  };
}
