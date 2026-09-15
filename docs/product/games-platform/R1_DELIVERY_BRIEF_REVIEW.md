# ASA Games R1 — Delivery Brief Review

**Status:** PASS / accepted for R1 implementation  
**Issue:** #250  
**Owner authorization:** 2026-09-15, continue into R1A  
**R1A implementation issue:** #258

## Review result

The R1 Delivery Brief remains bounded to one user-visible path: two authenticated ASA users complete one private online Russian Checkers match through invite, authoritative play, reconnect, finish and history.

The owner explicitly authorized continuing from the accepted brief into implementation. R1A is therefore active under Issue #258.

## Confirmed constraints

- no Quick Match, rating/stats, Chess convergence, classmates/social, Arena, Creator or tournaments in R1A;
- no Redis, broker, dedicated realtime service or second database;
- no second Checkers rules engine;
- `GameUpdateDeliveryPort` keeps transport replaceable; full realtime gateway remains R6;
- canonical Match participants/teams and command idempotency consume accepted R0 decisions;
- existing Checkers bot/local/classroom behavior remains protected;
- `CheckersModuleExperience.tsx` and `checkers.css` may not receive a new online responsibility.

## R1A decomposition

R1A is executed in two bounded implementation slices:

1. **R1A1 — hygiene + generic contracts**: read-only Games hygiene command, `contexts/games` Match/Participant/Team contracts, command envelope/fingerprint, repository ports and focused tests.
2. **R1A2 — PostgreSQL foundation**: additive `games` schema, forced-RLS platform tables and focused persistence/security tests. Migration number is selected from current `main` immediately before writing.

This decomposition does not widen R1; it prevents schema work from being coupled to unverified workspace integration.

## Gate

Proceed with R1A only. Stop before R1B invitation behavior until R1A focused tests, hygiene and exact-head governance/code checks are green.
