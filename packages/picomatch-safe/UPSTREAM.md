# ASA LAB — picomatch security replacement (Issue #1236)

This source is a local, **non-published** copy of upstream `micromatch/picomatch`
tag **4.0.7**, tree `6bb40679c218cefba5d4e9662408c5fdf699a8bb`.
Original copyright and MIT license are retained in `LICENSE`.

## Security change
The only upstream runtime modification is `lib/parse.js`.
- Disallow all caller-controlled `maxExtglobRecursion` relaxations, including false and positive numbers, for repeated extglobs; the default zero-depth safety bound is mandatory.
- Detect unescaped '*' wildcard inside **every** repeated extglob branch, not
  only multi-branch alternatives; retain upstream safe character-class rewrite
  for proven safe nested star sequences.
- Treat unsupported risky repeated extglobs as *literal*, using the existing
  upstream fail-closed `extglobClose` path.
- Reject nested unescaped parentheses and braces in repeated extglob branches;
  these can hide nested quantifiers or ambiguous alternatives.
- `unescape:true` can turn any nominally escaped character into a regex
  metacharacter. Repeated extglob branches with escapes now fail closed under
  that option, preventing hidden regex operators.
- In the default regex mode, an unescaped `+` inside a repeated extglob
  quantifies its preceding token and can create nested unbounded repetition.
  Such patterns fail closed. `regex:false` retains literal-plus semantics.
- Repetition over overlapping alternatives (e.g. `ab|abab`) or complex
  character-class alternatives (e.g. `[ab]|a`) can backtrack exponentially.
  Only demonstrably prefix-free, simple literal alternative branches are
  accepted; complex forms fail closed. When `nocase:true` or regex `i` flags
  apply, ASCII branches are lowercased before the prefix test, and non-ASCII
  alternatives fail closed because Unicode case folding may make distinct
  literals overlap. The existing upstream safe nested-star character-class
  rewrite is retained.
- Backslash-escaped '*' remains a literal; **all non-escaped stars** in repeated
  extglob branches are rejected, even inside bracket-looking text. This is
  intentional fail-closed behavior: unmatched '[' and `nobracket:true` make
  brackets literal to upstream's parser, so exempting these stars would leave
  CVE-2026-112366 exploitable. Rare valid character-class stars inside a
  repeated extglob may now be literalized instead of matched.

The package name/version `@asa-lab/picomatch-safe@1.0.0` identifies a real
local workspace package; **it is not presented as an upstream picomatch release**.

### Compatibility boundaries
All other upstream runtime files are byte-identical to the tag.
The public CommonJS/default export, POSIX export, scan/parse/makeRe/isMatch,
and fast-path call sites are preserved. A risky pattern can become literal
instead of a permissive match; this is an intentional security compatibility
boundary and must be reviewed. No server-facing glob from user input should
opt out of validation.

The root pnpm override must remove **all registry picomatch <=4.0.7
instances**, not merely avoid advisory output. Acceptance requires frozen
install, unit/browser Nx/Vite/Vitest compatibility, negative ReDoS tests in
resource-limited children, and a real unwaived `security:dependencies` PASS.

See [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
and Issue https://github.com/spikeal8-maker/asa-lab/issues/1236.
