/** Browser-serializable observers shared by native journeys and adversarial DOM checks. */
export function selectionStrokeDimensions(root: Element, ordinaryWidth: number | null) {
  const selections = root.querySelectorAll('.workbench-tinkercad-selection');
  if (selections.length !== 1) throw new Error('Expected one native selection outline');
  const selection = selections[0]!;
  const model = selection.parentElement;
  if (
    !model?.matches(
      '.workbench-owner-resistor, .workbench-tinkercad-button, .workbench-tinkercad-switch',
    )
  )
    throw new Error('Unexpected native selection owner');
  const primitive = selection.matches('rect');
  if (primitive && !model.matches('.workbench-tinkercad-switch'))
    throw new Error('Unexpected standalone selection primitive');
  if (!primitive && !selection.matches('g')) throw new Error('Unexpected selection wrapper');
  const bodies = primitive ? [selection] : Array.from(selection.querySelectorAll('path, rect'));
  if (bodies.length !== 1) throw new Error('Expected one native selection body');
  // The existing switch recolours its real leads; it does not create a wider
  // selection lead. Measure that actual width so the unchanged radius check
  // still exposes the missing outward geometry instead of crashing on null.
  const pins = Array.from((primitive ? model : selection).children).filter((node) =>
    node.matches('line'),
  );
  if (!pins.length) throw new Error('Missing native selection lead');
  const stroke = (node: Element) => {
    const raw = node.getAttribute('stroke-width');
    const value = Number(raw);
    if (raw === null || !Number.isFinite(value) || value <= 0)
      throw new Error('Missing finite native stroke width');
    return value;
  };
  if (ordinaryWidth === null || !Number.isFinite(ordinaryWidth) || ordinaryWidth <= 0)
    throw new Error('Missing finite unselected lead width');
  return { body: stroke(bodies[0]!), pin: stroke(pins[0]!), ordinary: ordinaryWidth };
}

export function installNativeSaveInputObserver() {
  const observedWindow = window as unknown as { f2SaveInput: unknown };
  observedWindow.f2SaveInput = null;
  window.addEventListener(
    'pointerdown',
    (event) => {
      const button = (event.target as Element)?.closest('button');
      const selector = 'button.workbench-pill.save[aria-label="Сохранить проект"]';
      const buttons = document.querySelectorAll(selector);
      observedWindow.f2SaveInput = {
        trusted: event.isTrusted,
        pointerType: event.pointerType,
        ariaLabel: button?.getAttribute('aria-label') ?? null,
        saveButton: buttons.length === 1 && button === buttons[0],
      };
    },
    { capture: true, once: true },
  );
}
