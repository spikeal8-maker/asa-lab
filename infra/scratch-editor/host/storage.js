(() => {
  const EXISTING_FIXTURE_ID = 'asa-controlled-fixture';
  const unavailable = () => new Error('fixture_asset_unavailable');
  const formatsByType = {
    ImageVector: ['svg'],
    ImageBitmap: ['png', 'jpg', 'jpeg'],
    Sound: ['wav', 'mp3'],
  };
  const mediaTypes = {
    svg: ['image/svg+xml'],
    png: ['image/png'],
    jpg: ['image/jpeg'],
    jpeg: ['image/jpeg'],
    wav: ['audio/wav', 'audio/x-wav', 'audio/wave'],
    mp3: ['audio/mpeg'],
  };
  const validLibraryAsset = (id, format) =>
    typeof id === 'string' &&
    /^[a-f0-9]{32}$/.test(id) &&
    typeof format === 'string' &&
    Object.hasOwn(mediaTypes, format);

  // Projects remain read-only fixtures. Only stock media may use the local library.
  // No project ID, arbitrary path, credentials or upstream web store enters that route.
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
        load: async (type, id, format) => {
          const cached = assets.get(key(type, id, format));
          if (cached) return cached;
          // Project/JSON requests and arbitrary paths must never reach the media store.
          if (
            !validLibraryAsset(id, format) ||
            !Object.hasOwn(formatsByType, type?.name) ||
            scratchStorage.AssetType[type.name] !== type ||
            !formatsByType[type.name].includes(format)
          )
            return null;
          try {
            const response = await fetch(`/library-assets/${id}.${format}`, {
              credentials: 'omit',
              redirect: 'error',
            });
            if (!response.ok) return null;
            const contentType = response.headers.get('content-type')?.split(';')[0].trim();
            if (!mediaTypes[format].includes(contentType)) return null;
            const bytes = new Uint8Array(await response.arrayBuffer());
            return cache(type, format, bytes, id);
          } catch {
            return null;
          }
        },
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
        if (asset) return asset.encodeDataURI();
        if (!validLibraryAsset(id, format)) throw unavailable();
        return `/library-assets/${id}.${format}`;
      },
    };
  }
  globalThis.AsaBlocksStorage = { createFixtureStorage, EXISTING_FIXTURE_ID };
})();
