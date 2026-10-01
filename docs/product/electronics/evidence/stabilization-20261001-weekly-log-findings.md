# Electronics stabilization — weekly log findings (25.09–01.10.2026)

Source: owner-provided archive `asa-lab-logs-20260925-20261001(1).zip`.
This repository file stores only aggregate findings. The original archive contains technical addresses/identifiers and MUST NOT be published.

## Proven observations

- ASA FRP `work connection pool is full, discarding`: **8,982** entries over the available week.
- Same FRP error during the reported classroom interval 2026-10-01 12:50–13:30 Moscow time: **1,264**.
- API response classes over available logs:
  - 2xx: **242,501**
  - 4xx: **1,323**
  - 5xx: **10**
- Frequent error paths include:
  - `/api/auth/refresh -> 401`: **34**
  - `/api/class-join/studentseat -> 401`: **53**
  - repeated `PUT /api/projects/<id>/draft -> 400`, plus isolated `409`.
- Browser-side student errors were not centrally collected.
- Electronics uses shared Web/API paths, so the server archive cannot reliably classify all Electronics requests.

## Interpretation boundary

The FRP pool saturation is proven to overlap the problematic lesson interval. It does **not** prove that every missing Electronics visual, authentication loss or failed save was caused by FRP.

The repeated 401 and draft errors are evidence for separate session/save investigations, not proof of one shared root cause.

## Required follow-up

Tracked by programme #452 and platform dependency #460:

1. isolated 15 Scratch + 15 Electronics load reproduction;
2. FRP pool/connection-limit analysis;
3. class-wide retry amplification measurement;
4. refresh/session lifecycle classification;
5. draft 400/409 module/root-cause classification;
6. audit of Electronics 3-second remote-project polling;
7. privacy-preserving browser observability for asset retry/final failure, simulation stop reason and save failure class.

Do not run load experiments against the live school service without separate owner authorization.
