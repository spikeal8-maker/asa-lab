import { describe, expect, it } from 'vitest';
import type { JournalSnapshot } from '../../classroom-journal-api';
import { journalMonthRange, journalShiftMonth } from '../../classroom-journal-api';
import {
  journalDefaultDate,
  journalRoster,
  journalSlots,
  journalRequestReceipt,
  journalQuickMutation,
} from '../quick-journal-model';

const snapshot: JournalSnapshot = {
  status: 'active',
  timeZone: 'Europe/Moscow',
  scale: { preset: 'five', version: 0 },
  range: { from: '2026-10-01', to: '2026-10-31', today: '2026-10-11', timeZone: 'Europe/Moscow' },
  offset: 0,
  nextOffset: null,
  students: [],
  columns: [],
  grades: [],
};
describe('quick journal UI slots', () => {
  it('freezes the entire uncertain quick command across fresh materialized data and corrections', () => {
    const first = journalQuickMutation(null, {
      slotKey: '2026-10:1',
      date: '2026-10-11',
      category: 'Работа 1',
      expectedScaleVersion: 0,
      expectedHeaderRevision: 0,
      seatId: 'seat',
      value: 0,
      reason: null,
      expectedRevision: 0,
    });
    const remapped = {
      columnId: 'persisted',
      date: '2026-10-11',
      category: 'Changed header',
      seatId: 'seat',
      expectedScaleVersion: 1,
      expectedHeaderRevision: 2,
      expectedRevision: 1,
      reason: 'New draft',
      value: 5,
    };
    expect(journalQuickMutation(first, remapped)).toBe(first);
    expect(first.payload).toMatchObject({
      slotKey: '2026-10:1',
      value: 0,
      reason: null,
      expectedRevision: 0,
    });
    first.uncertain = false; // definite 409 can be refreshed, never replayed blindly
    const correction = journalQuickMutation(first, { ...remapped, reason: 'Original correction' });
    expect(correction.payload.requestId).not.toBe(first.payload.requestId);
    expect(
      journalQuickMutation(correction, {
        ...remapped,
        reason: 'Changed draft',
        expectedRevision: 2,
      }),
    ).toBe(correction);
    expect(correction.payload.reason).toBe('Original correction');
    expect(correction.payload.expectedRevision).toBe(1);
  });
  it('replays an uncertain request exactly after another cell advances the scale; changed values use a new ID', () => {
    const body = { slotKey: '2026-10:1', expectedScaleVersion: 0, expectedRevision: 0, value: 0 };
    const receipt = journalRequestReceipt(undefined, body);
    receipt.uncertain = true;
    expect(journalRequestReceipt(receipt, { ...body, expectedScaleVersion: 1 })).toBe(receipt);
    expect(journalRequestReceipt(receipt, { ...body, value: 5 }).id).not.toBe(receipt.id);
    receipt.uncertain = false;
    expect(journalRequestReceipt(receipt, { ...body, expectedScaleVersion: 1 }).id).not.toBe(
      receipt.id,
    );
  });
  it('projects ten stable slots without mutating a GET snapshot', () => {
    const original = JSON.stringify(snapshot);
    const slots = journalSlots('class-a', snapshot);
    expect(slots).toHaveLength(10);
    expect(slots.map((c) => c.category)).toEqual(
      Array.from({ length: 10 }, (_, i) => `Работа ${i + 1}`),
    );
    expect(slots.every((c) => c.virtual && c.date === '2026-10-11')).toBe(true);
    expect(journalSlots('class-a', snapshot)).toEqual(slots);
    expect(journalSlots('class-b', snapshot)[0].id).not.toBe(slots[0].id);
    expect(JSON.stringify(snapshot)).toBe(original);
  });
  it('replaces only the materialized slot, keeps its scale, and fills one column with nine slots', () => {
    const slots = journalSlots('class-a', snapshot);
    const fifth = {
      ...slots[4],
      virtual: false,
      id: 'saved-five',
      preset: 'smileys' as const,
      scaleVersion: 1,
    };
    const after = journalSlots('class-a', {
      ...snapshot,
      scale: { preset: 'hundred', version: 2 },
      columns: [fifth],
    });
    expect(after).toHaveLength(10);
    expect(after[4].id).toBe('saved-five');
    expect(after[4].preset).toBe('smileys');
    expect(after[0].preset).toBe('hundred');
    expect(after.filter((c) => c.virtual)).toHaveLength(9);
    const legacy = journalSlots('class-a', {
      ...snapshot,
      columns: [
        { id: 'legacy', date: '2026-10-11', category: 'Работа 1', preset: 'five', scaleVersion: 1 },
      ],
    });
    expect(legacy).toHaveLength(10);
    expect(legacy[1].category).toBe('Работа 2');
    expect(legacy[9].category).toBe('Работа 10');
  });
  it('uses exact calendar dates for split months, leap years and year boundaries', () => {
    expect(journalDefaultDate('2026-09', '2026-10-01')).toBe('2026-09-01');
    expect(journalDefaultDate('2026-10', '2026-10-01')).toBe('2026-10-01');
    expect(journalMonthRange('2024-02').to).toBe('2024-02-29');
    expect(journalMonthRange('2026-02').to).toBe('2026-02-28');
    expect(journalShiftMonth('2026-12', 1)).toBe('2027-01');
    expect(
      journalSlots('class-a', {
        ...snapshot,
        range: { ...snapshot.range, from: '2026-09-01', to: '2026-09-30' },
      })[0].id,
    ).not.toBe(journalSlots('class-a', snapshot)[0].id);
  });
  it('retains 50-column pagination and supports explicit additional slots', () => {
    expect(journalSlots('class-a', { ...snapshot, nextOffset: 50 })).toEqual([]);
    expect(journalSlots('class-a', { ...snapshot, offset: 50 })).toEqual([]);
    expect(journalSlots('class-a', snapshot, 11)).toHaveLength(11);
  });
  it('does not reuse a slot whose saved column was moved to another month', () => {
    const slots = journalSlots('class-a', { ...snapshot, reservedSlotKeys: ['2026-10:1'] });
    expect(slots).toHaveLength(10);
    expect(slots[0].slotKey).toBe('2026-10:2');
    expect(slots.at(-1)?.slotKey).toBe('2026-10:11');
  });
  it('orders stored numeric prefixes predictably without editing student names', () => {
    const students = [
      { id: 'ten', name: '10Артем', status: 'active' },
      { id: 'one', name: '1Иван', status: 'active' },
      { id: 'two', name: '2Анна', status: 'active' },
    ];
    expect(journalRoster(students).map((s) => s.name)).toEqual(['1Иван', '2Анна', '10Артем']);
    expect(students[0].name).toBe('10Артем');
  });
});
