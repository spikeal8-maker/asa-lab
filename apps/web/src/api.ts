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

/** The server states capabilities and workspaces; the client never claims a role. */
export interface SessionPayload {
  user: PublicUser;
  capabilities: CapabilityRef[];
  workspaces: WorkspaceRef[];
}

/**
 * What a visitor sees about a class before identifying themselves.
 *
 * There is no classroom identifier here on purpose: the browser carries an
 * opaque, signed, short-lived token instead, so a page cannot name a class it
 * was never given.
 */
export interface ClassroomPreview {
  title: string;
  educatorDisplayName: string;
  joinIntentToken: string;
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

export interface ProjectDraft {
  projectId: string;
  document: SchematicDocument;
  revision: number;
  updatedAt: string;
}

export interface ProjectVersion {
  id: string;
  versionNo: number;
  label: string | null;
  createdAt: string;
}

export type ComponentKind = 'source' | 'resistor' | 'led' | 'wire';

export interface SchematicComponent {
  id: string;
  kind: ComponentKind;
  position: { x: number; y: number };
  value: number;
  rotation?: 0 | 90 | 180 | 270;
}

export interface SchematicConnection {
  id: string;
  from: { componentId: string; terminal: 'a' | 'b' };
  to: { componentId: string; terminal: 'a' | 'b' };
  color?: string;
  vertices?: { x: number; y: number }[];
}

export interface SchematicDocument {
  schemaVersion: 1;
  components: SchematicComponent[];
  connections: SchematicConnection[];
}

export interface Diagnostic {
  code: string;
  severity: 'info' | 'warning' | 'error';
  message: string;
  componentIds?: string[];
}

export interface ComponentResult {
  componentId: string;
  voltageDrop: number;
  current: number;
  lit?: boolean;
}

export interface SolveResult {
  solved: boolean;
  current: number;
  components: ComponentResult[];
  diagnostics: Diagnostic[];
}

export interface ApiError {
  code: string;
  message: string;
  /** Routes the server offers instead of a dead end (see age routing). */
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
  classroomId?: string | null | undefined;
  title: string;
  module: string;
  idempotencyKey: string;
}

export const api = {
  me: () => call<SessionPayload>('/api/auth/me'),
  /** The one sign-in: an email address or a username, plus a password. */
  login: (identifier: string, password: string) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ identifier, password }),
    }),
  /** Legacy path kept for accounts that still sign in through an organization. */
  loginWithWorkspace: (workspace: string, email: string, password: string) =>
    call<SessionPayload>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ workspace, email, password }),
    }),
  usernameAvailable: (username: string) =>
    call<{ available: boolean }>(
      `/api/auth/username-available?username=${encodeURIComponent(username)}`,
    ),
  register: (input: {
    email: string;
    password: string;
    username: string;
    displayName: string;
    birthDate: string;
    country: string;
  }) =>
    call<{ account: { id: string; email: string } }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  logout: () => call<{ ok: true }>('/api/auth/logout', { method: 'POST' }),
  /** Resolves a class code into a preview and an intent token; creates nothing. */
  resolveClassCode: (code: string) =>
    call<{ classroom: ClassroomPreview }>('/api/join-class/resolve', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  /** Asks the server what a stored intent token stands for; creates nothing. */
  describeJoinIntent: (joinIntentToken: string) =>
    call<{ classroom: { title: string; educatorDisplayName: string } }>('/api/join-class/intent', {
      method: 'POST',
      body: JSON.stringify({ joinIntentToken }),
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
  openProject: (projectId: string) =>
    call<{
      project: Project;
      draft: ProjectDraft;
      versions: ProjectVersion[];
      result: SolveResult | null;
    }>(`/api/projects/${encodeURIComponent(projectId)}`),
  saveDraft: (projectId: string, document: SchematicDocument) =>
    call<{ draft: ProjectDraft; result: SolveResult | null }>(
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
