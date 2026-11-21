import { strict as assert } from 'node:assert';
import { describe, it } from 'vitest';
import {
  createAssignmentLifetime,
  type AssignmentFocusTicket,
  type AssignmentStageToken,
} from '../classroom-assignment-lifetime';

function existing<T>(value: T | null): T {
  assert.notEqual(value, null);
  return value as T;
}

function fixture() {
  const owner = createAssignmentLifetime();
  const scope = owner.activate();
  const picker = existing(scope.start());
  return { owner, scope, picker };
}

describe('classroom assignment context and stage lifetime', () => {
  it('activates one live owner and starts one stage', () => {
    const { scope, picker } = fixture();
    assert.equal(scope.isLive(), true);
    assert.equal(scope.isCurrent(picker), true);
  });

  it('keeps tokens immutable', () => {
    const { scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    assert.equal(Object.isFrozen(picker), true);
    assert.equal(Object.isFrozen(ticket), true);
  });

  it('rejects a reconstructed stage with identical public fields', () => {
    const { scope, picker } = fixture();
    const forged = { ...picker };
    assert.equal(scope.isCurrent(forged), false);
    assert.equal(scope.advance(forged), null);
    assert.equal(scope.finish(forged), null);
    assert.equal(scope.isCurrent(picker), true);
  });

  it('starts a fresh flow without retaining the previous picker', () => {
    const { scope, picker } = fixture();
    const next = existing(scope.start());
    assert.equal(scope.isCurrent(picker), false);
    assert.equal(scope.isCurrent(next), true);
    assert.notEqual(picker, next);
  });

  it('advances picker to editor and invalidates picker callbacks', () => {
    const { scope, picker } = fixture();
    const editor = existing(scope.advance(picker));
    assert.equal(scope.isCurrent(picker), false);
    assert.equal(scope.isCurrent(editor), true);
    assert.equal(scope.finish(picker), null);
  });

  it('ignores a second creation request from the same old picker', () => {
    const { scope, picker } = fixture();
    const editor = existing(scope.advance(picker));
    assert.equal(scope.advance(picker), null);
    assert.equal(scope.isCurrent(editor), true);
  });

  it('advances editor to a new prepared picker without reviving the first picker', () => {
    const { scope, picker } = fixture();
    const editor = existing(scope.advance(picker));
    const prepared = existing(scope.advance(editor));
    assert.equal(scope.isCurrent(prepared), true);
    assert.equal(scope.isCurrent(picker), false);
    assert.equal(scope.isCurrent(editor), false);
  });

  it('rejects old editor publication after return to a prepared picker', () => {
    const { scope, picker } = fixture();
    const editor = existing(scope.advance(picker));
    const prepared = existing(scope.advance(editor));
    assert.equal(scope.advance(editor), null);
    assert.equal(scope.finish(editor), null);
    assert.equal(scope.isCurrent(prepared), true);
  });

  it('allows returning from a prepared picker to another editor stage', () => {
    const { scope, picker } = fixture();
    const firstEditor = existing(scope.advance(picker));
    const prepared = existing(scope.advance(firstEditor));
    const secondEditor = existing(scope.advance(prepared));
    assert.equal(scope.isCurrent(secondEditor), true);
    assert.equal(scope.isCurrent(firstEditor), false);
  });

  it('consumes confirmed completion exactly once', () => {
    const { scope, picker } = fixture();
    assert.ok(scope.finish(picker));
    assert.equal(scope.finish(picker), null);
    assert.equal(scope.advance(picker), null);
  });

  it('does not let a closed flow complete a newly opened flow', () => {
    const { scope, picker } = fixture();
    existing(scope.finish(picker));
    const next = existing(scope.start());
    assert.equal(scope.finish(picker), null);
    assert.equal(scope.isCurrent(next), true);
  });

  it('invalidates all stages on classroom context replacement', () => {
    const { owner, scope, picker } = fixture();
    const replacement = owner.activate();
    assert.equal(scope.isLive(), false);
    assert.equal(scope.isCurrent(picker), false);
    assert.equal(scope.finish(picker), null);
    assert.equal(replacement.isLive(), true);
  });

  it('prevents a stale provider from starting any new stage', () => {
    const { owner, scope } = fixture();
    owner.activate();
    assert.equal(scope.start(), null);
  });

  it('keeps the new provider flow intact after old completion attempts', () => {
    const { owner, scope, picker } = fixture();
    const nextScope = owner.activate();
    const nextPicker = existing(nextScope.start());
    assert.equal(scope.finish(picker), null);
    assert.equal(nextScope.isCurrent(nextPicker), true);
  });

  it('permits a new provider to finish its own current flow', () => {
    const { owner } = fixture();
    const nextScope = owner.activate();
    const nextPicker = existing(nextScope.start());
    assert.ok(nextScope.finish(nextPicker));
  });

  it('does not reactivate A callbacks when returning from B to A', () => {
    const { owner, scope, picker } = fixture();
    const b = owner.activate();
    const bStage = existing(b.start());
    const newA = owner.activate();
    const newStage = existing(newA.start());
    assert.equal(scope.finish(picker), null);
    assert.equal(b.finish(bStage), null);
    assert.equal(newA.isCurrent(newStage), true);
  });

  it('does not let cleanup of an old scope dispose a replacement', () => {
    const { owner, scope } = fixture();
    const nextScope = owner.activate();
    const next = existing(nextScope.start());
    scope.dispose();
    assert.equal(nextScope.isLive(), true);
    assert.equal(nextScope.isCurrent(next), true);
  });

  it('disposes active work on unmount or logout', () => {
    const { scope, picker } = fixture();
    scope.dispose();
    assert.equal(scope.isLive(), false);
    assert.equal(scope.finish(picker), null);
    assert.equal(scope.advance(picker), null);
    assert.equal(scope.start(), null);
  });

  it('supports idempotent teardown', () => {
    const { scope } = fixture();
    scope.dispose();
    scope.dispose();
    assert.equal(scope.isLive(), false);
  });

  it('supports StrictMode setup, cleanup and fresh setup', () => {
    const { owner, scope, picker } = fixture();
    scope.dispose();
    const replay = owner.activate();
    const live = existing(replay.start());
    assert.equal(scope.isCurrent(picker), false);
    assert.equal(replay.isCurrent(live), true);
  });

  it('allows focus restoration only for the most recent completed stage', () => {
    const { scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    assert.equal(scope.canRestoreFocus(ticket), true);
  });

  it('cancels a pending focus ticket as soon as a new flow starts', () => {
    const { scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    existing(scope.start());
    assert.equal(scope.canRestoreFocus(ticket), false);
  });

  it('never revives an old focus ticket after a later flow also closes', () => {
    const { scope, picker } = fixture();
    const first = existing(scope.finish(picker));
    const secondStage = existing(scope.start());
    const second = existing(scope.finish(secondStage));
    assert.equal(scope.canRestoreFocus(first), false);
    assert.equal(scope.canRestoreFocus(second), true);
  });

  it('invalidates deferred focus when a provider is replaced', () => {
    const { owner, scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    owner.activate();
    assert.equal(scope.canRestoreFocus(ticket), false);
  });

  it('invalidates deferred focus after unmount', () => {
    const { scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    scope.dispose();
    assert.equal(scope.canRestoreFocus(ticket), false);
  });

  it('does not accept a copied focus ticket', () => {
    const { scope, picker } = fixture();
    const ticket = existing(scope.finish(picker));
    assert.equal(scope.canRestoreFocus({ ...ticket }), false);
    assert.equal(scope.canRestoreFocus(ticket), true);
  });

  it('does not accept another component instance tokens', () => {
    const a = fixture();
    const b = fixture();
    assert.equal(a.scope.finish(b.picker), null);
    assert.equal(b.scope.finish(a.picker), null);
    assert.equal(a.scope.isCurrent(a.picker), true);
    assert.equal(b.scope.isCurrent(b.picker), true);
  });

  it('does not use matching sequence numbers as authorization', () => {
    const { scope, picker } = fixture();
    const fake = {
      kind: 'assignment-focus',
      sequence: picker.sequence + 1,
    } as AssignmentFocusTicket;
    existing(scope.finish(picker));
    assert.equal(scope.canRestoreFocus(fake), false);
  });

  it('survives many transitions and rejects every retired token', () => {
    const { scope, picker } = fixture();
    let live = picker;
    const retired: AssignmentStageToken[] = [];
    for (let i = 0; i < 100; i += 1) {
      retired.push(live);
      live = existing(scope.advance(live));
    }
    for (const token of retired) {
      assert.equal(scope.isCurrent(token), false);
      assert.equal(scope.advance(token), null);
      assert.equal(scope.finish(token), null);
    }
    assert.equal(scope.isCurrent(live), true);
    assert.ok(scope.finish(live));
  });

  it('does not let an earlier failed finish invalidate the current focus ticket', () => {
    const { scope, picker } = fixture();
    const editor = existing(scope.advance(picker));
    const ticket = existing(scope.finish(editor));
    assert.equal(scope.finish(picker), null);
    assert.equal(scope.canRestoreFocus(ticket), true);
  });
});
