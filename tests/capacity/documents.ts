export function edit(module: 'blocks' | 'electronics', wave: number): Record<string, unknown> {
  if (module === 'blocks')
    return {
      schemaVersion: 1,
      format: 'scratch-3',
      assets: [CAPACITY_ASSET],
      projectJson: {
        targets: [
          {
            isStage: true,
            name: 'Stage',
            variables: { counter: ['counter', wave] },
            lists: {},
            broadcasts: {},
            blocks: {},
            comments: {},
            currentCostume: 0,
            costumes: [
              {
                name: 'Synthetic backdrop',
                assetId: CAPACITY_ASSET.assetId,
                dataFormat: 'png',
                md5ext: `${CAPACITY_ASSET.assetId}.png`,
                bitmapResolution: 1,
                rotationCenterX: 0,
                rotationCenterY: 0,
              },
            ],
            sounds: [],
            volume: 100,
            layerOrder: 0,
            tempo: 60,
            videoTransparency: 50,
            videoState: 'on',
            textToSpeechLanguage: null,
          },
        ],
        monitors: [],
        extensions: [],
        meta: { semver: '3.0.0' },
      },
    };
  return {
    schemaVersion: 4,
    components: Array.from({ length: 5 }, (_, i) => ({
      id: `r${i}`,
      kind: 'resistor',
      electricalModelId: 'resistor',
      electricalModelVersion: 1,
      modelProfileId: 'legacy-resistor',
      modelProfileVersion: 1,
      name: `R${i}`,
      position: { x: 100 + i * 50, y: 100 },
      value: 1000 + wave,
      rotation: 0,
    })),
    connections: [],
    viewport: { x: wave, y: 0, zoom: 1 },
    simulation: { running: false, maxIterations: 24 },
  };
}
import { createHash } from 'node:crypto';

export const CAPACITY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=',
  'base64',
);
export const CAPACITY_ASSET = {
  assetId: createHash('md5').update(CAPACITY_PNG).digest('hex'),
  dataFormat: 'png',
  sha256: createHash('sha256').update(CAPACITY_PNG).digest('hex'),
  sizeBytes: CAPACITY_PNG.length,
};
