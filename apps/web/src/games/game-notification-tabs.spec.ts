import { describe, expect, it, vi } from 'vitest';
import { observeGameNotificationActivity } from './game-notification-tabs';

function tab(focused = true) {
  const document = Object.assign(new EventTarget(), {
    visibilityState: 'visible' as DocumentVisibilityState,
    hasFocus: () => focused,
  });
  const window = new EventTarget();
  const navigator = { onLine: true };
  return {
    document,
    window,
    navigator,
    focus(value: boolean) {
      focused = value;
      window.dispatchEvent(new Event(value ? 'focus' : 'blur'));
    },
  };
}

describe('independent notification tab lifecycle', () => {
  it('pauses hidden and offline tabs, with one update per actual activity change', () => {
    const environment = tab();
    const activity = vi.fn();
    const stop = observeGameNotificationActivity(activity, environment);
    expect(activity).toHaveBeenLastCalledWith('active');
    environment.focus(false);
    expect(activity).toHaveBeenLastCalledWith('background');
    environment.document.visibilityState = 'hidden';
    environment.document.dispatchEvent(new Event('visibilitychange'));
    expect(activity).toHaveBeenLastCalledWith('paused');
    const count = activity.mock.calls.length;
    environment.navigator.onLine = false;
    environment.window.dispatchEvent(new Event('offline'));
    environment.focus(true);
    expect(activity).toHaveBeenCalledTimes(count);
    environment.document.visibilityState = 'visible';
    environment.document.dispatchEvent(new Event('visibilitychange'));
    expect(activity).toHaveBeenCalledTimes(count);
    environment.navigator.onLine = true;
    environment.window.dispatchEvent(new Event('online'));
    expect(activity).toHaveBeenLastCalledWith('active');
    stop();
  });

  it('suspends for pagehide and resumes from bfcache without a second poll owner', () => {
    const environment = tab();
    const activity = vi.fn();
    const stop = observeGameNotificationActivity(activity, environment);
    environment.window.dispatchEvent(new Event('pagehide'));
    expect(activity).toHaveBeenLastCalledWith('paused');
    environment.window.dispatchEvent(new Event('focus'));
    environment.window.dispatchEvent(new Event('online'));
    expect(activity.mock.calls.map(([value]) => value)).toEqual(['active', 'paused']);
    environment.window.dispatchEvent(new Event('pageshow'));
    expect(activity.mock.calls.map(([value]) => value)).toEqual(['active', 'paused', 'active']);
    stop();
  });

  it('removes every listener and ignores all later events after disposal', () => {
    const environment = tab();
    const addedWindow = vi.spyOn(environment.window, 'addEventListener');
    const removedWindow = vi.spyOn(environment.window, 'removeEventListener');
    const addedDocument = vi.spyOn(environment.document, 'addEventListener');
    const removedDocument = vi.spyOn(environment.document, 'removeEventListener');
    const activity = vi.fn();
    const stop = observeGameNotificationActivity(activity, environment);
    stop();
    expect(removedWindow.mock.calls).toEqual(addedWindow.mock.calls);
    expect(removedDocument.mock.calls).toEqual(addedDocument.mock.calls);
    environment.focus(false);
    environment.navigator.onLine = false;
    for (const event of ['pagehide', 'pageshow', 'online', 'offline'])
      environment.window.dispatchEvent(new Event(event));
    environment.document.dispatchEvent(new Event('visibilitychange'));
    expect(activity).toHaveBeenCalledTimes(1);
  });

  it('keeps independent realms independent and never opens a payload channel', () => {
    const broadcast = vi.fn();
    vi.stubGlobal('BroadcastChannel', broadcast);
    const first = tab();
    const second = tab(false);
    const firstActivity = vi.fn();
    const secondActivity = vi.fn();
    const stopFirst = observeGameNotificationActivity(firstActivity, first);
    const stopSecond = observeGameNotificationActivity(secondActivity, second);
    first.document.visibilityState = 'hidden';
    first.document.dispatchEvent(new Event('visibilitychange'));
    expect(firstActivity).toHaveBeenLastCalledWith('paused');
    expect(secondActivity.mock.calls).toEqual([['background']]);
    second.focus(true);
    expect(secondActivity).toHaveBeenLastCalledWith('active');
    expect(broadcast).not.toHaveBeenCalled();
    stopFirst();
    stopSecond();
    vi.unstubAllGlobals();
  });
});
