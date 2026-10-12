import type { JournalColumn, JournalQuickInput, JournalSnapshot } from '../classroom-journal-api';

export type JournalSlot = JournalColumn & { virtual?: boolean };
export type JournalRequestReceipt = { payload: string; id: string; uncertain?: boolean };
export type JournalQuickMutation = {
  endpoint: 'quick';
  payload: Readonly<JournalQuickInput>;
  uncertain: boolean;
};
// The whole command survives focus reads and virtual-to-persisted remapping.
// Only a definite server outcome or cancelling the editor releases it.
export function journalQuickMutation(
  previous: JournalQuickMutation | null,
  input: Omit<JournalQuickInput, 'requestId'>,
): JournalQuickMutation {
  if (previous?.uncertain) return previous;
  return {
    endpoint: 'quick',
    payload: Object.freeze({ ...input, requestId: crypto.randomUUID() }),
    uncertain: true,
  };
}
export function journalRequestReceipt(
  previous: JournalRequestReceipt | undefined,
  input: object,
): JournalRequestReceipt {
  const payload = JSON.stringify(input);
  if (previous?.payload === payload) return previous;
  // A lost response may already have pinned the column's scale. Another cell
  // can advance the displayed scale before this request is retried.
  if (previous?.uncertain) {
    const previousInput = JSON.parse(previous.payload) as Record<string, unknown>;
    if (
      JSON.stringify({ ...previousInput, expectedScaleVersion: undefined }) ===
      JSON.stringify({ ...input, expectedScaleVersion: undefined })
    )
      return previous;
  }
  return { payload, id: crypto.randomUUID() };
}
export function journalDefaultDate(month: string, today: string): string {
  return today.slice(0, 7) === month ? today : `${month}-01`;
}
export function journalSlots(
  classroomId: string,
  data: JournalSnapshot,
  minimum = 10,
): JournalSlot[] {
  const month = data.range.from.slice(0, 7);
  const columns: JournalSlot[] = [...data.columns];
  if (data.offset !== 0 || data.nextOffset !== null) return columns;
  const used = new Set([...columns.map((c) => c.slotKey), ...(data.reservedSlotKeys ?? [])]);
  const firstFree = 1 + columns.filter((c) => !c.slotKey?.startsWith(`${month}:`)).length;
  for (let index = firstFree; columns.length < minimum; index += 1) {
    const slotKey = `${month}:${index}`;
    if (used.has(slotKey)) continue;
    columns.push({
      id: `${classroomId}:${slotKey}`,
      slotKey,
      virtual: true,
      date: journalDefaultDate(month, data.range.today),
      category: `Работа ${index}`,
      preset: data.scale.preset,
      scaleVersion: data.scale.version,
      headerRevision: 0,
    });
  }
  // Materializing Work 5 must not move it in front of Works 1–4.
  return columns.sort((a, b) => {
    const aSlot = a.slotKey?.startsWith(`${month}:`) ? Number(a.slotKey.split(':')[1]) : 0;
    const bSlot = b.slotKey?.startsWith(`${month}:`) ? Number(b.slotKey.split(':')[1]) : 0;
    return aSlot - bSlot;
  });
}
const rosterOrder = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' });
export function journalRoster(students: JournalSnapshot['students']) {
  return [...students].sort(
    (a, b) => rosterOrder.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
