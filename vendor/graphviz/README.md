# Offline Graphviz runtime

Pinned `@viz-js/viz 3.31.0` embeds Graphviz 16.1.0 and Expat 2.8.5. `viz.js` is the
unmodified ESM distribution from the npm archive in `manifest.json`; the WASM bytes
are embedded, so there is no separate WASM fetch, CDN, runtime installation or native
process. The distribution is 1,188,719 bytes. SHA-256 and license hashes are checked by
`tests/unit/graphviz-runtime.test.js`.

Upstream sources and notices:

- [Viz.js tagged source (MIT)](https://github.com/mdaines/viz-js/tree/release-viz-3.31.0), `VIZ-LICENSE.txt`.
- [Graphviz 16.1.0 source (EPL-2.0)](https://gitlab.com/graphviz/graphviz/-/tree/16.1.0), `GRAPHVIZ-LICENSE.txt`.
- [Expat 2.8.5 source (MIT)](https://github.com/libexpat/libexpat/tree/R_2_8_5), `EXPAT-LICENSE.txt`.
- [Viz.js API](https://viz-js.com/api/) and [release notes](https://github.com/mdaines/viz-js/releases/tag/release-viz-3.31.0).

Retrieved and verified 2026-11-15. Actual runtime format probing supports `json` and
`dot_json`. A remote Node 24.16.0 cold instance initialized in 23.5 ms; this is an
environment-specific probe, not a browser latency promise. Browser cold initialization
and offline Worker checks are recorded by `tests/e2e/graphviz-runtime-e2e.mjs`.
The 2026-11-15 Linux Chrome run passed all 10 checks with 186.4 ms cold and 2.3 ms
warm layout on its three-node parallel-edge sample, and zero external requests.

There are no font files or font URLs. Graphviz's built-in text metrics size labels;
the application requests Arial/sans-serif and SVG renders using system fonts. Glyph
appearance can vary across operating systems, while each document's geometry is
reused for highlighting and selection. Long and Unicode names remain literal text.

The single allowed third-party module boundary is
`src/platform/graphviz_vendor.js -> vendor/graphviz/viz.js`. The architecture checker
recognizes precisely that static import; its dependency-free vendor leaf is covered
by manifest and import checks. No general vendor path exemption is permitted.
