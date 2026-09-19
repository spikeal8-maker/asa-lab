import { newClientId } from '../client-id';

export const BLOCKS_PROTOCOL_VERSION = 1 as const;

export type BlocksRuntimeMode = 'editor' | 'player';

export type BlocksParentMessageType =
  'ASA_BLOCKS_INIT' | 'ASA_BLOCKS_TOKEN_UPDATE' | 'ASA_BLOCKS_FLUSH_REQUEST' | 'ASA_BLOCKS_STOP';

export type BlocksChildMessageType =
  | 'ASA_BLOCKS_READY'
  | 'ASA_BLOCKS_STATUS'
  | 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED'
  | 'ASA_BLOCKS_FLUSH_RESULT'
  | 'ASA_BLOCKS_FATAL';

export interface BlocksPostMessageTarget {
  postMessage(message: unknown, targetOrigin: string): void;
}

export interface BlocksMessageEventLike {
  source: unknown;
  origin: string;
  data: unknown;
}

export interface BlocksRuntimeBinding {
  protocolVersion: typeof BLOCKS_PROTOCOL_VERSION;
  projectId: string;
  sessionNonce: string;
}
export interface BlocksRuntimeInitOptions {
  childWindow: BlocksPostMessageTarget;
  runtimeOrigin: string;
  projectId: string;
  mode: BlocksRuntimeMode;
  versionId: string | null;
  apiOrigin: string;
  runtimeToken: string;
  draftRevision: number;
  projectJson: Record<string, unknown> | null;
  hasProjectJson: boolean;
  assets: readonly unknown[];
  recoveryNamespace: string;
  onMessage?: (message: Record<string, unknown>) => void;
  onFatal?: (message: Record<string, unknown>) => void;
}

type BlocksRuntimeNonSecretOptions = Omit<BlocksRuntimeInitOptions, 'runtimeToken'>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function createBlocksSessionNonce(): string {
  return newClientId();
}

export function requireExactHttpOrigin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.origin !== value) {
    throw new Error(`Blocks origin must be an exact HTTP(S) origin: ${value}`);
  }
  return value;
}
function isNonNegativeSafeInteger(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isChildMessageType(value: unknown): value is BlocksChildMessageType {
  return (
    value === 'ASA_BLOCKS_READY' ||
    value === 'ASA_BLOCKS_STATUS' ||
    value === 'ASA_BLOCKS_TOKEN_REFRESH_REQUIRED' ||
    value === 'ASA_BLOCKS_FLUSH_RESULT' ||
    value === 'ASA_BLOCKS_FATAL'
  );
}

export class BlocksRuntimeBridge {
  readonly sessionNonce: string;
  readonly runtimeOrigin: string;
  readonly projectId: string;

  private readonly options: BlocksRuntimeNonSecretOptions;
  private runtimeToken: string | null;
  private stopped = false;
  private readonly pendingFlushRequestIds = new Set<string>();
  private readonly issuedFlushRequestIds = new Set<string>();

  constructor(options: BlocksRuntimeInitOptions) {
    this.runtimeOrigin = requireExactHttpOrigin(options.runtimeOrigin);
    if (!UUID_RE.test(options.projectId)) throw new Error('Blocks projectId must be a UUID');
    if (!options.runtimeToken) throw new Error('Blocks runtimeToken is required');
    const { runtimeToken, ...nonSecretOptions } = options;
    this.options = nonSecretOptions;
    this.projectId = options.projectId;
    this.runtimeToken = runtimeToken;
    this.sessionNonce = createBlocksSessionNonce();
  }

  private assertActive(): void {
    if (this.stopped) throw new Error('Blocks runtime bridge is stopped');
  }

  private binding(): BlocksRuntimeBinding {
    return {
      protocolVersion: BLOCKS_PROTOCOL_VERSION,
      projectId: this.projectId,
      sessionNonce: this.sessionNonce,
    };
  }
  private post(messageType: BlocksParentMessageType, extra: Record<string, unknown> = {}): void {
    this.options.childWindow.postMessage(
      { ...this.binding(), messageType, ...extra },
      this.runtimeOrigin,
    );
  }

  sendInit(): void {
    this.assertActive();
    this.post('ASA_BLOCKS_INIT', {
      mode: this.options.mode,
      versionId: this.options.versionId,
      apiOrigin: requireExactHttpOrigin(this.options.apiOrigin),
      runtimeToken: this.runtimeToken,
      draftRevision: this.options.draftRevision,
      projectJson: this.options.projectJson,
      hasProjectJson: this.options.hasProjectJson,
      assets: this.options.assets,
      recoveryNamespace: this.options.recoveryNamespace,
    });
  }

  updateToken(runtimeToken: string): void {
    this.assertActive();
    if (!runtimeToken) throw new Error('Blocks runtimeToken is required');
    this.runtimeToken = runtimeToken;
    this.post('ASA_BLOCKS_TOKEN_UPDATE', { runtimeToken });
  }

  requestFlush(requestId: string): void {
    this.assertActive();
    if (!requestId) throw new Error('Blocks flush requestId is required');
    if (this.issuedFlushRequestIds.has(requestId)) {
      throw new Error(`Blocks flush requestId was already issued: ${requestId}`);
    }
    this.issuedFlushRequestIds.add(requestId);
    this.pendingFlushRequestIds.add(requestId);
    try {
      this.post('ASA_BLOCKS_FLUSH_REQUEST', { requestId });
    } catch (error) {
      this.pendingFlushRequestIds.delete(requestId);
      this.issuedFlushRequestIds.delete(requestId);
      throw error;
    }
  }

  stop(): void {
    if (this.stopped) return;
    try {
      this.post('ASA_BLOCKS_STOP');
    } finally {
      this.runtimeToken = null;
      this.pendingFlushRequestIds.clear();
      this.issuedFlushRequestIds.clear();
      this.stopped = true;
    }
  }
  acceptChildMessage(event: BlocksMessageEventLike): boolean {
    if (this.stopped) return false;
    if (event.source !== this.options.childWindow || event.origin !== this.runtimeOrigin) {
      return false;
    }
    const message = asRecord(event.data);
    if (!message || !isChildMessageType(message['messageType'])) return false;
    if (
      message['protocolVersion'] !== BLOCKS_PROTOCOL_VERSION ||
      message['projectId'] !== this.projectId ||
      message['sessionNonce'] !== this.sessionNonce
    ) {
      return false;
    }
    if (message['messageType'] === 'ASA_BLOCKS_STATUS') {
      const status = message['status'];
      if (typeof status !== 'string' || status.length === 0) return false;
      if (status === 'project-dirty') {
        if (!isNonNegativeSafeInteger(message['generation'])) return false;
      } else if (typeof message['generation'] !== 'undefined') {
        return false;
      }
    }
    if (message['messageType'] === 'ASA_BLOCKS_FLUSH_RESULT') {
      const requestId = message['requestId'];
      if (typeof requestId !== 'string' || !this.pendingFlushRequestIds.has(requestId)) {
        return false;
      }
      if (message['ok'] === true) {
        if (
          !isNonNegativeSafeInteger(message['revision']) ||
          !isNonNegativeSafeInteger(message['snapshotGeneration']) ||
          (message['reason'] !== null && typeof message['reason'] !== 'undefined')
        ) {
          return false;
        }
      } else if (message['ok'] === false) {
        if (
          typeof message['reason'] !== 'string' ||
          message['reason'].length === 0 ||
          typeof message['revision'] !== 'undefined' ||
          typeof message['snapshotGeneration'] !== 'undefined'
        ) {
          return false;
        }
      } else {
        return false;
      }
      this.pendingFlushRequestIds.delete(requestId);
    }

    this.options.onMessage?.(message);
    if (message['messageType'] === 'ASA_BLOCKS_FATAL') this.options.onFatal?.(message);
    return true;
  }
}
