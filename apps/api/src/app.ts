import { randomUUID } from 'node:crypto';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import type pg from 'pg';
import { PAGE_HTML } from './page.js';
import {
  createSessionToken,
  isValidClassroomTitle,
  isValidEmail,
  verifyPassword,
} from './security.js';
import {
  createClassroom,
  createPool,
  createSession,
  findUserByEmail,
  listClassrooms,
  resolveContext,
  revokeSession,
  type AuthenticatedContext,
} from './store.js';

export type DependencyState = 'up' | 'down' | 'unknown';

export interface LiveResponse {
  readonly status: 'live';
}

export interface ReadyResponse {
  readonly status: 'ready' | 'not_ready';
  readonly dependencies: Readonly<Record<string, DependencyState>>;
}

export interface AppOptions {
  /** Injected PostgreSQL pool; when omitted, created from DATABASE_URL if set. */
  readonly pool?: pg.Pool;
}

const SESSION_COOKIE = 'asa_session';

/**
 * Evaluate readiness. In the Bootstrap foundation no external dependency is
 * wired yet, so their state is unknown and readiness is intentionally NOT
 * confirmed. Real probes replace the `unknown` states in later persistence and
 * infrastructure tasks.
 */
export function evaluateReadiness(): { ready: boolean; body: ReadyResponse } {
  const dependencies: Record<string, DependencyState> = {
    database: 'unknown',
    redis: 'unknown',
    objectStorage: 'unknown',
  };
  const ready = Object.values(dependencies).every((state) => state === 'up');
  return {
    ready,
    body: { status: ready ? 'ready' : 'not_ready', dependencies },
  };
}

function errorBody(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/**
 * Build the Control Plane API. Health probes plus the first user slice:
 * teacher login (server-side session) and classroom create/list. The tenant
 * context is derived exclusively from the session on the server; any
 * client-supplied tenant identifier is rejected.
 */
export function buildApp(options: AppOptions = {}): FastifyInstance {
  const app = Fastify({
    logger: false,
    genReqId: (): string => randomUUID(),
  });

  let pool: pg.Pool | null = options.pool ?? null;
  if (pool === null && process.env['DATABASE_URL']) {
    pool = createPool();
    app.addHook('onClose', async () => {
      await pool?.end();
    });
  }

  void app.register(fastifyCookie);

  app.addHook('onRequest', async (request, reply) => {
    reply.header('x-request-id', request.id);
  });

  const requirePool = (): pg.Pool => {
    if (pool === null) {
      throw Object.assign(new Error('database unavailable'), { statusCode: 503 });
    }
    return pool;
  };

  const contextOf = async (request: FastifyRequest): Promise<AuthenticatedContext | null> => {
    const token = request.cookies[SESSION_COOKIE];
    if (!token) {
      return null;
    }
    return resolveContext(requirePool(), token);
  };

  app.get('/health/live', async (): Promise<LiveResponse> => ({ status: 'live' }));

  app.get('/health/ready', async (_request, reply): Promise<ReadyResponse> => {
    const { ready, body } = evaluateReadiness();
    reply.code(ready ? 200 : 503);
    return body;
  });

  app.get('/', async (_request, reply) => {
    reply.type('text/html; charset=utf-8');
    return PAGE_HTML;
  });

  app.post('/auth/login', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    if (!isValidEmail(body['email']) || typeof body['password'] !== 'string') {
      reply.code(400);
      return errorBody('validation_error', 'email and password are required');
    }
    const db = requirePool();
    const user = await findUserByEmail(db, body['email']);
    if (
      !user ||
      user.status !== 'active' ||
      !verifyPassword(body['password'], user.password_hash)
    ) {
      reply.code(401);
      return errorBody('invalid_credentials', 'invalid email or password');
    }
    const token = createSessionToken();
    await createSession(db, { tenantId: user.tenant_id, userId: user.id, token });
    reply.setCookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      maxAge: 12 * 60 * 60,
    });
    const context = await resolveContext(db, token);
    return { user: publicUser(context) };
  });

  app.post('/auth/logout', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    if (token) {
      await revokeSession(requirePool(), token);
    }
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', async (request, reply) => {
    const context = await contextOf(request);
    if (!context) {
      reply.code(401);
      return errorBody('unauthorized', 'no active session');
    }
    return { user: publicUser(context) };
  });

  app.post('/classrooms', async (request, reply) => {
    const context = await contextOf(request);
    if (!context) {
      reply.code(401);
      return errorBody('unauthorized', 'no active session');
    }
    const body = (request.body ?? {}) as Record<string, unknown>;
    if ('tenant_id' in body || 'tenantId' in body) {
      reply.code(400);
      return errorBody(
        'validation_error',
        'tenant is derived from the session and must not be sent',
      );
    }
    if (!isValidClassroomTitle(body['title'])) {
      reply.code(400);
      return errorBody('validation_error', 'title must be 1..255 characters');
    }
    const classroom = await createClassroom(requirePool(), context, body['title']);
    reply.code(201);
    return { classroom };
  });

  app.get('/classrooms', async (request, reply) => {
    const context = await contextOf(request);
    if (!context) {
      reply.code(401);
      return errorBody('unauthorized', 'no active session');
    }
    const items = await listClassrooms(requirePool(), context);
    return { items, meta: { total: items.length } };
  });

  return app;
}

function publicUser(context: AuthenticatedContext | null): {
  id: string;
  role: string;
  displayName: string;
  email: string;
} {
  if (!context) {
    throw new Error('context missing after login');
  }
  return {
    id: context.userId,
    role: context.role,
    displayName: context.displayName,
    email: context.email,
  };
}
