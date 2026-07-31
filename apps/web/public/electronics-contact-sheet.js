const auditRoot = '/assets/electronics/owner-audit/';

const text = (selector, value) => {
  document.querySelector(selector).textContent = value;
};

const formatNumber = (value) => new Intl.NumberFormat('ru-RU').format(value);

const createImage = (file, alt, className = 'asset-image') => {
  const image = document.createElement('img');
  image.src = `${auditRoot}${file}`;
  image.alt = alt;
  image.className = className;
  image.loading = 'lazy';
  image.decoding = 'async';
  return image;
};

const badge = (label, tone = 'neutral') => {
  const item = document.createElement('span');
  item.className = `badge badge-${tone}`;
  item.textContent = label;
  return item;
};

const preferredAsset = (component, importedAssets) => {
  const assets = importedAssets.filter((asset) => asset.componentId === component.id);
  const priority = (asset) => {
    if (
      asset.sourceArchive === 'canonical-components-svg' &&
      /:0$|off$|released$|default$|reference_fixed/.test(asset.state)
    )
      return 0;
    if (asset.sourceArchive === 'canonical-components-svg') return 1;
    if (asset.acceptance === 'owner_reference_raster_not_runtime') return 2;
    return 3;
  };
  return assets.sort((left, right) => priority(left) - priority(right))[0];
};

const renderArchiveSummary = (manifest) => {
  const list = document.querySelector('#archive-list');
  manifest.sourceArchives.forEach((archive) => {
    const card = document.createElement('article');
    card.className = 'archive-card';
    const title = document.createElement('strong');
    title.textContent = archive.name;
    const role = document.createElement('span');
    role.textContent = archive.role.replaceAll('_', ' ');
    const hash = document.createElement('code');
    hash.textContent = archive.sha256;
    const count = document.createElement('small');
    count.textContent = `${formatNumber(archive.fileCount)} файлов · архив не включён в Git`;
    card.append(title, role, hash, count);
    list.append(card);
  });
};

const renderInventory = (manifest) => {
  const grouped = new Map();
  for (const component of manifest.logicalComponents) {
    const items = grouped.get(component.category) ?? [];
    items.push(component);
    grouped.set(component.category, items);
  }
  const root = document.querySelector('#inventory-groups');
  [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .forEach(([category, components]) => {
      const group = document.createElement('section');
      group.className = 'inventory-group';
      const heading = document.createElement('h3');
      heading.textContent = `${category} · ${components.length}`;
      const grid = document.createElement('div');
      grid.className = 'inventory-grid';

      components.forEach((component) => {
        const card = document.createElement('article');
        card.className = 'component-card';
        card.dataset.componentId = component.id;
        const asset = preferredAsset(component, manifest.importedReviewAssets);
        const visual = document.createElement('div');
        visual.className = 'component-visual checkerboard';
        if (asset) {
          visual.append(createImage(asset.importedFile, component.displayName));
        } else {
          visual.classList.add('missing-asset');
          visual.textContent = 'Файл отсутствует';
        }
        const body = document.createElement('div');
        body.className = 'component-body';
        const title = document.createElement('strong');
        title.textContent = component.displayName;
        const id = document.createElement('code');
        id.textContent = component.id;
        const badges = document.createElement('div');
        badges.className = 'badge-row';
        badges.append(
          badge(
            component.canonicalPackageStatus === 'present'
              ? 'канонический ZIP'
              : 'доп. owner source',
            component.canonicalPackageStatus === 'present' ? 'ok' : 'warn',
          ),
          badge(`${component.assetCount} файлов`),
          badge(
            component.pinMapStatus.replaceAll('_', ' '),
            component.pinMapStatus.includes('not_') ? 'warn' : 'ok',
          ),
        );
        body.append(title, id, badges);
        card.append(visual, body);
        grid.append(card);
      });
      group.append(heading, grid);
      root.append(group);
    });
};

const renderBatteryFamily = (manifest) => {
  const root = document.querySelector('#battery-family');
  [1, 2, 3, 4, 5, 6, 8].forEach((count) => {
    const id = `battery-holder-aa-${count}`;
    const component = manifest.logicalComponents.find((item) => item.id === id);
    const asset = manifest.importedReviewAssets.find(
      (item) => item.componentId === id && item.sourceArchive === 'canonical-components-svg',
    );
    const card = document.createElement('article');
    card.className = `battery-card${asset ? '' : ' battery-card-missing'}`;
    const visual = document.createElement('div');
    visual.className = 'battery-visual checkerboard';
    if (asset) visual.append(createImage(asset.importedFile, component.displayName));
    else visual.textContent = '5×AA в пакете отсутствует';
    const title = document.createElement('strong');
    title.textContent = component.displayName;
    const status = document.createElement('small');
    status.textContent = asset ? 'owner exact SVG · v6' : 'не найден ни в одном архиве';
    card.append(visual, title, status);
    root.append(card);
  });
};

const renderLedFamily = (stateMap) => {
  const family = stateMap.families.find((item) => item.componentId === 'led-5mm');
  const root = document.querySelector('#led-family');
  Object.entries(family.colors).forEach(([color, variants]) => {
    const row = document.createElement('article');
    row.className = 'led-row';
    const header = document.createElement('div');
    header.className = 'led-row-header';
    const title = document.createElement('strong');
    title.textContent = color;
    const count = document.createElement('span');
    count.textContent = `${variants.length} уровней · 0–100%`;
    header.append(title, count);
    const strip = document.createElement('div');
    strip.className = 'led-strip checkerboard';
    variants.forEach((variant) => {
      const cell = document.createElement('div');
      cell.className = 'led-cell';
      cell.title = `${color} ${variant.brightnessPercent}%`;
      cell.append(createImage(variant.file, `${color} ${variant.brightnessPercent}%`, 'led-image'));
      strip.append(cell);
    });
    row.append(header, strip);
    root.append(row);
  });

  const special = document.querySelector('#led-special');
  family.specialStates.forEach((variant) => {
    const card = document.createElement('article');
    card.className = 'state-card';
    card.append(createImage(variant.file, variant.state), badge(variant.state, 'warn'));
    special.append(card);
  });
};

const renderRgbFamily = (stateMap) => {
  const family = stateMap.families.find((item) => item.componentId === 'rgb-led');
  const root = document.querySelector('#rgb-family');
  family.variants.forEach((variant) => {
    const card = document.createElement('article');
    card.className = 'state-card';
    card.append(createImage(variant.file, `RGB LED ${variant.state}`), badge(variant.state));
    root.append(card);
  });
};

const renderPhysicalDimensions = (dimensions, manifest) => {
  const body = document.querySelector('#physical-table tbody');
  dimensions.components.forEach((item) => {
    const component = manifest.logicalComponents.find(
      (candidate) => candidate.id === item.componentId,
    );
    const row = document.createElement('tr');
    const values = [
      component?.displayName ?? item.componentId,
      item.physicalWidthMm ?? 'не заявлено',
      item.physicalHeightMm ?? 'не заявлено',
      item.confidence,
      item.source,
    ];
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
};

const renderPinMap = (pinMap, manifest) => {
  const body = document.querySelector('#pin-table tbody');
  pinMap.components.forEach((item) => {
    const component = manifest.logicalComponents.find(
      (candidate) => candidate.id === item.componentId,
    );
    const row = document.createElement('tr');
    const ids = item.pins
      .slice(0, 12)
      .map((pin) => pin.id ?? pin.componentPin)
      .join(', ');
    const values = [
      component?.displayName ?? item.componentId,
      item.pinCount,
      ids + (item.pins.length > 12 ? ` … +${item.pins.length - 12}` : ''),
      item.status,
    ];
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
};

const renderBreadboards = (footprints, manifest) => {
  const root = document.querySelector('#breadboard-family');
  footprints.boards.forEach((board) => {
    const component = manifest.logicalComponents.find((item) => item.id === board.componentId);
    const asset = manifest.importedReviewAssets.find(
      (item) =>
        item.componentId === board.componentId && item.sourceArchive === 'canonical-components-svg',
    );
    const card = document.createElement('article');
    card.className = 'breadboard-card';
    const visual = document.createElement('div');
    visual.className = 'breadboard-visual checkerboard';
    visual.append(createImage(asset.importedFile, component.displayName));
    const details = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = component.displayName;
    const size = document.createElement('span');
    size.textContent = `${board.physical.widthMm}×${board.physical.heightMm} мм · шаг ${board.physical.holePitchMm} мм`;
    const holes = document.createElement('span');
    holes.textContent = `${formatNumber(board.holes.length)} отверстий · ${formatNumber(board.groupCount)} внутренних групп`;
    details.append(title, size, holes);
    card.append(visual, details);
    root.append(card);
  });

  const body = document.querySelector('#footprint-table tbody');
  footprints.componentFootprints.forEach((item) => {
    const row = document.createElement('tr');
    const values = [
      item.componentId,
      item.status,
      item.pitchMm ?? item.requiredHolePitchMm ?? '—',
      item.source ?? '—',
    ];
    values.forEach((value) => {
      const cell = document.createElement('td');
      cell.textContent = value;
      row.append(cell);
    });
    body.append(row);
  });
};

const renderStateIndex = (stateMap) => {
  const body = document.querySelector('#state-table tbody');
  stateMap.families.forEach((family) => {
    const row = document.createElement('tr');
    const variantCount =
      family.variants?.length ??
      Object.values(family.colors ?? {}).reduce((sum, variants) => sum + variants.length, 0) +
        (family.specialStates?.length ?? 0);
    const values = [
      family.componentId,
      family.kind,
      variantCount || family.presentCellCounts?.join(', ') || 'dynamic',
      JSON.stringify(family).length,
    ];
    values.forEach((value, index) => {
      const cell = document.createElement('td');
      cell.textContent = index === 3 ? `${formatNumber(value)} bytes metadata` : value;
      row.append(cell);
    });
    body.append(row);
  });
};

const renderAuditDetails = (manifest) => {
  const counts = document.querySelector('#classification-counts');
  Object.entries(manifest.summary.roleCounts).forEach(([role, count]) => {
    const item = document.createElement('div');
    item.append(badge(role), document.createTextNode(formatNumber(count)));
    counts.append(item);
  });
  const gaps = document.querySelector('#known-gaps');
  manifest.knownGaps.forEach((gap) => {
    const item = document.createElement('article');
    const title = document.createElement('strong');
    title.textContent = `${gap.id} · ${gap.status}`;
    const evidence = document.createElement('p');
    evidence.textContent = gap.evidence;
    item.append(title, evidence);
    gaps.append(item);
  });
};

const start = async () => {
  const [manifest, dimensions, pinMap, footprints, stateMap] = await Promise.all(
    [
      'manifest.json',
      'physical-dimensions.json',
      'pin-map.json',
      'breadboard-footprint-map.json',
      'state-family-map.json',
    ].map(async (file) => {
      const response = await fetch(`${auditRoot}${file}`, { cache: 'no-store' });
      if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
      return response.json();
    }),
  );

  text('#outer-count', formatNumber(manifest.summary.outerFilesClassified));
  text('#nested-count', formatNumber(manifest.summary.nestedFilesClassified));
  text('#component-count', formatNumber(manifest.summary.logicalComponents));
  text('#asset-count', formatNumber(manifest.summary.importedReviewAssets));
  text('#canonical-sha', manifest.sourceArchives[0].sha256);

  renderArchiveSummary(manifest);
  renderInventory(manifest);
  renderBatteryFamily(manifest);
  renderLedFamily(stateMap);
  renderRgbFamily(stateMap);
  renderPhysicalDimensions(dimensions, manifest);
  renderPinMap(pinMap, manifest);
  renderBreadboards(footprints, manifest);
  renderStateIndex(stateMap);
  renderAuditDetails(manifest);
};

start().catch((error) => {
  const failure = document.createElement('pre');
  failure.className = 'load-error';
  failure.textContent = `Asset audit failed: ${error.stack ?? error.message}`;
  document.querySelector('main').append(failure);
});
