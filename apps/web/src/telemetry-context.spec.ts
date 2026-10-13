import { describe, expect, it } from 'vitest';
import {
  setTelemetryContext,
  telemetryActor,
  telemetryContext,
  telemetryRoute,
} from './telemetry-context';
const a = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const b = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
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
