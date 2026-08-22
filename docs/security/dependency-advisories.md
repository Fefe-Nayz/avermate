# Dependency advisory exceptions

## `image-size@1.2.1`

`GHSA-w3rx-r6r6-pgpr` and `GHSA-5p2g-fcmc-qvqq` affect every version currently
published on npm (`<= 2.0.2`). Avermate therefore carries
`patches/image-size@1.2.1.patch` instead of pretending an installable upstream
fix exists. The patch rejects zero/undersized ISO BMFF boxes and zero/undersized
ICNS entries before any parser loop can reuse the same offset.

`tools/security/dependency-patches.test.ts` executes the two malicious
zero-length shapes in timeout-fenced child processes and checks the vendored
patch markers. `bun run security:audit` ignores only these two advisory IDs
after that regression suite has proved the mitigation; every other advisory
still fails the audit.

Recheck after any `image-size`, `pptxgenjs`, Expo or Metro dependency change and
remove the patch/exception as soon as a reviewed upstream release contains the
same bounds checks.

Primary records:

- <https://github.com/advisories/GHSA-w3rx-r6r6-pgpr>
- <https://github.com/advisories/GHSA-5p2g-fcmc-qvqq>
