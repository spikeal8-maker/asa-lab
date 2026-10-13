// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ClassroomStudentSeat } from '../../api';
import { StudentAccessCards } from '../StudentAccessCards';

vi.mock('../ClassJoinQr', () => ({ ClassJoinQr: () => null }));
const testGlobal = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean };
const linked: ClassroomStudentSeat = {
  id: 'linked-seat',
  displayLabel: 'Связанный ученик с коротким кодом',
  loginMethod: 'student_code',
  studentCode: 'Ab7kQ2',
  loginHandle: 'Ab7kQ2',
  safeMode: true,
  status: 'active',
  avatarKey: null,
  lastActiveAt: null,
  createdAt: '2026-10-09T00:00:00.000Z',
};
const account: ClassroomStudentSeat = {
  ...linked,
  id: 'account-seat',
  displayLabel: 'Александра Константиновна Иванова-Петрова',
  loginMethod: 'account',
  studentCode: null,
  loginHandle: null,
};
let root: Root;
let container: HTMLDivElement;
beforeAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  testGlobal.IS_REACT_ACT_ENVIRONMENT = false;
});
afterEach(async () => {
  if (root) await act(async () => root.unmount());
  container?.remove();
  vi.restoreAllMocks();
  document.body.classList.remove('student-access-printing');
});
async function mount(students: ClassroomStudentSeat[]) {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(StudentAccessCards, {
        classroomTitle: 'Смешанный класс',
        classCode: 'ABC DEF 234',
        students,
        onClose: vi.fn(),
      }),
    ),
  );
  return document.querySelector<HTMLElement>('.student-access-dialog')!;
}
describe('Account and linked Seat access card interactions', () => {
  it('selects, prints and deselects honest Account instructions beside the unchanged linked code', async () => {
    const print = vi.spyOn(window, 'print').mockImplementation(() => undefined);
    const dialog = await mount([linked, account]);
    const accountCard = dialog.querySelector<HTMLElement>('.is-account-entry')!;
    expect(accountCard.textContent).toContain('Вход через аккаунт');
    expect(accountCard.querySelector('.student-access-instruction')?.textContent).toContain(
      'Войдите в ASA Lab',
    );
    expect(accountCard.querySelector('code')).toBeNull();
    const codes = [...dialog.querySelectorAll('.student-access-selector code')].map(
      (node) => node.textContent,
    );
    expect(codes).toEqual(['Ab7kQ2']);
    expect(dialog.querySelector('.student-access-student-code code')?.textContent).toBe('Ab7kQ2');
    expect(
      [...dialog.querySelectorAll('.student-access-card')].every((card) => {
        const url = card.getAttribute('data-qr-url')!;
        return (
          url === `${window.location.origin}/#/join-class?code=ABC%20DEF%20234` &&
          !url.includes('Ab7kQ2')
        );
      }),
    ).toBe(true);
    const printButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((button) =>
      button.textContent?.includes('Распечатать'),
    )!;
    await act(async () => printButton.click());
    expect(print).toHaveBeenCalledOnce();
    expect(document.body.classList.contains('student-access-printing')).toBe(true);
    expect(dialog.querySelector('.student-access-print-sheet')?.textContent).not.toContain('acc:');
    window.dispatchEvent(new Event('afterprint'));
    expect(document.body.classList.contains('student-access-printing')).toBe(false);
    const accountChoice = [
      ...dialog.querySelectorAll<HTMLLabelElement>('.student-access-selector label'),
    ].find((label) => label.textContent?.includes(account.displayLabel))!;
    expect(accountChoice.textContent).toContain('Вход через аккаунт');
    await act(async () => accountChoice.querySelector<HTMLInputElement>('input')!.click());
    expect(dialog.querySelectorAll('.student-access-card')).toHaveLength(1);
    expect(dialog.querySelector('.student-access-student-code code')?.textContent).toBe('Ab7kQ2');
    await act(async () =>
      [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent === 'Выбрать всех')!
        .click(),
    );
    expect(dialog.querySelectorAll('.student-access-card')).toHaveLength(2);
  });
  it('never renders an obsolete internal handle when the server says Account admission', async () => {
    const internal = 'acc:1234567890abcdef1234';
    const dialog = await mount([
      { ...account, studentCode: internal, loginHandle: internal },
      linked,
    ]);
    expect(dialog.outerHTML).not.toContain(internal);
    expect(dialog.querySelector('.is-account-entry')?.textContent).toContain('Вход через аккаунт');
    expect(dialog.querySelector('.is-account-entry code')).toBeNull();
    expect(dialog.querySelectorAll('.student-access-selector code')).toHaveLength(1);
  });
});
