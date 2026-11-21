import { call } from './admin-api';
export interface Responsibility {
  kind: 'organization' | 'classroom';
  scopeId: string;
  targetId: string;
  role: string | null;
  state: string | null;
  version: string;
  allowedRoles: string[];
}
export const responsibilitiesApi = {
  read: (kind: string, scope: string, target: string) =>
    call<Responsibility>(
      `/api/crm/v1/responsibilities/${encodeURIComponent(kind)}/${encodeURIComponent(scope)}/${encodeURIComponent(target)}`,
    ),
  update: (
    kind: string,
    scope: string,
    target: string,
    input: { version: string; role: string; state: string; reason: string },
  ) =>
    call<Responsibility>(
      `/api/crm/v1/responsibilities/${encodeURIComponent(kind)}/${encodeURIComponent(scope)}/${encodeURIComponent(target)}`,
      { method: 'PUT', body: JSON.stringify(input) },
    ),
};
