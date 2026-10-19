import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { ActiveContextUseCase } from '@asa-lab/identity';
import type { FastifyRequest } from 'fastify';
import { AccountVerificationService } from './account-verification.service.js';
import type { SeatContextUseCase } from './seat-context.js';
import { SESSION_COOKIE, TOKENS } from './tokens.js';

const ALLOW_UNVERIFIED_ACCOUNT = 'asa.allowUnverifiedAccount';

// Compare the route registered by Fastify, never a URL/header supplied by a client.
// These handlers either are public or authenticate StudentSeat alone. Their
// existing authentication, validation, rate limits and origin checks still run.
const INDEPENDENT_ROUTES = new Set([
  'GET /api/modules',
  'GET /api/version',
  'GET /api/classroom-teacher-invitations/:token',
  'GET /health/live',
  'GET /health/ready',
  'GET /health/metrics',
  'POST /api/diagnostics/client',
  'POST /api/class-join/resolve',
  'POST /api/class-join/studentseat',
  'POST /api/class-join/logout',
  'GET /api/class-join/me',
  'PUT /api/class-join/me/avatar',
  'GET /api/class-join/me/assignment-counts',
  'GET /api/class-join/me/assignments',
  'GET /api/class-join/me/quizzes',
  'GET /api/class-join/me/results',
  'GET /api/class-join/me/course-runs',
  'GET /api/class-join/me/awards',
  'POST /api/class-join/me/course-runs/:runId/lessons/:lessonId/progress',
]);

// The audited handlers on these routes select a Seat before an Account. A
// genuine Seat session must not acquire an unrelated Account's verification
// requirement. A fabricated Seat cookie never bypasses the Account gate.
const AI_SEAT_FIRST_ROUTES = new Set([
  'GET /api/ai/scopes',
  'GET /api/ai/status',
  'GET /api/ai/threads',
  'POST /api/ai/threads',
  'PATCH /api/ai/threads/:threadId',
  'DELETE /api/ai/threads/:threadId',
  'GET /api/ai/threads/:threadId/messages',
  'POST /api/ai/threads/:threadId/messages',
  'POST /api/ai/threads/:threadId/messages/stream',
  'POST /api/ai/threads/:threadId/requests/:requestId/stop',
]);
const SEAT_FIRST_ROUTES = new Set([
  ...AI_SEAT_FIRST_ROUTES,
  'GET /api/class-join/course-runs/:runId/lessons/:lessonId/sample',
  'GET /api/class-join/course-runs/:runId/lessons/:lessonId/materials/:blockId',
  'GET /api/class-join/course-runs/:runId/lessons/:lessonId/materials/:blockId/:role/:contentHash',
  'GET /api/class-join/course-activities/:activityRunId/sample',
  'POST /api/class-join/me/quizzes/:assignmentId/submit',
  'POST /api/class-join/me/assignments/:assignmentId/work',
  'POST /api/class-join/me/assignments/:assignmentId/submit',
  'GET /api/learning/projects/:projectId/context',
  'POST /api/learning/projects/:projectId/submit',
  'POST /api/learning/work/runs/:activityRunId/start',
]);

/** Only identity proof, recovery and narrowly scoped configuration use this. */
export const AllowUnverifiedAccount = () => SetMetadata(ALLOW_UNVERIFIED_ACCOUNT, true);

@Injectable()
export class AccountVerificationGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKENS.activeContextUseCase) private readonly activeContext: ActiveContextUseCase,
    @Inject(TOKENS.accountVerification) private readonly verification: AccountVerificationService,
    @Inject(TOKENS.seatContextUseCase) private readonly seats: SeatContextUseCase,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== 'http') return true;
    if (
      this.reflector.getAllAndOverride<boolean>(ALLOW_UNVERIFIED_ACCOUNT, [
        context.getHandler(),
        context.getClass(),
      ])
    )
      return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const method = request.method === 'HEAD' ? 'GET' : request.method;
    const route = `${method} ${request.routeOptions?.url}`;
    if (INDEPENDENT_ROUTES.has(route)) return true;
    const token = request.cookies[SESSION_COOKIE];
    if (!token || !(await this.verification.isEnabled())) return true;
    if (
      SEAT_FIRST_ROUTES.has(route) &&
      request.cookies['asa_student_session'] &&
      (await (AI_SEAT_FIRST_ROUTES.has(route)
        ? this.seats.resolveExisting(request.cookies['asa_student_session'])
        : this.seats.resolve(request.cookies['asa_student_session'])))
    )
      return true;
    const identity = await this.activeContext.resolve(token);
    // Existing route authentication still rejects invalid or revoked cookies.
    // Anonymous/public and StudentSeat requests gain no Account authority here.
    if (!identity) return true;
    await this.verification.requireAccount(identity.accountId);
    return true;
  }
}
