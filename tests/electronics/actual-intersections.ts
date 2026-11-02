/** Browser-serializable actual clipping measurement, shared by journeys and adversarial proof. */
export async function observeActualIntersections(selector: string) {
  const targets = Array.from(document.querySelectorAll(selector));
  if (!targets.length) throw new Error('No intersection targets');
  return new Promise<
    { left: number; top: number; right: number; bottom: number; width: number; height: number }[]
  >((resolve, reject) => {
    // A single initial delivery captures every target in one rendering update.
    // Never fill missing entries with bounding boxes: that would conceal clipping.
    const observer = new IntersectionObserver((entries) => {
      try {
        const byTarget = new Map(entries.map((entry) => [entry.target, entry]));
        resolve(
          targets.map((target) => {
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
          }),
        );
      } catch (error) {
        reject(error);
      } finally {
        observer.disconnect();
      }
    });
    try {
      for (const target of targets) observer.observe(target);
    } catch (error) {
      observer.disconnect();
      reject(error);
    }
  });
}
