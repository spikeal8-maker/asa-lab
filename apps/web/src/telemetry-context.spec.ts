import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  beginTelemetryIdentityObservation,
  beginTelemetryWorkspaceSwitch,
  confirmTelemetryProductSession,
  finishTelemetryWorkspaceSwitch,
  observeTelemetryIdentity,
  renewTelemetryContext,
  setTelemetryContext,
  telemetryActor,
  telemetryContext,
  telemetryRoute,
  subscribeProductConfirmation,
} from './telemetry-context';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const subscriptions: (() => void)[] = [];
afterEach(() => {
  subscriptions.splice(0).forEach((unsubscribe) => unsubscribe());
  setTelemetryContext(null, true, 'public');
  vi.useRealTimers();
});
describe('original server-issued identity and safe visit context', () => {
  it('distinguishes Seat from Account even when presentation IDs are identical', () => {
    const account = telemetryActor({
      kind: 'authenticated',
      session: { account: { id: a }, activeWorkspace: { workspaceId: b } },
    });
    const seat = telemetryActor({
      kind: 'student',
      session: { student: { seatId: a }, classroom: { id: b } },
    });
    expect(account).toEqual({ kind: 'account', accountId: a, workspaceId: b });
    expect(seat).toEqual({ kind: 'student', seatId: a, classId: b });
    expect(
      telemetryActor({
        kind: 'student',
        session: { account: { id: a }, activeWorkspace: { workspaceId: b } },
      }),
    ).toBeNull();
    for (const kind of ['checking', 'error', 'anonymous'])
      expect(telemetryActor({ kind })).toBeNull();
  });
  it('StrictMode/re-render/navigation keep generation; scope switch and same-user logout/relogin retire it', () => {
    const actor = { kind: 'account' as const, accountId: a, workspaceId: b };
    setTelemetryContext(actor, true, 'home');
    const original = telemetryContext().generation;
    setTelemetryContext({ ...actor }, true, 'projects');
    expect(telemetryContext().generation).toBe(original);
    setTelemetryContext({ ...actor, workspaceId: a }, true, 'projects');
    expect(telemetryContext().generation).toBe(original + 1);
    setTelemetryContext(null, true, 'public');
    setTelemetryContext(actor, true, 'home');
    expect(telemetryContext().generation).toBe(original + 3);
    setTelemetryContext({ kind: 'student', seatId: a, classId: b }, true, 'home');
    expect(telemetryContext().generation).toBe(original + 4);
  });
  it('maps parsed views only; secret IDs and query fragments cannot become stored routes', () => {
    expect(telemetryRoute({ kind: 'editor', moduleKey: 'blocks' })).toBe('editor.blocks');
    expect(telemetryRoute({ kind: 'editor', moduleKey: 'secret?token=hidden' })).toBe('unknown');
    expect(telemetryRoute({ kind: 'teacher-invite' })).toBe('classes');
    expect(telemetryRoute({ kind: 'home' }, true)).toBe('admin');
  });
});

describe('workspace handoff identity fence', () => {
  const actor = { kind: 'account' as const, accountId: a, workspaceId: b };
  const successor = { ...actor, workspaceId: a };
  const session = (identity = actor) => ({
    authenticated: true,
    account: { id: identity.accountId },
    activeWorkspace: { workspaceId: identity.workspaceId },
  });

  it('releases one product success after all overlapping mutations and preserves its absolute deadline', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
    setTelemetryContext(actor, true, 'home');
    const older = beginTelemetryWorkspaceSwitch();
    const newer = beginTelemetryWorkspaceSwitch();
    const listener = vi.fn();
    subscriptions.push(subscribeProductConfirmation(listener));
    const deadline = Date.now() + 12_000;
    confirmTelemetryProductSession(telemetryContext());
    expect(listener).not.toHaveBeenCalled();
    vi.setSystemTime(Date.now() + 4000);
    finishTelemetryWorkspaceSwitch(newer, false);
    observeTelemetryIdentity(beginTelemetryIdentityObservation(), session());
    expect(listener).not.toHaveBeenCalled();
    finishTelemetryWorkspaceSwitch(older, false);
    observeTelemetryIdentity(beginTelemetryIdentityObservation(), session());
    expect(listener).toHaveBeenCalledExactlyOnceWith(telemetryContext(), deadline);
    setTelemetryContext(actor, true, 'projects');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it.each(['unready', 'verification', 'logout', 'seat', 'actor', 'generation', 'expired'] as const)(
    'does not carry old product success across the %s boundary',
    (boundary) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2026-10-20T12:00:00Z'));
      setTelemetryContext(actor, true, 'home');
      const original = telemetryContext();
      if (boundary === 'generation') renewTelemetryContext(original);
      const mutation = beginTelemetryWorkspaceSwitch();
      const listener = vi.fn();
      subscriptions.push(subscribeProductConfirmation(listener));
      confirmTelemetryProductSession(original);
      finishTelemetryWorkspaceSwitch(mutation, false);
      if (boundary === 'unready') {
        setTelemetryContext(actor, false, 'home');
        setTelemetryContext(actor, true, 'home');
      } else if (boundary === 'verification') {
        observeTelemetryIdentity(beginTelemetryIdentityObservation(), {
          ...session(),
          verification: { required: true },
        });
      } else if (boundary === 'logout' || boundary === 'seat') {
        setTelemetryContext(
          boundary === 'seat' ? { kind: 'student', seatId: a, classId: b } : null,
          true,
          'home',
        );
        setTelemetryContext(actor, true, 'home');
      } else if (boundary === 'actor') {
        observeTelemetryIdentity(beginTelemetryIdentityObservation(), session(successor));
        setTelemetryContext(successor, true, 'home');
        const returning = beginTelemetryWorkspaceSwitch();
        finishTelemetryWorkspaceSwitch(returning, false);
        setTelemetryContext(actor, true, 'home');
      } else if (boundary === 'expired') vi.setSystemTime(Date.now() + 12_001);
      observeTelemetryIdentity(beginTelemetryIdentityObservation(), session());
      setTelemetryContext(actor, true, 'home');
      expect(listener).not.toHaveBeenCalled();
    },
  );

  it('pauses synchronously and resumes an unchanged accepted binding without generation churn', () => {
    setTelemetryContext(actor, true, 'home');
    const original = telemetryContext();
    const mutation = beginTelemetryWorkspaceSwitch();
    expect(telemetryContext()).toEqual({ ...original, ready: false });
    setTelemetryContext(actor, true, 'projects');
    expect(telemetryContext().ready).toBe(false);
    finishTelemetryWorkspaceSwitch(mutation, false);
    observeTelemetryIdentity(beginTelemetryIdentityObservation(), session());
    expect(telemetryContext()).toEqual({ ...original, route: 'projects' });
  });

  it('waits for App to accept the proved new actor and rejects old renders even afterward', () => {
    setTelemetryContext(actor, true, 'home');
    const original = telemetryContext();
    const mutation = beginTelemetryWorkspaceSwitch();
    setTelemetryContext(actor, true, 'projects');
    expect(telemetryContext().ready).toBe(false);
    finishTelemetryWorkspaceSwitch(mutation, false);
    observeTelemetryIdentity(beginTelemetryIdentityObservation(), session(successor));
    expect(telemetryContext()).toMatchObject({ actor, ready: false });
    setTelemetryContext(successor, true, 'projects');
    expect(telemetryContext()).toMatchObject({
      actor: successor,
      ready: true,
      generation: original.generation + 1,
      continuity: original.continuity + 1,
    });
    setTelemetryContext(actor, true, 'home');
    expect(telemetryContext()).toMatchObject({ actor: successor, ready: true });
    expect(telemetryContext().generation).toBe(original.generation + 1);
  });

  it('accepts an already-presented matching actor only after fresh post-settlement proof', () => {
    setTelemetryContext(actor, true, 'home');
    const original = telemetryContext();
    const older = beginTelemetryWorkspaceSwitch();
    const newer = beginTelemetryWorkspaceSwitch();
    finishTelemetryWorkspaceSwitch(newer, false);
    setTelemetryContext(successor, true, 'projects');
    expect(telemetryContext()).toMatchObject({ actor, ready: false });
    finishTelemetryWorkspaceSwitch(older, false);
    observeTelemetryIdentity(beginTelemetryIdentityObservation(), session(successor));
    expect(telemetryContext()).toMatchObject({
      actor: successor,
      ready: true,
      generation: original.generation + 1,
      continuity: original.continuity + 1,
      route: 'projects',
    });
  });

  it('requires proof begun after every overlapping mutation settles, regardless of start order', () => {
    setTelemetryContext(actor, true, 'home');
    const before = beginTelemetryIdentityObservation();
    const older = beginTelemetryWorkspaceSwitch();
    const newer = beginTelemetryWorkspaceSwitch();
    finishTelemetryWorkspaceSwitch(newer, false);
    const between = beginTelemetryIdentityObservation();
    expect(between).toBeUndefined();
    finishTelemetryWorkspaceSwitch(older, false);
    observeTelemetryIdentity(before, session());
    observeTelemetryIdentity(between, session(successor));
    expect(telemetryContext().ready).toBe(false);
    const superseded = beginTelemetryIdentityObservation();
    const fresh = beginTelemetryIdentityObservation();
    observeTelemetryIdentity(superseded, session());
    expect(telemetryContext().ready).toBe(false);
    observeTelemetryIdentity(fresh, session());
    expect(telemetryContext().ready).toBe(true);
  });

  it.each(['checking', 'verification', 'logout', 'seat'] as const)(
    'does not let Account proof reopen delivery across the %s readiness boundary',
    (boundary) => {
      setTelemetryContext(actor, true, 'home');
      const mutation = beginTelemetryWorkspaceSwitch();
      finishTelemetryWorkspaceSwitch(mutation, false);
      const proof = beginTelemetryIdentityObservation();
      if (boundary === 'verification') {
        observeTelemetryIdentity(proof, { ...session(), verification: { required: true } });
        setTelemetryContext(actor, true, 'home');
      } else if (boundary === 'checking') {
        setTelemetryContext(null, false, 'home');
        observeTelemetryIdentity(proof, session());
        // Even a subsequent valid read cannot bypass App's remaining unready state.
        observeTelemetryIdentity(beginTelemetryIdentityObservation(), session());
      } else {
        const next =
          boundary === 'seat' ? { kind: 'student' as const, seatId: a, classId: b } : null;
        setTelemetryContext(next, true, 'home');
        observeTelemetryIdentity(proof, session());
        expect(telemetryContext()).toMatchObject({ actor: next, ready: true });
        return;
      }
      expect(telemetryContext().ready).toBe(false);
    },
  );
});
