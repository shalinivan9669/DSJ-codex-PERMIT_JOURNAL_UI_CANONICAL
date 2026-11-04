# Dependency patches

`zod@3.25.76.patch` is retained here for historical reference only. It is no
longer applied by the lockfile or package configuration after migration to
Zod 4.6.6. The notes below describe the previous mitigation, not the current
installed dependency.

`zod@3.25.76.patch` is a local, unofficial backport of the approach proposed in
[Zod issue #6653](https://github.com/colinhacks/zod/issues/6653) and its
[example commit](https://github.com/dokson/zod/commit/9f5b6c52). Zod is MIT
licensed; its license is preserved in the installed package and copied to
`zod-LICENSE` in this directory.

For arrays with an upper `.max()` or `.length()` bound and sets with an upper
`.max()` bound, oversized values now return the existing `too_big` issue before
parsing elements. The patch changes error details for already-invalid oversized
values: element-level issues are no longer included. Valid values and arrays
shorter than a `.length()` bound retain the existing validation path. Runtime
CommonJS and ESM copies and the bundled TypeScript source are patched.

This was a partial mitigation, not an upstream security release. Collections
without an upper bound can still consume resources while collecting errors, and
the package version remains listed by `pnpm audit`. Review request limits and
unbounded schemas separately; do not suppress the advisory or describe it as
fully resolved. In Zod 4, unbounded collections still require separate limits
or other resource controls.
