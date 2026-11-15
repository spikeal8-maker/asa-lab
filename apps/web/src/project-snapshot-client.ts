import { call, type ApiResult } from './api-call';

export interface ProjectSnapshotInfo {
  projectId: string;
  contentType: string;
  width: number;
  height: number;
  sourceRevision: number;
  capturedAt: string;
}

export interface SaveProjectSnapshotOptions {
  unloading?: boolean;
  signal?: AbortSignal;
}

export function saveProjectSnapshot(
  projectId: string,
  imageDataUrl: string,
  sourceRevision: number,
  options: SaveProjectSnapshotOptions = {},
): Promise<ApiResult<{ snapshot: ProjectSnapshotInfo }>> {
  return call<{ snapshot: ProjectSnapshotInfo }>(
    `/api/projects/${encodeURIComponent(projectId)}/snapshot`,
    {
      method: 'PUT',
      body: JSON.stringify({ imageDataUrl, sourceRevision }),
      ...(options.unloading === true ? { keepalive: true } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    },
  );
}
