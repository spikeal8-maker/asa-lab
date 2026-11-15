/** Private no-store bootstrap response, never catalog metadata or a persistent artifact. */
export interface PublicScratchPlayerBootstrap {
  readonly schemaVersion: 1;
  readonly viewerFamily: 'scratch';
  readonly publicationId: string;
  readonly revisionId: string;
  readonly runtimeOrigin: string;
  readonly runtimeToken: string;
  readonly expiresAt: number;
  readonly serverTime: number;
  readonly projectJson: Record<string, unknown>;
  readonly assets: readonly {
    readonly assetId: string;
    readonly dataFormat: 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';
    readonly sha256: string;
    readonly sizeBytes: number;
  }[];
}
