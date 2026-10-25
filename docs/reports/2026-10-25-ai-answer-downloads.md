# AI answer downloads and white resizable history

Bounded owner request: visible answer actions, native local file downloads in
popular formats, and a white history panel with a draggable divider. This is an
evidence report, not execution authority or a deployment record.

## User behavior

- Saved assistant answers show Copy, Retry and Download Answer. Retry continues
  to use the existing explicit paid, source-bound generation path.
- Code blocks download their literal code with a closed language-to-extension
  mapping; complete HTML downloads as index.html. Unknown or malicious language
  labels fall back to TXT. Incomplete streaming code cannot be downloaded.
- Whole answers export locally as genuine PDF, DOCX, Markdown or TXT. Headings,
  lists, tables and literal code are retained in document exports; mathematical
  source is not converted into native document equations. These are document
  exports rather than exact copies of the browser appearance.
- No answer text is sent to an external converter. HTML/SVG downloads never
  insert executable content into the portal. PDF fonts are bundled, not loaded
  from remote font URLs. PDF/DOCX libraries load only when export is requested.
- The cloud/local shared system instruction asks for fenced files and complete
  self-contained HTML when a user requests a one-file browser app. Downloading
  saves the model's code; it does not invent or assemble missing application files.
- Light-theme history is white with its existing 1px divider. Desktop resizing
  supports pointer capture, cancellation, Left/Right and Home/End, clamps to
  240–420px, and remembers the preference locally. Mobile keeps the modal drawer.

## POST_STEP_REVIEW

- CHANGE_CLASS: L1_UI_BEHAVIOR. No API/SQL/Auth/permission/storage mutation changes.
- INVARIANTS: AI-CONTENT-001, AI-HISTORY-001, AI-VARIANT-001, AI-UI-SCOPE-001.
- LAYOUT_IMPACT: AiMessageContent code headers, AiChatPage answer actions and
  history, and the new AiAnswerDownloads consumer. CSS remains scoped to the AI
  workspace. Surface Map and the product specification include the new behavior.
- VIEWPORTS: 1440/1024/390/320; empty/history, saved files, long code and tables,
  download options, both themes, school scope, pending/disabled/error and retry.
- VISUAL_EVIDENCE: reports/playwright/ai-chat, reports/playwright/ai-exports,
  reports/playwright/ai-resizer. Export controls inspected at desktop and 320px;
  the actual downloaded PDF was rendered with Poppler and visually inspected
  for Cyrillic text, heading, code wrapping and table. DOCX ZIP/XML contains the
  expected Cyrillic content. HTML bytes match the source exactly.
- NEGATIVE_CHECKS: no extra provider operation while downloading; malicious or
  unknown language labels cannot choose a path/extension; raw HTML remains code;
  downloads are disabled during streaming; existing retry/draft isolation tests
  remain. The old broad summary locator now explicitly selects the source-question
  disclosure, because Download Answer adds another legitimate disclosure.
- TESTS: focused unit tests for filename mapping, renderer and chat service —
  45 PASS; Web TypeScript — PASS; Web build (6 fresh Nx tasks) and API/identity
  build (16 fresh Nx tasks) with NX_SKIP_NX_CACHE=true and --skip-nx-cache — PASS;
  bundle budget, Prettier, ESLint and diff check — PASS. Full browser and exact-SHA
  remote conclusions are reported in the PR and final handoff.
- DEPENDENCIES: pinned pdfmake 0.3.13, docx 9.14.0, unified 11.0.5,
  remark-parse 11.0.0, and @types/pdfmake 0.3.3. Dependency/license gate PASS:
  no high/critical advisory; the existing moderate/low advisories remain reported.
- UNVERIFIED: live paid generation and the installed service. UI/model fixtures
  test export transport and behavior, not the quality of a live generated game.
- VERDICT: local focused verification passes; full browser and exact-SHA CI are
  required before any integration claim. No owner acceptance or release claimed.

One convergence with origin/main preceded package/lockfile edits. Unrelated
dirty worktrees concern Electronics/Classroom workflows; those paths are not
modified. No main push/merge, Docker, deployment, working database, backup,
paid provider call or protected owner-asset operation was performed.
