# AI layout quality — bounded UI verification

Owner request: finish and verify the existing ChatGPT-inspired conversation layout,
saved image/file presentation and expandable prompt before further integrations.
This report records evidence, not execution authority or installed-service state.

## Change

- Continue PR #749 on its existing c9b32f1 candidate; converge once with main
  7d0d24e1 without conflicts. Later unrelated main changes are not repeatedly merged.
- Saved images use visible-card-only authenticated byte reads with the selected
  Account/Seat scope, no-store, cancellation and object-URL cleanup. MIME and byte
  size must match the saved descriptor. A failed preview leaves an accessible file
  card and download action. Placeholder dimensions reserve the final image space.
- Saved files show their name, extension and size, without stretching to the
  height of adjacent images. Long names wrap on narrow screens.
- Long prompts can expand/collapse without losing text; the existing auto-growth,
  keyboard viewport limits, Enter/Shift+Enter, Stop and history behavior remain.
- Conversation text is 16px with distinct heading and paragraph spacing.
- Native Windows clipboard CRLF is normalized only in the cross-platform test
  comparison; the complete original Markdown is still compared.
- Surface Map includes the new attachment component. Specification now accurately
  distinguishes text-file input, local Ollama Vision and unsupported cloud images.

## POST_STEP_REVIEW

- CHANGE_CLASS: L1_UI_BEHAVIOR.
- INVARIANTS: AI-CONTENT-001, AI-HISTORY-001, AI-OWNER-001, AI-UI-SCOPE-001.
- LAYOUT_IMPACT: AI conversation only; selectors are scoped below asa-ai-layout.
  The saved-card component has one consumer, AiChatPage. No shared portal styles,
  provider adapter, API authorization, SQL or migration changes.
- VIEWPORTS: 1440/1024/390/320, saved cards in both explicit themes; expanded
  prompts, long names, Markdown headings/code/tables/math, denied image read,
  empty canvas, mobile keyboard and existing school/history regression suite.
- VISUAL_EVIDENCE: reports/playwright/ai-chat and
  reports/playwright/ai-layout-final; desktop and mobile screenshots inspected.
- TESTS: pnpm e2e:ai-chat — 141 passed; Web typecheck and build — PASS.
  Nx cache explicitly disabled with NX_SKIP_NX_CACHE=true and --skip-nx-cache:
  Web typecheck 6 tasks, Web build 6 tasks; API/identity preparation 16 tasks.
  Prettier and ESLint for changed TSX — PASS; git diff --check — PASS.
- LOCAL_UNIT_LIMITATION: after building dependencies, pnpm test:ai-chat reports
  856 passed, 8 skipped, 2 failed. Both failures assert POSIX file permissions
  on native Windows (0666 reported instead of 0600); the service mock consequently
  reports an unknown PUT outcome. Native cleanup also reports ENOTEMPTY after its
  assertion stops the test early. These assertions are preserved. Exact-SHA Linux
  CI is required; this local command is not reported as PASS.
- NEGATIVE_CHECKS: denied image read preserves the conversation and falls back
  to a card; external model images remain blocked by the existing renderer;
  previews use the existing owner-authorized endpoint and never a public URL.
- UNVERIFIED: live paid provider calls, deployed service, pixel identity with a
  changing external product. Browser tests use controlled API/model fixtures.
- VERDICT: local UI checks pass; Linux CI and any integration acceptance remain
  separate requirements. No release or owner acceptance is claimed.

## Remaining integrations

The owner clarified that Ollama means **ollama.com cloud with an API key**.
The existing local Ollama connection does not implement that provider. Cloud
Ollama requires its own server-side secret/provider and verification work.

Internet search must originate from the user's computer, per the owner request.
The current disabled search control does not implement this. It must not silently
be replaced by server-side browsing. PDF/DOCX extraction and cloud image input
also remain separate functional work. This UI slice does not claim them complete.

No main push/merge, deployment, Docker operation, backup, working database change,
paid provider call or deletion of owner data was performed.
