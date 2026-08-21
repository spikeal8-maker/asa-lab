import { readFileSync, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const web = resolve(root, 'apps', 'web');
const publicRoot = resolve(web, 'public');
const socialImage = (name) => `https://asa-lab.ru/social/${name}`;
const mainImage = socialImage('asa-lab-og.png');
const teacherImage = socialImage('asa-lab-for-teachers.png');

const pages = [
  { file: resolve(web, 'index.html'), url: 'https://asa-lab.ru/', image: mainImage },
  {
    file: resolve(publicRoot, 'features', 'index.html'),
    url: 'https://asa-lab.ru/features/',
    image: mainImage,
  },
  {
    file: resolve(publicRoot, 'for-teachers', 'index.html'),
    url: 'https://asa-lab.ru/for-teachers/',
    image: teacherImage,
  },
  {
    file: resolve(publicRoot, 'for-schools', 'index.html'),
    url: 'https://asa-lab.ru/for-schools/',
    image: teacherImage,
  },
  {
    file: resolve(publicRoot, 'safety', 'index.html'),
    url: 'https://asa-lab.ru/safety/',
    image: mainImage,
  },
  {
    file: resolve(publicRoot, 'about', 'index.html'),
    url: 'https://asa-lab.ru/about/',
    image: mainImage,
  },
  {
    file: resolve(publicRoot, 'faq', 'index.html'),
    url: 'https://asa-lab.ru/faq/',
    image: mainImage,
  },
  {
    file: resolve(publicRoot, 'features', 'block-programming', 'index.html'),
    url: 'https://asa-lab.ru/features/block-programming/',
    image: socialImage('asa-lab-block-programming.png'),
  },
  {
    file: resolve(publicRoot, 'features', 'drawing', 'index.html'),
    url: 'https://asa-lab.ru/features/drawing/',
    image: socialImage('asa-lab-drawing.png'),
  },
  {
    file: resolve(publicRoot, 'features', '3d-modeling', 'index.html'),
    url: 'https://asa-lab.ru/features/3d-modeling/',
    image: socialImage('asa-lab-3d-modeling.png'),
  },
  {
    file: resolve(publicRoot, 'features', 'electronics', 'index.html'),
    url: 'https://asa-lab.ru/features/electronics/',
    image: socialImage('asa-lab-electronics.png'),
  },
  {
    file: resolve(publicRoot, 'features', 'chess-and-checkers', 'index.html'),
    url: 'https://asa-lab.ru/features/chess-and-checkers/',
    image: socialImage('asa-lab-chess-checkers.png'),
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

function hasImageProperty(value, expectedImage) {
  if (Array.isArray(value)) return value.some((item) => hasImageProperty(item, expectedImage));
  if (!value || typeof value !== 'object') return false;
  if (value.image === expectedImage) return true;
  return Object.values(value).some((item) => hasImageProperty(item, expectedImage));
}

function pngChunkTypes(buffer) {
  const chunks = [];
  let offset = 8;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    chunks.push(buffer.toString('ascii', offset + 4, offset + 8));
    offset += 12 + length;
  }
  return chunks;
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
  const ogImage = capture(html, /<meta\s+property="og:image"\s+content="([^"]+)"\s*\/?\s*>/i);
  const ogImageWidth = capture(
    html,
    /<meta\s+property="og:image:width"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
  const ogImageHeight = capture(
    html,
    /<meta\s+property="og:image:height"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
  const ogImageType = capture(
    html,
    /<meta\s+property="og:image:type"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
  const ogImageAlt = capture(
    html,
    /<meta\s+property="og:image:alt"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
  const twitterCard = capture(html, /<meta\s+name="twitter:card"\s+content="([^"]+)"\s*\/?\s*>/i);
  const twitterImage = capture(html, /<meta\s+name="twitter:image"\s+content="([^"]+)"\s*\/?\s*>/i);
  const twitterImageAlt = capture(
    html,
    /<meta\s+name="twitter:image:alt"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
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
  expect(ogImage === page.image, `${page.url}: og:image is ${ogImage || 'missing'}`);
  expect(ogImageWidth === '1200', `${page.url}: og:image:width must be 1200`);
  expect(ogImageHeight === '630', `${page.url}: og:image:height must be 630`);
  expect(ogImageType === 'image/png', `${page.url}: og:image:type must be image/png`);
  expect(
    ogImageAlt.length >= 20 && ogImageAlt.length <= 180,
    `${page.url}: og:image:alt length ${ogImageAlt.length}`,
  );
  expect(twitterCard === 'summary_large_image', `${page.url}: Twitter card is not large`);
  expect(twitterImage === page.image, `${page.url}: twitter:image does not match og:image`);
  expect(twitterImageAlt === ogImageAlt, `${page.url}: Twitter and Open Graph alt text differ`);
  expect(robotsMeta.includes('index') && robotsMeta.includes('follow'), `${page.url}: robots meta`);
  expect(h1Count === 1, `${page.url}: expected one h1, found ${h1Count}`);
  expect(jsonLdBlocks.length > 0, `${page.url}: JSON-LD structured data is missing`);
  let structuredDataHasImage = false;
  for (const [index, jsonLd] of jsonLdBlocks.entries()) {
    try {
      const structuredData = JSON.parse(jsonLd);
      structuredDataHasImage ||= hasImageProperty(structuredData, page.image);
    } catch (error) {
      failures.push(`${page.url}: JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  }
  expect(structuredDataHasImage, `${page.url}: JSON-LD does not reference its social image`);
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

  const imagePath = resolve(publicRoot, new URL(page.image).pathname.slice(1));
  expect(existsSync(imagePath), `${page.url}: local social image is missing: ${imagePath}`);
  if (existsSync(imagePath)) {
    const imageBuffer = readFileSync(imagePath);
    const pngSignature = '89504e470d0a1a0a';
    expect(
      imageBuffer.subarray(0, 8).toString('hex') === pngSignature,
      `${page.url}: social image is not a valid PNG`,
    );
    if (imageBuffer.length >= 24) {
      expect(imageBuffer.readUInt32BE(16) === 1200, `${page.url}: PNG width is not 1200`);
      expect(imageBuffer.readUInt32BE(20) === 630, `${page.url}: PNG height is not 630`);
    }
    const bytes = statSync(imagePath).size;
    expect(bytes >= 100 * 1024, `${page.url}: social image is suspiciously small`);
    expect(bytes <= 1.5 * 1024 * 1024, `${page.url}: social image exceeds 1.5 MiB`);
    const metadataChunks = pngChunkTypes(imageBuffer).filter((type) =>
      ['eXIf', 'tEXt', 'zTXt', 'iTXt'].includes(type),
    );
    expect(
      metadataChunks.length === 0,
      `${page.url}: social image contains metadata chunks: ${metadataChunks.join(', ')}`,
    );
  }
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
