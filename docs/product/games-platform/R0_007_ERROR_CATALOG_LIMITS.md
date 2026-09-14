# GP-R0-007 — Error Catalog and API Limits

**Parent:** `R0_007_ERROR_IDEMPOTENCY.md`  
**Issue:** #241

## Error envelope

Games HTTP APIs use one shape:

```json
{
  "error": {
    "code": "VERSION_CONFLICT",
    "message": "match version conflict",
    "requestId": "opaque-trace-id",
    "details": { "currentVersion": 12 }
  }
}
```

`message` is human-readable and non-normative. Clients branch on `code`.

`details` is optional and code-specific. It may contain only authorized/public-safe values. Never return stack traces, SQL, tenant ids, raw account/principal/learner ids or internal implementation details.

## Required V1 codes

| Code | HTTP | Meaning |
| --- | ---: | --- |
| `UNAUTHORIZED` | 401 | no valid authenticated ASA subject |
| `FORBIDDEN` | 403 | authenticated but action/read denied |
| `NOT_FOUND` | 404 | absent or intentionally undisclosed resource |
| `VALIDATION_FAILED` | 400 | malformed or unsupported request |
| `IDEMPOTENCY_CONFLICT` | 409 | command id reused for another semantic command |
| `VERSION_CONFLICT` | 409 | stale optimistic version |
| `STATE_CONFLICT` | 409 | action invalid in current non-terminal state |
| `MATCH_FINISHED` | 409 | terminal match cannot be mutated |
| `INVITE_EXPIRED` | 410 | admission reference expired |
| `GAME_COMMAND_REJECTED` | 422 | game rules reject a structurally valid command |
| `ADMISSION_DISABLED` | 409 | new admission disabled by platform state/policy |
| `RATE_LIMITED` | 429 | server rate policy exceeded |

`RATE_LIMITED` includes standard `Retry-After` when known.

Game-specific rejections may include a namespaced reason inside `details`, but cannot redefine transport semantics.

## Server-enforced R1–R4 limits

Conservative defaults:

- mutation JSON body: **64 KiB max**;
- `Idempotency-Key`: **128 characters max**;
- history/list page: default **25**, max **100**, opaque cursor;
- event/reconnect page: default **100**, max **250**, sequence/cursor based;
- admission mutations: **30/minute per actor**;
- active match commands: **120/minute per actor per match**;
- authenticated read/reconnect/history: **300/minute per actor**.

IP/device abuse controls may apply in addition. Safety/operations policy may lower these defaults without changing the protocol. Clients cannot raise them.

Large game state must not be tunneled through generic mutation bodies to evade the payload limit; game-owned snapshot/state protocols remain separate.

## Conflict details

For `VERSION_CONFLICT`, `details.currentVersion` may be returned only when the actor is authorized to read the resource. Otherwise use the same privacy-preserving error policy as ordinary unauthorized/not-found access.

Pagination never accepts an unbounded `limit`.
