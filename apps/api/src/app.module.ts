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
    const requirePool = (): pg.Pool => {
      if (!pool) {
        throw new Error('database unavailable: APP_DATABASE_URL is not configured');
      }
      return pool;
    };
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, ClassroomsController],
      providers: [
        { provide: TOKENS.pool, useValue: pool },
        {
          provide: TOKENS.loginUseCase,
          useFactory: () =>
            new LoginUseCase(
              new PgTenantLocator(requirePool()),
              new PgUserDirectory(requirePool()),
              new PgSessionStore(requirePool()),
            ),
        },
        {
          provide: TOKENS.sessionUseCase,
          useFactory: () => new SessionUseCase(new PgSessionStore(requirePool())),
        },
        {
          provide: TOKENS.teachingContextUseCase,
          useFactory: () => new GetTeachingContextUseCase(new PgTeachingContext(requirePool())),
        },
        {
          provide: TOKENS.createClassroomUseCase,
          useFactory: () => new CreateClassroomUseCase(new PgClassroomRepository(requirePool())),
        },
        {
          provide: TOKENS.listClassroomsUseCase,
          useFactory: () => new ListClassroomsUseCase(new PgClassroomRepository(requirePool())),
        },
      ],
    };
  }
}
