import { call } from './admin-api';
export interface CrmSubject {
  kind: 'account' | 'student';
  targetId: string;
  classroomId?: string | undefined;
}
export interface CrmDashboard {
  generatedAt: string;
  period: { days: number; timeZone: 'UTC'; from: string; to: string };
  lastSeenAt: string | null;
  lastActionAt: string | null;
  totals: {
    projects: number;
    publications: number;
    aiRequests: number;
    aiErrors: number;
    events: number;
    inputTokens: string | null;
    outputTokens: string | null;
  };
  activity: Array<{ date: string; events: number; aiRequests: number }>;
  latestActions: Array<{ occurredAt: string; eventType: string; module: string | null }>;
  rating: {
    kind: 'classroom' | 'not_configured';
    value: number | null;
    label: string;
    rank: number | null;
    periodDays: number | null;
  };
  coverage: {
    activityFrom: string | null;
    limited: true;
    aiDetailedRequests: number;
    tokenRequests: number;
  };
}
export interface CrmProfile {
  kind: 'account' | 'student';
  id: string;
  name: string;
  bio: string;
  country: string | null;
  birthDate: string | null;
  age: number | null;
  email: string | null;
  status: string;
  registeredAt: string;
  classId: string | null;
  classTitle: string | null;
  version: string;
  canEdit: boolean;
  canManageCapabilities: boolean;
  linkedIdentities: Array<{
    kind: 'account' | 'student';
    id: string;
    classId?: string;
    name?: string;
  }>;
  capabilities: Array<{ capability: string; state: string }>;
  memberships: Array<{ id: string; title: string; role: string; state: string }>;
  teachingClasses?: Array<{ id: string; title: string; role: string; status: string }>;
}
export interface CrmContentItem {
  id: string;
  title?: string;
  module?: string;
  status?: string;
  classId?: string;
  threadId?: string;
  requestId?: string;
  role?: string;
  text?: string;
  state?: string;
  occurredAt: string;
  lastSeenAt?: string;
  expiresAt?: string;
  eventType?: string;
  ipAddress?: string | null;
  device?: string | null;
}
export type CrmContentCategory = 'messages' | 'projects' | 'sessions' | 'events';
export interface CrmContentPage {
  items: CrmContentItem[];
  next: string | null;
}
export interface CrmDocument {
  projectId: string;
  title: string;
  module: string;
  revision: number;
  source: string;
  updatedAt: string;
  document: unknown;
  preview?: { dataUrl: string; revision: number } | null;
}
export function crmSubjectPath(subject: CrmSubject) {
  return `/api/crm/v1/users/${encodeURIComponent(subject.kind)}/${encodeURIComponent(subject.targetId)}`;
}
function query(subject: CrmSubject) {
  const value = new URLSearchParams();
  if (subject.classroomId) value.set('classroomId', subject.classroomId);
  return value;
}
export interface CrmSeatDetailItem {
  id: string;
  key?: string;
  text?: string;
  title?: string;
  occurredAt: string;
  type?: string;
  projectId?: string;
  revision?: number;
  status?: string;
  provider?: string;
  model?: string | null;
  requestedModel?: string | null;
  inputTokens?: string | null;
  outputTokens?: string | null;
  errorCode?: string | null;
  durationMs?: string | null;
}
export interface CrmSeatDetailPage {
  canWrite?: boolean;
  items: CrmSeatDetailItem[];
  next: string | null;
  version?: string;
}
export const crmApi = {
  dashboard: (subject: CrmSubject) =>
    call<CrmDashboard>(`${crmSubjectPath(subject)}/dashboard?${query(subject)}`),
  seatDetail: (
    subject: CrmSubject,
    category: 'notes' | 'projects' | 'publications' | 'ai',
    cursor: string | null,
  ) => {
    const params = query(subject);
    params.set('category', category);
    if (cursor) params.set('cursor', cursor);
    return call<CrmSeatDetailPage>(`${crmSubjectPath(subject)}/detail?${params}`);
  },
  addSeatNote: (subject: CrmSubject, input: { version: string; text: string; reason: string }) =>
    call<CrmSeatDetailPage>(`${crmSubjectPath(subject)}/notes`, {
      method: 'PUT',
      body: JSON.stringify({ ...input, classroomId: subject.classroomId }),
    }),
  studentStatus: (
    subject: CrmSubject,
    input: { version: string; status: 'active' | 'suspended'; reason: string },
  ) =>
    call<CrmProfile>(`${crmSubjectPath(subject)}/status`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  profile: (subject: CrmSubject) =>
    call<CrmProfile>(`${crmSubjectPath(subject)}?${query(subject)}`),
  saveProfile: (
    subject: CrmSubject,
    input: {
      version: string;
      name: string;
      bio: string;
      country: string | null;
      birthDate: string | null;
      reason: string;
    },
  ) =>
    call<CrmProfile>(`${crmSubjectPath(subject)}/profile`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  capability: (
    subject: CrmSubject,
    input: { version: string; capability: string; state: string; reason: string },
  ) =>
    call<CrmProfile>(`${crmSubjectPath(subject)}/capability`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  content: (subject: CrmSubject, category: CrmContentCategory, cursor: string | null) => {
    const params = query(subject);
    params.set('category', category);
    if (cursor) params.set('cursor', cursor);
    return call<CrmContentPage>(`${crmSubjectPath(subject)}/content?${params}`);
  },
  project: (subject: CrmSubject, projectId: string, versionId?: string) => {
    const params = query(subject);
    if (versionId) params.set('versionId', versionId);
    return call<CrmDocument>(
      `${crmSubjectPath(subject)}/projects/${encodeURIComponent(projectId)}?${params}`,
    );
  },
};
