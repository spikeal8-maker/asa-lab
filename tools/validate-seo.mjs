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
    creatableRoute: false,
  },
  {
    file: resolve(publicRoot, 'features', 'drawing', 'index.html'),
    url: 'https://asa-lab.ru/features/drawing/',
    image: socialImage('asa-lab-drawing.png'),
    creatableRoute: false,
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
const warnings = [];
const titles = new Set();
const descriptions = new Set();

function expect(condition, message) {
  if (!condition) failures.push(message);
}

function advise(condition, message) {
  if (!condition) warnings.push(message);
}

function capture(html, expression) {
  return expression.exec(html)?.[1]?.replace(/\s+/g, ' ').trim() ?? '';
}

function captures(html, expression) {
  return [...html.matchAll(expression)].map((match) => match[1]?.trim() ?? '');
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
  const ogTitle = capture(html, /<meta\s+property="og:title"\s+content="([^"]+)"\s*\/?\s*>/i);
  const ogDescription = capture(
    html,
    /<meta\s+property="og:description"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
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
  const twitterTitle = capture(html, /<meta\s+name="twitter:title"\s+content="([^"]+)"\s*\/?\s*>/i);
  const twitterDescription = capture(
    html,
    /<meta\s+name="twitter:description"\s+content="([^"]+)"\s*\/?\s*>/i,
  );
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
  expect(title.length > 0, `${page.url}: title is missing`);
  advise(
    title.length >= 30 && title.length <= 90,
    `${page.url}: review title length ${title.length}`,
  );
  expect(description.length > 0, `${page.url}: meta description is missing`);
  advise(
    description.length >= 110 && description.length <= 220,
    `${page.url}: review description length ${description.length}`,
  );
  expect(canonical === page.url, `${page.url}: canonical is ${canonical || 'missing'}`);
  expect(ogTitle.length > 0, `${page.url}: og:title is missing`);
  expect(ogDescription.length > 0, `${page.url}: og:description is missing`);
  expect(ogUrl === page.url, `${page.url}: og:url is ${ogUrl || 'missing'}`);
  expect(ogImage === page.image, `${page.url}: og:image is ${ogImage || 'missing'}`);
  expect(/^\d+$/.test(ogImageWidth), `${page.url}: og:image:width is missing or invalid`);
  expect(/^\d+$/.test(ogImageHeight), `${page.url}: og:image:height is missing or invalid`);
  expect(ogImageType === 'image/png', `${page.url}: og:image:type must be image/png`);
  expect(ogImageAlt.length > 0, `${page.url}: og:image:alt is missing`);
  advise(
    ogImageAlt.length >= 20 && ogImageAlt.length <= 180,
    `${page.url}: review og:image:alt length ${ogImageAlt.length}`,
  );
  expect(twitterCard === 'summary_large_image', `${page.url}: Twitter card is not large`);
  expect(twitterTitle.length > 0, `${page.url}: twitter:title is missing`);
  expect(twitterDescription.length > 0, `${page.url}: twitter:description is missing`);
  expect(twitterImage === page.image, `${page.url}: twitter:image does not match og:image`);
  expect(twitterImageAlt === ogImageAlt, `${page.url}: Twitter and Open Graph alt text differ`);
  expect(robotsMeta.includes('index') && robotsMeta.includes('follow'), `${page.url}: robots meta`);
  expect(h1Count > 0, `${page.url}: main h1 is missing`);
  advise(h1Count === 1, `${page.url}: review h1 count ${h1Count}`);
  expect(/<main(?:\s|>)/i.test(html), `${page.url}: semantic main content is missing`);
  expect(/<a\s+[^>]*href="[^"]+"/i.test(html), `${page.url}: crawlable links are missing`);
  expect(jsonLdBlocks.length > 0, `${page.url}: JSON-LD structured data is missing`);
  for (const [index, jsonLd] of jsonLdBlocks.entries()) {
    try {
      JSON.parse(jsonLd);
    } catch (error) {
      failures.push(`${page.url}: JSON-LD block ${index + 1} is invalid: ${error.message}`);
    }
  }
  expect(!titles.has(title), `${page.url}: duplicate title`);
  expect(!descriptions.has(description), `${page.url}: duplicate description`);
  expect(
    html.includes('href="/seo.css"') && html.includes('href="/asa-lab-mark.svg"'),
    `${page.url}: shared public CSS or brand icon is missing`,
  );
  if (page.creatableRoute === false) {
    expect(
      !/>\s*(?:Открыть|Начать|Создать)(?:\s+[^<]*)?\s*</i.test(html),
      `${page.url}: page without a creatable route must not show a false open/start/create CTA`,
    );
  }
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
      const width = imageBuffer.readUInt32BE(16);
      const height = imageBuffer.readUInt32BE(20);
      expect(String(width) === ogImageWidth, `${page.url}: og:image:width differs from the PNG`);
      expect(String(height) === ogImageHeight, `${page.url}: og:image:height differs from the PNG`);
      advise(width === 1200 && height === 630, `${page.url}: recommended social size is 1200x630`);
    }
    const bytes = statSync(imagePath).size;
    advise(bytes >= 100 * 1024, `${page.url}: review unusually small social image`);
    advise(bytes <= 1.5 * 1024 * 1024, `${page.url}: review social image over 1.5 MiB`);
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
const publicEntrySource = readFileSync(resolve(web, 'src', 'pages', 'PublicEntryPage.tsx'), 'utf8');
const readme = readFileSync(resolve(root, 'README.md'), 'utf8');
const globalPages = pages.filter(
  (page) => !page.url.endsWith('/for-teachers/') && !page.url.endsWith('/for-schools/'),
);
const schoolOnlyPositioning = /(?:STEM[- ]лаборатори\w*|цифров\w+\s+лаборатори\w*)\s+для\s+школ/i;
const unavailableCopy = /в\s+разработке|будущ\w*\s+сред\w*|планиру\w*|скоро|развива\w*\s+сред/i;
for (const page of globalPages) {
  const html = readFileSync(page.file, 'utf8');
  const title = capture(html, /<title>([^<]+)<\/title>/i);
  const ogTitle = capture(html, /<meta\s+property="og:title"\s+content="([^"]+)"\s*\/?\s*>/i);
  const h1 = capture(html, /<h1(?:\s[^>]*)?>([\s\S]*?)<\/h1>/i);
  expect(
    !schoolOnlyPositioning.test(`${title} ${ogTitle} ${h1}`),
    `${page.url}: global title, Open Graph title or H1 has school-only positioning`,
  );
}
for (const page of pages.filter((item) => item.creatableRoute === false)) {
  const html = readFileSync(page.file, 'utf8');
  expect(
    !unavailableCopy.test(html),
    `${page.url}: module is described as future or in development`,
  );
}
expect(
  !schoolOnlyPositioning.test(publicEntrySource) && !schoolOnlyPositioning.test(readme),
  'public entry UI or README still defines ASA Lab as a school-only product',
);
expect(
  !unavailableCopy.test(publicEntrySource),
  'public entry UI still describes a module as future or in development',
);
const capabilitySection = publicEntrySource
  .split('id="capabilities"')[1]
  ?.split('id="teachers"')[0];
expect(
  capabilitySection?.indexOf('Блочное программирование') <
    capabilitySection?.indexOf('Классы и задания'),
  'public entry capability cards must put project tools before classes and assignments',
);
expect(rootHtml.includes('"@type": "Organization"'), 'root JSON-LD has no Organization entity');
expect(rootHtml.includes('"@type": "WebSite"'), 'root JSON-LD has no WebSite entity');
expect(
  rootHtml.includes('"@type": "SoftwareApplication"'),
  'root JSON-LD has no SoftwareApplication entity',
);
const rootJsonLd = captures(
  rootHtml,
  /<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/gi,
).map((block) => JSON.parse(block));
const rootGraph = rootJsonLd.flatMap((entry) => entry['@graph'] ?? [entry]);
const rootApplication = rootGraph.find((entry) => entry['@type'] === 'SoftwareApplication');
expect(rootApplication, 'root JSON-LD SoftwareApplication entity cannot be parsed');
expect(
  !rootApplication?.audience,
  'root JSON-LD must not narrow the product to an educational audience',
);
expect(
  rootApplication?.applicationCategory !== 'EducationalApplication',
  'root JSON-LD applicationCategory still defines ASA Lab only as educational software',
);
const featureList = rootApplication?.featureList ?? [];
expect(
  featureList.includes('Блочное программирование') && featureList.includes('Рисование и черчение'),
  'root JSON-LD omits block programming or drawing and drafting',
);
expect(
  featureList.at(-1)?.includes('Классы и задания'),
  'root JSON-LD must list classes and assignments after the core tools',
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
for (const value of captures(sitemap, /<lastmod>([^<]+)<\/lastmod>/g)) {
  expect(/^\d{4}-\d{2}-\d{2}$/.test(value), `sitemap lastmod is not an ISO date: ${value}`);
  expect(
    value <= new Date().toISOString().slice(0, 10),
    `sitemap lastmod is in the future: ${value}`,
  );
}

const robots = readFileSync(resolve(publicRoot, 'robots.txt'), 'utf8');
expect(robots.includes('Sitemap: https://asa-lab.ru/sitemap.xml'), 'robots.txt has no sitemap');
const defaultRobotsGroup = robots.split(/User-agent:\s*OAI-SearchBot/i)[0];
expect(
  !defaultRobotsGroup.includes('Disallow: /projects/') &&
    !defaultRobotsGroup.includes('Disallow: /max-login'),
  'default crawler group blocks application routes before it can observe X-Robots-Tag noindex',
);
expect(robots.includes('User-agent: OAI-SearchBot'), 'robots.txt does not name OAI-SearchBot');
expect(robots.includes('User-agent: GPTBot\nDisallow: /'), 'robots.txt does not exclude training');
expect(robots.includes('ai-input=yes'), 'robots.txt does not allow AI reference input');
expect(robots.includes('ai-train=no'), 'robots.txt does not reserve model-training rights');

const llms = readFileSync(resolve(publicRoot, 'llms.txt'), 'utf8');
for (const page of pages.slice(1)) {
  expect(llms.includes(page.url), `llms.txt is missing ${page.url}`);
}
expect(!schoolOnlyPositioning.test(llms), 'llms.txt defines ASA Lab as a school-only product');
expect(!unavailableCopy.test(llms), 'llms.txt describes a module as future or in development');
expect(
  /personal projects|creating personal projects/i.test(llms) &&
    /classes and assignments are an optional way/i.test(llms),
  'llms.txt does not make personal projects primary and classes secondary',
);

const caddy = readFileSync(resolve(root, 'docker', 'web', 'Caddyfile'), 'utf8');
expect(
  !caddy.includes('try_files {path} /index.html'),
  'Caddy still turns every unknown path into a soft 404',
);
expect(
  caddy.includes('@spa path /projects/* /max-login /max-login/'),
  'Caddy lost a canonical SPA route',
);
expect(
  caddy.includes('header X-Robots-Tag "noindex, nofollow"'),
  'Caddy application routes are missing X-Robots-Tag noindex',
);

const appFactory = readFileSync(resolve(root, 'apps', 'api', 'src', 'app.factory.ts'), 'utf8');
expect(
  appFactory.includes('if (!shouldServeSpaDocument(path))') &&
    appFactory.includes("reply.code(404).send({ error: { code: 'not_found'"),
  'Fastify production fallback still risks soft-404 responses',
);
expect(
  appFactory.includes("reply.header('X-Robots-Tag', 'noindex, nofollow')"),
  'Fastify application routes are missing X-Robots-Tag noindex',
);

for (const warning of warnings) console.warn(`SEO advisory: ${warning}`);

if (failures.length > 0) {
  console.error('ASA Lab SEO validation: FAIL');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    `ASA Lab SEO validation: PASS (${pages.length} public pages; ${warnings.length} advisory warning(s))`,
  );
}
