# Dependency security

## Policy

- `npm audit` must report zero findings for the committed lockfile.
- OSV scans cover both `package-lock.json` and `Cargo.lock` on pull requests,
  pushes to `main`, and the weekly schedule.
- Critical or high container findings block releases. The production image must
  contain runtime dependencies only and use a digest-pinned base image. CI
  blocks on fixable critical/high findings; Debian findings without an upstream
  fix remain visible in scan reports and are addressed by the next base refresh.
- Overrides are limited to patched, API-compatible transitive packages and must
  pass the complete build and test suite.
- Exceptions require a concrete reachability reason and expiry date in
  `osv-scanner.toml`; expired exceptions fail the scan.

## Current upstream exceptions

The remaining RustSec entries originate in Solana/Anchor's locked dependency
graph. FATE does not use `bincode`, `libsecp256k1`, or `rand` for game outcome
selection. Anchor account discriminators, owner checks, fixed account sizes, and
Switchboard verification remain the security boundary. The Borsh advisory is
also isolated behind those constraints. These exceptions expire on 2026-10-01
and must be removed or renewed only after a documented review.

## Commands

```sh
npm run security:audit
npm run security:sbom > fate-sbom.cdx.json
docker run --rm -v "$PWD:/src" ghcr.io/google/osv-scanner:latest scan source -r /src
```

Never use `npm audit fix --force` without a separate compatibility review.

The 2026-08-01 runtime scan found no vulnerable npm/Go artifacts after pruning
the development toolchain. OSV still reports Debian Bookworm base advisories for
which the selected current image publishes no fix; these are not suppressed in
local reports, while CI uses `--ignore-unfixed` so actionable findings remain
release-blocking.
