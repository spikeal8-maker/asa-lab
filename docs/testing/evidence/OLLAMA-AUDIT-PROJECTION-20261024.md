# Ollama audit diagnostic projection — 24 October 2026

Migration `0239_ai_ollama_local.sql` already appends the concrete audit action
`administration.ai_ollama.update` after an authorized settings update. The shared
closed diagnostic contract omitted that action, so both the Python collector
and API reader discarded its name. This is a projection defect, not evidence
that the settings transaction or Ollama provider failed.

The repair adds exactly that enum value to
`apps/api/src/database-diagnostic-contract.json`. The other actual AI audit
action, `administration.ai_configuration.update`, was already covered. No prefix
matching, new diagnostic fields, SQL write or settings behaviour is introduced.

A regression verifies safe action/result/version metadata survives while the
private URL, reason, credentials, identity/request IDs and nested payload do not.
Unknown AI action variants remain outside the allowlist. The existing migration
producer parity check is retained.

One local run of `tools.test_coverage_diagnostics` passed all **21 tests** in
14.977 seconds. No Scratch edits, installed-site update or live settings mutation
was performed. GitHub review and publication remain controller steps.
