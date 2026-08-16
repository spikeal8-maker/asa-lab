/**
 * Turns an editor's live SVG stage into a canvas for a project card.
 *
 * A serialised SVG is rendered by the browser in isolation: it cannot see the
 * page's stylesheets and it may not fetch anything. Both matter here. The
 * electronics stage paints most of itself through CSS classes, and its parts
 * are real component artwork referenced by URL — left alone, the picture would
 * come out as unstyled outlines with holes where the components should be. So
 * the clone carries its own computed paint values and its own image bytes.
 */

/** Paint that a stylesheet can set and a standalone SVG would otherwise lose. */
const PAINT_PROPERTIES = [
  'fill',
  'fill-opacity',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-dasharray',
  'opacity',
  'color',
  'display',
  'visibility',
] as const;

/** Editor chrome that belongs to interaction, not to the work. */
const CHROME_SELECTOR = [
  '[data-testid="wire-hit"]',
  '.workbench-grid-hit',
  '.workbench-selection-outline',
  '.workbench-tooltip',
  '[data-snapshot-hide]',
].join(',');

async function toDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { credentials: 'same-origin', cache: 'force-cache' });
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string | null>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * Replaces referenced artwork with its own bytes. A reference to another origin
 * is dropped rather than followed: a snapshot must not become a way to pull a
 * third party's image into a class.
 */
async function inlineImages(clone: SVGSVGElement): Promise<void> {
  const images = [...clone.querySelectorAll('image')];
  const cache = new Map<string, Promise<string | null>>();
  await Promise.all(
    images.map(async (image) => {
      const href = image.getAttribute('href') ?? image.getAttribute('xlink:href');
      if (!href || href.startsWith('data:')) return;
      let resolved: URL;
      try {
        resolved = new URL(href, window.location.href);
      } catch {
        image.remove();
        return;
      }
      if (resolved.origin !== window.location.origin) {
        image.remove();
        return;
      }
      let pending = cache.get(resolved.href);
      if (!pending) {
        pending = toDataUrl(resolved.href);
        cache.set(resolved.href, pending);
      }
      const encoded = await pending;
      if (encoded === null) {
        image.remove();
        return;
      }
      image.setAttribute('href', encoded);
      image.removeAttribute('xlink:href');
    }),
  );
}

function inlinePaint(source: SVGSVGElement, clone: SVGSVGElement): void {
  const sourceNodes = [source, ...source.querySelectorAll<SVGElement>('*')];
  const cloneNodes = [clone, ...clone.querySelectorAll<SVGElement>('*')];
  for (let index = 0; index < cloneNodes.length; index += 1) {
    const from = sourceNodes[index];
    const to = cloneNodes[index];
    if (!from || !to) break;
    const computed = window.getComputedStyle(from);
    for (const property of PAINT_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      if (value) to.style.setProperty(property, value);
    }
  }
}

async function draw(markup: string, width: number, height: number): Promise<HTMLCanvasElement> {
  const blob = new Blob([markup], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error('snapshot svg failed to load'));
      element.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('2d context unavailable');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);
    return canvas;
  } finally {
    URL.revokeObjectURL(url);
  }
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest framing, in user units, so one small part is not blown up. */
const MIN_CONTENT_EXTENT = 220;
const CONTENT_PADDING = 0.12;
const TARGET_ASPECT = 4 / 3;

/**
 * The extent of the work, in the stage's own coordinates.
 *
 * Screen rectangles are used rather than `getBBox`, because the layers of a
 * stage carry their own pan and zoom transforms and a bounding box measured
 * inside one of them would be in the wrong space. The stage's screen matrix
 * maps everything back to one.
 */
function contentBox(source: SVGSVGElement, selector: string): Box | null {
  const matrix = source.getScreenCTM();
  if (!matrix) return null;
  const inverse = matrix.inverse();
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;
  for (const element of source.querySelectorAll(selector)) {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 && rect.height <= 0) continue;
    for (const [screenX, screenY] of [
      [rect.left, rect.top],
      [rect.right, rect.bottom],
    ]) {
      const point = new DOMPoint(screenX, screenY).matrixTransform(inverse);
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return null;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Pads the work, gives it a card-shaped aspect and keeps it centred. */
function framed(box: Box): Box {
  const padded = Math.max(box.width, box.height) * CONTENT_PADDING;
  let width = Math.max(MIN_CONTENT_EXTENT, box.width + padded * 2);
  let height = Math.max(MIN_CONTENT_EXTENT / TARGET_ASPECT, box.height + padded * 2);
  if (width / height < TARGET_ASPECT) width = height * TARGET_ASPECT;
  else height = width / TARGET_ASPECT;
  return {
    x: box.x + box.width / 2 - width / 2,
    y: box.y + box.height / 2 - height / 2,
    width,
    height,
  };
}

/**
 * Frames the work rather than the window.
 *
 * A learner may be zoomed into one corner or panned away from everything they
 * built, and either way the viewport says nothing on a card. When the caller
 * names the elements that make up the work, the picture is framed around them;
 * otherwise the stage's own viewBox is used.
 */
export async function rasteriseSvgStage(
  source: SVGSVGElement,
  targetWidth: number,
  options: { readonly contentSelector?: string } = {},
): Promise<HTMLCanvasElement | null> {
  const viewBox = source.viewBox.baseVal;
  const content = options.contentSelector ? contentBox(source, options.contentSelector) : null;
  const box: Box = content
    ? framed(content)
    : {
        x: viewBox.x,
        y: viewBox.y,
        width: viewBox.width > 0 ? viewBox.width : source.clientWidth,
        height: viewBox.height > 0 ? viewBox.height : source.clientHeight,
      };
  const { width, height } = box;
  if (width <= 0 || height <= 0) return null;

  const clone = source.cloneNode(true) as SVGSVGElement;
  clone.setAttribute('viewBox', `${box.x} ${box.y} ${width} ${height}`);
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  clone.setAttribute('xmlns:xlink', 'http://www.w3.org/1999/xlink');
  clone.setAttribute('preserveAspectRatio', 'xMidYMid meet');

  // Paint is copied first: it walks the two trees side by side, so nothing may
  // be removed from the clone until that is done.
  inlinePaint(source, clone);
  for (const element of clone.querySelectorAll(CHROME_SELECTOR)) element.remove();
  await inlineImages(clone);

  const scale = Math.min(1, targetWidth / width);
  const pixelWidth = Math.max(16, Math.round(width * scale));
  const pixelHeight = Math.max(16, Math.round(height * scale));
  clone.setAttribute('width', String(pixelWidth));
  clone.setAttribute('height', String(pixelHeight));

  try {
    const markup = new XMLSerializer().serializeToString(clone);
    return await draw(markup, pixelWidth, pixelHeight);
  } catch {
    // A stage that cannot be serialised or drawn simply has no snapshot; the
    // card falls back to the computed figure.
    return null;
  }
}
