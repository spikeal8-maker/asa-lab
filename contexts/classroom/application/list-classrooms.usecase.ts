import type { Classroom } from '../domain/classroom.js';
import type { ClassroomRepositoryPort } from './ports.js';

export class ListClassroomsUseCase {
  constructor(private readonly repository: ClassroomRepositoryPort) {}

  async execute(accountId: string): Promise<Classroom[]> {
    return this.repository.listForAccount(accountId);
  }
}
