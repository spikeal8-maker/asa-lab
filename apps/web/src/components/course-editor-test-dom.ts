/**
 * jsdom lacks these browser APIs. The unit harness supplies only their DOM
 * state; geometry, native focus, reflow and top-layer behavior are browser gates.
 */
export function installCourseEditorTestDom(): () => void {
  const restore: Array<() => void> = [];
  function replace(target: object, key: string, value: unknown): void {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    Object.defineProperty(target, key, { configurable: true, writable: true, value });
    restore.push(() => {
      if (previous) Object.defineProperty(target, key, previous);
      else Reflect.deleteProperty(target, key);
    });
  }
  replace(window, 'matchMedia', (media: string) => ({
    media,
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  replace(
    globalThis,
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  replace(HTMLDialogElement.prototype, 'showModal', function (this: HTMLDialogElement) {
    this.open = true;
  });
  replace(HTMLDialogElement.prototype, 'show', function (this: HTMLDialogElement) {
    this.open = true;
  });
  replace(HTMLDialogElement.prototype, 'close', function (this: HTMLDialogElement) {
    this.open = false;
  });
  return () => restore.reverse().forEach((entry) => entry());
}
