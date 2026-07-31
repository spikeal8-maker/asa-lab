const manifestUrl = '/assets/electronics/owner-supplied/manifest.json';
const assetBaseUrl = '/assets/electronics/owner-supplied/';

const formatMillimeters = (value) => Number(value.toFixed(3)).toString();

const addPinMarkers = (frame, component, scale) => {
  component.pins.forEach((pin, index) => {
    const marker = document.createElement('span');
    marker.className = 'pin-marker';
    marker.style.left = `${pin.pinPosition.xMm * scale}px`;
    marker.style.top = `${pin.pinPosition.yMm * scale}px`;
    marker.title = `${pin.pinId}: ${pin.electricalRole}`;
    marker.setAttribute('aria-label', marker.title);

    const label = document.createElement('span');
    label.className = 'pin-label';
    label.textContent = pin.pinId;
    label.style.setProperty('--label-offset', `${-19 - (index % 2) * 13}px`);
    marker.append(label);
    frame.append(marker);
  });
};

const createSpecimen = ({ component, variant, scale, xMm, yMm, showPins = true }) => {
  const specimen = document.createElement('article');
  specimen.className = 'specimen';
  specimen.dataset.componentId = component.id;
  specimen.dataset.sourceFile = component.sourceFile;
  specimen.style.left = `${xMm * scale}px`;
  specimen.style.top = `${yMm * scale}px`;
  specimen.style.width = `${component.physicalWidthMm * scale}px`;
  specimen.style.height = `${component.physicalHeightMm * scale}px`;

  const frame = document.createElement('div');
  frame.className = 'asset-frame';

  const image = document.createElement('img');
  image.src = `${assetBaseUrl}${variant.file}`;
  image.alt = `${component.displayName}, ${variant.state}`;
  image.draggable = false;
  frame.append(image);

  if (showPins) {
    addPinMarkers(frame, component, scale);
  }

  const caption = document.createElement('div');
  caption.className = 'specimen-caption';

  const name = document.createElement('strong');
  name.className = 'specimen-name';
  name.textContent = component.displayName;

  const file = document.createElement('span');
  file.className = 'specimen-file';
  file.textContent = variant.file;
  file.title = component.sourceFile;

  const size = document.createElement('span');
  size.className = 'specimen-size';
  const bodySuffix = component.packageBodyMm
    ? ` · корпус ${component.packageBodyMm.width}×${component.packageBodyMm.height} мм`
    : '';
  size.textContent = `${formatMillimeters(component.physicalWidthMm)}×${formatMillimeters(component.physicalHeightMm)} мм${bodySuffix}`;

  caption.append(name, file, size);
  specimen.append(frame, caption);
  return specimen;
};

const renderComparison = (manifest) => {
  const stage = document.querySelector('#comparison-stage');
  const scale = manifest.worldUnitsPerMm;
  const baselineMm = 87;
  let xMm = 5;

  manifest.components.forEach((component) => {
    const variant = component.stateVariants[0];
    stage.append(
      createSpecimen({
        component,
        variant,
        scale,
        xMm,
        yMm: baselineMm - component.physicalHeightMm,
      }),
    );
    xMm += component.physicalWidthMm + 7;
  });

  stage.style.minWidth = `${Math.max(1520, (xMm + 5) * scale)}px`;
};

const renderVariants = (manifest) => {
  const stage = document.querySelector('#variants-stage');
  const scale = manifest.worldUnitsPerMm;
  const maxRowWidthMm = 178;
  const rowHeightMm = 84;
  const baselineOffsetMm = 58;
  let xMm = 5;
  let row = 0;

  manifest.components.forEach((component) => {
    component.stateVariants.forEach((variant) => {
      const itemWidthMm = component.physicalWidthMm + 7;
      if (xMm + itemWidthMm > maxRowWidthMm) {
        row += 1;
        xMm = 5;
      }

      const baselineMm = row * rowHeightMm + baselineOffsetMm;
      stage.append(
        createSpecimen({
          component,
          variant,
          scale,
          xMm,
          yMm: baselineMm - component.physicalHeightMm,
        }),
      );
      xMm += itemWidthMm;
    });
  });

  const rows = row + 1;
  stage.style.height = `${(rows * rowHeightMm + 14) * scale}px`;
};

const renderAudit = (manifest) => {
  const archiveList = document.querySelector('#archive-list');
  manifest.sourceArchives.forEach((archive) => {
    const entry = document.createElement('div');
    entry.className = 'audit-entry';

    const title = document.createElement('strong');
    title.textContent = `${archive.name} · ${archive.fileCount} файлов`;

    const hash = document.createElement('small');
    hash.className = 'hash';
    hash.textContent = `SHA-256 ${archive.sha256}`;

    const backup = document.createElement('small');
    backup.textContent = `Резервная копия проверена · архив не включён в Git`;

    entry.append(title, hash, backup);
    archiveList.append(entry);
  });

  const unconfirmedList = document.querySelector('#unconfirmed-list');
  manifest.unconfirmedCurrentAssets.forEach((asset) => {
    const entry = document.createElement('div');
    entry.className = 'file-entry file-entry-rejected';

    const title = document.createElement('strong');
    title.textContent = asset.file;

    const status = document.createElement('small');
    status.textContent = asset.status.replaceAll('_', ' ');

    entry.append(title, status);
    unconfirmedList.append(entry);
  });
};

const start = async () => {
  const response = await fetch(manifestUrl, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status}`);
  }

  const manifest = await response.json();
  document.documentElement.style.setProperty(
    '--world-units-per-mm',
    `${manifest.worldUnitsPerMm}px`,
  );
  document.querySelector('#scale-value').textContent =
    `1 мм = ${manifest.worldUnitsPerMm} экранных единиц`;

  renderComparison(manifest);
  renderVariants(manifest);
  renderAudit(manifest);
};

start().catch((error) => {
  const message = document.createElement('p');
  message.className = 'load-error';
  message.textContent = `Не удалось загрузить проверочный лист: ${error.message}`;
  document.querySelector('main').append(message);
});
