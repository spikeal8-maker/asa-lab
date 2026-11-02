# Printable access-card QR regression

The long-host print layout keeps the existing 97.5 × 27mm card, two columns,
20 cards per A4 page and full class/name/host labels. A long host gets a 27mm
right column and may wrap between characters. Its QR grows to 21mm, including
its four-module white quiet zone. The QR column uses 0.35mm of the card's existing
vertical padding on each side, staying inside the cut line. No text size or line
height is reduced. Print uses Arial with a sans-serif fallback; screen typography
is unchanged.

The previous long-host rule shrank the QR to 16mm. The independently retained
failure trace contained a 41-unit SVG (33 data modules plus quiet zone). At 16mm
it rasterizes to about 60.47 CSS pixels: the same square decoded at some pixel
phases and returned null after a half-pixel shift. Merely enlarging it in the
old 22mm column overflows the long host below the card.

Private offline verification of the final CSS reused the exact 31-card DOM and
the original text-zone and QR decoding functions. All 16 quarter-pixel phases
passed both independent and monochrome decoding; all 31 cards passed text-zone
and overflow checks before/after the phases, retaining pages of 20 and 11 cards.
The measured card remained 368.5 × 102.046875 CSS pixels, with zero overflow;
the long-host QR measured 79.359375 pixels (21mm, subject to CSS-unit rounding).
This is Windows Chromium140 / Playwright1.55.1 offline evidence, not the Linux
CI journey. A 20mm draft still failed one actual-card raster phase and was not
accepted as the fix.

The follow-up challenge used the actual final card position and all 256 x/y
phases on a 1/16-pixel grid. All 256 passed the same independent, quiet-zone and
monochrome checks without retries. This covers the recorded payload/layout;
larger QR matrices from other origin lengths and physical camera/print quality
are not established by this bounded raster proof.

The existing `owner classroom flow: one-click batch, exact retry and existing
Account approval` browser test preserves its original 31-card, 20+11 pagination,
Account/StudentCode, long-label, overflow, text-zone, independent jsQR, white
quiet-zone and monochrome assertions. It additionally decodes the rendered
long-host QR at all 16 quarter-pixel x/y phases and restores its original style.
There are no decoder, timeout, retry or acceptance exceptions.

Offline diagnosis used the exact privately retained SVG and reconstructed
31-card DOM from General41501758879. No credential payload, SVG, QR image or
trace belongs in this document or Git. Offline geometry/pixel checks are not
the real Account/API/browser acceptance: that remains the normal exact-source
Access A journey in GitHub General CI. No server deployment is implied.
