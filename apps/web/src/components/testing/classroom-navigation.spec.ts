import { expect, it } from 'vitest';
import { classroomNavigation, createClassNavigationGeneration } from '../classroom-navigation';

const row = (id: string, title: string, status = 'active', teacherRole = 'owner') => ({
  id,
  title,
  status,
  teacherRole,
});
const current = { id: 'b', status: 'active', teacherRole: 'owner' };

it('sorts naturally in Russian with identity as the final tie break', () => {
  const rows = [row('z', '10Б-1 Роботы'), row('b', '4Б Роботы'), row('a', '4Б Роботы')];
  const result = classroomNavigation(rows, current);
  expect(result?.items.map((item) => item.id)).toEqual(['a', 'b', 'z']);
  expect(classroomNavigation([...rows].reverse(), current)).toEqual(result);
  expect(result?.previous?.id).toBe('a');
  expect(result?.next?.id).toBe('z');
});

it('includes both teaching roles within status and excludes malformed or deleted rows', () => {
  const result = classroomNavigation(
    [
      row('b', '4Б'),
      row('co', '5А', 'active', 'co_teacher'),
      row('archive', '6А', 'archived'),
      row('deleted', '7А', 'deleted'),
      row('student', '8А', 'active', 'student'),
      row('', '9А'),
      row('blank', ' '),
      null,
      { id: 42, title: '10А', status: 'active', teacherRole: 'owner' },
    ],
    current,
  );
  expect(result?.items.map((item) => item.id)).toEqual(['b', 'co']);
});

it('does not wrap endpoints or invent neighbors for a single class', () => {
  const rows = [row('a', '1А'), row('b', '2А')];
  expect(classroomNavigation(rows, { ...current, id: 'a' })?.previous).toBeNull();
  expect(classroomNavigation(rows, current)?.next).toBeNull();
  expect(classroomNavigation([row('b', '2А')], current)).toMatchObject({
    previous: null,
    next: null,
  });
});

it('requires the current server identity and matching role', () => {
  expect(classroomNavigation([], current)).toBeNull();
  expect(classroomNavigation(undefined, current)).toBeNull();
  expect(classroomNavigation([row('a', '1А')], current)).toBeNull();
  expect(classroomNavigation([row('b', '2А', 'active', 'co_teacher')], current)).toBeNull();
});

it('keeps archived navigation separate and supports a co-teacher current class', () => {
  const result = classroomNavigation(
    [row('b', '2А', 'archived', 'co_teacher'), row('a', '1А', 'archived'), row('c', '3А')],
    { id: 'b', status: 'archived', teacherRole: 'co_teacher' },
  );
  expect(result?.items.map((item) => item.id)).toEqual(['a', 'b']);
});

it('deduplicates identical rows and excludes conflicting identities regardless of input order', () => {
  const rows = [row('b', '2А'), row('b', '2А'), row('a', '1А'), row('a', '9А')];
  expect(classroomNavigation(rows, current)?.items.map((item) => item.id)).toEqual(['b']);
  expect(classroomNavigation(rows, current)).toEqual(
    classroomNavigation([...rows].reverse(), current),
  );
});

it('invalidates late request generations after replacement or cleanup', () => {
  const scope = createClassNavigationGeneration();
  const first = scope.begin();
  const second = scope.begin();
  expect(first()).toBe(false);
  expect(second()).toBe(true);
  scope.invalidate();
  expect(second()).toBe(false);
  expect(scope.begin()()).toBe(true);
});
