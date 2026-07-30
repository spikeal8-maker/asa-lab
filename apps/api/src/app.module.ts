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
  type CreatableProjectModule,
  type ModuleCatalogPort,
  type ProjectModule,
} from '@asa-lab/projects';
import {
  ChessLiveService,
  CryptoLiveIds,
  MemoryChessLiveRepository,
  PgChessLiveRepository,
  SystemLiveClock,
} from '@asa-lab/chess-live';
import type { RegisteredModule } from '@asa-lab/module-sdk';
import { AuthController } from './auth.controller.js';
import { ChessLiveController } from './chess-live.controller.js';
import { ClassroomsController } from './classrooms.controller.js';
import { HealthController } from './health.controller.js';
import { ModulesController } from './modules.controller.js';
import { ProjectsController } from './projects.controller.js';
import { createApiModuleRegistry } from './module-registry.js';
import { TOKENS } from './tokens.js';

function validationMessage(entry: RegisteredModule, value: unknown): {
  readonly ok: true;
  readonly document: unknown;
} | {
  readonly ok: false;
  readonly message: string;
} {
  const provider = entry.provider;
  if (!provider) {
    return { ok: false, message: `module "${entry.manifest.moduleKey}" has no provider` };
  }
  const result = provider.validate(value);
  if (!result.ok) {
    return {
      ok: false,
      message:
        result.diagnostics.map((diagnostic) => diagnostic.message).join('; ') ||
        'invalid document',
    };
  }
  return { ok: true, document: result.payload };
}

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
    const projectRepository = (): PgProjectRepository =>
      new PgProjectRepository(requirePool());
    const moduleRegistry = createApiModuleRegistry();
    // Health-only composition may be built without a DB. Every normal runtime
    // with APP_DATABASE_URL uses the durable RLS-protected repository.
    const chessLiveRepository = pool
      ? new PgChessLiveRepository(pool)
      : new MemoryChessLiveRepository();
    const chessLiveService = new ChessLiveService(
      chessLiveRepository,
      new SystemLiveClock(),
      new CryptoLiveIds(),
    );
    const toProjectModule = (entry: RegisteredModule): ProjectModule => ({
      moduleKey: entry.manifest.moduleKey,
      validateDocument: (value) => validationMessage(entry, value),
    });
    const projectModules: ModuleCatalogPort = {
      get: (moduleKey) => {
        const entry = moduleRegistry.get(moduleKey);
        return entry?.provider ? toProjectModule(entry) : null;
      },
      getCreatable: (moduleKey) => {
        const entry = moduleRegistry.getCreatable(moduleKey);
        const provider = entry?.provider;
        if (!entry || !provider) return null;
        const module: CreatableProjectModule = {
          ...toProjectModule(entry),
          createEmptyProject: () => provider.createEmptyProject(),
        };
        return module;
      },
    };

    return {
      module: AppModule,
      controllers: [
        HealthController,
        AuthController,
        ClassroomsController,
        ModulesController,
        ProjectsController,
        ChessLiveController,
      ],
      providers: [
        { provide: TOKENS.pool, useValue: pool },
        { provide: TOKENS.moduleRegistry, useValue: moduleRegistry },
        { provide: TOKENS.chessLiveRepository, useValue: chessLiveRepository },
        { provide: TOKENS.chessLiveService, useValue: chessLiveService },
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
          useFactory: () =>
            new GetTeachingContextUseCase(new PgTeachingContext(requirePool())),
        },
        {
          provide: TOKENS.createClassroomUseCase,
          useFactory: () =>
            new CreateClassroomUseCase(new PgClassroomRepository(requirePool())),
        },
        {
          provide: TOKENS.createProjectUseCase,
          useFactory: () =>
            new CreateProjectUseCase(projectRepository(), projectModules),
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
            new SaveDraftUseCase(projectRepository(), projectModules),
        },
        {
          provide: TOKENS.createCheckpointUseCase,
          useFactory: () => new CreateCheckpointUseCase(projectRepository()),
        },
        {
          provide: TOKENS.listClassroomsUseCase,
          useFactory: () =>
            new ListClassroomsUseCase(new PgClassroomRepository(requirePool())),
        },
      ],
    };
  }
}
