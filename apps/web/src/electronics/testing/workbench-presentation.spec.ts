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

describe('owner-reference Electronics presentation contract', () => {
  it('keeps idle terminals and breadboard overlays invisible until an active target state', () => {
    expect(stageSource).not.toContain('workbench-snap-link');
    expect(stageSource).toContain('width={10 / c.viewport.zoom}');
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
    expect(stageSource).toContain("? 'arduino-board-body' : 'component-bounds'");
    expect(stageSource).toContain("entry.key === 'arduino-uno'");
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
    expect(stageSource).toContain('component.position.x + bounds.width * 0.83');
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
    expect(stageSource).toContain('data-presentation-state={c.resultByComponent.get(component.id)');
    expect(workbenchCss).toContain("[data-presentation-state='destructive'][data-kind='source']");
    expect(workbenchCss).toContain("[data-presentation-state='destructive'][data-kind='resistor']");
    expect(workbenchCss).toContain('@keyframes workbench-component-overheat');
    expect(workbenchCss).not.toContain('.workbench-component-diagnostic-tooltip');
    expect(productionVisualSource).not.toContain('--workbench-led-glow');
    expect(stageSource).not.toContain('workbench-results-card');
    expect(stageSource).not.toContain('workbench-toast');
    expect(sidebarSource).not.toContain('workbench-inspector-diagnostic-badge');
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

  it('shows the calculated ordinary LED state and fixed limits inside I', () => {
    expect(sidebarSource).toContain("c.selectedComponent.kind === 'led'");
    expect(sidebarSource).toContain('Номинальный ток');
    expect(sidebarSource).toContain('Разрушительный ток');
    expect(sidebarSource).toContain('measurement.destructiveCurrentLimitAmp');
    expect(sidebarSource).toContain("c.selectedComponent.kind !== 'led'");
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
    expect(controllerModuleSource).toContain('lastSegmentPressRef');
    expect(controllerModuleSource).toContain('lastVertexPressRef');
    expect(controllerModuleSource).toContain('insertWireVertex(document, wireId, toWorld(event))');
    expect(controllerModuleSource).toContain('removeWireVertexAt(wireId, vertexIndex)');
    expect(stageSource).toContain('workbench-wire-endpoint');
    expect(stageSource).toContain('c.removeWireVertexAt(wire.id, index)');
    expect(stageSource).toContain('event.detail >= 2');
    expect(stageSource).toContain('c.wireDraftVertices');
    expect(stageSource.indexOf('workbench-wire-overlay')).toBeGreaterThan(
      stageSource.indexOf('{orderedComponents'),
    );
    expect(stageSource.indexOf('workbench-wire-hit-layer')).toBeGreaterThan(
      stageSource.indexOf('{orderedComponents'),
    );
    expect(stageSource.indexOf('workbench-wire-hit-layer')).toBeLessThan(
      stageSource.indexOf('workbench-wire-overlay'),
    );
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
    expect(vertexPointLogic).not.toContain('magneticWirePoint');
    expect(controllerSource).toContain('magneticWirePoint(anchor, freePoint');
    expect(controllerSource).toContain('lockOrthogonalBend');
    expect(controllerSource).toContain('orthogonalWireMode || event.shiftKey');
    expect(controllerSource).toContain(
      'wireDraftPoint(anchor, world, orthogonalWireMode || event.shiftKey)',
    );
    expect(controllerSource).toContain('removeWireVertexAt');
    expect(controllerSource).toContain("selection.kind === 'wire' && selection.vertexIndex");
    const newWireStart = controllerSource.slice(
      controllerSource.indexOf('if (!pendingTerminal) {'),
      controllerSource.indexOf('if (pendingTerminal.componentId'),
    );
    expect(newWireStart).toContain('setSelection(null);');
    expect(newWireStart.indexOf('setSelection(null);')).toBeLessThan(
      newWireStart.indexOf('setPendingTerminal({ componentId, terminal });'),
    );

    // A running simulation is a circuit under power: it can be operated, not
    // rebuilt. Components used to stay draggable while it ran, so the board could
    // be rearranged underneath a result that described the old arrangement.
    // Actuators, the potentiometer and the value fields keep working.
    expect(controllerSource).toContain(
      'Идёт моделирование: остановите его, чтобы переставлять компоненты.',
    );
    expect(controllerSource).toContain(
      'Идёт моделирование: остановите его, чтобы менять соединения.',
    );
    const vertexDrag = controllerSource.slice(controllerSource.indexOf('function startVertexDrag'));
    expect(vertexDrag.slice(0, 320)).toContain('if (simulationRunning) return;');
    const endpointDrag = controllerSource.slice(
      controllerSource.indexOf('function startEndpointDrag'),
    );
    expect(endpointDrag.slice(0, 320)).toContain('if (simulationRunning) return;');
    expect(controllerSource).toContain('onEmptyCanvas && !event.shiftKey');
    expect(stageSource).toContain('onPointerDownCapture={c.placeCatalogComponent}');
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
    expect(sidebarSource).toContain('stateOpen && measurement && technicalMetrics.length > 0');
    expect(sidebarSource).toContain('stateOpen && selectedDiagnostics.length > 0');
    expect(sidebarSource).not.toContain('workbench-led-electrical-state');
    expect(editorSource).toContain('window.print()');
    expect(editorSource).toContain('text/csv;charset=utf-8');
    expect(alternateViewsSource).toContain('<th>Имя</th>');
    expect(alternateViewsSource).toContain('<th>Количество</th>');
    expect(alternateViewsSource).toContain('<th>Компонент</th>');
  });

  it('provides a real phone workbench with a bottom component sheet and touch targets', () => {
    expect(workbenchCss).toContain('@media (max-width: 760px)');
    expect(workbenchCss).toContain('--wb-library-open-height: min(44dvh, 360px)');
    expect(workbenchCss).toContain('.workbench-library-handle-label');
    expect(workbenchCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.workbench-library,[\s\S]*?\.workbench-library\.collapsed\s*\{[\s\S]*?bottom:\s*0;[\s\S]*?width:\s*100%;/,
    );
    expect(workbenchCss).toMatch(
      /@media \(max-width: 760px\)[\s\S]*?\.workbench-stage,[\s\S]*?right:\s*0;/,
    );
    expect(sidebarSource).toContain("c.libraryOpen ? 'Скрыть компоненты' : 'Компоненты'");
    expect(controllerModuleSource).toContain("window.matchMedia?.('(max-width: 760px)')");
    expect(controllerModuleSource).toContain('Компонент выбран. Коснитесь места на рабочем поле');
    expect(stageSource).toContain('coarseInteraction ? 14 : 8');
    expect(stageSource).toContain('coarseInteraction ? 10 : 5');
  });
});
