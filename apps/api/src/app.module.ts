import { Module, type DynamicModule } from '@nestjs/common';
import type pg from 'pg';
import {
  LoginUseCase,
  PgSessionStore,
  PgTenantLocator,
  PgUserDirectory,
  SessionUseCase,
} from '@asa-lab/identity';
import { GetTeachingContextUseCase, PgTeachingContext } from '@asa-lab/organization';
import {
  CreateClassroomUseCase,
  ListClassroomsUseCase,
  PgClassroomRepository,
} from '@asa-lab/classroom';
import { AuthController } from './auth.controller.js';
import { ClassroomsController } from './classrooms.controller.js';
import { HealthController } from './health.controller.js';
import { TOKENS } from './tokens.js';

/** Composition root: wires context use cases to PostgreSQL adapters. */
@Module({})
export class AppModule {
  static forPool(pool: pg.Pool | null): DynamicModule {
    // A health-only application is intentionally constructible without a pool
    // so readiness can report 503 rather than crashing the process. The real
    // executable still fails closed before startup when APP_DATABASE_URL is
    // absent; this branch exists for health probes and regression tests.
    if (pool === null) {
      return {
        module: AppModule,
        controllers: [HealthController],
        providers: [{ provide: TOKENS.pool, useValue: null }],
      };
    }

    return {
      module: AppModule,
      controllers: [HealthController, AuthController, ClassroomsController],
      providers: [
        { provide: TOKENS.pool, useValue: pool },
        {
          provide: TOKENS.loginUseCase,
          useFactory: () =>
            new LoginUseCase(
              new PgTenantLocator(pool),
              new PgUserDirectory(pool),
              new PgSessionStore(pool),
            ),
        },
        {
          provide: TOKENS.sessionUseCase,
          useFactory: () => new SessionUseCase(new PgSessionStore(pool)),
        },
        {
          provide: TOKENS.teachingContextUseCase,
          useFactory: () => new GetTeachingContextUseCase(new PgTeachingContext(pool)),
        },
        {
          provide: TOKENS.createClassroomUseCase,
          useFactory: () => new CreateClassroomUseCase(new PgClassroomRepository(pool)),
        },
        {
          provide: TOKENS.listClassroomsUseCase,
          useFactory: () => new ListClassroomsUseCase(new PgClassroomRepository(pool)),
        },
      ],
    };
  }
}
