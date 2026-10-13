import { call, type ApiResult } from './api-call';

/** Works: distinct supported projects (active + archived); assigned/submitted/
 * waiting: learner obligations; notSubmitted: learners with obligations and no submission. */
export interface ObservationCounts {
  students: number;
  works: number;
  assigned: number;
  submitted: number;
  waiting: number;
  notSubmitted: number;
}
export interface ObservationSummary {
  items: Array<ObservationCounts & { classroomId: string }>;
  totals: ObservationCounts;
}
export interface ObservationProject {
  id: string;
  title: string;
  moduleKey: string;
  seatId: string;
  student: string;
  avatarKey: string | null;
  updatedAt: string;
  status: string;
  assigned: boolean;
}
export interface ObservationEvent {
  id: string;
  action: string;
  seatId: string | null;
  student: string | null;
  byTeacher: boolean;
  projectId: string | null;
  projectTitle: string | null;
  at: string;
  count: number;
}
export interface ObservationProjectsPage {
  items: ObservationProject[];
  total: number;
  hidden: number;
  nextOffset: number | null;
  learners: Array<{ id: string; label: string }>;
}
export interface ObservationHistoryPage {
  items: ObservationEvent[];
  nextCursor: string | null;
  learners: Array<{ id: string; label: string }>;
}
function query(filters: Record<string, string | number | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}
export const observationApi = {
  prepare: (classroomIds: string[]) =>
    call<{ ok: true }>('/api/classrooms/observation/prepare', {
      method: 'POST',
      body: JSON.stringify({ classroomIds }),
    }),
  summary: async (classroomIds: string[]): Promise<ApiResult<ObservationSummary>> => {
    const prepared = await observationApi.prepare(classroomIds);
    if (!prepared.ok) return prepared;
    return call<ObservationSummary>('/api/classrooms/observation/summary', {
      method: 'POST',
      body: JSON.stringify({ classroomIds }),
    });
  },
  projects: (classroomId: string, filters: Record<string, string | number | undefined> = {}) =>
    call<ObservationProjectsPage>(
      `/api/classrooms/${classroomId}/observation/projects?${query(filters)}`,
    ),
  history: (classroomId: string, filters: Record<string, string | number | undefined> = {}) =>
    call<ObservationHistoryPage>(
      `/api/classrooms/${classroomId}/observation/history?${query(filters)}`,
    ),
};
