# Acorn 8.15.0 — development checks only

`acorn.cjs` is the standalone Acorn bundle extracted from Node.js v24.12.0's
`internal/deps/acorn/acorn/dist/acorn` source. The checked-in bundle is loaded
directly as CommonJS; checks do not use Node private APIs or install packages.

Upstream: https://github.com/acornjs/acorn/tree/8.15.0
License: MIT; the full notice is in `LICENSE`.

SHA-256 of `acorn.cjs`:
`23db9caa827172bb60f50978d14a1a9d51ff34e11bfed2408787854a6359d53b`.

Only tools/tests depend on this bundle. Browser modules, native embedded assets
and Windows release resources do not include it. Updating it requires checking
the version, provenance, license and digest again, then running module-graph tests.
