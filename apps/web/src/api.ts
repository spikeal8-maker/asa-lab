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
  birthDate: string;
  country: string;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
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

export interface Project {
  id: string;
  scope: ProjectScope;
  classroomId: string | null;
  moduleKey: string;
  title: string;
  status: string;
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
    response = await fetch(path, { credentials: 'same-origin', ...init, headers });
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
}

export interface CreateProjectOptions {
  scope: ProjectScope;
  classroomId?: string | null;
  title: string;
  module: string;
  idempotencyKey: string;
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
  updateAccountProfile: (username: string, displayName: string) =>
    call<AccountProfile>('/api/account/profile', {
      method: 'PATCH',
      body: JSON.stringify({ username, displayName }),
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
  createClassroom: (title: string, idempotencyKey: string) =>
    call<{ classroom: Classroom; created: boolean }>('/api/classrooms', {
      method: 'POST',
      headers: { 'idempotency-key': idempotencyKey },
      body: JSON.stringify({ title }),
    }),
};
