import { Module, type DynamicModule } from '@nestjs/common';
import type pg from 'pg';
import {
  AccountLoginUseCase,
  AccountManagementUseCase,
  ActiveContextUseCase,
  LoginUseCase,
  PgAccountDirectory,
  PgSessionStore,
  PgSessionV2Store,
  PgTenantLocator,
  PgUserDirectory,
  RegisterAccountUseCase,
  SessionUseCase,
} from '@asa-lab/identity';
import { GetTeachingContextUseCase, PgTeachingContext } from '@asa-lab/organization';
import {
  CreateClassroomUseCase,
  ListClassroomsUseCase,
  PgClassroomRepository,
} from '@asa-lab/classroom';
import {
  ChangeProjectStatusUseCase,
  CreateCheckpointUseCase,
  RestoreVersionUseCase,
  ListVersionsUseCase,
  CreateProjectUseCase,
  DuplicateProjectUseCase,
  ListProjectsUseCase,
  OpenProjectUseCase,
  PgProjectRepository,
  ReadProjectSnapshotUseCase,
  RenameProjectUseCase,
  SaveDraftUseCase,
  SaveProjectSnapshotUseCase,
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
import { AccountC1Controller } from './account-c1.controller.js';
import { CheckersClassroomController } from './checkers-classroom.controller.js';
import { ChessLiveController } from './chess-live.controller.js';
import { AssignmentsController } from './assignments.controller.js';
import { CoursesController } from './courses.controller.js';
import { GalleryController } from './gallery.controller.js';
import { CollectionsController } from './collections.controller.js';
import { ClassroomsController } from './classrooms.controller.js';
import { ClassroomJoinController } from './classroom-join.controller.js';
import {
  ClassroomTeacherInvitationsController,
  ClassroomTeachersController,
} from './classroom-teachers.controller.js';
import { createRuntimeMetrics } from '@asa-lab/observability';
import { HealthController } from './health.controller.js';
import { ModulesController } from './modules.controller.js';
import { ProjectsController } from './projects.controller.js';
import { VersionController } from './version.controller.js';
import { createApiModuleRegistry } from './module-registry.js';
import { SeatContextUseCase } from './seat-context.js';
import { ProjectFeedbackService } from './project-feedback.js';
import { TOKENS } from './tokens.js';

function validationMessage(
  entry: RegisteredModule,
  value: unknown,
):
  | {
      readonly ok: true;
      readonly document: unknown;
    }
  | {
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
        result.diagnostics.map((diagnostic) => diagnostic.message).join('; ') || 'invalid document',
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
    const projectRepository = (): PgProjectRepository => new PgProjectRepository(requirePool());
    const moduleRegistry = createApiModuleRegistry();
    // Health-only composition may be built without a DB. Every normal runtime
    // with APP_DATABASE_URL uses the durable RLS-protected repository.
    const persistentChessLiveRepository = pool ? new PgChessLiveRepository(pool) : null;
    const chessLiveRepository = persistentChessLiveRepository ?? new MemoryChessLiveRepository();
    const chessLiveService = new ChessLiveService(
      chessLiveRepository,
      new SystemLiveClock(),
      new CryptoLiveIds(),
    );
    const toProjectModule = (entry: RegisteredModule): ProjectModule => ({
      moduleKey: entry.manifest.moduleKey,
      validateDocument: (value) => validationMessage(entry, value),
      // Project Core hands back the document it just validated, so the provider
      // sees its own payload type and the validation never runs twice.
      describePreview: (document) => entry.provider?.createPreview(document) ?? null,
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
        AccountC1Controller,
        AssignmentsController,
        CoursesController,
        GalleryController,
        CollectionsController,
        ClassroomsController,
        ClassroomJoinController,
        ClassroomTeachersController,
        ClassroomTeacherInvitationsController,
        ModulesController,
        ProjectsController,
        CheckersClassroomController,
        ChessLiveController,
        VersionController,
      ],
      providers: [
        { provide: TOKENS.pool, useValue: pool },
        { provide: TOKENS.runtimeMetrics, useValue: createRuntimeMetrics() },
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
          provide: TOKENS.accountDirectory,
          useFactory: () => new PgAccountDirectory(requirePool()),
        },
        {
          provide: TOKENS.activeContextUseCase,
          useFactory: () =>
            new ActiveContextUseCase(
              new PgSessionV2Store(requirePool()),
              new PgSessionStore(requirePool()),
              new PgAccountDirectory(requirePool()),
            ),
        },
        {
          provide: TOKENS.registerAccountUseCase,
          useFactory: () => new RegisterAccountUseCase(new PgAccountDirectory(requirePool())),
        },
        {
          provide: TOKENS.accountLoginUseCase,
          useFactory: () =>
            new AccountLoginUseCase(
              new PgAccountDirectory(requirePool()),
              new PgSessionV2Store(requirePool()),
            ),
        },
        {
          provide: TOKENS.accountManagementUseCase,
          useFactory: () =>
            new AccountManagementUseCase(
              new PgAccountDirectory(requirePool()),
              new PgSessionV2Store(requirePool()),
            ),
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
          useFactory: () => new CreateProjectUseCase(projectRepository(), projectModules),
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
          provide: TOKENS.changeProjectStatusUseCase,
          useFactory: () => new ChangeProjectStatusUseCase(projectRepository()),
        },
        {
          provide: TOKENS.duplicateProjectUseCase,
          useFactory: () => new DuplicateProjectUseCase(projectRepository()),
        },
        {
          provide: TOKENS.saveDraftUseCase,
          useFactory: () => new SaveDraftUseCase(projectRepository(), projectModules),
        },
        {
          provide: TOKENS.restoreVersionUseCase,
          useFactory: () => new RestoreVersionUseCase(projectRepository()),
        },
        {
          provide: TOKENS.listVersionsUseCase,
          useFactory: () => new ListVersionsUseCase(projectRepository()),
        },
        {
          provide: TOKENS.createCheckpointUseCase,
          useFactory: () => new CreateCheckpointUseCase(projectRepository()),
        },
        {
          provide: TOKENS.saveProjectSnapshotUseCase,
          useFactory: () => new SaveProjectSnapshotUseCase(projectRepository()),
        },
        {
          provide: TOKENS.readProjectSnapshotUseCase,
          useFactory: () => new ReadProjectSnapshotUseCase(projectRepository()),
        },
        {
          provide: TOKENS.seatContextUseCase,
          useFactory: () => new SeatContextUseCase(pool),
        },
        {
          provide: TOKENS.projectFeedbackService,
          useFactory: () => new ProjectFeedbackService(pool),
        },
        {
          provide: TOKENS.listClassroomsUseCase,
          useFactory: () => new ListClassroomsUseCase(new PgClassroomRepository(requirePool())),
        },
      ],
    };
  }
}
