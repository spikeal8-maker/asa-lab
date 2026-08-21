import { describe, expect, it, vi } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type pg from 'pg';
import type { AccountDirectoryPort, ActiveContextUseCase } from '@asa-lab/identity';
import { AssignmentsController } from './assignments.controller.js';
import type { SeatContextUseCase } from './seat-context.js';

const ASSIGNMENT_ID = '123e4567-e89b-42d3-a456-426614174000';
const IMAGE_ID = '123e4567-e89b-42d3-a456-426614174001';

function request(cookies: Record<string, string> = {}): FastifyRequest {
  return { cookies } as unknown as FastifyRequest;
}

function reply(): FastifyReply {
  const value = {
    header: vi.fn(),
    send: vi.fn(),
  };
  value.header.mockReturnValue(value);
  value.send.mockReturnValue(value);
  return value as unknown as FastifyReply;
}

function controller(options: {
  account?: Record<string, unknown> | null;
  seat?: Record<string, unknown> | null;
  rows?: unknown[];
}) {
  const query = vi.fn(async () => ({ rows: options.rows ?? [] }));
  const activeContext = {
    resolve: vi.fn(async () => options.account ?? null),
  } as unknown as ActiveContextUseCase;
  const seatContext = {
    resolve: vi.fn(async () => options.seat ?? null),
  } as unknown as SeatContextUseCase;
  const accounts = {} as AccountDirectoryPort;
  const pool = { query } as unknown as pg.Pool;
  return {
    value: new AssignmentsController(activeContext, seatContext, accounts, pool),
    query,
  };
}

describe('assignment media authorization', () => {
  it('rejects anonymous sample reads before touching the database', async () => {
    const target = controller({ account: null, seat: null });
    await expect(target.value.sample(request(), ASSIGNMENT_ID, reply())).rejects.toMatchObject({
      status: 401,
    });
    expect(target.query).not.toHaveBeenCalled();
  });

  it('passes the signed-in account identity to the protected sample reader', async () => {
    const target = controller({
      account: {
        principalId: 'principal-account',
        accountId: 'account-id',
        tenantId: 'tenant-id',
      },
      rows: [{ sample_bytes: Buffer.from('image'), sample_content_type: 'image/png' }],
    });
    await target.value.sample(request({ asa_session: 'session' }), ASSIGNMENT_ID, reply());

    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('assignment_sample_for_viewer'),
      [ASSIGNMENT_ID, 'principal-account', 'account-id', 'tenant-id', null],
    );
  });

  it('passes the exact learner seat to the protected inline-image reader', async () => {
    const target = controller({
      account: null,
      seat: {
        principalId: 'principal-seat',
        tenantId: 'tenant-id',
        seatId: 'seat-id',
      },
      rows: [{ bytes: Buffer.from('image'), content_type: 'image/webp' }],
    });
    await target.value.image(
      request({ asa_student_session: 'student-session' }),
      ASSIGNMENT_ID,
      IMAGE_ID,
      reply(),
    );

    expect(target.query).toHaveBeenCalledWith(
      expect.stringContaining('assignment_image_for_viewer'),
      [ASSIGNMENT_ID, IMAGE_ID, 'principal-seat', null, 'tenant-id', 'seat-id'],
    );
  });
});
