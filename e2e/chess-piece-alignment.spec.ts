import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

// Exercise the real renderer and shipped font without an API/database fixture.
// Raster bounds catch the baseline defect that square DOM bounds cannot detect.
test('all twelve chess symbols center their visible ink without clipping', async ({ page }) => {
  test.setTimeout(90_000);
  const localRequire = createRequire(`${process.cwd()}/package.json`);
  const { buildSync } = createRequire(localRequire.resolve('vite'))('esbuild');
  const bundle = buildSync({
    stdin: {
      contents: `import React from 'react';import{createRoot}from'react-dom/client';
        import{ChessBoard}from'./apps/web/src/chess/ChessBoard';
        import{parseFen,START_FEN}from'./contexts/chess/index';
        createRoot(document.getElementById('root')).render(React.createElement(ChessBoard,{
          position:parseFen(START_FEN).value,orientation:window.orientationFixture,
          selectedSquare:null,legalMoves:[],onSquare(){},onMove(){}}));`,
      resolveDir: process.cwd(),
      loader: 'tsx',
    },
    bundle: true,
    write: false,
    jsx: 'automatic',
    alias: { '@asa-lab/chess': `${process.cwd()}/contexts/chess/index.ts` },
  }).outputFiles[0].text;
  const css = readFileSync('apps/web/src/chess/chess.css', 'utf8');
  const font = readFileSync(
    'apps/web/public/assets/chess/fonts/noto-sans-symbols-2-v25-symbols.woff2',
  ).toString('base64');
  const measurements: object[] = [];
  for (const width of [1440, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const orientation of ['white', 'black'] as const) {
      await page.setContent(`<style>${css.replace('/assets/chess/fonts/noto-sans-symbols-2-v25-symbols.woff2', `data:font/woff2;base64,${font}`)}
        body{margin:8px}.asa-chess-board{width:min(100%,760px)}
        </style><div id="root"></div><script>window.orientationFixture=${JSON.stringify(orientation)};${bundle}</script>`);
      await page.getByTestId('asa-chess-board').waitFor();
      await page.evaluate(() => document.fonts.load('32px "ASA Chess Symbols"', '♔♟'));
      expect(
        await page.evaluate(() =>
          [...document.fonts].some(
            (face) => face.family === 'ASA Chess Symbols' && face.status === 'loaded',
          ),
        ),
      ).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.getByTestId('asa-chess-board').screenshot({
        path: test.info().outputPath(`board-${width}-${orientation}.png`),
      });
      // Isolate foreground ink for measurement; retain the untouched board above.
      await page.addStyleTag({
        content: `
        .asa-chess-coordinate{visibility:hidden}
        .asa-chess-piece-glyph{filter:none!important;text-shadow:none!important}
        .asa-chess-piece{text-shadow:none!important}
      `,
      });
      const seen = new Set<string>();
      for (const square of await page.locator('[data-piece]:not([data-piece="empty"])').all()) {
        const piece = (await square.getAttribute('data-piece'))!;
        if (seen.has(piece)) continue;
        seen.add(piece);
        const background = await square.evaluate((node) =>
          getComputedStyle(node).backgroundColor.match(/\d+/g)!.map(Number),
        );
        const png = PNG.sync.read(await square.screenshot());
        let left = png.width,
          right = -1,
          top = png.height,
          bottom = -1;
        // Fractional CSS cell edges can capture a pixel of the adjacent square.
        for (let y = 2; y < png.height - 2; y++) {
          for (let x = 2; x < png.width - 2; x++) {
            const offset = (y * png.width + x) * 4;
            if (background.some((channel, i) => Math.abs(png.data[offset + i]! - channel) > 45)) {
              left = Math.min(left, x);
              right = Math.max(right, x);
              top = Math.min(top, y);
              bottom = Math.max(bottom, y);
            }
          }
        }
        const context = `${width}/${orientation}/${piece}`;
        measurements.push({
          context,
          width: png.width,
          height: png.height,
          left,
          right,
          top,
          bottom,
        });
        expect(right, context).toBeGreaterThan(left);
        expect(Math.abs((left + right + 1) / 2 - png.width / 2), context).toBeLessThanOrEqual(1.5);
        expect(Math.abs((top + bottom + 1) / 2 - png.height / 2), context).toBeLessThanOrEqual(1.5);
        expect(
          Math.min(left, top, png.width - right - 1, png.height - bottom - 1),
          context,
        ).toBeGreaterThanOrEqual(3);
      }
      expect(seen.size).toBe(12);
    }
  }
  const metricsPath = test.info().outputPath('visible-ink-bounds.json');
  writeFileSync(metricsPath, JSON.stringify(measurements, null, 2));
  await test
    .info()
    .attach('visible-ink-bounds', { path: metricsPath, contentType: 'application/json' });
});
