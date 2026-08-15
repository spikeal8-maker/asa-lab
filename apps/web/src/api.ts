/** Thin same-origin API client. The session lives in an HttpOnly cookie; the
 * client never sends or stores tenant identifiers. */

export interface PublicUser {
  id: string;
  displayName: string;
  email: string;
}

export interface CapabilityRef {
  capability: string;
  state: string;
}

export interface WorkspaceRef {
  workspaceId: string;
  kind: string;
  title: string;
  role: string;
}

export interface SchoolWorkspace {
  workspaceId: string;
  tenantId: string;
  schoolId: string;
  userId: string;
  title: string;
  role: 'school_admin';
}

export interface SessionPayload {
  authenticated: true;
  user: PublicUser;
  account: PublicUser;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
  activeWorkspace: { workspaceId: string; kind: string };
  navigation: { classes: boolean; classroomManagement: boolean };
}

export interface AccountProfile {
  email: string;
  emailVerificationState: string;
  username: string;
  displayName: string;
  bio: string;
  birthDate: string;
  country: string;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
}

export interface AccountAvatar {
  avatarDataUrl: string | null;
}

export interface AccountSession {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
  userAgentSummary: string | null;
}

export interface Classroom {
  id: string;
  title: string;
  status: string;
  createdAt: string;
}

export type ProjectScope = 'personal' | 'classroom';
export type ProjectStatus = 'active' | 'archived' | 'trashed';

export interface Project {
  id: string;
  scope: ProjectScope;
  classroomId: string | null;
  moduleKey: string;
  title: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ModuleSummary {
  moduleKey: string;
  moduleVersion: string;
  displayName: string;
  shortDescription: string;
  projectType: string;
  schemaVersion: number;
  editorRoute: string;
  viewerRoute: string;
  safeModeSupported: boolean;
  availability: 'active' | 'coming_soon' | 'disabled';
  previewKind: 'schematic' | 'board' | 'stage' | 'scene' | 'drawing' | 'summary';
  iconKey: string;
  categories: string[];
  creatable: boolean;
}

export interface ProjectDraft<TDocument = unknown> {
  projectId: string;
  document: TDocument;
  revision: number;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  versionNo: number;
  label: string | null;
  createdAt: string;
}

export type ComponentKind =
  | 'source'
  | 'resistor'
  | 'led'
  | 'rgb-led'
  | 'seven-segment'
  | 'button'
  | 'switch'
  | 'potentiometer'
  | 'diode'
  | 'transistor'
  | 'lamp'
  | 'breadboard'
  | 'visual'
  | 'wire';
export type Terminal = string;
export type ProductionStateValue = string | number | boolean | readonly string[];

export interface BreadboardHoleBinding {
  breadboardComponentId: string;
  holeId: string;
}

export interface SchematicComponent {
  id: string;
  kind: ComponentKind;
  componentTypeId?: string;
  variantId?: string;
  position: { x: number; y: number };
  value: number;
  rotation?: 0 | 90 | 180 | 270;
  name?: string;
  state?: boolean;
  wiperPosition?: number;
  stateProperties?: Record<string, ProductionStateValue>;
  pinIds?: string[];
  holeBindings?: Record<string, BreadboardHoleBinding>;
  internalConnections?: [string, string][];
}

export interface SchematicConnection {
  id: string;
  from: { componentId: string; terminal: Terminal };
  to: { componentId: string; terminal: Terminal };
  color?: string;
  vertices?: { x: number; y: number }[];
}

export interface SchematicDocument {
  schemaVersion: 3;
  components: SchematicComponent[];
  connections: SchematicConnection[];
  viewport: { x: number; y: number; zoom: number };
  simulation: { running: boolean; maxIterations: number };
}

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  componentIds?: string[];
  wireIds?: string[];
  netIds?: string[];
  suggestedAction?: string;
  anchors?: { kind: 'component' | 'wire' | 'net'; id: string }[];
}

export interface ComponentResult {
  componentId: string;
  voltageDrop: number;
  current: number;
  terminalVoltages: Partial<Record<Terminal, number>>;
  power?: number;
  brightness?: number;
  branchCurrents?: Record<string, number>;
  branchBrightness?: Record<string, number>;
  lit?: boolean;
  energized?: boolean;
  currentUtilizationPercent?: number;
  stressState?: 'normal' | 'warning' | 'overcurrent' | 'burned';
  operatingRegion?: 'cutoff' | 'active' | 'saturation';
  baseCurrent?: number;
  collectorCurrent?: number;
  emitterCurrent?: number;
}

export interface SolveResult {
  solved: boolean;
  status: 'solved' | 'invalid' | 'unsupported' | 'nonconvergent';
  current: number;
  components: ComponentResult[];
  nodes: { id: string; voltage: number; terminals: string[] }[];
  diagnostics: Diagnostic[];
  iterations: number;
  numericalResidual: number;
  numericalTolerance: number;
  quality?: {
    finite: boolean;
    passed: boolean;
    maxKclResidualAmp: number;
    maxSourceVoltageResidualVolt: number;
    kclToleranceAmp: number;
    sourceVoltageToleranceVolt: number;
  };
  topologySignature?: string;
}

export interface ApiError {
  code: string;
  message: string;
  routes?: string[];
}

export type ApiResult<T> =
  { ok: true; status: number; data: T } | { ok: false; status: number; error: ApiError };

async function call<T>(path: string, init?: RequestInit): Promise<ApiResult<T>> {
  let response: Response;
  const headers: Record<string, string> = {
    ...(init?.body === undefined ? {} : { 'content-type': 'application/json' }),
    ...((init?.headers as Record<string, string> | undefined) ?? {}),
  };
  try {
    response = await fetch(path, {
      credentials: 'same-origin',
      ...init,
      cache: 'no-store',
      headers,
    });
  } catch {
    return { ok: false, status: 0, error: { code: 'network', message: 'сервер недоступен' } };
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (response.ok) {
    return { ok: true, status: response.status, data: body as T };
  }
  const error =
    (body as { error?: ApiError } | null)?.error ??
    ({ code: 'server_error', message: 'ошибка сервера' } satisfies ApiError);
  return { ok: false, status: response.status, error };
}

export interface ProjectListOptions {
  scope?: ProjectScope;
  classroomId?: string;
  status?: ProjectStatus;
}

export interface CreateProjectOptions {
  scope: ProjectScope;
  classroomId?: string | null;
  title: string;
  module: string;
  idempotencyKey: string;
}

export interface CheckersClassroomStudent<TProgress = unknown, TEvidence = unknown> {
  id: string;
  displayName: string;
  email: string;
  lastActivityAt: string | null;
  progress: TProgress[];
  evidence: TEvidence[];
  completedPuzzleIds: string[];
  lastMove: { ply: number; path: string[]; capturedIds: string[] } | null;
  revision: number;
  updatedAt: string | null;
}

export interface CheckersSafetySignal {
  id: string;
  gameId: string;
  reactionEventId: string;
  reactionId: string;
  reporterName: string;
  senderName: string;
  status: string;
  createdAt: string;
}

export interface CheckersClassGame<TDocument = unknown> {
  id: string;
  mode: 'friendly' | 'team' | 'teacher-event';
  status: 'pending' | 'active' | 'declined' | 'finished';
  version: number;
  side: 'light' | 'dark' | null;
  lightPlayer: { id: string; displayName: string };
  darkPlayer: { id: string; displayName: string };
  document: TDocument;
  createdAt: string;
  updatedAt: string;
  reactions: Array<{
    id: string;
    senderName: string;
    reactionId: string;
    sentAt: string;
  }>;
}

export interface CheckersClassPlay<TDocument = unknown> {
  role: 'owner' | 'student';
  muted: boolean;
  classmates: Array<{ id: string; displayName: string }>;
  games: CheckersClassGame<TDocument>[];
}

export type CheckersTeacherFeedbackId =
  'great-progress' | 'retry-capture' | 'review-turning-point' | 'ready-next';

export interface CheckersTeacherFeedback {
  id: string;
  feedbackId: CheckersTeacherFeedbackId;
  createdAt: string;
}

export const api = {
  me: () => call<SessionPayload | { authenticated: false }>('/api/auth/me'),
  login: (identifier: string, password: string) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  loginWithWorkspace: (workspace: string, email: string, password: string) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ workspace, email, password }),
    }),
  register: (input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
    birthDate: string;
    country: string;
  }) =>
    call<SessionPayload>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  usernameAvailable: (username: string) =>
    call<{ available: boolean }>(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
    ),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  accountProfile: () => call<AccountProfile>('/api/account/profile'),
  accountAvatar: () => call<AccountAvatar>('/api/account/avatar'),
  updateAccountAvatar: (avatarDataUrl: string | null) =>
    call<AccountAvatar>('/api/account/avatar', {
      method: 'PATCH',
      body: JSON.stringify({ avatarDataUrl }),
    }),
  updateAccountProfile: (username: string, displayName: string, bio: string) =>
    call<AccountProfile>('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username, displayName, bio }),
    }),
  setAccountRole: (role: 'creator' | 'educator') =>
    call<{ role: 'creator' | 'educator'; state: string | null; changed: boolean }>(
      '/api/account/role',
      {
        method: 'PUT',
        body: JSON.stringify({ role }),
      },
    ),
  createSchool: (title: string) =>
    call<{ school: SchoolWorkspace }>('/api/schools', {
      method: 'POST',
      body: JSON.stringify({ title }),
    }),
  listWorkspaces: () =>
    call<{ items: WorkspaceRef[]; activeWorkspaceId: string }>('/api/workspaces'),
  switchWorkspace: (workspaceId: string) =>
    call<{ activeWorkspace: { workspaceId: string; kind: string } }>('/api/session/context', {
      method: 'POST',
      body: JSON.stringify({ workspaceId }),
    }),
  selfAttestEducator: () =>
    call<{ capability: 'educator'; state: string; created: boolean }>(
      '/api/capabilities/educator/self-attest',
      { method: 'POST', body: JSON.stringify({}) },
    ),
  listAccountSessions: () => call<{ items: AccountSession[] }>('/api/account/sessions'),
  revokeAccountSession: (sessionId: string) =>
    call<{ ok: true }>(`/api/account/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    }),
  revokeOtherAccountSessions: () =>
    call<{ revoked: number }>('/api/account/sessions/revoke-all', {
      method: 'POST',
      body: JSON.stringify({}),
    }),
  listModules: () => call<{ items: ModuleSummary[] }>('/api/modules'),
  listClassrooms: () => call<{ items: Classroom[]; meta: { total: number } }>('/api/classrooms'),
  listProjects: (options: ProjectListOptions = {}) => {
    const query = new URLSearchParams();
    if (options.scope) query.set('scope', options.scope);
    if (options.classroomId) query.set('classroomId', options.classroomId);
    if (options.status) query.set('status', options.status);
    const suffix = query.size > 0 ? `?${query.toString()}` : '';
    return call<{ items: Project[] }>(`/api/projects${suffix}`);
  },
  createProject: (options: CreateProjectOptions) =>
    call<{ project: Project; created: boolean }>('/api/projects', {
      method: 'POST',
      headers: { 'idempotency-key': options.idempotencyKey },
      body: JSON.stringify({
        scope: options.scope,
        classroomId: options.classroomId ?? null,
        module: options.module,
        title: options.title,
      }),
    }),
  renameProject: (projectId: string, title: string) =>
    call<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    }),
  duplicateProject: (projectId: string, title: string, idempotencyKey: string) =>
    call<{ project: Project; created: boolean }>(
      `/api/projects/${encodeURIComponent(projectId)}/duplicate`,
      {
        method: 'POST',
        headers: { 'idempotency-key': idempotencyKey },
        body: JSON.stringify({ title }),
      },
    ),
  changeProjectStatus: (projectId: string, status: ProjectStatus) =>
    call<{ project: Project }>(`/api/projects/${encodeURIComponent(projectId)}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
  openProject: <TDocument = unknown, TResult = unknown>(projectId: string) =>
    call<{
      project: Project;
      draft: ProjectDraft<TDocument>;
      versions: ProjectVersion[];
      result: TResult | null;
    }>(`/api/projects/${encodeURIComponent(projectId)}`),
  saveDraft: <TDocument = unknown, TResult = unknown>(projectId: string, document: TDocument) =>
    call<{ draft: ProjectDraft<TDocument>; result: TResult | null }>(
      `/api/projects/${encodeURIComponent(projectId)}/draft`,
      { method: 'PUT', body: JSON.stringify({ document }) },
    ),
  createCheckpoint: (projectId: string, label?: string) =>
    call<{ version: ProjectVersion }>(
      `/api/projects/${encodeURIComponent(projectId)}/checkpoints`,
      { method: 'POST', body: JSON.stringify(label ? { label } : {}) },
    ),
  loadCheckersStudentState: <TDocument = unknown>(projectId: string) =>
    call<{
      role: 'student';
      document: TDocument;
      revision: number;
      updatedAt: string | null;
      teacherFeedback: CheckersTeacherFeedback[];
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/state`),
  saveCheckersStudentState: <TDocument = unknown>(projectId: string, document: TDocument) =>
    call<{ document: TDocument; revision: number; updatedAt: string }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/state`,
      { method: 'PUT', body: JSON.stringify({ document }) },
    ),
  checkersClassroom: <TAssignment = unknown, TProgress = unknown, TEvidence = unknown>(
    projectId: string,
  ) =>
    call<{
      assignments: TAssignment[];
      students: CheckersClassroomStudent<TProgress, TEvidence>[];
      safetySignals: CheckersSafetySignal[];
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/classroom`),
  enrolCheckersStudent: (projectId: string, email: string) =>
    call<{
      student: {
        student_user_id: string;
        student_account_id: string;
        display_name: string;
        email: string;
      };
    }>(`/api/checkers/projects/${encodeURIComponent(projectId)}/students`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  loadCheckersClassPlay: <TDocument = unknown>(projectId: string) =>
    call<CheckersClassPlay<TDocument>>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/play`,
    ),
  createCheckersChallenge: (
    projectId: string,
    opponentId: string,
    mode: 'friendly' | 'team' = 'friendly',
  ) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/challenges`,
      { method: 'POST', body: JSON.stringify({ opponentId, mode }) },
    ),
  createCheckersTeacherEvent: (projectId: string, lightPlayerId: string, darkPlayerId: string) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/events`,
      { method: 'POST', body: JSON.stringify({ lightPlayerId, darkPlayerId }) },
    ),
  acceptCheckersChallenge: (projectId: string, gameId: string) =>
    call<{ game: { id: string; status: string; version: number } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/accept`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  playCheckersClassMove: (
    projectId: string,
    gameId: string,
    input: { expectedVersion: number; pieceId: string; path: readonly string[] },
  ) =>
    call<{ game: { document_json: unknown; status: string; version: number; updated_at: string } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/moves`,
      { method: 'POST', body: JSON.stringify(input) },
    ),
  sendCheckersReaction: (projectId: string, gameId: string, reactionId: string) =>
    call<{ reaction: { id: string; reaction_id: string; created_at: string } }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/reactions`,
      { method: 'POST', body: JSON.stringify({ reactionId }) },
    ),
  muteCheckersReactions: (projectId: string, muted: boolean) =>
    call<{ muted: boolean }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/reactions/mute`,
      { method: 'PUT', body: JSON.stringify({ muted }) },
    ),
  reportCheckersReaction: (projectId: string, gameId: string, reactionEventId: string) =>
    call<{ reported: true }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/games/${encodeURIComponent(gameId)}/reactions/${encodeURIComponent(reactionEventId)}/report`,
      { method: 'POST', body: JSON.stringify({}) },
    ),
  sendCheckersTeacherFeedback: (
    projectId: string,
    studentId: string,
    feedbackId: CheckersTeacherFeedbackId,
  ) =>
    call<{ feedback: CheckersTeacherFeedback }>(
      `/api/checkers/projects/${encodeURIComponent(projectId)}/feedback`,
      { method: 'POST', body: JSON.stringify({ studentId, feedbackId }) },
    ),
  createClassroom: (title: string, idempotencyKey: string) =>
    call<{ classroom: Classroom; created: boolean }>('/api/classrooms', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ title }),
    }),
};
