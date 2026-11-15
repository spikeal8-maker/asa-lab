# Shared local Qwen profile

Owner request: maximum supported reasoning, a common120000-token context and no
fixed output-token or assistant-answer character cap. Weights, quantization,
cloud billing, identity, user-input admission and image generation are unchanged.

The Ollama transport sends `think: xhigh`, `num_ctx:120000`, `num_predict:-1`
and indefinite residency for `qwen3.8:27b`. Other models keep their existing
thinking mode. Local generation has a30-minute transport deadline; an incomplete
stream remains an explicit error with its partial answer preserved.

Migration0261 widens assistant answer storage to text, retaining the existing
user-message bound and all ownership checks. It extends the local admission lease
to exceed the local inference deadline. No previous migration is edited.

Acceptance: mock transport passes an answer above8192 characters intact; SQL
owner isolation, complete long-answer persistence and replay pass on an isolated
database. The code and migration must be deployed together through the canonical
updater. Copying configuration alone does not activate this behavior.

Runtime rollout: backup the current installation first; align Ollama's service
context, IZO and OpenCode with120000, then verify the active model, full GPU
placement, reasoning metadata and complete answers through each interface.
Do not claim ten simultaneous generations or unbounded physical context.

Rollback: stop new local admissions and restore the previous application release.
The additive widened text column can remain. Never truncate stored answers to
restore the former8192-character column. Configuration has its own backups.
