import type { BlocksRuntimeGrant } from './blocks-runtime-capability.js';

export const BLOCKS_UPLOAD_CONCURRENCY = 4;
export const BLOCKS_CAPABILITY_NEW_BYTES = 512 * 1024 * 1024;
export const BLOCKS_PROJECT_WINDOW_NEW_BYTES = 1024 * 1024 * 1024;
export const BLOCKS_PROJECT_WINDOW_SECONDS = 5 * 60;
const MAX_CAPABILITY_STATES = 4096;
const MAX_PROJECT_STATES = 4096;

type BudgetError =
  | 'too_many_uploads'
  | 'capability_byte_budget'
  | 'project_byte_budget'
  | 'budget_state_unavailable';
export type BlocksUploadBudgetResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code: BudgetError };

interface CapabilityState {
  readonly tenantId: string;
  readonly projectId: string;
  readonly expiresAt: number;
  active: number;
  usedBytes: number;
  reservedBytes: number;
}
interface ProjectState {
  readonly tenantId: string;
  readonly projectId: string;
  readonly windowEndsAt: number;
  usedBytes: number;
  reservedBytes: number;
}

export interface BlocksUploadLease {
  release(): void;
}
export interface BlocksUploadByteReservation {
  commit(): void;
  release(): void;
}

function fail<T>(code: BudgetError): BlocksUploadBudgetResult<T> {
  return { ok: false, code };
}
function safeSize(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

export class BlocksRuntimeUploadBudget {
  private readonly capabilities = new Map<string, CapabilityState>();
  private readonly projects = new Map<string, ProjectState>();

  constructor(private readonly now: () => number = () => Math.floor(Date.now() / 1000)) {}
  private cleanup(now: number): void {
    for (const [key, state] of this.capabilities) {
      if (state.expiresAt <= now && state.active === 0 && state.reservedBytes === 0) {
        this.capabilities.delete(key);
      }
    }
    for (const [key, state] of this.projects) {
      if (state.windowEndsAt <= now && state.reservedBytes === 0) this.projects.delete(key);
    }
  }

  private capability(grant: Readonly<BlocksRuntimeGrant>, now: number): CapabilityState | null {
    if (grant.expiresAt <= now) return null;
    const existing = this.capabilities.get(grant.tokenId);
    if (existing) {
      if (
        existing.tenantId !== grant.tenantId ||
        existing.projectId !== grant.projectId ||
        existing.expiresAt !== grant.expiresAt
      )
        return null;
      return existing;
    }
    if (this.capabilities.size >= MAX_CAPABILITY_STATES) return null;
    const state: CapabilityState = {
      tenantId: grant.tenantId,
      projectId: grant.projectId,
      expiresAt: grant.expiresAt,
      active: 0,
      usedBytes: 0,
      reservedBytes: 0,
    };
    this.capabilities.set(grant.tokenId, state);
    return state;
  }
  private project(grant: Readonly<BlocksRuntimeGrant>, now: number): ProjectState | null {
    const key = `${grant.tenantId}:${grant.projectId}`;
    const existing = this.projects.get(key);
    if (existing && existing.windowEndsAt > now) return existing;
    if (existing && existing.reservedBytes > 0) return existing;
    if (!existing && this.projects.size >= MAX_PROJECT_STATES) return null;
    const state: ProjectState = {
      tenantId: grant.tenantId,
      projectId: grant.projectId,
      windowEndsAt: now + BLOCKS_PROJECT_WINDOW_SECONDS,
      usedBytes: 0,
      reservedBytes: 0,
    };
    this.projects.set(key, state);
    return state;
  }

  begin(grant: Readonly<BlocksRuntimeGrant>): BlocksUploadBudgetResult<BlocksUploadLease> {
    const now = this.now();
    this.cleanup(now);
    const state = this.capability(grant, now);
    if (!state) return fail('budget_state_unavailable');
    if (state.active >= BLOCKS_UPLOAD_CONCURRENCY) return fail('too_many_uploads');
    state.active += 1;
    let released = false;
    return {
      ok: true,
      value: {
        release: () => {
          if (released) return;
          released = true;
          state.active = Math.max(0, state.active - 1);
        },
      },
    };
  }
  reserveNewBytes(
    grant: Readonly<BlocksRuntimeGrant>,
    sizeBytes: number,
  ): BlocksUploadBudgetResult<BlocksUploadByteReservation> {
    if (!safeSize(sizeBytes)) return fail('budget_state_unavailable');
    const now = this.now();
    this.cleanup(now);
    const capability = this.capability(grant, now);
    const project = this.project(grant, now);
    if (!capability || !project) return fail('budget_state_unavailable');
    if (capability.usedBytes + capability.reservedBytes + sizeBytes > BLOCKS_CAPABILITY_NEW_BYTES)
      return fail('capability_byte_budget');
    if (project.usedBytes + project.reservedBytes + sizeBytes > BLOCKS_PROJECT_WINDOW_NEW_BYTES)
      return fail('project_byte_budget');
    capability.reservedBytes += sizeBytes;
    project.reservedBytes += sizeBytes;
    let state: 'reserved' | 'committed' | 'released' = 'reserved';
    return {
      ok: true,
      value: {
        commit: () => {
          if (state !== 'reserved') return;
          state = 'committed';
          capability.reservedBytes -= sizeBytes;
          project.reservedBytes -= sizeBytes;
          capability.usedBytes += sizeBytes;
          project.usedBytes += sizeBytes;
        },
        release: () => {
          if (state !== 'reserved') return;
          state = 'released';
          capability.reservedBytes -= sizeBytes;
          project.reservedBytes -= sizeBytes;
        },
      },
    };
  }
}
