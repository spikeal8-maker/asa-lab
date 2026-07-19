/** Injection tokens for the composition root. */
export const TOKENS = {
  pool: 'PG_POOL',
  loginUseCase: 'LOGIN_USECASE',
  sessionUseCase: 'SESSION_USECASE',
  teachingContextUseCase: 'TEACHING_CONTEXT_USECASE',
  createClassroomUseCase: 'CREATE_CLASSROOM_USECASE',
  listClassroomsUseCase: 'LIST_CLASSROOMS_USECASE',
} as const;

export const SESSION_COOKIE = 'asa_session';
