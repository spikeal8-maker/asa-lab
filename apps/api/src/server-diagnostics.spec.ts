import { describe, it, expect, vi } from 'vitest';
import { Controller, Get, Post, Module, HttpException, type ArgumentsHost } from '@nestjs/common';
import { NestFactory, type HttpAdapterHost } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';
import {
  ServerDiagnosticsFilter,
  safeServerError,
  diagnosticContext,
  requestFailures,
  recordServerFailure,
} from './server-diagnostics.js';

@Controller()
class DiagnosticFixtureController {
  @Post('input') input() {
    return { ok: true };
  }
  @Get('native-failure') native() {
    return { ok: true };
  }
}
@Module({ controllers: [DiagnosticFixtureController] })
class DiagnosticFixtureModule {}

describe('structured server error evidence', () => {
  it('preserves native parser 400/415 and records one native 500 through Nest and Fastify', async () => {
    const adapter = new FastifyAdapter();
    const app = await NestFactory.create<NestFastifyApplication>(DiagnosticFixtureModule, adapter, {
      logger: false,
    });
    const fastify = adapter.getInstance();
    app.useGlobalFilters(new ServerDiagnosticsFilter(app.getHttpAdapter(), 'abcdef0', null));
    fastify.addHook('onError', async (request, _reply, error) => {
      recordServerFailure(error, request, error.statusCode ?? 500, 'abcdef0', null);
    });
    fastify.addHook('onRequest', async (request) => {
      if (request.url === '/native-failure') throw new Error('Query read timeout');
    });
    for (const status of [400, 415])
      fastify.addContentTypeParser(
        `application/x-diag-${status}`,
        { parseAs: 'string' },
        (_request, _body, done) =>
          done(Object.assign(new Error(`fixture_parser_${status}`), { statusCode: status })),
      );
    await app.init();
    await fastify.ready();
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      for (const status of [400, 415]) {
        const response = await fastify.inject({
          method: 'POST',
          url: '/input',
          headers: { 'content-type': `application/x-diag-${status}` },
          payload: 'malformed fixture',
        });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({
          statusCode: status,
          message: `fixture_parser_${status}`,
        });
      }
      expect(out).not.toHaveBeenCalled();
      const response = await fastify.inject({ method: 'GET', url: '/native-failure' });
      expect(response.statusCode).toBe(500);
      const errors = out.mock.calls
        .map((call) => JSON.parse(String(call[0])))
        .filter((e) => e.kind === 'server_error');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatchObject({ errorCode: 'database_query_timeout', status: 500 });
    } finally {
      out.mockRestore();
      await app.close();
    }
  });
  it('records a safe cause and stack without exception messages, SQL or capability contents', () => {
    const error = new Error('Query read timeout; password=private-value SELECT private SQL');
    error.stack =
      'Error: private-value\n    at execute (/app/query.js:14:3)\n    at https://host.invalid/?token=private-value:1:2';
    const safe = safeServerError(error);
    expect(safe).toMatchObject({
      errorCode: 'database_query_timeout',
      frames: ['at execute (/app/query.js:14:3)'],
    });
    expect(JSON.stringify(safe)).not.toMatch(/private-value|SELECT/);
  });
  it('logs one correlated 500 and keeps the public error response and expected 4xx semantics', () => {
    const reply = vi.fn();
    const adapter = {
      isHeadersSent: () => false,
      reply,
    } as unknown as HttpAdapterHost['httpAdapter'];
    const request = {
      id: '10000000-0000-4000-8000-000000000001',
      method: 'GET',
      raw: { url: '/api/projects/fixture?secret=private-value' },
      headers: {
        'x-asa-diagnostic-module': 'scratch',
        'x-asa-diagnostic-instance': '20000000-0000-4000-8000-000000000001',
      },
    } as unknown as FastifyRequest;
    const host = {
      switchToHttp: () => ({ getRequest: () => request, getResponse: () => ({}) }),
      getArgByIndex: () => ({}),
    } as unknown as ArgumentsHost;
    const filter = new ServerDiagnosticsFilter(adapter, 'abcdef0', null);
    const out = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    try {
      filter.catch(new Error('Query read timeout private-value'), host);
      expect(out).toHaveBeenCalledTimes(1);
      const event = JSON.parse(String(out.mock.calls[0]![0]));
      expect(event).toMatchObject({
        kind: 'server_error',
        requestId: request.id,
        errorCode: 'database_query_timeout',
        module: 'scratch',
        revision: 'abcdef0',
        status: 500,
      });
      expect(JSON.stringify(event)).not.toContain('private-value');
      expect(reply.mock.calls[0]![1]).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(requestFailures.get(request)).toBe('database_query_timeout');
      filter.catch(new HttpException({ error: { code: 'validation_error' } }, 400), host);
      expect(out).toHaveBeenCalledTimes(1);
      expect(reply.mock.calls[1]![1]).toEqual({ error: { code: 'validation_error' } });
      expect(
        diagnosticContext({
          ...request,
          headers: {
            'x-asa-diagnostic-instance': 'private-value',
            'x-asa-diagnostic-module': 'secret',
          },
        } as FastifyRequest),
      ).toEqual({});
    } finally {
      out.mockRestore();
    }
  });
});
