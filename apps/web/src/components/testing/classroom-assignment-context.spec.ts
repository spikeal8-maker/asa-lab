// @vitest-environment jsdom
import { createElement, useLayoutEffect, act, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ClassroomLearning } from '../ClassroomLearning';
import {
  ClassroomActionFeedbackProvider,
  type ClassroomFeedbackPublisher,
} from '../ClassroomActionFeedback';

type PickerProps = {
  classroomId: string;
  preparedVersionId: string | null;
  onClose: () => void;
  onCreate: (draftId?: string) => void;
  onAssigned: (title: string, count: number, wholeClass: boolean) => void;
};
type MaterialsProps = {
  onRegisterLeaveGuard: (guard: (() => boolean) | null) => void;
  classroomCreation: {
    draftId: string | null;
    onClose: () => void;
    onPublished: (draftId: string, versionId: string) => Promise<void>;
  };
};

const captures = vi.hoisted(() => ({
  pickers: [] as PickerProps[],
  editors: [] as MaterialsProps[],
  assignmentMounts: 0,
  logout: new Set<() => void>(),
}));

vi.mock('../../session-fetch', () => ({
  onSessionLoggedOut: (callback: () => void) => {
    captures.logout.add(callback);
    return () => captures.logout.delete(callback);
  },
}));
vi.mock('../../learning/use-learning-destination', () => ({
  useLearningDestination: () => ({ courseRun: null, assignment: null }),
}));
vi.mock('../ClassroomCourses', () => ({
  ClassroomCourses: () => createElement('div', { 'data-test': 'courses' }, 'Курсы класса'),
}));
vi.mock('../ClassroomQuizzes', () => ({
  ClassroomQuizzes: () => createElement('div', { 'data-test': 'quizzes' }, 'Тесты класса'),
}));
vi.mock('../ClassroomAssignments', () => ({
  ClassroomAssignments: () => {
    useLayoutEffect(() => {
      captures.assignmentMounts += 1;
    }, []);
    return createElement('div', { 'data-test': 'assignments' }, 'Выданные задания');
  },
}));
vi.mock('../AssignLearningActivityDialog', () => ({
  AssignLearningActivityDialog: (props: PickerProps) => {
    captures.pickers.push(props);
    return createElement('div', { role: 'dialog', 'aria-label': 'Выбор задания' });
  },
}));
vi.mock('../CourseEditorDialog', () => ({
  CourseEditorDialog: ({ children }: { children: ReactNode }) =>
    createElement('div', { role: 'dialog', 'aria-label': 'Редактор задания' }, children),
}));
vi.mock('../../pages/AuthoredMaterialsPage', () => ({
  AuthoredMaterialsPage: (props: MaterialsProps) => {
    captures.editors.push(props);
    useLayoutEffect(() => {
      const register = props.onRegisterLeaveGuard;
      register(() => true);
      return () => register(null);
    }, [props.onRegisterLeaveGuard]);
    return createElement('div', { 'data-test': 'editor-body' });
  },
}));

let host: HTMLDivElement;
let root: Root;
let frameId = 0;
let frames: Map<number, FrameRequestCallback>;

function publisher(scopeKey: string): ClassroomFeedbackPublisher {
  return {
    scopeKey,
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    clear: vi.fn(),
  };
}
function render(
  value: ClassroomFeedbackPublisher | null,
  classroomId = 'class-a',
  archived = false,
) {
  const page = createElement(ClassroomLearning, {
    classroomId,
    archived,
    onOpenProject: vi.fn(),
  });
  act(() => {
    root.render(
      value ? createElement(ClassroomActionFeedbackProvider, { value, children: page }) : page,
    );
  });
}
function click(label: string) {
  const button = Array.from(host.querySelectorAll('button')).find(
    (entry) => entry.textContent === label,
  );
  expect(button).toBeDefined();
  act(() => button?.click());
}
function openPicker(): PickerProps {
  click('Выдать задание');
  const picker = captures.pickers.at(-1);
  expect(picker).toBeDefined();
  return picker!;
}
function activeTab() {
  return host.querySelector('.classroom-learning-tabs .active')?.textContent;
}
function assertCurrentDialogIsPicker() {
  expect(document.querySelector('[aria-label="Выбор задания"]')).not.toBeNull();
  expect(document.querySelector('[aria-label="Редактор задания"]')).toBeNull();
}

beforeEach(() => {
  captures.pickers.length = 0;
  captures.editors.length = 0;
  captures.assignmentMounts = 0;
  captures.logout.clear();
  frames = new Map();
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  host = document.createElement('div');
  host.id = 'root';
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  expect(captures.logout.size).toBe(0);
  expect(frames.size).toBe(0);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('assignment UI mutations belong to the active provider and dialog stage', () => {
  it('publishes confirmed current success without an inline band', () => {
    const feedback = publisher('a');
    render(feedback);
    const picker = openPicker();
    act(() => picker.onAssigned('Тестовый проект', 2, false));
    expect(feedback.success).toHaveBeenCalledExactlyOnceWith(
      'Задание «Тестовый проект» выдано. Получателей: 2.',
    );
    expect(host.querySelector('.notice-success')).toBeNull();
    expect(activeTab()).toBe('Отдельные задания');
    expect(captures.assignmentMounts).toBe(1);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
  });

  it('keeps the standalone fallback but clears it on classroom change', () => {
    render(null);
    const picker = openPicker();
    act(() => picker.onAssigned('Standalone', 1, true));
    expect(host.querySelector('.notice-success')?.textContent).toContain('Standalone');
    render(null, 'class-b');
    expect(host.querySelector('.notice-success')).toBeNull();
  });

  it('blocks every old picker mutation after provider replacement and permits the new flow', () => {
    const first = publisher('same-key');
    const replacement = publisher('same-key');
    render(first);
    click('Тесты');
    const oldPicker = openPicker();
    render(replacement);
    const current = openPicker();
    const mounts = captures.assignmentMounts;
    act(() => {
      oldPicker.onAssigned('Старое', 3, false);
      oldPicker.onCreate('old-draft');
      oldPicker.onClose();
    });
    expect(activeTab()).toBe('Тесты');
    expect(captures.assignmentMounts).toBe(mounts);
    expect(first.success).not.toHaveBeenCalled();
    expect(replacement.success).not.toHaveBeenCalled();
    assertCurrentDialogIsPicker();
    expect(captures.pickers.at(-1)?.preparedVersionId).toBeNull();
    act(() => current.onAssigned('Новое', 1, false));
    expect(activeTab()).toBe('Отдельные задания');
    expect(captures.assignmentMounts).toBe(mounts + 1);
    expect(replacement.success).toHaveBeenCalledExactlyOnceWith(
      'Задание «Новое» выдано. Получателей: 1.',
    );
  });

  it('does not let an old editor publish, close or change the new provider flow', async () => {
    const first = publisher('a');
    render(first);
    const picker = openPicker();
    act(() => picker.onCreate('draft-a'));
    const editor = captures.editors.at(-1)!;
    render(publisher('b'));
    openPicker();
    await act(async () => {
      await editor.classroomCreation.onPublished('stale-draft', 'stale-version');
      editor.classroomCreation.onClose();
      editor.onRegisterLeaveGuard(() => false);
    });
    assertCurrentDialogIsPicker();
    expect(captures.pickers.at(-1)?.preparedVersionId).toBeNull();
    expect(activeTab()).toBe('Курсы');
    expect(captures.assignmentMounts).toBe(0);
  });

  it('rejects prior-stage picker completion while its editor is open', () => {
    const feedback = publisher('a');
    render(feedback);
    const picker = openPicker();
    act(() => picker.onCreate());
    act(() => {
      picker.onAssigned('Старый выбор', 1, false);
      picker.onClose();
    });
    expect(document.querySelector('[aria-label="Редактор задания"]')).not.toBeNull();
    expect(activeTab()).toBe('Курсы');
    expect(feedback.success).not.toHaveBeenCalled();
    expect(captures.assignmentMounts).toBe(0);
  });

  it('preserves valid picker/editor/prepared-picker transitions and rejects retired editors', async () => {
    const feedback = publisher('a');
    render(feedback);
    const initial = openPicker();
    act(() => initial.onCreate('draft'));
    const editor = captures.editors.at(-1)!;
    await act(() => editor.classroomCreation.onPublished('draft', 'version-1'));
    const prepared = captures.pickers.at(-1)!;
    expect(prepared.preparedVersionId).toBe('version-1');
    await act(async () => {
      await editor.classroomCreation.onPublished('other', 'stale');
      editor.classroomCreation.onClose();
    });
    assertCurrentDialogIsPicker();
    expect(captures.pickers.at(-1)?.preparedVersionId).toBe('version-1');
    act(() => prepared.onClose());
    expect(captures.editors.at(-1)?.classroomCreation.draftId).toBe('draft');
    const currentEditor = captures.editors.at(-1)!;
    await act(() => currentEditor.classroomCreation.onPublished('draft', 'version-2'));
    act(() => captures.pickers.at(-1)!.onAssigned('Актуальное', 2, false));
    expect(feedback.success).toHaveBeenCalledTimes(1);
    expect(captures.assignmentMounts).toBe(1);
  });

  it('ignores duplicate completion rather than refreshing or announcing twice', () => {
    const feedback = publisher('a');
    render(feedback);
    const picker = openPicker();
    act(() => {
      picker.onAssigned('Одно', 1, false);
      picker.onAssigned('Одно', 1, false);
    });
    expect(feedback.success).toHaveBeenCalledTimes(1);
    expect(captures.assignmentMounts).toBe(1);
  });

  it('does not steal focus for an old close when another flow is already open', () => {
    render(publisher('a'));
    const old = openPicker();
    act(() => old.onClose());
    const queued = Array.from(frames.values());
    openPicker();
    const focus = vi.spyOn(HTMLButtonElement.prototype, 'focus');
    act(() => queued.forEach((callback) => callback(0)));
    expect(focus).not.toHaveBeenCalled();
    assertCurrentDialogIsPicker();
  });

  it('an obsolete frame cannot hide a newer focus request from cleanup', () => {
    const feedback = publisher('a');
    render(feedback);
    const old = openPicker();
    act(() => old.onClose());
    const oldFrames = Array.from(frames.values());
    const current = openPicker();
    act(() => current.onAssigned('Новое', 1, false));
    expect(frames.size).toBe(1);
    act(() => oldFrames.forEach((callback) => callback(0)));
    render(publisher('b'));
    expect(frames.size).toBe(0);
  });

  it('blocks late completion and focus after logout', () => {
    const feedback = publisher('a');
    render(feedback);
    const old = openPicker();
    act(() => Array.from(captures.logout).forEach((listener) => listener()));
    act(() => old.onAssigned('После выхода', 1, false));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(feedback.success).not.toHaveBeenCalled();
    expect(captures.assignmentMounts).toBe(0);
    expect(frames.size).toBe(0);
  });

  it('closes archived work and rejects its delayed callbacks', () => {
    const feedback = publisher('a');
    render(feedback);
    const old = openPicker();
    render(feedback, 'class-a', true);
    act(() => old.onAssigned('Архив', 1, true));
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(feedback.success).not.toHaveBeenCalled();
    expect(captures.assignmentMounts).toBe(0);
  });
});
