# Web document CSP rollout

The production HTML entry is served by `docker/web/Caddyfile`. The API's
`app.factory.ts` security hook does not cover those static responses. A CSP on
`/health/ready` therefore does not prove that the browser document has a policy.

The web ingress now enforces `base-uri 'self'`, `object-src 'none'`,
`frame-ancestors 'none'` and `form-action 'self'` on its portal responses. The
matcher excludes `/api/*`, `/health/*` and `/internal/blocks/*`: the API keeps its
own stronger policy and the embedded editor keeps its same-origin frame policy.
No installation domains, discovered addresses or wildcard mutation origins are
introduced.

The broader resource policy is **report-only**. Its script restriction is not
enforced yet. ASA intentionally supports sandboxed interactive `srcdoc` games,
Monaco/blob workers and a browser-side WASM toolchain. Copying the API policy to
the parent document would also constrain those child documents and can break
the educational runtime. The enforced baseline deliberately does not introduce
`script-src`, `default-src` or forced HTTPS resource upgrades on LAN HTTP entries.

Report-only violations are available in browser diagnostics; this change does
not create a reporting endpoint or send reports to a third-party service.
Before promoting resource restrictions to enforcement, qualify login, Scratch
save/reopen, electronics/Monaco/WASM and interactive AI previews in the exact
production build. This staged change must not be described as complete XSS
prevention or as browser acceptance of the whole application.

## Focused response test

Use the production-pinned Caddy **v2.10.2** binary from the official Caddy release
and verify its release checksum before use. No local Docker installation is
required:

```bash
CADDY_BIN=/path/to/caddy python3 tools/deployment/test_web_csp.py
```

The test starts disposable loopback-only Caddy and upstream fixtures, changing
only listener, fixture root and upstream addresses in the production config.
Four tests exercise real HTTP responses: portal root/index/SPA/public HTML,
report-only resource candidates, API/health policy preservation and the embedded
editor frame policy. A missing binary is reported as **SKIPPED**, never PASS.
The fixtures are not an installed ASA stack and do not prove actual user flows.

On 2 November 2026 the four tests passed on Windows using the official
`caddy_2.10.2_windows_amd64.zip`, SHA256
`9fd1ef9be5d9b05852b66ccc25f96f23d8651bcab20779861a745bdffa273722`.
No deployment or production container restart was performed by this slice.

## Self-review

- Change class: L3 security boundary; layout impact: none.
- Preserved: existing API/editor CSP, educational script execution, LAN HTTP,
  future approved entry origins and the deployment blocker on production update.
- Tested: pinned Caddy parsing and four real-response tests; no package or
  lockfile changes.
- Not verified: strict script-policy enforcement, full product browser journeys,
  exact-SHA production image/CI qualification and deployment.
- Rollback: revert this source change and rebuild through the guarded release
  process; do not edit generated server proxy files or bypass deployment gates.
