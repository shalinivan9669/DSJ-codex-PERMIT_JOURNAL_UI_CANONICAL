# License provenance

`scripts/verification/software-bill.mjs` reads resolved pnpm inventories, copies the
license/notice/copyright files supplied by each package, and records their SHA-256
in `docs/evidence/commercial-acceptance/license-text-sources.json`.

The collector also preserves the complete license sections actually shipped in
the README files of `@tokenizer/token`, `imurmurhash`, and `esrecurse`. Native
esbuild and Next packages use the same-version project package license; HumanFS
types use the installed HumanFS core project's Apache-2.0 text. These references
are labeled in the notices. They are not claimed to be files shipped in the
platform package itself.

`provenance.json` records the supplementary primary-project source used for
`natural-compare@1.4.0`. Its installed README's 2012–2015 copyright attribution is
retained. The complete MIT text is taken from the same project's immutable commit,
and its saved bytes are checksum-checked on every generation.

`client-only@0.0.1` declares MIT in its package metadata but does not ship a full
license text or copyright holder. The primary React RFC confirms publication of
the package, but it does not establish an exact package attribution. This remains
an explicit unresolved notice gap. The generator does not invent a copyright
holder or silently substitute React's license.

The Linux `@img/sharp-libvips-*` bundles ship a README table identifying their
native libraries and licenses, but not the complete license texts for that
bundle. The table is included as attribution evidence and is explicitly marked
`isFullLicense: false`; those packages remain in `missingLicenseText`. The build
scripts' Apache-2.0 license is not substituted for the bundled native libraries'
licenses. Distribution clearance for these remaining gaps is not claimed.

For an additional operating-system installation, collect the actual files there:

```sh
pnpm licenses list --json > npm-licenses.json
node scripts/verification/software-bill.mjs --collect npm-licenses.json npm-licenses-collected.json
```

The collected JSON embeds the license bytes and platform, so it can be merged on
another host without pretending that the other host's package paths exist:

```sh
node scripts/verification/software-bill.mjs npm-licenses-windows.json npm-licenses-collected.json
```

The application SBOM does not replace an image scan. It covers resolved npm
versions in the supplied inventories, pinned Python requirements, and bundled
fonts. The actual image's OS libraries and transitive native libraries require
their separate image SBOM and vulnerability report. Proprietary forms, logos,
and issuer legal approval are outside these dependency notices.
