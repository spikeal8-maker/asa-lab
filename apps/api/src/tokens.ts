/** Injection tokens for the composition root. */
export const TOKENS = {
  pool: 'PG_POOL',
  moduleRegistry: 'MODULE_REGISTRY',
  loginUseCase: 'LOGIN_USECASE',
  sessionUseCase: 'SESSION_USECASE',
  teachingContextUseCase: 'TEACHING_CONTEXT_USECASE',
  createClassroomUseCase: 'CREATE_CLASSROOM_USECASE',
  listClassroomsUseCase: 'LIST_CLASSROOMS_USECASE',
  createProjectUseCase: 'CREATE_PROJECT_USECASE',
  listProjectsUseCase: 'LIST_PROJECTS_USECASE',
  openProjectUseCase: 'OPEN_PROJECT_USECASE',
  renameProjectUseCase: 'RENAME_PROJECT_USECASE',
  saveDraftUseCase: 'SAVE_DRAFT_USECASE',
  createCheckpointUseCase: 'CREATE_CHECKPOINT_USECASE',
} as const;
export const SESSION_COOKIE = 'asa_session';
