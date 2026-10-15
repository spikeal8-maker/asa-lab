/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ElectronicsProjectRecovery } from '../electronics-project-recovery';
import { writeLocalProjectDraft, localProjectDraftKey } from '../../modules/project-local-draft';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() {
      return data.size;
    },
    key: (index) => [...data.keys()][index] ?? null,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}
afterEach(() => vi.useRealTimers());

describe('Electronics owned recovery slots', () => {
  const input = (value: number) => ({ baseRevision: 1, document: { value } });
  const store = (local: Storage, session: Storage | null, user = 'user') =>
    new ElectronicsProjectRecovery<{ value: number }>(
      () => local,
      session,
      'project',
      user,
      'account',
    );

  it('isolates same-actor writers from each other writes, mirror clears and acknowledgements', () => {
    const local = memoryStorage(),
      a = store(local, memoryStorage()),
      b = store(local, memoryStorage());
    expect(a.write(input(10))).toBe(true);
    expect(b.write(input(20))).toBe(true);
    local.removeItem(localProjectDraftKey('project', 'user', 'account'));
    expect(a.readOwned()?.document.value).toBe(10);
    expect(b.readOwned()?.document.value).toBe(20);
    a.clear({ value: 10 });
    expect(a.readOwned()).toBeNull();
    expect(b.readOwned()?.document.value).toBe(20);
    expect(a.write(input(30))).toBe(true);
    b.clear({ value: 20 });
    expect(a.readOwned()?.document.value).toBe(30);
  });

  it('reloads the tab branch, safely forks copied session hints, and offers newest pending work to a fresh tab', () => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const local = memoryStorage(),
      session = memoryStorage();
    const a = store(local, session);
    a.write(input(10));
    vi.advanceTimersByTime(1000);
    const b = store(local, memoryStorage());
    b.write(input(20));
    expect(store(local, session).read()?.document.value).toBe(10);
    expect(store(local, memoryStorage()).read()?.document.value).toBe(20);
    const fork = store(local, session);
    expect(fork.read()?.document.value).toBe(10);
    fork.write(input(30));
    expect(a.readOwned()?.document.value).toBe(10);
    fork.clear({ value: 30 });
    expect(a.readOwned()?.document.value).toBe(10);
    expect(b.readOwned()?.document.value).toBe(20);
    // This acknowledged tab must not resurrect older branches on reload.
    expect(store(local, session).read()).toBeNull();
  });

  it('reads legacy drafts and leaves a later legacy writer untouched during clear', () => {
    const local = memoryStorage();
    const legacy = (value: number) =>
      writeLocalProjectDraft(local, {
        ...input(value),
        projectId: 'project',
        userId: 'user',
        moduleKey: 'electronics',
        identityKind: 'account',
      });
    legacy(10);
    const recovery = store(local, null);
    expect(recovery.read()?.document.value).toBe(10);
    recovery.write(input(20));
    legacy(30);
    recovery.clear({ value: 20 });
    expect(store(local, null).read()?.document.value).toBe(30);
  });

  it('reports quota/access failure without losing a prior owned document or crossing actors', () => {
    const local = memoryStorage(),
      recovery = store(local, null);
    recovery.write(input(10));
    vi.spyOn(local, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(recovery.write(input(20))).toBe(false);
    expect(recovery.readOwned()?.document.value).toBe(10);
    expect(store(local, null, 'other-user').read()).toBeNull();
    const denied = new ElectronicsProjectRecovery(
      () => {
        throw new Error('denied');
      },
      null,
      'project',
      'user',
      'account',
    );
    expect(denied.write(input(1))).toBe(false);
    expect(denied.read()).toBeNull();
    expect(denied.readOwned()).toBeNull();
    expect(() => denied.clear({ value: 1 })).not.toThrow();
    vi.restoreAllMocks();
  });

  it('does not resurrect acknowledged reload sources or legacy drafts after a later server undo', () => {
    const local = memoryStorage(),
      session = memoryStorage();
    const a = store(local, session);
    a.write(input(330));
    const reloaded = store(local, session);
    expect(reloaded.read()?.document.value).toBe(330);
    reloaded.write(input(330));
    const twiceReloaded = store(local, session);
    expect(twiceReloaded.read()?.document.value).toBe(330);
    twiceReloaded.write(input(330));
    twiceReloaded.clear({ value: 330 });
    // Server may now be deliberately undone to220. No pending330 may be offered.
    expect(store(local, memoryStorage()).read()).toBeNull();
    expect(a.readOwned()).toBeNull();
    const legacy = memoryStorage();
    writeLocalProjectDraft(legacy, {
      ...input(330),
      projectId: 'project',
      userId: 'user',
      moduleKey: 'electronics',
    });
    const reader = store(legacy, memoryStorage());
    expect(reader.read()?.document.value).toBe(330);
    reader.clear({ value: 330 });
    expect(store(legacy, memoryStorage()).read()).toBeNull();
  });

  it('keeps an unconfirmed source branch and a concurrent edit during acknowledgement', () => {
    const local = memoryStorage(),
      session = memoryStorage();
    const a = store(local, session);
    a.write(input(330));
    const fork = store(local, session);
    fork.read();
    fork.write(input(470));
    fork.clear({ value: 470 });
    expect(a.readOwned()?.document.value).toBe(330);
    const reload = store(local, session);
    // Use an independent tab hint to read A's pending source, not saved fork's hint.
    const fresh = store(local, memoryStorage());
    expect(fresh.read()?.document.value).toBe(330);
    const set = local.setItem.bind(local);
    let raced = false;
    vi.spyOn(local, 'setItem').mockImplementation((key, value) => {
      if (key.endsWith(':ack') && !raced) {
        raced = true;
        a.write(input(560));
      }
      set(key, value);
    });
    fresh.clear({ value: 330 });
    expect(raced).toBe(true);
    expect(a.readOwned()?.document.value).toBe(560);
    expect(reload.read()).toBeNull();
    vi.restoreAllMocks();
  });
});
