import { call } from './api-call';
import { newClientId } from './client-id';
import type {
  ClassroomStudentWork,
  ProjectFeedback,
  ClassroomActivityEntry,
  SeatAward,
} from './api';

export const PARTICIPANT_FACTORS = ['projects', 'logins', 'days', 'time', 'grades'] as const;
export type ParticipantFactor = (typeof PARTICIPANT_FACTORS)[number];
export interface ParticipantSettings {
  periodDays: 7 | 30 | 90;
  revision: number;
  factors: Record<ParticipantFactor, boolean>;
}
export interface ParticipantMetrics {
  seatId: string;
  totalWorks: number;
  archivedWorks: number;
  score: number | null;
  rank: number | null;
  factors: Record<ParticipantFactor, number>;
  sources: Record<ParticipantFactor, number>;
  role: 'student' | 'helper';
  avatarUrl: string | null;
}
export interface ParticipantRoster {
  settings: ParticipantSettings;
  items: ParticipantMetrics[];
}
export interface ParticipantProfile {
  status: 'active' | 'archived';
  settings: ParticipantSettings;
  metrics: ParticipantMetrics;
  student: {
    id: string;
    displayLabel: string;
    avatarKey: string | null;
    status: string;
    safeMode: boolean;
    lastActiveAt: string | null;
  };
  activity: ClassroomActivityEntry[];
  builtinAwards: SeatAward[];
  submittedCount: number;
  awaitingReview: number;
  merits: Array<{
    id: string;
    title: string;
    description: string;
    granted: boolean;
    grantedAt: string | null;
  }>;
  avatars: Array<{
    id: string;
    title: string;
    url: string;
    secret: boolean;
    available: boolean;
    selected: boolean | null;
    permitted: boolean;
  }>;
}
export interface ParticipantWorks {
  totalWorks: number;
  visibleWorks: number;
  filteredWorks: number;
  offset: number;
  hasMore: boolean;
  items: Array<ClassroomStudentWork & { feedback: ProjectFeedback | null }>;
}
export interface ParticipantSummary {
  classCount: number;
  studentCount: number;
  totalWorks: number;
  archivedWorks: number;
}
export interface ParticipantStaff {
  name: string;
  avatarUrl: string | null;
  classes: Array<{
    id: string;
    title: string;
    role: 'owner' | 'co_teacher' | 'organization_owner' | 'school_admin';
  }>;
}
export interface ParticipantGradeRevision {
  id: string;
  columnId: string;
  seatId: string;
  revision: number;
  value: number | null;
  reason: string | null;
  authorName: string;
  publishedAt: string;
}
export interface ParticipantGrades {
  journal: {
    offset: number;
    nextOffset: number | null;
    columns: Array<{ id: string; date: string; category: string; preset: string }>;
    grades: ParticipantGradeRevision[];
  };
  resultOffset: number;
  nextResultOffset: number | null;
  results: Array<{
    assignment_id: string;
    assignment_title: string;
    raw_points: number | null;
    max_points: number | null;
    display_grade: string | null;
    published_at: string;
    feedback: string | null;
  }>;
}
export interface ParticipantManualHistory {
  items: ParticipantGradeRevision[];
  nextBeforeRevision: number | null;
}
export interface ParticipantResultHistory {
  offset: number;
  hasMore: boolean;
  items: Array<{
    id: string;
    revision: number;
    attempt_number: number;
    raw_points: number | null;
    max_points: number | null;
    reason: string | null;
    feedback: string | null;
    author: string;
    published_at: string;
  }>;
}
const base = (classId: string): string =>
  `/api/classrooms/${encodeURIComponent(classId)}/participants`;
export const participantsApi = {
  roster: (classId: string) => call<ParticipantRoster>(base(classId)),
  profile: (classId: string, seatId: string) =>
    call<ParticipantProfile>(`${base(classId)}/${encodeURIComponent(seatId)}/profile`),
  staff: (classId: string, accountId: string) =>
    call<ParticipantStaff>(`${base(classId)}/staff/${encodeURIComponent(accountId)}`),
  managers: (classId: string) =>
    call<Array<{ accountId: string; name: string; role: 'owner' | 'school_admin' }>>(
      `${base(classId)}/managers`,
    ),
  listSeatAwards: (classId: string, seatId: string) =>
    call<{ items: SeatAward[] }>(`${base(classId)}/${encodeURIComponent(seatId)}/builtin-awards`),
  setSeatAward: (
    classId: string,
    seatId: string,
    awardKey: string,
    granted: boolean,
    note: string | null,
  ) =>
    call<{ items: SeatAward[] }>(`${base(classId)}/actions/builtin_grant`, {
      method: 'POST',
      body: JSON.stringify({ seatId, awardKey, granted, note, requestId: newClientId() }),
    }),
  grades: (classId: string, seatId: string, offset = 0, resultOffset = 0) =>
    call<ParticipantGrades>(
      `${base(classId)}/${encodeURIComponent(seatId)}/grades?offset=${offset}&resultOffset=${resultOffset}`,
    ),
  history: (classId: string, seatId: string, columnId: string, beforeRevision?: number) =>
    call<ParticipantManualHistory>(
      `${base(classId)}/${encodeURIComponent(seatId)}/history/${encodeURIComponent(columnId)}${beforeRevision ? `?beforeRevision=${beforeRevision}` : ''}`,
    ),
  resultHistory: (classId: string, seatId: string, assignmentId: string, offset = 0) =>
    call<ParticipantResultHistory>(
      `${base(classId)}/${encodeURIComponent(seatId)}/result-history/${encodeURIComponent(assignmentId)}?offset=${offset}`,
    ),
  summary: (classroomIds: string[]) =>
    call<ParticipantSummary>('/api/classrooms/participants/summary', {
      method: 'POST',
      body: JSON.stringify({ classroomIds }),
    }),
  works: (
    classId: string,
    seatId: string,
    module: string | null,
    archive: boolean,
    offset: number,
    assignments = false,
  ) => {
    const query = new URLSearchParams({
      archive: String(archive),
      offset: String(offset),
      assignments: String(assignments),
    });
    if (module) query.set('module', module);
    return call<ParticipantWorks>(`${base(classId)}/${encodeURIComponent(seatId)}/works?${query}`);
  },
  mutate: <T = { saved: true }>(
    classId: string,
    action: string,
    input: Record<string, unknown>,
    requestId: string,
  ) =>
    call<T>(`${base(classId)}/actions/${action}`, {
      method: 'POST',
      body: JSON.stringify({ ...input, requestId }),
    }),
  seatProfile: () => call<ParticipantProfile>('/api/class-join/participants/me'),
  seatAvatar: (id: string | null, requestId: string) =>
    call<{ saved: true }>('/api/class-join/participants/avatar', {
      method: 'POST',
      body: JSON.stringify({ id, requestId }),
    }),
};
