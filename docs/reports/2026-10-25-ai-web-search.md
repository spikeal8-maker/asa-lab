# Free server internet search — implementation checkpoint

Source-only candidate. No deployment, paid search requests or search subscriptions.

Backend: internal SearxNG JSON web/image results; optional MET Norway forecasts and bounded manual Nominatim city resolution. Immutable Account/Seat authorization precedes retrieval. PostgreSQL receipts bind mode/city to request UUID; replay and regeneration preserve sources without another lookup. Proxy accepts only persisted closed-CDN thumbnails with raster validation and global eight-fetch cap. Forecast cache obeys Expires/304; geocoder admission is shared across instances, one in flight and one second after completion, 60 new cities/hour. Matching migration0253 is required before new API.

Local evidence: provider30 tests PASS; history15 PASS; new PGlite10 PASS; Seat guard61 PASS; abuse42 PASS. Fresh API typecheck17 tasks executed without Nx cache PASS. Real PostgreSQL concurrency suite authored, NOT_RUN locally (TEST_DATABASE_URL absent); CI must run it. Other executors report frontend141 unit, legacy147 browser/new15 browser PASS; deployment110 tests (5 platform skips), static syntax/compose checks PASS. These source checks do not prove a deployed SearxNG instance.

Controller read-only free-upstream operation887934946e574ffaad58e9e30e4f526c at2026-10-25T20:04:47Z: TLS MET Norway/Nominatim/Bing/DuckDuckGo verified. One MET compact request returned200/92 forecast points, updated19:17:17Z and Expires20:15:50Z. One manual Moscow geocoding request returned200/three candidates, proving that explicit ambiguity handling is necessary. Public repository contact verified. This is upstream reachability evidence, not end-to-end SearxNG proof or a guarantee for every Russian network.

No API keys are used for search or forecasts. Existing model credentials remain outside this change. Nominatim is limited to moderate manual city requests, with identifying User-Agent, attribution, shared cache and replaceable trusted deployment endpoint. Primary policies and provider references are linked in the AI specification.
