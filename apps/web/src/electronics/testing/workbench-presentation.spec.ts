import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const electronicsRoot = resolve(process.cwd(), 'apps/web/src/electronics');
const stageSource = readFileSync(resolve(electronicsRoot, 'WorkbenchStage.tsx'), 'utf8');
const sidebarSource = readFileSync(resolve(electronicsRoot, 'WorkbenchSidebars.tsx'), 'utf8');
const headerSource = readFileSync(resolve(electronicsRoot, 'WorkbenchHeader.tsx'), 'utf8');
const editorSource = readFileSync(resolve(electronicsRoot, '../pages/SchematicEditor.tsx'), 'utf8');
const alternateViewsSource = readFileSync(
  resolve(electronicsRoot, 'AlternateWorkbenchViews.tsx'),
  'utf8',
);
const productionVisualSource = readFileSync(
  resolve(electronicsRoot, 'ProductionComponentVisual.tsx'),
  'utf8',
);
const previewSource = readFileSync(resolve(electronicsRoot, 'component-preview.tsx'), 'utf8');
const controllerModuleSource = readFileSync(
  resolve(electronicsRoot, 'use-electronics-workbench.ts'),
  'utf8',
);
const projectStateSource = readFileSync(
  resolve(electronicsRoot, 'use-workbench-project-state.ts'),
  'utf8',
);
const persistenceIndicatorSource = readFileSync(
  resolve(electronicsRoot, '../components/editor-chrome/EditorPersistenceIndicator.tsx'),
  'utf8',
);
const workbenchCss = readFileSync(resolve(electronicsRoot, 'workbench.css'), 'utf8');
const geometrySource = readFileSync(resolve(electronicsRoot, 'workbench-geometry.ts'), 'utf8');
const shortcutsSource = readFileSync(resolve(electronicsRoot, 'workbench-shortcuts.ts'), 'utf8');
const iconSource = readFileSync(resolve(electronicsRoot, 'workbench-icons.tsx'), 'utf8');
const dragPreviewSource = readFileSync(
  resolve(electronicsRoot, 'workbench-drag-preview.ts'),
  'utf8',
);

describe('owner-reference Electronics presentation contract', () => {
  it('keeps idle terminals and breadboard overlays invisible until an active target state', () => {
    expect(stageSource).not.toContain('workbench-snap-link');
    expect(stageSource).toContain('TERMINAL_MARKER_SIZE');
    expect(stageSource).toContain('TERMINAL_HIT_RADIUS');
    expect(stageSource).toContain('TERMINAL_TOUCH_HIT_RADIUS');
    expect(stageSource).not.toContain('width={10 / c.viewport.zoom}');
    expect(stageSource).not.toContain('r={8 / c.viewport.zoom}');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    expect(stageSource).toContain("? ' wiring' : ''");
    expect(workbenchCss).toMatch(/\.workbench-terminal-dot\s*\{[^}]*opacity:\s*0;/s);
    expect(workbenchCss).toContain('.workbench-canvas.wiring .workbench-terminal-dot');
    expect(workbenchCss).toMatch(/\.workbench-breadboard-hole\s*\{[^}]*opacity:\s*0;/s);
    expect(stageSource).toContain('hoveredBreadboardNet.groupId === hole.groupId');
    expect(stageSource).toContain('workbench-breadboard-net-ring');
    expect(workbenchCss).toContain('.workbench-breadboard-terminal.connected');
    expect(stageSource).not.toContain('selectedLandingHoles');
    expect(workbenchCss).not.toContain('.workbench-breadboard-terminal.landing');
    expect(stageSource).toContain('workbench-terminal-tooltip');
    expect(stageSource).toContain('data-terminal-component-id');
    expect(stageSource).not.toContain('<title>{hole.id}</title>');
    expect(stageSource).not.toContain('tooltipWidth(hole.id');
    expect(stageSource).toContain('tooltipPlacement(label, point, c.viewBox');
    expect(stageSource).toContain('fontSize={12 / c.viewport.zoom}');
    expect(workbenchCss).not.toMatch(/\.workbench-terminal text\s*\{[^}]*font-size:/s);
    const terminalTooltipMarkup =
      stageSource.match(/<g className="workbench-terminal-tooltip">[\s\S]*?<\/g>/)?.[0] ?? '';
    expect(terminalTooltipMarkup).not.toContain('<rect');
    expect(workbenchCss).not.toContain('.workbench-terminal-tooltip rect');
    expect(workbenchCss).toMatch(/\.workbench-terminal-tooltip text\s*\{[^}]*text-shadow:/s);
  });

  it('scales wires with the scene and exposes the calculated LED visual state', () => {
    // Wires used to hold a constant screen width. Zoomed in, a magnified LED sat
    // beside a wire that had not grown at all, and the connection read as a hair
    // rather than a lead. A wire is a physical object here, so it scales with
    // everything else. The invisible hit path keeps its screen width, because
    // that one is a target for the pointer rather than something being looked at.
    const visibleWireMarkup =
      stageSource.match(/data-testid="schematic-wire"[\s\S]*?\/>/)?.[0] ?? '';
    const previewWireMarkup =
      stageSource.match(/className="workbench-wire-preview"[\s\S]*?\/>/)?.[0] ?? '';
    const hitWireMarkup = stageSource.match(/className="workbench-wire-hit"[\s\S]*?\/>/)?.[0] ?? '';
    expect(visibleWireMarkup).not.toContain('non-scaling-stroke');
    expect(previewWireMarkup).not.toContain('non-scaling-stroke');
    expect(hitWireMarkup).toContain('non-scaling-stroke');
    expect(workbenchCss).toMatch(/\.workbench-wire\s*\{[^}]*stroke-width:\s*3\.2;/s);
    expect(productionVisualSource).toContain('data-led-runtime-state');
    expect(productionVisualSource).toContain('data-led-brightness');
    expect(productionVisualSource).toContain('workbench-led-visual');
    expect(workbenchCss).not.toContain('.workbench-led-visual.is-lit .workbench-led-asset');
    expect(workbenchCss).toContain('.workbench-led-visual.is-reverse .workbench-led-asset');
    expect(productionVisualSource).toContain('fill={rgbDisplayColour}');
    expect(productionVisualSource).toContain('opacity={rgbIsLit ? rgbDisplayOpacity : 0}');
    expect(productionVisualSource).not.toContain("mixBlendMode: 'screen'");
    expect(sidebarSource).not.toContain('Расчётная яркость');
    expect(sidebarSource).not.toContain('workbench-led-electrical-state');
  });

  it('uses one three-column shelf and a meaningful detailed list', () => {
    expect(existsSync(resolve(electronicsRoot, 'workbench-tinkercad-parity.css'))).toBe(false);
    expect(workbenchCss).toContain('--wb-library-width: 276px');
    expect(workbenchCss).toContain('grid-template-columns: repeat(3, 74px)');
    expect(workbenchCss).toContain('column-gap: 8px');
    expect(workbenchCss).toContain('row-gap: 12px');
    expect(workbenchCss).toContain('height: 99px');
    expect(sidebarSource).not.toContain('workbench-family-variant-label');
    expect(sidebarSource).not.toContain('<small>В разработке</small>');
    expect(sidebarSource).not.toContain('workbench-catalog-blocked');
    expect(sidebarSource).not.toContain('workbench-catalog-variants');
    expect(sidebarSource).not.toContain('workbench-variant-popover');
    expect(sidebarSource).not.toContain('Варианты: {family.variants.length}');
    expect(sidebarSource).toContain('c.selectedFamily.variants.length > 1');
    expect(sidebarSource).toContain('c.setSelectedVariant(event.target.value)');
    expect(sidebarSource).toContain('workbench-catalog-copy');
    expect(sidebarSource).toContain('selectedVariant.entry.description');
    expect(sidebarSource).toContain('c.beginFamilyPlacement(family.familyId)');
    expect(sidebarSource).toContain('entry={selectedVariant.entry}');
    expect(previewSource).toContain('<ProductionComponentVisual');
    expect(workbenchCss).toContain('.workbench-component-vector-preview');
  });

  it('matches the compact editor chrome and shape-following selection contract', () => {
    expect(workbenchCss).toContain('--wb-header-height: 48px');
    expect(workbenchCss).toContain('--wb-toolbar-height: 48px');
    expect(stageSource).not.toContain('workbench-selection-box');
    expect(stageSource).toContain("workbench-part${selected ? ' selected' : ''}");
    expect(productionVisualSource).toContain('workbench-selection-silhouette');
    expect(productionVisualSource).not.toContain('diodeSelectionBounds');
    expect(workbenchCss).not.toContain('.workbench-diode-selection');
    expect(productionVisualSource).toContain('transform={ownerAssetTransform}');
    expect(productionVisualSource).toContain('width={ownerAssetWidth + selectionOffset * 4}');
    expect(productionVisualSource).toContain('height={ownerAssetHeight + selectionOffset * 4}');
    expect(productionVisualSource).toContain("entry.key === 'diode-do41'");
    expect(productionVisualSource).toContain('height * 0.88');
    expect(productionVisualSource).toContain('tinkercad-four-pin-6x6');
    expect(productionVisualSource).not.toContain('tinkercad-three-pin-rotary');
    expect(productionVisualSource).toContain('tinkercad-spdt-three-pin');
    expect(stageSource).toContain('selectionOffset={1.6 / c.viewport.zoom}');
    expect(productionVisualSource).toContain('<feMorphology');
    expect(productionVisualSource).toContain('operator="dilate"');
    expect(productionVisualSource).toContain('operator="out"');
    expect(productionVisualSource).toContain('filter={`url(#${selectionFilterId})`}');
    expect(workbenchCss).toContain('border: 1px solid #3b8ed7');
    expect(sidebarSource).not.toContain('owner-provenance');
    expect(sidebarSource).not.toContain('workbench-inspector-preview');
    expect(headerSource).toContain('Копировать (Ctrl+C)');
    expect(headerSource).toContain('Вставить (Ctrl+V)');
    // Three named tabs, and the project's own mark beside its name. The tabs used
    // to be bare icons, which gave no way to tell the breadboard from the
    // schematic without clicking one; the mark used to be a grid of letters
    // imitating another product's logo.
    expect(headerSource).toContain("{ id: 'breadboard', label: 'Цепи'");
    expect(headerSource).toContain("{ id: 'schematic', label: 'Схемы'");
    expect(headerSource).toContain("{ id: 'bom', label: 'Компоненты'");
    expect(headerSource).toContain('useEditorAvatar(user)');
    expect(headerSource).toContain('<EditorAvatar className="workbench-avatar" avatar={avatar} />');
    expect(headerSource).toContain('onViewChange(tab.id)');
    expect(headerSource).toContain('src="/asa-lab-mark.svg"');
    expect(headerSource).toContain('ASA Lab');
    expect(headerSource).not.toContain('workbench-brand-grid');
    expect(headerSource).toContain('Время моделирования:');
    expect(headerSource).toContain('formatSimulationTime(simulationElapsedSeconds)');
    expect(headerSource).toContain('<EditorPersistenceIndicator');
    expect(persistenceIndicatorSource).toContain("label: 'Сохранено'");
    expect(persistenceIndicatorSource).toContain("label: 'Не удалось сохранить'");
    expect(persistenceIndicatorSource).toContain('pendingDelayMs: 900');
    expect(headerSource).not.toContain('Серверная версия изменилась');
    expect(projectStateSource).not.toContain('Серверная версия изменилась');
    expect(workbenchCss).toContain('.workbench-save-state.quiet');
    expect(headerSource).toContain(
      "c.simulationRunning ? 'Остановить моделирование' : 'Начать моделирование'",
    );
    expect(headerSource).toContain("aria-label={c.simulationRunning ? 'Остановить моделирование'");
    expect(headerSource).toContain('data-simulation-status={c.simulationStatus}');
    expect(controllerModuleSource).toContain('new ElectronicsLiveSimulationWorkerController()');
    expect(controllerModuleSource).toContain(
      'simulationWorkerRef.current?.update(runtimeDocument, requestedHorizonMicroseconds)',
    );
    expect(controllerModuleSource).toContain(
      'simulationWorkerRef.current?.restart(currentRuntimeDocument)',
    );
    expect(controllerModuleSource).not.toContain(
      'simulationWorkerRef.current?.update(runtimeDocument, simulationTimeMs)',
    );
    expect(controllerModuleSource).not.toContain('advanceLiveSimulation(');
    expect(controllerModuleSource).not.toContain(
      'calculateLiveSimulation(runtimeDocument, persistedResult, true',
    );
    expect(projectStateSource).not.toContain('prepareLiveSimulationStart(document)');
    expect(controllerModuleSource).toContain('warmProductionAsset(');
    expect(controllerModuleSource).toContain('calculateSimulationPreflight(runningDocument)');
    expect(controllerModuleSource).toContain('applyRuntimeComponentOverrides(');
    expect(controllerModuleSource).toContain('setRuntimeComponentOverride(');
    expect(projectStateSource).not.toContain('persist(start.document');
    expect(headerSource).toContain('workbench-wire-color-menu');
    expect(headerSource).toContain('role="menuitemradio"');
    expect(headerSource).not.toContain('<option key={color} value={color}>');
    expect(workbenchCss).toContain('.workbench-wire-color-menu button > span');
    expect(workbenchCss).toMatch(
      /\.workbench-wire-color summary > span\s*\{[^}]*flex:\s*0 0 30px;/s,
    );
    expect(headerSource).toContain("aria-label={codeOpen ? 'Закрыть редактор кода'");
    expect(headerSource).toContain("className={`workbench-pill code${codeOpen ? ' active' : ''}`}");
    expect(editorSource).toContain('<ArduinoCodePanel');
    expect(editorSource).toContain('controller={controller}');
    expect(editorSource).toContain('drawerWidth={codePanelWidth}');
    expect(headerSource).toContain('aria-label="Отправить — пока недоступно"');
    expect(workbenchCss).toContain('width: 222px');
    expect(workbenchCss).toContain('overflow-x: clip');
    expect(workbenchCss).toMatch(
      /\.workbench-toolbar-group\.right \.workbench-pill\.simulate\s*\{[^}]*height:\s*36px;/s,
    );
    expect(workbenchCss).toMatch(/\.workbench-tool svg\s*\{[^}]*width:\s*28px;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-preview\s*\{[^}]*stroke-dasharray:\s*none;/s);
    expect(workbenchCss).toMatch(/\.workbench-canvas\.wiring[^}]*cursor:\s*default;/s);
  });

  it('keeps diagnostics on components and reproduces the LED burnout effect', () => {
    expect(stageSource).toContain('className="workbench-component-body-hit"');
    expect(stageSource).toContain('data-hit-surface="owner-alpha-mask"');
    expect(stageSource).toContain('componentAssetContainsPoint');
    expect(stageSource).toContain('preloadComponentHitMask');
    expect(productionVisualSource).toContain('pointerEvents="none"');
    expect(stageSource).toContain('fillOpacity={0.001}');
    expect(productionVisualSource).toContain('data-testid="spdt-actuator"');
    expect(stageSource).toContain('pointerEvents="all"');
    expect(stageSource).toContain('c.simulationRunning &&');
    expect(stageSource).toContain('c.errorDiagnosticComponentIds.has(component.id)');
    expect(stageSource).toContain("'led-diagnostic-badge'");
    expect(stageSource).toContain('const showDiagnosticIndicator = isLedIndicator');
    expect(stageSource).toContain('? ledOvercurrent || ledBurned');
    expect(stageSource).toContain("'rgb-led-burnout-explosion'");
    expect(stageSource).toContain("'component-diagnostic-indicator'");
    expect(stageSource).toContain('!c.simulationRunning || !primaryDiagnostic');
    expect(stageSource).toContain('workbench-diagnostic-layer');
    expect(stageSource).toContain('diagnosticBadgeGeometry(c.viewport.zoom)');
    expect(stageSource).toContain('r={badgeGeometry.radius}');
    expect(stageSource).toContain('fontSize={badgeGeometry.fontSize}');
    expect(stageSource).toContain('aria-label={diagnosticText}');
    expect(stageSource).toContain('pointerEvents="all"');
    expect(stageSource).toContain("'led-burnout-explosion'");
    expect(stageSource).toContain('workbench-led-burnout-explosion');
    expect(stageSource).not.toContain('workbench-component-diagnostic-tooltip');
    expect(stageSource).toContain('data-testid="component-model-warning"');
    expect(stageSource).toContain('data-screen-upright="true"');
    expect(stageSource).toContain('componentAssetVisibleBounds');
    expect(stageSource).toContain('topRightBadgeAnchor');
    expect(stageSource).toContain('gearmotorDiagnosticBodyBounds');
    expect(stageSource).toContain("'primary-body-top-right'");
    expect(stageSource).toContain('data-anchor="owner-alpha-top-right"');
    expect(stageSource).not.toContain('workbench-led-warning-indicator');
    expect(stageSource).toContain('unsupportedModelIndicators');
    expect(alternateViewsSource).toContain('workbench-schematic-model-warning');
    expect(workbenchCss).toContain('.workbench-catalog-model-warning');
    expect(workbenchCss).toContain('.workbench-component-model-warning');
    expect(productionVisualSource).toContain("entry.key === 'temperature-sensor'");
    expect(productionVisualSource).toContain('TMP');
    expect(workbenchCss).toContain('.workbench-component-diagnostic-indicator circle');
    expect(workbenchCss).toContain('.workbench-led-explosion-outer');
    expect(workbenchCss).toContain('.workbench-led-explosion-inner');
    expect(stageSource).toContain(
      'c.runtimePresentationResultByComponent.get(component.id)?.presentationState',
    );
    expect(workbenchCss).toContain("[data-presentation-state='destructive'][data-kind='source']");
    expect(workbenchCss).toContain("[data-presentation-state='destructive'][data-kind='resistor']");
    expect(workbenchCss).toContain('@keyframes workbench-component-overheat');
    expect(workbenchCss).not.toContain('.workbench-component-diagnostic-tooltip');
    expect(productionVisualSource).not.toContain('--workbench-led-glow');
    expect(stageSource).not.toContain('workbench-results-card');
    expect(stageSource).not.toContain('workbench-toast');
    expect(sidebarSource).not.toContain('workbench-inspector-diagnostic-badge');
    expect(sidebarSource).toContain('data-testid="capacitor-polarity-state"');
  });

  it('shows fixed diode profile limits inside I without exposing a fake editable Vf', () => {
    expect(sidebarSource).toContain("c.selectedComponent.kind === 'diode'");
    expect(sidebarSource).toContain('!c.selectedComponent.componentTypeId');
    expect(sidebarSource).toContain('measurement.reverseVoltageLimitVolt');
    expect(sidebarSource).toContain('Длительный ток');
    expect(sidebarSource).toContain('Обратный предел');
    expect(sidebarSource).toContain('c.selectedEntry!.key');
    expect(sidebarSource).toContain('technicalMetrics.map');
  });

  it('presents photoresistor runtime light in lux and keeps it out of project saves', () => {
    expect(stageSource).toContain('formatIlluminanceLux(photoresistorLux)');
    expect(stageSource).toContain('photoresistorResistanceOhm(component)');
    expect(stageSource).toContain('aria-valuetext={`${photoresistorLightText}; сопротивление');
    expect(stageSource).not.toContain('<output>{photoresistorPercent}%</output>');
    expect(sidebarSource).toContain('data-testid="photoresistor-reference-profile"');
    expect(sidebarSource).toContain('Сопротивление сейчас');
    expect(sidebarSource).toContain('Больше света → меньше сопротивление');
    expect(controllerModuleSource).toContain("component?.kind === 'photoresistor'");
    expect(controllerModuleSource).toContain(
      "runtimeOnlyControl = keys.every((key) => key === 'illumination')",
    );
  });

  it('shows the fixed electrothermal lamp profile and no resistance editor', () => {
    expect(sidebarSource).toContain('data-testid="lamp-reference-profile"');
    expect(sidebarSource).toContain('Сопротивление нити сейчас');
    expect(sidebarSource).toContain('Нагрузка по напряжению');
    expect(sidebarSource).toContain('filamentStateLabel(measurement.filamentState)');
    expect(sidebarSource).not.toContain("['resistor', 'potentiometer', 'lamp']");
  });

  it('shows the calculated ordinary LED state and fixed limits inside I', () => {
    expect(sidebarSource).toContain("c.selectedComponent.kind === 'led'");
    expect(sidebarSource).toContain('Номинальный ток');
    expect(sidebarSource).toContain('Разрушительный ток');
    expect(sidebarSource).toContain('measurement.destructiveCurrentLimitAmp');
    expect(sidebarSource).toContain("c.selectedComponent.kind !== 'led'");
  });

  it('shows the MATH-3 NPN operating point inside I without adding a stage card', () => {
    expect(sidebarSource).toContain('Полностью открыт как ключ');
    expect(sidebarSource).toContain('Ток управления (база)');
    expect(sidebarSource).toContain('Ток нагрузки (коллектор)');
    expect(sidebarSource).toContain('Общий ток (эмиттер)');
    expect(sidebarSource).toContain('measurement.baseCurrent');
    expect(sidebarSource).toContain('measurement.collectorCurrent');
    expect(sidebarSource).toContain('measurement.emitterCurrent');
    expect(sidebarSource).not.toContain('Токи B / C / E');
    expect(sidebarSource).not.toContain('Early 100 В');
    expect(sidebarSource).not.toContain('workbench-npn-stage-card');
  });

  it('keeps the measured Circuits toolbar order and functional viewport controls', () => {
    expect(headerSource).toContain('workbench-breadboard-tools');
    expect(headerSource).toContain('workbench-wire-style');
    expect(headerSource).not.toContain('label="Подогнать под экран"');
    expect(workbenchCss).toContain('.workbench-toolbar-gap.rotate');
    expect(workbenchCss).toMatch(/\.workbench-wire-color\s*\{[^}]*flex:\s*0 0 62px;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-style\s*\{[^}]*flex:\s*0 0 67px;/s);
    expect(stageSource).toContain('c.zoomBy(1.18)');
    expect(stageSource).toContain('c.zoomBy(0.85)');
    expect(stageSource).toContain('Math.round(c.viewport.zoom * 100)');
    expect(stageSource).toContain('data-testid="wire-vertex"');
    expect(stageSource).toContain('data-testid="wire-hit"');
    expect(stageSource).toContain('data-testid="wire-endpoint"');
    expect(stageSource).toContain('data-testid="wire-segment"');
    expect(stageSource).toContain('handleWirePointerDown(event, wire.id, segmentIndex)');
    expect(stageSource).toContain('Date.now() - previous.at <= 420');
    expect(stageSource).toContain(
      'Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= 8',
    );
    expect(stageSource).toContain('c.startSegmentDrag(event, wireId, segmentIndex)');
    expect(stageSource).toContain('c.addWireVertexAt(event, wireId)');
    expect(controllerModuleSource).not.toContain('lastSegmentPressRef');
    const segmentStart = controllerModuleSource.slice(
      controllerModuleSource.indexOf('function startSegmentDrag('),
      controllerModuleSource.indexOf('function removeWireVertexAt('),
    );
    expect(segmentStart).not.toContain('insertWireVertex');
    expect(stageSource).toContain('pointerSequenceRef');
    expect(stageSource).toContain('previous.pointerSequence + 1 === pointerSequenceRef.current');
    expect(stageSource).toContain('previous.mutationEpoch === c.documentMutationEpoch()');
    expect(controllerModuleSource).toContain('lastVertexPressRef');
    expect(controllerModuleSource).toContain('insertWireVertex(document, wireId, toWorld(event))');
    expect(controllerModuleSource).toContain('removeWireVertexAt(wireId, vertexIndex)');
    expect(stageSource).toContain('workbench-wire-endpoint');
    expect(stageSource).toContain('data-testid="wire-endpoint-visible"');
    expect(stageSource).toContain('className="workbench-wire-endpoint-hit"');
    expect(geometrySource).toContain('TERMINAL_MARKER_SIZE = 8');
    expect(geometrySource).toContain('WIRE_ENDPOINT_VISIBLE_RADIUS = 4');
    expect(geometrySource).toContain('WIRE_ENDPOINT_HIT_RADIUS = 9');
    expect(workbenchCss).toMatch(
      /\.workbench-inspector\.wire-selected\s*\{[^}]*border:\s*1px solid #cbd3d9;/s,
    );
    expect(workbenchCss).toMatch(
      /\.workbench-inspector\.wire-selected\s*\{[^}]*border-radius:\s*8px;/s,
    );
    expect(workbenchCss).toContain('border-left: 1px solid #e1e6e9;');
    expect(workbenchCss).toContain('caret-color: transparent;');
    expect(workbenchCss).toContain('.workbench-wire-inspector-compact button,');
    expect(sidebarSource).toContain('<DeleteIcon className="workbench-delete-icon" />');
    expect(iconSource).toContain(
      'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z',
    );
    expect(iconSource).toContain('fill="currentColor"');
    expect(iconSource).toContain('stroke="none"');
    expect(iconSource).not.toContain('<path d="M10 11v5M14 11v5" />');
    expect(headerSource).toContain('aria-pressed={c.simulationRunning}');
    expect(workbenchCss).toContain('@keyframes workbench-simulation-running-pulse');
    expect(workbenchCss).toMatch(
      /\.workbench-toolbar-group\.right \.workbench-pill\.simulate\.running\s*\{[^}]*background:\s*#b42318;[^}]*color:\s*#fff;[^}]*font-weight:\s*700;/s,
    );
    expect(headerSource).toContain('{c.simulationRunning ? <StopIcon /> : <PlayIcon />}');
    expect(controllerModuleSource).toContain("useState<ComponentCategory>('all')");
    expect(controllerModuleSource).toContain('DESKTOP_INITIAL_ZOOM = 1.25');
    expect(controllerModuleSource).toContain('KEYBOARD_NUDGE_STEP = 5');
    expect(controllerModuleSource).toContain('KEYBOARD_NUDGE_LARGE_STEP = 20');
    expect(sidebarSource).toContain('workbench-library-search-toggle');
    expect(workbenchCss).toContain('--wb-library-open-height: calc(156px');
    expect(workbenchCss).toContain('--wb-library-closed-height: calc(18px');
    expect(dragPreviewSource).toContain('.workbench-wire-editor-layer > g[data-wire-id=');
    expect(dragPreviewSource).toContain('circle[data-wire-vertex-index]');
    expect(stageSource).toContain('c.removeWireVertexAt(wire.id, index)');
    expect(stageSource).toContain('event.detail >= 2');
    expect(stageSource).toContain('c.wirePreviewVertices');
    const layerMarkers = [
      'data-testid="breadboard-body-layer"',
      'className="workbench-wire-layer workbench-wire-hit-layer"',
      'data-testid="wire-layer"',
      'data-testid="component-body-layer"',
      'data-testid="terminal-overlay-layer"',
      'data-testid="wire-editor-layer"',
      'data-testid="wire-control-layer"',
    ];
    const layerPositions = layerMarkers.map((marker) => stageSource.indexOf(marker));
    expect(layerPositions.every((position) => position >= 0)).toBe(true);
    expect(layerPositions).toEqual([...layerPositions].sort((a, b) => a - b));
    expect(stageSource).toContain('data-testid="component-terminal-overlay"');
    expect(workbenchCss).toMatch(/\.workbench-wire\s*\{[^}]*pointer-events:\s*none;/s);
    expect(workbenchCss).toMatch(/\.workbench-wire-hit\s*\{[^}]*pointer-events:\s*stroke;/s);
    expect(stageSource).toContain('className="workbench-wire-selection"');
    expect(stageSource).toContain('data-testid="schematic-wire"');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    const controllerSource = readFileSync(
      resolve(electronicsRoot, 'use-electronics-workbench.ts'),
      'utf8',
    );
    expect(controllerSource).toContain('catalogPlacement');
    expect(controllerSource).toContain('actuatorPressRef');
    expect(controllerSource).toContain('lockOrthogonalPoint');
    // A dragged bend goes where the pointer is. There used to be a magnet on
    // every drag, aligning the vertex to whichever neighbour happened to be
    // nearer; the anchor changed mid-drag and the point jumped between axes, so a
    // wire could not be laid deliberately alongside another one. Squaring a bend
    // is available on request — Shift, or the 90° mode — and only then.
    const vertexPointLogic = controllerSource.slice(
      controllerSource.indexOf('function wireVertexDragPoint'),
      controllerSource.indexOf('function wireDraftPoint'),
    );
    expect(vertexPointLogic).toContain('resolveWireVertexAssist');
    expect(vertexPointLogic).toContain('vertexAssistTargetRef.current');
    expect(vertexPointLogic).not.toContain('magneticWirePoint');
    expect(controllerSource).toContain('resolveWireAssist(');
    expect(controllerSource).toContain('worldToClient(');
    expect(controllerSource).toContain('wireAssistAxisRef.current');
    expect(controllerSource).toContain('event.altKey');
    expect(controllerSource).toContain(
      'completeOrthogonalRoute(start, targetPoint, wireDraftVertices)',
    );
    expect(stageSource).toContain('data-testid="wire-alignment-guide"');
    expect(workbenchCss).toMatch(/\.workbench-wire-guide\s*\{[^}]*pointer-events:\s*none;/s);
    expect(controllerSource).toContain('lockOrthogonalBend');
    expect(controllerSource).toContain('orthogonalWireMode || event.shiftKey');
    expect(controllerSource).toContain('removeWireVertexAt');
    expect(controllerSource).toContain("selection.kind === 'wire' && selection.vertexIndex");
    const beginWire = controllerSource.slice(
      controllerSource.indexOf('function beginWireAtTerminal'),
      controllerSource.indexOf('function commitPendingWireTo'),
    );
    expect(beginWire).toContain('setSelection(null);');
    expect(beginWire).toContain('setPendingTerminal(source);');
    expect(beginWire.indexOf('setSelection(null);')).toBeLessThan(
      beginWire.indexOf('setPendingTerminal(source);'),
    );
    expect(controllerSource).toContain(
      'terminalTargetAt(event.clientX, event.clientY) ?? { componentId, terminal }',
    );

    // Running simulation is a rigid structural lock. Only catalog pickup has
    // the explicit auto-stop path; runtime actuator/measurement paths stay live.
    expect(controllerSource).toContain('function structuralEditAllowed(): boolean');
    expect(controllerSource).toContain('function stopSimulationForCatalogPlacement(): void');
    expect(controllerSource).toContain('stopSimulationForCatalogPlacement();');
    expect(controllerSource).toContain('simulationWorkerRef.current?.stop();');
    const componentDrag = controllerSource.slice(
      controllerSource.indexOf('function startComponentDrag'),
      controllerSource.indexOf('function wiperPositionFromPointer'),
    );
    expect(componentDrag).toContain("simulationRunning && component.kind === 'button'");
    expect(componentDrag).toContain("simulationRunning && component.kind === 'switch'");
    expect(componentDrag).toContain('if (simulationRunning) {');
    expect(componentDrag).toContain(
      "setSelection({ kind: 'component', id: component.id, ids: [component.id] });",
    );
    const componentMove = controllerSource.slice(
      controllerSource.indexOf('const drag = componentDragRef.current;'),
      controllerSource.indexOf('const pan = panDragRef.current;'),
    );
    expect(componentMove).not.toContain('stopSimulationForCatalogPlacement();');
    expect(componentMove).not.toContain('structuralEditStarted = true');
    const vertexDrag = controllerSource.slice(controllerSource.indexOf('function startVertexDrag'));
    expect(vertexDrag.slice(0, 360)).toContain('if (!structuralEditAllowed()) return;');
    const endpointDrag = controllerSource.slice(
      controllerSource.indexOf('function startEndpointDrag'),
    );
    expect(endpointDrag.slice(0, 360)).toContain('if (!structuralEditAllowed()) return;');
    expect(controllerSource).toContain('onEmptyCanvas && !event.shiftKey');
    expect(stageSource).toContain('onPointerDownCapture={c.beginStagePointer}');
    expect(controllerSource).toContain('placeCatalogComponent(event)');

    // Runtime presentation is a running-simulation contract; static solve data
    // remains available to diagnostics without driving destructive visuals.
    expect(controllerSource).toContain('runtimePresentationResultByComponent');
    expect(controllerSource).toContain('simulationRunning ? resultByComponent');
    expect(stageSource).toContain(
      'c.runtimePresentationResultByComponent.get(component.id)?.presentationState',
    );
    expect(stageSource).toContain(
      'result={c.runtimePresentationResultByComponent.get(component.id)}',
    );

    // Guides render through the visible viewBox, not just the active segment.
    expect(stageSource).toContain('wireGuideAxes(c.wireGuide)');
    expect(stageSource).toContain('data-guide-axis={axis.orientation}');
    expect(stageSource).toContain('c.viewBox.x + c.viewBox.width');
    expect(stageSource).toContain('c.viewBox.y + c.viewBox.height');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    expect(workbenchCss).toMatch(
      /\.workbench-wire-guide\s*\{[^}]*stroke-width:\s*1px;[^}]*pointer-events:\s*none;/s,
    );

    // Command shortcuts use physical codes and ignore editable ancestors.
    expect(controllerSource).toContain('resolveWorkbenchShortcut(event)');
    expect(controllerSource).toContain('isEditableShortcutTarget(event.target)');
    expect(controllerSource).not.toContain('event.key.toLowerCase()');
    expect(shortcutsSource).toContain("event.code === 'KeyC'");
    expect(shortcutsSource).toContain('[contenteditable]:not([contenteditable="false"])');
    expect(shortcutsSource).toContain('.monaco-editor textarea');

    // Multi-selection has a summary inspector instead of one component editor.
    expect(controllerSource).toContain(
      "selection?.kind === 'component' && selection.ids.length === 1",
    );
    expect(sidebarSource).toContain('Выбрано: ${c.selection.ids.length}');
  });

  it('uses compact inline properties and real schematic/BOM export actions', () => {
    expect(workbenchCss).toMatch(/\.workbench-inspector\s*\{[^}]*width:\s*260px;/s);
    expect(workbenchCss).toMatch(/\.workbench-inspector-body\s*\{[^}]*padding:\s*2px;/s);
    expect(sidebarSource).toContain('RESISTANCE_UNITS');
    expect(sidebarSource).toContain('workbench-inspector-help-popover');
    expect(sidebarSource).toContain('aria-label="Подключение выводов"');
    expect(sidebarSource).toContain('workbench-terminal-status');
    expect(sidebarSource).toContain("if (kind === 'potentiometer') return 'Сопротивление'");
    expect(sidebarSource).toContain("selectedIsPotentiometer ? ' is-potentiometer' : ''");
    expect(sidebarSource).toContain("c.selectedComponent.kind === 'potentiometer' && stateOpen");
    expect(sidebarSource).toContain('aria-label="Положение движка"');
    expect(sidebarSource).not.toContain('Положение движка: {Math.round');
    expect(sidebarSource).toContain('(!selectedIsPotentiometer || stateOpen)');
    expect(sidebarSource).not.toContain('Ещё параметры');
    expect(sidebarSource).not.toContain('secondaryOpen');
    expect(sidebarSource).toContain('aria-label={`Техническое состояние');
    expect(sidebarSource).toContain('data-diagnostic-severity={selectedDiagnosticSeverity}');
    expect(workbenchCss).toContain("data-diagnostic-severity='error'");
    expect(workbenchCss).toContain("data-diagnostic-severity='warning'");
    expect(sidebarSource).toContain('Внутреннее сопротивление');
    expect(sidebarSource).toContain('Просадка напряжения');
    expect(sidebarSource).toContain('Нагрев источника');
    expect(sidebarSource).toContain('Нагрузка по току');
    expect(sidebarSource).toContain("c.selectedEntry?.key === 'regulated-power-supply'");
    expect(sidebarSource).toContain('aria-label={`Справка о компоненте');
    expect(productionVisualSource).toContain('<OwnerPotentiometerVisual');
    expect(productionVisualSource).toContain('potentiometerRuntimeMarkup(ownerSvg, wiperPosition)');
    expect(productionVisualSource).toContain('data-testid="potentiometer-angle"');
    expect(productionVisualSource).toContain('<OwnerDcMotorVisual');
    expect(productionVisualSource).toContain('dcMotorRuntimeMarkup(ownerSvg)');
    expect(productionVisualSource).toContain('dcMotorVisualMotion(motorRpm)');
    expect(productionVisualSource).toContain('data-testid="dc-motor-phase"');
    expect(productionVisualSource).toContain('data-motor-visual-direction={motion.direction}');
    expect(productionVisualSource).toContain('<OwnerGearmotorVisual');
    expect(productionVisualSource).toContain('gearmotorRuntimeMarkup(ownerSvg)');
    expect(productionVisualSource).toContain(
      'gearmotorVisualPresentation(simulationTimeMs, motorRpm, outputRpm)',
    );
    expect(productionVisualSource).toContain('data-testid="gearmotor-phase"');
    expect(productionVisualSource).toContain('data-output-rpm=');
    expect(workbenchCss).toContain('@keyframes workbench-dc-motor-gear-spin');
    expect(workbenchCss).toContain("data-motor-visual-direction='counterclockwise'");
    expect(stageSource).toContain("'dc-motor-rpm'");
    expect(stageSource).toContain("'gearmotor-output-rpm'");
    expect(stageSource).toContain('result?.outputRpm ?? 0');
    expect(stageSource).toContain('formatMotorRpm(rpm)');
    expect(stageSource).toContain('pointerEvents="none"');
    expect(sidebarSource).toContain('data-testid="dc-motor-rpm-measurement"');
    expect(sidebarSource).toContain('data-testid="gearmotor-profile-summary"');
    expect(sidebarSource).toContain('Настройки мотор-редуктора');
    expect(sidebarSource).toContain('1:48 · TT · 3–6 В');
    expect(sidebarSource).toContain('Сейчас доступна одна подтверждённая версия.');
    expect(sidebarSource).toContain('Нагрузка на вал, мН·м');
    expect(sidebarSource).toContain('Заблокировать выходной вал мотор-редуктора');
    expect(sidebarSource).toContain('data-testid="gearmotor-motor-rpm-measurement"');
    expect(sidebarSource).toContain('data-testid="gearmotor-output-rpm-measurement"');
    expect(sidebarSource).toContain('data-testid="gearmotor-output-torque-measurement"');
    expect(sidebarSource).toContain('Подробные параметры');
    expect(sidebarSource).toContain('Передаточное отношение');
    expect(sidebarSource).toContain('КПД редуктора');
    expect(sidebarSource).toContain('Мощность на выходе');
    expect(sidebarSource).toContain('Электромагнитный момент');
    expect(sidebarSource).toContain('Нагрузка на валу');
    expect(sidebarSource).toContain('Рабочий диапазон');
    expect(sidebarSource).toContain('Режим питания');
    expect(sidebarSource).toContain('Нагрев обмотки I²R');
    expect(sidebarSource).toContain("'Заблокировать вал двигателя'");
    expect(sidebarSource).toContain("'Заблокировать выходной вал мотор-редуктора'");
    expect(controllerModuleSource).toContain('setSelectedMotorShaftLocked');
    expect(controllerModuleSource).toContain('{ stateProperties: { shaftLocked } }');
    expect(workbenchCss).toContain("data-component-type='dc-motor'");
    expect(workbenchCss).toContain('.workbench-gearmotor-output-bar-highlight');
    expect(workbenchCss).toContain('.workbench-gearmotor-output-bar');
    expect(workbenchCss).not.toContain('.workbench-gearmotor-output-axle-highlight');
    expect(workbenchCss).toContain('fill: #66727b');
    expect(workbenchCss).toContain('translateY(calc(12px +');
    expect(workbenchCss).toContain('translateX(calc(-5.5px +');
    expect(workbenchCss).toContain('scaleY(var(--workbench-gearmotor-output-shaft-scale-y, 1))');
    expect(workbenchCss).toContain('--workbench-gearmotor-output-highlight-opacity');
    expect(workbenchCss).toContain('--workbench-gearmotor-motor-highlight-opacity');
    expect(workbenchCss).toContain('opacity 120ms linear');
    expect(workbenchCss).toContain('--workbench-gearmotor-motor-highlight-shift');
    expect(workbenchCss).toContain('.workbench-stage-readout.workbench-gearmotor-rpm');
    expect(stageSource).toContain('gearmotorRpmBodyPoint');
    expect(stageSource).toContain("data-placement={isGearmotor ? 'primary-body'");
    expect(workbenchCss).toContain('grid-template-columns: 90px minmax(0, 1fr)');
    expect(sidebarSource).toContain('Обмотка');
    expect(stageSource).toContain('data-hit-surface="potentiometer-knob-face"');
    expect(stageSource).toContain('cx={baseSize.width * (71.5 / 144)}');
    expect(stageSource).toContain('cy={baseSize.height * (71 / 164)}');
    expect(stageSource).toContain('Math.min(baseSize.width / 144, baseSize.height / 164) * 71');
    expect(stageSource).toContain(
      'onPointerDown={(event) => c.startPotentiometerControl(event, component)}',
    );
    expect(productionVisualSource).not.toContain('<foreignObject');
    expect(workbenchCss).toMatch(
      /\.workbench-inspector \.workbench-inspector-body > label\s*\{[^}]*grid-template-columns:\s*104px minmax\(0, 1fr\);/s,
    );
    expect(sidebarSource).toContain('data-testid="component-compact-properties"');
    expect(sidebarSource).not.toContain('data-testid="component-simulation-status"');
    expect(sidebarSource).not.toContain("'Расчёт не завершён'");
    expect(sidebarSource).not.toContain(
      'Измерения появятся после внедрения его математической модели.',
    );
    expect(sidebarSource).toContain(
      'stateOpen && measurement && !selectedIsGearmotor && technicalMetrics.length > 0',
    );
    expect(sidebarSource).toContain('stateOpen && selectedDiagnostics.length > 0');
    expect(sidebarSource).not.toContain('workbench-led-electrical-state');
    expect(editorSource).toContain('window.print()');
    expect(editorSource).toContain('text/csv;charset=utf-8');
    expect(alternateViewsSource).toContain('<th>Имя</th>');
    expect(alternateViewsSource).toContain('<th>Количество</th>');
    expect(alternateViewsSource).toContain('<th>Компонент</th>');
  });

  it('keeps RGB and seven-segment primary controls visible without duplicate detail tables', () => {
    expect(sidebarSource).toContain('{selectedIsRgbLed ? (');
    expect(sidebarSource).toContain("{c.selectedEntry.key === 'seven-segment-display' ? (");
    expect(sidebarSource).not.toContain('{selectedIsRgbLed && stateOpen ? (');
    expect(sidebarSource).not.toContain(
      "{c.selectedEntry.key === 'seven-segment-display' && stateOpen ? (",
    );
    expect(sidebarSource).toContain('workbench-primary-controls');
    expect(sidebarSource).toContain(
      '{stateOpen && !selectedIsRgbLed && !selectedIsSevenSegment ? (',
    );
    expect(workbenchCss).toMatch(
      /\.workbench-primary-controls label\s*\{[^}]*grid-template-columns:\s*104px minmax\(0, 1fr\);/s,
    );
  });

  it('shows all multimeter modes and their calculated reading on the instrument and panel', () => {
    expect(sidebarSource).toContain(
      "const selectedIsMultimeter = c.selectedEntry?.key === 'multimeter'",
    );
    expect(sidebarSource).toContain('data-testid="multimeter-primary-controls"');
    expect(sidebarSource).toContain('data-testid="multimeter-panel-reading"');
    expect(sidebarSource).toContain('Напряжение DC');
    expect(sidebarSource).toContain('Ток DC');
    expect(sidebarSource).toContain('Сопротивление');
    expect(sidebarSource).toContain('Ошибка · внешнее напряжение');
    expect(sidebarSource).toContain('Обрыв цепи или выше 50 МОм');
    expect(productionVisualSource).toContain("return 'ОШИБКА'");
    expect(productionVisualSource).toContain("return 'ОБРЫВ'");
    expect(sidebarSource).toContain('Последовательно с нагрузкой');
    expect(productionVisualSource).toContain('data-testid="multimeter-runtime-display"');
    expect(productionVisualSource).toContain("result.measurementMode === 'dc-current'");
    expect(productionVisualSource).toContain('data-measured-value');
    expect(productionVisualSource).toContain('OwnerMultimeterVisual');
    expect(productionVisualSource).toContain(
      'multimeterRuntimeMarkup(ownerSvg, measurementMode, displayValue)',
    );
    expect(productionVisualSource).toContain("return '';");
    expect(productionVisualSource).toContain('workbench-multimeter-mode-current');
    expect(productionVisualSource).toContain('workbench-multimeter-mode-resistance');
    expect(productionVisualSource).not.toContain('>DC</text>');
    expect(workbenchCss).toContain('.workbench-multimeter-reading');
    expect(workbenchCss).toContain('.workbench-multimeter-mode-button.is-active');
    expect(workbenchCss).not.toContain('.workbench-multimeter-active-mode');
  });

  it('operates the regulated supply through its existing owner SVG and compact panel', () => {
    expect(productionVisualSource).toContain('OwnerRegulatedPowerSupplyVisual');
    expect(productionVisualSource).toContain('regulatedPowerSupplyRuntimeMarkup(ownerSvg, {');
    expect(productionVisualSource).toContain('data-testid="regulated-power-supply-runtime"');
    expect(productionVisualSource).toContain('workbench-regulated-supply-voltage-knob');
    expect(productionVisualSource).toContain('workbench-regulated-supply-current-knob');
    expect(productionVisualSource).toContain('workbench-regulated-supply-power-switch');
    expect(stageSource).toContain('c.setRegulatedPowerSupplyControls(component.id, patch)');
    expect(sidebarSource).toContain('data-testid="regulated-power-supply-primary-controls"');
    expect(sidebarSource).toContain('Включить выход лабораторного источника');
    expect(sidebarSource).toContain('Уставка напряжения лабораторного источника');
    expect(sidebarSource).toContain('Ограничение тока лабораторного источника');
    expect(sidebarSource).toContain('data-testid="regulated-power-supply-panel-reading"');
    expect(sidebarSource).toContain("measurement?.regulationMode === 'cc' ? 'CC' : 'CV'");
    expect(workbenchCss).toContain('.workbench-regulated-supply-reading');
    expect(workbenchCss).toContain('.workbench-regulated-supply-indicator.is-cc.is-active');
  });

  it('shows active and passive piezo modes and animates only calculated sound state', () => {
    expect(sidebarSource).toContain('data-testid="piezo-primary-controls"');
    expect(sidebarSource).toContain('<option value="passive">Пассивный</option>');
    expect(sidebarSource).toContain('<option value="active">Активный</option>');
    expect(sidebarSource).not.toContain('workbench-piezo-summary');
    expect(sidebarSource).not.toContain('Пищит от 3–12 В');
    expect(productionVisualSource).toContain('OwnerPiezoVisual');
    expect(productionVisualSource).toContain('piezoRuntimeMarkup(ownerSvg)');
    expect(productionVisualSource).toContain('data-testid="piezo-owner-runtime"');
    expect(productionVisualSource).toContain('workbench-piezo-selection-copy');
    expect(productionVisualSource).toMatch(
      /const piezoActive =[^;]+simulationRunning[^;]+result\?\.energized === true/s,
    );
    expect(workbenchCss).toContain('.workbench-piezo-owner-waves');
    expect(workbenchCss).toContain('.workbench-piezo-selection-copy .workbench-piezo-owner-waves');
    expect(workbenchCss).toContain('.workbench-piezo-visual.is-sounding');
  });

  it('provides a real phone workbench with a bottom component sheet and touch targets', () => {
    expect(workbenchCss).toContain('@media (max-width: 980px)');
    expect(workbenchCss).toContain(
      '--wb-library-open-height: calc(194px + env(safe-area-inset-bottom))',
    );
    expect(workbenchCss).toContain('.workbench-library-handle-label');
    expect(workbenchCss).toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.workbench-library,[\s\S]*?\.workbench-library\.collapsed\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?width:\s*100%;/,
    );
    expect(workbenchCss).toMatch(
      /@media \(max-width: 980px\)[\s\S]*?\.workbench-stage,[\s\S]*?right:\s*0;/,
    );
    expect(sidebarSource).toContain("c.libraryOpen ? 'Скрыть компоненты' : 'Компоненты'");
    expect(controllerModuleSource).toContain("window.matchMedia?.('(max-width: 980px)')");
    expect(workbenchCss).toContain('touch-action: pan-x pinch-zoom');
    expect(editorSource).toContain('onMobileHeightChange={setCodeHeightPercent}');
    expect(controllerModuleSource).toContain('Компонент выбран. Коснитесь места на рабочем поле');
    expect(sidebarSource).toContain("mode: 'pending' | 'dragging' | 'scrolling'");
    expect(sidebarSource).toContain('Math.abs(dy) >= 1.25 * Math.abs(dx)');
    expect(sidebarSource).toContain("touch.mode = 'scrolling'");
    expect(sidebarSource).toContain("touch.mode = 'dragging'");
    expect(stageSource).toContain('TERMINAL_TOUCH_HIT_RADIUS');
    expect(stageSource).toContain('TERMINAL_HIT_RADIUS');
  });

  it('keeps runtime visuals, structural lock, full guide, multi-select and code shortcuts explicit', () => {
    expect(controllerModuleSource).toContain('function structuralEditAllowed(): boolean');
    expect(controllerModuleSource).toContain('function stopSimulationForCatalogPlacement(): void');
    expect(controllerModuleSource).toContain('runtimePresentationResultByComponent');
    expect(stageSource).toContain('c.runtimePresentationResultByComponent');
    expect(stageSource).toContain('wireGuideAxes(c.wireGuide)');
    expect(stageSource).toContain('data-guide-axis={axis.orientation}');
    expect(stageSource).toContain('vectorEffect="non-scaling-stroke"');
    expect(workbenchCss).toMatch(/\.workbench-wire-guide\s*\{[^}]*stroke-width:\s*1px;/s);
    expect(iconSource).toContain(
      'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM8 9h8v10H8V9zm7.5-5-1-1h-5l-1 1H5v2h14V4z',
    );
    expect(sidebarSource).toContain('className="workbench-wire-delete"');
    expect(controllerModuleSource).toContain(
      'nextComponentSelection(current, componentId, additive)',
    );
    expect(controllerModuleSource).toContain('selection.ids.length === 1');
    expect(shortcutsSource).toContain("event.code === 'KeyC'");
    expect(shortcutsSource).toContain("event.code === 'KeyV'");
    expect(shortcutsSource).toContain("event.code === 'KeyD'");
    expect(shortcutsSource).toContain("event.code === 'KeyZ'");
    expect(shortcutsSource).toContain("event.code === 'KeyY'");
    expect(shortcutsSource).toContain('[contenteditable]:not([contenteditable="false"])');
    expect(shortcutsSource).toContain('.arduino-source-editor');
    expect(controllerModuleSource).not.toContain("event.key.toLowerCase() === 'c'");
    expect(controllerModuleSource).not.toContain("event.key.toLowerCase() === 'v'");
  });
});
