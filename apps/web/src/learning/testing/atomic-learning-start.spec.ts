import { describe, expect, it, vi } from 'vitest';
import { AtomicLearningStarter } from '../atomic-learning-start';

const receipt = {
  projectId: 'project-one',
  participationId: 'participation-one',
  activityRunId: 'run-one',
  attemptId: 'attempt-one',
  attemptNumber: 1,
  state: 'in_progress' as const,
  reused: false,
};

describe('atomic learner Start request', () => {
  it('uses one exact Run, blocks a simultaneous click, and reuses the request key after lost response', async () => {
    let release!: (value: {
      ok: false;
      status: number;
      error: { code: string; message: string };
    }) => void;
    const first = new Promise<{
      ok: false;
      status: number;
      error: { code: string; message: string };
    }>((resolve) => {
      release = resolve;
    });
    const send = vi.fn().mockReturnValueOnce(first).mockResolvedValueOnce({
      ok: true,
      status: 200,
      data: receipt,
    });
    const starter = new AtomicLearningStarter(send);
    const pending = starter.start('run-one');
    expect(await starter.start('run-one')).toBeNull();
    expect(send).toHaveBeenCalledTimes(1);
    release({ ok: false, status: 0, error: { code: 'network', message: 'lost response' } });
    expect((await pending)?.ok).toBe(false);
    expect((await starter.start('run-one'))?.ok).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]?.[0]).toBe('run-one');
    expect(send.mock.calls[0]?.[1]).toBe(send.mock.calls[1]?.[1]);
    expect(send.mock.calls[0]?.[1]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('fails closed without an exact Run and does not send or navigate', async () => {
    const send = vi.fn();
    const starter = new AtomicLearningStarter(send);
    expect(await starter.start(null)).toMatchObject({
      ok: false,
      error: { code: 'exact_run_unavailable' },
    });
    expect(send).not.toHaveBeenCalled();
  });
});
