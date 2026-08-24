# ASA Lab Electronics component database

This directory is the only runtime source of Electronics component artwork.

- `catalog.json` is the authoritative catalog, model and geometry index.
- `components/` contains byte-exact owner SVGs grouped by component family.
- `owner-imports.json` records direct owner uploads and their SHA-256 hashes.

Runtime raster artwork is prohibited. PNG, JPEG, WebP, GIF, embedded images,
external image references, scripts and generated replacement artwork fail the
electronics asset gates.

The legacy `owner-audit/`, `owner-supplied/`, `owner-approved/` and
`owner-catalog/` directories are provenance evidence, not runtime sources.
