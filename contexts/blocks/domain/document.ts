export type BlocksAssetFormat = 'svg' | 'png' | 'jpg' | 'wav' | 'mp3';

export interface BlocksAssetReferenceV1 {
  /** Scratch compatibility identity: lowercase MD5 of the asset bytes. */
  readonly assetId: string;
  /** Supported Scratch media format without a leading dot. */
  readonly dataFormat: BlocksAssetFormat;
  /** ASA integrity digest of the stored bytes. */
  readonly sha256: string;
  readonly sizeBytes: number;
}

/**
 * ASA-owned envelope around Scratch 3 state.
 *
 * `projectJson` is the JSON document found inside an .sb3 archive. Binary assets
 * are deliberately represented by logical references only. Physical bucket/object
 * location is server-side metadata and never belongs in Project Core JSONB.
 */
export interface BlocksProjectDocumentV1 {
  readonly schemaVersion: 1;
  readonly format: 'scratch-3';
  /** Null until the embedded Scratch runtime has initialised its default project. */
  readonly projectJson: Record<string, unknown> | null;
  readonly assets: readonly BlocksAssetReferenceV1[];
}
