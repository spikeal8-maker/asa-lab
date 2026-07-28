export { isValidClassroomTitle, type Classroom } from './domain/classroom.js';
export {
  generateJoinCode,
  isValidJoinCode,
  joinCodeDigest,
  normalizeJoinCode,
} from './domain/join-code.js';
export type {
  ClassroomPreview,
  IssuedJoinCode,
  JoinCodeDirectoryPort,
  JoinCodeSecretPort,
} from './application/join-code.ports.js';
export {
  JOIN_INTENT_TTL_SECONDS,
  issueJoinIntentToken,
  verifyJoinIntentToken,
  type JoinIntentClaims,
} from './domain/join-intent.js';
export {
  DescribeJoinIntentUseCase,
  type DescribeJoinIntentResult,
} from './application/describe-join-intent.usecase.js';
export {
  ResolveJoinCodeUseCase,
  type ResolveJoinCodeResult,
  type ResolvedClass,
} from './application/resolve-join-code.usecase.js';
export {
  IssueJoinCodeUseCase,
  type IssueJoinCodeResult,
} from './application/issue-join-code.usecase.js';
export { RevokeJoinCodeUseCase } from './application/revoke-join-code.usecase.js';
export { PgJoinCodeDirectory } from './infrastructure/pg-join-code.directory.js';
export type {
  ClassroomRepositoryPort,
  CreateClassroomInput,
  CreateWithOwnerResult,
} from './application/ports.js';
export {
  CreateClassroomUseCase,
  classroomRequestFingerprint,
  type CreateClassroomResult,
} from './application/create-classroom.usecase.js';
export { ListClassroomsUseCase } from './application/list-classrooms.usecase.js';
export { PgClassroomRepository } from './infrastructure/pg-classroom.repository.js';
