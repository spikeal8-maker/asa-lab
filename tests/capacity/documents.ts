export function edit(module: 'blocks' | 'electronics', wave: number): Record<string, unknown> {
  if (module === 'blocks')
    return {
      schemaVersion: 1,
      format: 'scratch-3',
      assets: [],
      projectJson: {
        targets: [
          {
            isStage: true,
            name: 'Stage',
            variables: { counter: ['counter', wave] },
            lists: {},
            broadcasts: {},
            blocks: {},
            costumes: [],
            sounds: [],
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
