# ASA LAB — picomatch security replacement (Issue #1236)

This source is a local, **non-published** copy of upstream `micromatch/picomatch`
tag **4.0.7**, tree `6bb40679c218cefba5d4e9662408c5fdf699a8bb`.
Original copyright and MIT license are retained in `LICENSE`.

## Security change
Upstream runtime modifications are confined to `lib/parse.js` and
`lib/picomatch.js`; the latter revalidates parse-state compilation. No audit
policy, dependency version or license waiver is part of this repair.
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
and fast-path call sites remain available. The following deliberately
conservative boundaries also apply:

- A pattern with more than one root repeated extglob, or a repeated extglob
  combined with an ordinary star or any other extglob outside it, is matched
  literally as a whole.
  This includes combinations in optional/negated groups and across path
  segments; it is not a proof that otherwise independent pieces are safe.
  The existing single-root flat-character-class rewrite is retained.
- Raw regex groups/assertions, raw postfix plus quantifiers after groups,
  braces or classes, and the explicit `regex:true` mode are literalized.
  Glob syntax is not an unrestricted regular-expression construction API.
- `compileRe`, including its raw-output mode, re-parses the original glob
  under the effective compilation options before constructing a regex.
  A private WeakMap preserves original input/options for live parse states;
  changing public `state.output` cannot inject unvalidated regex. Serialized
  states are re-parsed from `input`; callers must supply the original options
  when those options are needed after serialization. Caller-provided regex
  output without an original string input is rejected.
- The low-level `toRegex` function and caller-supplied `RegExp` arguments,
  `prepend` fragments and `expandRange` callbacks remain trusted-code APIs.
  They are not safe entry points for untrusted raw regular expressions and
  are outside the glob-pattern security claim.
- Every adversarial regression, including parse/compile and state APIs,
  executes in a child with an external 2400 ms deadline and a 96 MiB V8 heap
  limit. No risky corpus runs in the parent test process. Ordinary positive
  API tests remain in the parent.

A risky pattern can become literal instead of a permissive match; this is an
intentional security compatibility boundary and requires independent review.
No server-facing glob from user input may opt out of validation. Passing the
focused corpus is regression evidence, not a claim that arbitrary native
regular expressions are safe or that independent acceptance is complete.

The root pnpm override must remove **all registry picomatch <=4.0.7
instances**, not merely avoid advisory output. Acceptance requires frozen
install, unit/browser Nx/Vite/Vitest compatibility, negative ReDoS tests in
resource-limited children, and a real unwaived `security:dependencies` PASS.

See [GHSA-fc5q-39xc-vjpf](https://github.com/advisories/GHSA-fc5q-39xc-vjpf)
and Issue https://github.com/spikeal8-maker/asa-lab/issues/1236.
