# Ollama Cloud API-key connection — bounded implementation evidence

Owner request: cloud Ollama through an API key, and sign-in if supported, without
publishing to main while another executor is working there. This report is
evidence, not execution authority or installed-service state.

## Implemented contract

- Separate ollama-cloud provider beside local Ollama, OpenAI and DeepSeek.
- Closed server/SQL model list: gemma4:31b, gpt-oss:120b, gpt-oss:20b. Official
  names verified at https://ollama.com/api/tags on 2026-10-25.
- Server-only HTTPS endpoint https://ollama.com/v1/chat/completions; Bearer
  credentials, no redirects or browser-selected cloud endpoint. JSON and SSE
  share the existing bounded request policy, terminal checks and safe errors.
- Existing encrypted per-provider settings and optimistic revisions are reused.
  The additive migration inserts an empty disabled cloud slot and extends the
  closed guards. It does not modify existing keys/history, tenant/RLS policy,
  quota ledgers or encryption format. Clearing the new slot preserves old keys.
- Paid admission, owner isolation, Stop/replay and immutable usage recording
  remain the existing mechanisms. Cloud usage comes from reported completion
  tokens; local Ollama usage retains its native token fields.
- The admin gets a separate cloud card, password input, bounded model selector,
  saved-key indication and one explicitly consented potentially paid connection
  test. Opening or editing the form does not invoke generation.
- Sign-in opens https://ollama.com/settings/keys on the official site to create
  a key. No public third-party OAuth contract was found in the official auth/cloud
  documentation/index; the link is not represented as an ASA OAuth grant.
- Text input only in this slice; upstream Vision metadata does not enable an
  ASA cloud attachment adapter. No automatic model downloading or local-server
  installation is added.

## POST_STEP_REVIEW / CHALLENGE_REVIEW scope

CHANGE_CLASS: L3_CRITICAL. Invariants: AI-CLOUD-CREDENTIAL-001, AI-OWNER-001,
AI-REPLAY-001, AI-USAGE-001. Surface Map and test catalog include the provider
transport, SQL guard, UI and real-PostgreSQL regression paths.

Local focused Vitest: 106 PASS, including the migration/credential/JSON/SSE/replay
and foreign-owner checks on isolated PGlite, catalog parity, safe transport and
old admin behavior. Provider configuration browser suite: 27 PASS; cloud setup
also checked at 1440/1024/390/320. Screenshots under reports/playwright/ollama-cloud*.
API/Web TypeScript, API/identity/Web builds, ESLint, Prettier, contracts and diff
checks executed separately. Builds use NX_SKIP_NX_CACHE=true and --skip-nx-cache.

The full Windows AI-unit attempt encountered the existing POSIX mode assertions
in native attachment tests (0666 versus 0600), plus an initial timeout in the new
isolated migration test under parallel load. The latter now has the same 30s
budget as neighboring migration cases and passes; security assertions are intact.
The full Windows browser attempt encountered native clipboard CRLF in an unchanged
chat test and an old two-provider-only fixture assertion; that fixture now asserts
the old keys separately and the new empty slot explicitly. The complete provider
browser suite passes after correction. Linux exact-SHA CI is authoritative for
the full suite and real PostgreSQL; local subsets are not called repository PASS.

Rollout requires the new migration plus matching API/Web. New Web accepts the
old two-provider DTO and the expanded three-provider DTO; old Web may reject the
expanded admin DTO safely. Old API workers must not be used for a selected cloud
provider. No automatic production configuration or enablement occurs.

Unverified locally: real PostgreSQL (added to its existing CI suite), real paid
Ollama inference, owner API key, installed service and any third-party OAuth grant.
Independent exact-SHA critical review and CI conclusions belong in the final
handoff. No release/owner acceptance is claimed.

No main push/merge, live DB migration, Docker action, backup, paid external request
or protected owner-asset operation was performed. PR #749 remains separate.

Sources: https://docs.ollama.com/api/authentication,
https://docs.ollama.com/cloud, https://docs.ollama.com/api/openai-compatibility,
https://docs.ollama.com/llms.txt.
