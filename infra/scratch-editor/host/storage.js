(() => {
  const EXISTING_FIXTURE_ID = 'asa-controlled-fixture';
  const unavailable = () => new Error('fixture_asset_unavailable');

  // Only the stock bytes embedded in the pinned standalone bundle are reused.
  // No upstream web stores, ASA project IDs, tokens or runtime endpoints enter here.
  function createFixtureStorage(standalone) {
    const scratchStorage = new standalone.ScratchStorage();
    const assets = new Map();
    const key = (type, id, format) => `${type.name}:${id}:${format}`;
    const cache = (type, format, data, id) => {
      const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      const asset = scratchStorage.createAsset(type, format, bytes, String(id), false);
      assets.set(key(type, id, format), asset);
      return asset;
    };
    const defaults = standalone.buildDefaultProject();
    for (const asset of defaults) {
      if (asset.assetType !== 'Project') {
        cache(
          scratchStorage.AssetType[asset.assetType],
          scratchStorage.DataFormat[asset.dataFormat],
          asset.data,
          asset.id,
        );
      }
    }
    const original = defaults.find((asset) => asset.assetType === 'Project');
    const project = JSON.parse(
      typeof original.data === 'string' ? original.data : new TextDecoder().decode(original.data),
    );
    const stage = project.targets.find((target) => target.isStage);
    const sprite = project.targets.find((target) => !target.isStage);
    stage.variables = { 'fixture-ticks': ['Ticks', 0] };
    sprite.name = 'Fixture Cat';
    const block = (opcode, next, parent, inputs = {}, fields = {}) => ({
      opcode,
      next,
      parent,
      inputs,
      fields,
      shadow: false,
      topLevel: parent === null,
      ...(parent === null ? { x: 70, y: 60 } : {}),
    });
    const variable = { VARIABLE: ['Ticks', 'fixture-ticks'] };
    sprite.blocks = {
      flag: block('event_whenflagclicked', 'reset', null),
      reset: block('data_setvariableto', 'loop', 'flag', { VALUE: [1, [4, '0']] }, variable),
      loop: block('control_forever', null, 'reset', { SUBSTACK: [2, 'tick'] }),
      tick: block('data_changevariableby', 'move', 'loop', { VALUE: [1, [4, '1']] }, variable),
      move: block('motion_movesteps', 'bounce', 'tick', { STEPS: [1, [4, '8']] }),
      bounce: block('motion_ifonedgebounce', 'wait', 'move'),
      wait: block('control_wait', null, 'bounce', { DURATION: [1, [4, '0.1']] }),
    };
    project.monitors = [
      {
        id: 'fixture-ticks',
        mode: 'default',
        opcode: 'data_variable',
        params: { VARIABLE: 'Ticks' },
        spriteName: null,
        value: 0,
        width: 0,
        height: 0,
        x: 10,
        y: 10,
        visible: true,
        sliderMin: 0,
        sliderMax: 100,
        isDiscrete: true,
      },
    ];
    for (const id of ['0', EXISTING_FIXTURE_ID]) {
      cache(
        scratchStorage.AssetType.Project,
        scratchStorage.DataFormat.JSON,
        JSON.stringify(project),
        id,
      );
    }
    scratchStorage.addHelper(
      {
        load: (type, id, format) => Promise.resolve(assets.get(key(type, id, format)) ?? null),
      },
      200,
    );
    return {
      scratchStorage,
      async saveProject() {
        throw new Error('fixture_storage_read_only');
      },
      getLibraryAssetUrl(id, format) {
        const asset = [...assets.values()].find(
          (item) =>
            item.assetType !== scratchStorage.AssetType.Project &&
            item.assetId === id &&
            item.dataFormat === format,
        );
        if (!asset) throw unavailable();
        return asset.encodeDataURI();
      },
    };
  }
  globalThis.AsaBlocksStorage = { createFixtureStorage, EXISTING_FIXTURE_ID };
})();
