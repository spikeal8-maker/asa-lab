/** Browser-serializable actual clipping measurement, shared by journeys and adversarial proof. */
export async function observeActualIntersections(selector: string) {
  const targets = Array.from(document.querySelectorAll(selector));
  if (!targets.length) throw new Error('No intersection targets');
  type Bounds = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
  // Retain identities, including every ancestor: matching target boxes alone misses
  // an overflow ancestor shrinking by two pixels while all five inset hits survive.
  const ancestors = Array.from(
    new Set(
      targets.flatMap((target) => {
        const chain = [];
        for (let element: Element | null = target; element; element = element.parentElement)
          chain.push(element);
        return chain;
      }),
    ),
  );
  const parents = ancestors.map((element) => element.parentElement);
  // Clock telemetry is not presentation. Fail closed if CSS could consume it,
  // including escaped selectors, attr() content, imports or unreadable sheets.
  const telemetryIsStyleIndependent = () => {
    const consumesTelemetry = (text: string) =>
      text
        .replace(
          /\\([\da-f]{1,6})\s?|\\(.)/gi,
          (_match, hex: string | undefined, literal: string) =>
            hex ? String.fromCodePoint(parseInt(hex, 16) || 0xfffd) : literal,
        )
        .toLowerCase()
        .includes('data-time-ms');
    const visited = new Set<CSSStyleSheet>();
    const inspect = (sheet: CSSStyleSheet): boolean => {
      if (visited.has(sheet)) return true;
      visited.add(sheet);
      return Array.from(sheet.cssRules).every((rule) => {
        return (
          !consumesTelemetry(rule.cssText) &&
          (!(rule instanceof CSSImportRule) ||
            (rule.styleSheet !== null && inspect(rule.styleSheet)))
        );
      });
    };
    try {
      return (
        [...document.styleSheets, ...document.adoptedStyleSheets].every(inspect) &&
        !ancestors.some((element) => consumesTelemetry(element.getAttribute('style') ?? ''))
      );
    } catch {
      return false;
    }
  };
  const telemetryIndependent = telemetryIsStyleIndependent();
  const snapshot = () =>
    JSON.stringify({
      viewport: [innerWidth, innerHeight, scrollX, scrollY],
      elements: ancestors.map((element) => {
        const rect = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return [
          rect.x,
          rect.y,
          rect.width,
          rect.height,
          element.clientLeft,
          element.clientTop,
          element.clientWidth,
          element.clientHeight,
          element.scrollLeft,
          element.scrollTop,
          // The accepted infinite running pulse animates box-shadow only. It
          // cannot alter clipping, layout, visibility, content or native hits.
          Array.from(css)
            .filter((property) => property !== 'box-shadow')
            .map((property) => [property, css.getPropertyValue(property)]),
        ];
      }),
    });
  const baseline = snapshot();
  const verify = () => {
    const current = Array.from(document.querySelectorAll(selector));
    if (
      current.length !== targets.length ||
      current.some((target, index) => target !== targets[index]) ||
      ancestors.some(
        (element, index) => !element.isConnected || element.parentElement !== parents[index],
      ) ||
      snapshot() !== baseline
    )
      throw new Error('Actual intersection capture changed');
  };
  // Detect even change-and-revert while the rendering observation is pending.
  const relevant = (record: MutationRecord) => {
    if (
      record.type === 'attributes' &&
      record.attributeName === 'data-time-ms' &&
      telemetryIndependent &&
      telemetryIsStyleIndependent()
    )
      return false;
    return (
      ancestors.includes(record.target as Element) ||
      (record.target instanceof Element && record.target.closest('style, link') !== null)
    );
  };
  let changed = false;
  const mutations = new MutationObserver((records) => {
    changed ||= records.some(relevant);
  });
  mutations.observe(document, {
    attributes: true,
    childList: true,
    characterData: true,
    subtree: true,
  });
  return new Promise<{
    read: <T>(measure: (targets: Element[], intersections: Bounds[]) => T) => T;
  }>((resolve, reject) => {
    // A single initial delivery captures every target in one rendering update.
    // Never fill missing entries with bounding boxes: that would conceal clipping.
    const observer = new IntersectionObserver((entries) => {
      try {
        const byTarget = new Map(entries.map((entry) => [entry.target, entry]));
        if (changed || mutations.takeRecords().some(relevant))
          throw new Error('Actual intersection capture changed');
        verify();
        const intersections = targets.map((target) => {
          const entry = byTarget.get(target);
          if (!entry) throw new Error('Missing actual intersection observation');
          const rect = entry.intersectionRect;
          const result = {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
            width: rect.width,
            height: rect.height,
          };
          if (!Object.values(result).every(Number.isFinite))
            throw new Error('Nonfinite actual intersection');
          return result;
        });
        resolve({
          read: (measure) => {
            verify();
            const result = measure(targets, intersections);
            verify();
            return result;
          },
        });
      } catch (error) {
        reject(error);
      } finally {
        observer.disconnect();
        mutations.disconnect();
      }
    });
    try {
      for (const target of targets) observer.observe(target);
    } catch (error) {
      observer.disconnect();
      mutations.disconnect();
      reject(error);
    }
  });
}
