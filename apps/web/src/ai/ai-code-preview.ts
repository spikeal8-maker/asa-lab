import { parse, type DefaultTreeAdapterMap } from 'parse5';

// Parse as data, never through a live DOM. Only this reconstructed static
// subset enters an opaque-origin iframe, with an additional restrictive CSP.
const TAGS = new Set(
  'html head body title style main section article header footer nav aside div span p h1 h2 h3 h4 h5 h6 br hr a strong em b i u s small sub sup pre code blockquote ul ol li dl dt dd table caption thead tbody tfoot tr th td colgroup col figure figcaption details summary button label input textarea select option form fieldset legend svg g path rect circle ellipse line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask pattern symbol use'.split(
    ' ',
  ),
);
const VOID = new Set(['br', 'hr', 'input', 'col']);
const ATTRS = new Set(
  'class id style title lang dir role width height viewbox preserveaspectratio x y x1 x2 y1 y2 cx cy r rx ry d points fill fill-opacity fill-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-opacity opacity transform gradientunits gradienttransform offset stop-color stop-opacity clip-path clip-rule mask patternunits patterntransform font-size font-family font-weight text-anchor dominant-baseline dx dy colspan rowspan scope type value placeholder disabled readonly checked selected open start reversed'.split(
    ' ',
  ),
);
const CASED: Record<string, string> = {
  lineargradient: 'linearGradient',
  radialgradient: 'radialGradient',
  clippath: 'clipPath',
  viewbox: 'viewBox',
  preserveaspectratio: 'preserveAspectRatio',
  gradientunits: 'gradientUnits',
  gradienttransform: 'gradientTransform',
  patternunits: 'patternUnits',
  patterntransform: 'patternTransform',
};
function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Games commonly save a high score. Opaque origins cannot use browser Storage;
// supply bounded, per-run memory instead of granting access to ASA's storage.
const RUN_STORAGE = `<script>(()=>{const make=()=>{const values=new Map();return Object.freeze({get length(){return values.size},key:i=>Array.from(values.keys())[i]??null,getItem:k=>values.get(String(k))??null,setItem:(k,v)=>{k=String(k);v=String(v);if(k.length<=128&&v.length<=8192&&(values.has(k)||values.size<64))values.set(k,v)},removeItem:k=>values.delete(String(k)),clear:()=>values.clear()})};for(const name of ['localStorage','sessionStorage'])Object.defineProperty(window,name,{value:make(),configurable:false})})();</script>`;

export function codePreviewDocument(code: string, interactive = false): string | null {
  if (code.length > 200_000) return null;
  let nodes = 0;
  function render(node: DefaultTreeAdapterMap['node'], depth: number): string {
    if (++nodes > 10_000 || depth > 64) throw new Error('preview_limit');
    if (node.nodeName === '#text') return escape((node as DefaultTreeAdapterMap['textNode']).value);
    if (!('tagName' in node))
      return 'childNodes' in node ? node.childNodes.map((n) => render(n, depth + 1)).join('') : '';
    const tag = node.tagName.toLowerCase();
    if (!TAGS.has(tag) && tag !== 'canvas' && !(interactive && tag === 'script')) return '';
    // Outer document is always ours; no generated metadata, base, frames,
    // foreignObject, scripts, resource elements or event attributes survive.
    if (['html', 'head', 'body'].includes(tag))
      return node.childNodes.map((n) => render(n, depth + 1)).join('');
    const attrs = node.attrs
      .filter(
        (a) =>
          !a.namespace &&
          (ATTRS.has(a.name.toLowerCase()) ||
            /^aria-[a-z-]+$/.test(a.name) ||
            /^data-[a-z0-9_-]+$/.test(a.name) ||
            ['tabindex', 'for', 'name'].includes(a.name) ||
            (interactive && /^on[a-z]+$/.test(a.name))),
      )
      .map((a) => ` ${CASED[a.name.toLowerCase()] || a.name}="${escape(a.value)}"`)
      .join('');
    // Local SVG references only. No external href, including encoded URLs.
    const href =
      tag === 'use'
        ? node.attrs.find((a) => a.name === 'href' && /^#[a-zA-Z_][\w.-]*$/.test(a.value))
        : undefined;
    const name = CASED[tag] || tag;
    const contents =
      tag === 'script'
        ? node.childNodes
            .filter((n) => n.nodeName === '#text')
            .map((n) => (n as DefaultTreeAdapterMap['textNode']).value)
            .join('')
        : tag === 'style'
          ? node.childNodes
              .filter((n) => n.nodeName === '#text')
              .map((n) => (n as DefaultTreeAdapterMap['textNode']).value.replace(/</g, '\\3c '))
              .join('')
          : node.childNodes.map((n) => render(n, depth + 1)).join('');
    return `<${name}${attrs}${href ? ` href="${escape(href.value)}"` : ''}>${VOID.has(tag) ? '' : contents + `</${name}>`}`;
  }
  try {
    const body = render(parse(code), 0);
    const policy = `default-src 'none'; script-src ${interactive ? "'unsafe-inline'" : "'none'"}; style-src 'unsafe-inline'; img-src 'none'; font-src 'none'; connect-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; base-uri 'none'; form-action 'none'`;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html{background:white;color:#172b3a;font-family:Arial,sans-serif}body{margin:16px}svg{max-width:100%;height:auto}</style>${interactive ? RUN_STORAGE : ''}</head><body>${body}</body></html>`;
    if (!interactive) return doc;
    // The trusted containing document owns frame-src 'none': srcdoc is allowed,
    // but URL navigation of the child is blocked BEFORE making a request. The
    // child's opaque origin cannot remove this outer policy or reach ASA.
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}iframe{display:block;border:0;width:100%;height:100%}</style></head><body><iframe title="Приложение" sandbox="allow-scripts" referrerpolicy="no-referrer" srcdoc="${escape(doc)}"></iframe></body></html>`;
  } catch {
    return null;
  }
}
