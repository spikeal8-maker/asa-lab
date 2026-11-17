# ASA LAB — picomatch security replacement (Issue #1236)

This source is a local, **non-published** copy of upstream `micromatch/picomatch`
tag **4.0.7**, tree `6bb40679c218cefba5d4e9662408c5fdf699a8bb`.
Original copyright and MIT license are retained in `LICENSE`.

## Security change
The only upstream runtime modification is `lib/parse.js`.
- Remove `maxExtglobRecursion:false`'s ability to disable the ReDoS guard.
- Detect unescaped '*' wildcard inside **every** repeated extglob branch, not
  only multi-branch alternatives; retain upstream safe character-class rewrite
  for proven safe nested star sequences.
- Treat unsupported risky repeated extglobs as *literal*, using the existing
  upstream fail-closed `extglobClose` path.
- Backslash-escaped '*' and '*' inside bracket classes are not classified as
  unbounded wildcard.

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
