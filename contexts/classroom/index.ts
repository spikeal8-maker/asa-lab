export { isValidClassroomTitle, type Classroom } from './domain/classroom.js';
export type { ClassroomRepositoryPort, CreateClassroomInput } from './application/ports.js';
export {
  CreateClassroomUseCase,
  type CreateClassroomResult,
} from './application/create-classroom.usecase.js';
export { ListClassroomsUseCase } from './application/list-classrooms.usecase.js';
export { PgClassroomRepository } from './infrastructure/pg-classroom.repository.js';
