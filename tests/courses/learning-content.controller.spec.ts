import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import cookie from '@fastify/cookie';
import { LearningContentController } from '../../apps/api/src/learning-content.controller.js';
import { TOKENS } from '../../apps/api/src/tokens.js';
const clientRequest = vi.hoisted(() => ({ path: '' }));
vi.mock('../../apps/web/src/api-call', () => ({
  call: vi.fn(async (path: string) => {
    clientRequest.path = path;
    return { ok: true, status: 200, data: {} };
  }),
}));
import { api as actualClient } from '../../apps/web/src/api';
const id = '10000000-0000-4000-8000-000000000001';
describe('Quiz author content HTTP contracts', () => {
  it('registers canonical Question/Quiz routes, preserves incomplete drafts and binds actor from session', async () => {
    const query = vi
      .fn()
      .mockResolvedValue({ rows: [{ content: { code: 'ok', id, draftRevision: 1 } }] });
    @Module({})
    class TestModule {}
    const app = await NestFactory.create<NestFastifyApplication>(
      {
        module: TestModule,
        controllers: [LearningContentController],
        providers: [
          { provide: TOKENS.pool, useValue: { query } },
          {
            provide: TOKENS.activeContextUseCase,
            useValue: {
              resolve: vi.fn().mockResolvedValue({ principalId: 'author', tenantId: 'tenant' }),
            },
          },
        ],
      },
      new FastifyAdapter(),
      { logger: false },
    );
    try {
      await app.register(cookie);
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      for (const kind of ['questions', 'quizzes']) {
        const created = await app.inject({
          method: 'POST',
          url: '/api/learning/' + kind,
          payload: { requestId: 'quiz:create:1', payload: {} },
        });
        expect(created.statusCode).toBe(201);
        expect(created.json().draftRevision).toBe(1);
        expect(query.mock.calls.at(-1)?.[1]?.slice(0, 2)).toEqual(['author', 'tenant']);
        const saved = await app.inject({
          method: 'PUT',
          url: `/api/learning/${kind}/${id}/draft`,
          payload: {
            requestId: 'quiz:save:1',
            expectedRevision: 1,
            expectedHeadId: null,
            payload: {},
          },
        });
        expect(saved.statusCode).toBe(200);
        const version = await app.inject({
          method: 'GET',
          url: `/api/learning/${kind}/versions/${id}`,
        });
        expect(version.statusCode).toBe(200);
      }
      await actualClient.authoredQuizVersion(id, id);
      expect(clientRequest.path).toBe(`/api/learning/quizzes/${id}/versions/${id}`);
      const exact = await app.inject({ method: 'GET', url: clientRequest.path });
      expect(exact.statusCode).toBe(200);
      expect(query.mock.calls.at(-1)?.[1]).toEqual(['author', 'tenant', id, id]);
      const other = '10000000-0000-4000-8000-000000000002';
      await actualClient.authoredQuizVersion(other, id);
      query.mockResolvedValueOnce({ rows: [{ content: null }] });
      const mismatched = await app.inject({ method: 'GET', url: clientRequest.path });
      expect(mismatched.statusCode).toBe(404);
      expect(query.mock.calls.at(-1)?.[1]).toEqual(['author', 'tenant', other, id]);
      await actualClient.authoredQuizVersion('invalid', id);
      expect((await app.inject({ method: 'GET', url: clientRequest.path })).statusCode).toBe(400);
      const count = query.mock.calls.length;
      const injected = await app.inject({
        method: 'POST',
        url: '/api/learning/questions',
        payload: { requestId: 'quiz:create:1', payload: {}, tenantId: id },
      });
      expect(injected.statusCode).toBe(400);
      expect(query).toHaveBeenCalledTimes(count);
      expect(
        (await app.inject({ method: 'POST', url: '/api/learning/unknown', payload: {} }))
          .statusCode,
      ).toBe(404);
    } finally {
      await app.close();
    }
  });
});
