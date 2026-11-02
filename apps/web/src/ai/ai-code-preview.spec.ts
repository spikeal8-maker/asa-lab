import { describe, expect, it } from 'vitest';
import { codePreviewDocument } from './ai-code-preview';

describe('isolated static code preview', () => {
  it.each([
    ['viewBox="0 0 800 200"', '0 0 800 200'],
    ['width="1200" height="600"', '0 0 1200 600'],
    ['width="640px" height="480px"', '0 0 640 480'],
    ['width="100%" height="100%"', '0 0 300 150'],
    ['viewBox="0 0 -10 0" width="400" height="200"', '0 0 400 200'],
  ])('fits standalone SVG with %s without enabling scripts', (attrs, expected) => {
    const doc = codePreviewDocument(
      `<svg ${attrs} style="fill:red;width:9999px!important" onload="alert(1)"><rect width="100" height="100"/><script>alert(1)</script></svg>`,
      true,
      true,
    )!;
    expect(doc).toContain(`viewBox="${expected}"`);
    expect(doc).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(doc).toContain('width:100%!important;height:100%!important');
    expect(doc).toContain('fill:red');
    expect(doc).toContain("script-src 'none'");
    expect(doc).not.toMatch(/<script|onload|<iframe/);
  });
  it('rejects a non-SVG document in SVG mode', () => {
    expect(codePreviewDocument('<main>not SVG</main>', false, true)).toBeNull();
  });
  it('permits inline games only in an explicitly interactive document with network CSP intact', () => {
    const code =
      '<canvas id="board" width="300" height="300"></canvas><button onclick="score++">Play</button><script src="https://external.test/code.js">let score=0;document.querySelector("#board").getContext("2d").fillRect(1,2,3,4);</script>';
    const doc = codePreviewDocument(code, true);
    expect(doc).toContain(
      '&lt;canvas id=&quot;board&quot; width=&quot;300&quot; height=&quot;300&quot;&gt;&lt;/canvas&gt;',
    );
    expect(doc).toContain('onclick=&quot;score++&quot;');
    expect(doc).toContain('&lt;script&gt;let score=0;');
    expect(doc).not.toContain('src="https:');
    expect(doc).toContain("script-src 'unsafe-inline'");
    expect(doc).toContain("connect-src 'none'");
    expect(doc).toContain("frame-src 'none'");
    expect(doc).toContain("worker-src 'none'");
    expect(codePreviewDocument(code)).not.toContain('<script>');
  });
  it('keeps HTML layout and inline CSS without fetching or using a live DOM parser', () => {
    const doc = codePreviewDocument(
      '<!doctype html><style>.card{color:blue}</style><main class="card"><h1>Мастерская</h1></main>',
    );
    expect(doc).toContain('.card{color:blue}');
    expect(doc).toContain('<main class="card"><h1>Мастерская</h1></main>');
    expect(doc).toContain("default-src 'none'");
    expect(doc).toContain("form-action 'none'");
  });
  it('removes scripts, navigation, nested frames, event handlers and external resources', () => {
    const doc = codePreviewDocument(
      '<meta http-equiv="refresh" content="0;url=https://evil.test"><base href="https://evil.test"><script>alert(1)</script><iframe srcdoc="bad"></iframe><object data="bad"></object><img src="https://evil.test/pixel"><a href="javascript:alert(1)" onclick="alert(1)">safe text</a><form action="https://evil.test"><button formaction="https://evil.test">Go</button></form>',
    );
    expect(doc).not.toMatch(
      /evil\.test|<script|<iframe|<object|<img|onclick|formaction|javascript:/,
    );
    expect(doc).toContain('<a>safe text</a>');
    expect(doc).toContain('<form><button>Go</button></form>');
  });
  it('keeps SVG shapes and local references, removes foreignObject, animation and URLs', () => {
    const doc = codePreviewDocument(
      '<svg viewBox="0 0 100 100" onload="alert(1)"><defs><linearGradient id="paint"><stop offset="0" stop-color="blue"/></linearGradient><symbol id="shape"><circle r="4"/></symbol></defs><rect width="100" height="100" fill="url(#paint)"/><use href="#shape"/><use href="https://evil.test/a.svg#shape"/><foreignObject><div>bad</div></foreignObject><animate attributeName="href" to="bad"/></svg>',
    );
    expect(doc).toContain('viewBox="0 0 100 100"');
    expect(doc).toContain('<linearGradient');
    expect(doc).toContain('href="#shape"');
    expect(doc).not.toMatch(/foreignObject|onload|<animate|evil\.test/);
  });
  it('escapes decoded attributes and malformed mixed namespace content', () => {
    const doc = codePreviewDocument(
      '<svg><g title="&quot;&gt;&lt;img src=x onerror=alert(1)&gt;"></g></svg><math><mtext><script>alert(1)</script></mtext></math>',
    );
    expect(doc).not.toMatch(/<img|<script|<math/);
    expect(doc).toContain('&quot;&gt;&lt;img');
  });
  it('bounds oversized and deeply nested input', () => {
    expect(codePreviewDocument('x'.repeat(200_001))).toBeNull();
    expect(codePreviewDocument('<div>'.repeat(80) + 'x' + '</div>'.repeat(80))).toBeNull();
  });
});
