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
import {
  CreateCheckpointUseCase,
  CreateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  PgProjectRepository,
  RenameProjectUseCase,
  SaveDraftUseCase,
} from '@asa-lab/projects';
import { EMPTY_DOCUMENT, parseElectronicsDocument } from '@asa-lab/electronics';
import { AuthController } from './auth.controller.js';
import { ProjectsController } from './projects.controller.js';
import { ClassroomsController } from './classrooms.controller.js';
import { HealthController } from './health.controller.js';
import { TOKENS } from './tokens.js';

@Module({})
export class AppModule {
  static forPool(pool: pg.Pool | null): DynamicModule {
    const unavailablePool = new Proxy({} as pg.Pool, {
      get() {
        return () => {
          throw new Error('database unavailable: APP_DATABASE_URL is not configured');
        };
      },
    });
    const requirePool = (): pg.Pool => pool ?? unavailablePool;
    const projectRepository = (): PgProjectRepository => new PgProjectRepository(requirePool());
    return {
      module: AppModule,
      controllers: [HealthController, AuthController, ClassroomsController, ProjectsController],
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
          provide: TOKENS.createProjectUseCase,
          useFactory: () => new CreateProjectUseCase(projectRepository(), EMPTY_DOCUMENT),
        },
        {
          provide: TOKENS.listProjectsUseCase,
          useFactory: () => new ListProjectsUseCase(projectRepository()),
        },
        {
          provide: TOKENS.openProjectUseCase,
          useFactory: () => new OpenProjectUseCase(projectRepository()),
        },
        {
          provide: TOKENS.renameProjectUseCase,
          useFactory: () => new RenameProjectUseCase(projectRepository()),
        },
        {
          provide: TOKENS.saveDraftUseCase,
          useFactory: () =>
            new SaveDraftUseCase(projectRepository(), (value: unknown) => {
              const parsed = parseElectronicsDocument(value);
              return parsed.ok
                ? { ok: true, document: parsed.document }
                : { ok: false, message: parsed.message };
            }),
        },
        {
          provide: TOKENS.createCheckpointUseCase,
          useFactory: () => new CreateCheckpointUseCase(projectRepository()),
        },
        {
          provide: TOKENS.listClassroomsUseCase,
          useFactory: () => new ListClassroomsUseCase(new PgClassroomRepository(requirePool())),
        },
      ],
    };
  }
}
