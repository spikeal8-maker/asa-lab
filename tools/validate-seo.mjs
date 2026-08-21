import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps', 'web');
const publicRoot = resolve(web, 'public');

const pages = [
  { file: resolve(web, 'index.html'), url: 'https://asa-lab.ru/' },
  { file: resolve(publicRoot, 'features', 'index.html'), url: 'https://asa-lab.ru/features/' },
  {
    file: resolve(publicRoot, 'for-teachers', 'index.html'),
    url: 'https://asa-lab.ru/for-teachers/',
  },
  {
    file: resolve(publicRoot, 'for-schools', 'index.html'),
    url: 'https://asa-lab.ru/for-schools/',
  },
  {
    file: resolve(publicRoot, 'safety', 'index.html'),
    url: 'https://asa-lab.ru/safety/',
  },
  {
    file: resolve(publicRoot, 'about', 'index.html'),
    url: 'https://asa-lab.ru/about/',
  },
  {
    file: resolve(publicRoot, 'faq', 'index.html'),
    url: 'https://asa-lab.ru/faq/',
  },
  {
    file: resolve(publicRoot, 'features', 'block-programming', 'index.html'),
    url: 'https://asa-lab.ru/features/block-programming/',
  },
  {
    file: resolve(publicRoot, 'features', 'drawing', 'index.html'),
    url: 'https://asa-lab.ru/features/drawing/',
  },
  {
    file: resolve(publicRoot, 'features', '3d-modeling', 'index.html'),
    url: 'https://asa-lab.ru/features/3d-modeling/',
  },
  {
    file: resolve(publicRoot, 'features', 'electronics', 'index.html'),
    url: 'https://asa-lab.ru/features/electronics/',
  },
  {
    file: resolve(publicRoot, 'features', 'chess-and-checkers', 'index.html'),
    url: 'https://asa-lab.ru/features/chess-and-checkers/',
  },
];

const failures = [];
const titles = new Set();
const descriptions = new Set();

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function capture(html, expression) {
  return expression.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function captures(html, expression) {
  return [...html.matchAll(expression)].map((match) => match[1]?.trim() ?? '');
}

for (const page of pages) {
  expect(existsSync(page.file), `missing SEO page: ${page.file}`);
  if (!existsSync(page.file)) continue;

  const html = readFileSync(page.file, 'utf8');
  const title = capture(html, /<title>([^<]+)<\/title>/i);
  const description = capture(html, /<meta\s+name="description"\s+content="([^"]+)"\s*\/?\s*>/i);
  const canonical = capture(html, /<link\s+rel="canonical"\s+href="([^"]+)"\s*\/?\s*>/i);
  const robotsMeta = capture(html, /<meta\s+name="robots"\s+content="([^"]+)"\s*\/?\s*>/i);
  const ogUrl = capture(html, /<meta\s+property="og:url"\s+content="([^"]+)"\s*\/?\s*>/i);
  const h1Count = (html.match(/<h1(?:\s[^>]*)?>/gi) ?? []).length;
  const jsonLdBlocks = captures(
    html,
    /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
  );

  expect(html.includes('<html lang="ru">'), `${page.url}: html language must be ru`);
  expect(title.length >= 30 && title.length <= 90, `${page.url}: title length ${title.length}`);
  expect(
    description.length >= 110 && description.length <= 220,
    `${page.url}: description length ${description.length}`,
  );
  expect(canonical === page.url, `${page.url}: canonical is ${canonical || 'missing'}`);
  expect(ogUrl === page.url, `${page.url}: og:url is ${ogUrl || 'missing'}`);
  expect(robotsMeta.includes('index') && robotsMeta.includes('follow'), `${page.url}: robots meta`);
  expect(h1Count === 1, `${page.url}: expected one h1, found ${h1Count}`);
  expect(jsonLdBlocks.length > 0, `${page.url}: JSON-LD structured data is missing`);
  for (const [index, jsonLd] of jsonLdBlocks.entries()) {
    try {
      JSON.parse(jsonLd);
    } catch (error) {
      failures.push(`${page.url}: JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  }
  expect(
    html.includes('property="og:title"') && html.includes('property="og:description"'),
    `${page.url}: Open Graph title or description is missing`,
  );
  expect(!titles.has(title), `${page.url}: duplicate title`);
  expect(!descriptions.has(description), `${page.url}: duplicate description`);
  expect(
    html.includes('href="/seo.css"') && html.includes('href="/asa-lab-mark.svg"'),
    `${page.url}: shared public CSS or brand icon is missing`,
  );
  titles.add(title);
  descriptions.add(description);
}

const rootHtml = readFileSync(resolve(web, 'index.html'), 'utf8');
expect(rootHtml.includes('"@type": "Organization"'), 'root JSON-LD has no Organization entity');
expect(rootHtml.includes('"@type": "WebSite"'), 'root JSON-LD has no WebSite entity');
expect(
  rootHtml.includes('"@type": "SoftwareApplication"'),
  'root JSON-LD has no SoftwareApplication entity',
);
expect(
  rootHtml
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim().length > 1500,
  'root fallback content is too thin for a JavaScript-independent product description',
);

const sitemapPath = resolve(publicRoot, 'sitemap.xml');
const sitemap = readFileSync(sitemapPath, 'utf8');
for (const page of pages) {
  const occurrences = sitemap.split(`<loc>${page.url}</loc>`).length - 1;
  expect(occurrences === 1, `sitemap must contain ${page.url} exactly once, found ${occurrences}`);
}
expect(
  (sitemap.match(/<loc>/g) ?? []).length === pages.length,
  'sitemap and the validated public page inventory differ',
);
expect(
  (sitemap.match(/<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/g) ?? []).length === pages.length,
  'every sitemap URL must have an ISO lastmod date',
);

const robots = readFileSync(resolve(publicRoot, 'robots.txt'), 'utf8');
expect(robots.includes('Sitemap: https://asa-lab.ru/sitemap.xml'), 'robots.txt has no sitemap');
expect(robots.includes('User-agent: OAI-SearchBot'), 'robots.txt does not name OAI-SearchBot');
expect(robots.includes('User-agent: GPTBot\nDisallow: /'), 'robots.txt does not exclude training');
expect(robots.includes('ai-input=yes'), 'robots.txt does not allow AI reference input');
expect(robots.includes('ai-train=no'), 'robots.txt does not reserve model-training rights');

const llms = readFileSync(resolve(publicRoot, 'llms.txt'), 'utf8');
for (const page of pages.slice(1)) {
  expect(llms.includes(page.url), `llms.txt is missing ${page.url}`);
}

const caddy = readFileSync(resolve(root, 'docker', 'web', 'Caddyfile'), 'utf8');
expect(
  !caddy.includes('try_files {path} /index.html'),
  'Caddy still turns every unknown path into a soft 404',
);
expect(caddy.includes('handle /projects/*'), 'Caddy lost the canonical Electronics SPA route');

if (failures.length > 0) {
  console.error('ASA Lab SEO validation: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`ASA Lab SEO validation: PASS (${pages.length} public pages)`);
}
