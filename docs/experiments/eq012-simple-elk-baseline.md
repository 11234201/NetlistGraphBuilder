# eq012 Focused Simple versus ELK baseline

Status: measured and visually inspected. Measurement date: 2026-09-15.

## Fixed scenario

- Fixture: `tests/fixtures/mapped/equal/eq_012_mapped.v`
- Focus root: net `clk`
- Fanin depth: 1
- Fanout depth: 1
- Providers: Simple Layered and ELK Layered
- Collapse: disabled / out of product scope

## Reproduction

Run `npm run analyze:eq012-layouts`. The runner parses module `tc`, builds one shared workspace graph,
applies the fixed Focused query, and passes the resulting graph independently to the current Simple and
vendored ELK providers. It does not use collapse or mutate the source graph.

The query result contains 1,540 nodes and 2,050 edges. The visible-node budget retains 512 design nodes;
Focused boundary projection then adds 1,028 boundary nodes. This explains why a nominally shallow cone
is still a large, high-fanout layout and is an observed query fact rather than a layout regression.

## Baseline results

| Metric | Simple | ELK 0.11.1 |
| --- | ---: | ---: |
| Elapsed time | 1,920.8 ms | 6,144.5 ms |
| Bounds | 13,307 x 88,324 | 8,524 x 98,440 |
| Layout status | routed | unroutable |
| Missing routes | 0 | 0 |
| Hard validation violations | 0 | 4 |
| Routed-edge crossings | 188,006 | 261,888 |
| Total routed length | 35,471,408 | 37,066,181 |
| Average bends per edge | 0.999 | 4.999 |

ELK's four hard violations are two `wrong-port-side` and two `endpoint-body-crossing` reports on the
project adapter's focus-input-to-hub attachments for `clk` and `rst_n`. They do not invalidate ELK as a
placement golden, but they confirm that the acceptance target must not require byte-for-byte routing
identity with ELK.

## Placement observations

- Simple places the 512 cells in one column at x=12,907 and the 512 output boundaries at x=13,139. The
  design is very wide even though its two tallest columns are similar in height.
- ELK places those columns at x=8,134 and x=8,344. Its output is about 36% narrower, while about 11%
  taller.
- The main Simple inter-layer channel has a current span of 12,560 pixels, while the post-placement
  allocator measures three reusable lanes and a required span of only 96 pixels. This directly identifies
  raw fanout-based x preallocation as an oversized estimate rather than required route capacity.
- Cell ordering is materially different: the 512 shared cell IDs have mean absolute rank difference
  229.328 and Spearman rank correlation -0.693 between Simple and ELK.
- Simple's initial placement starts every layer at the same top coordinate. Later alignment passes center
  some small layers, but they do not provide a global balanced-layer placement invariant.
- The current exact baseline does not reproduce a Simple hard unroutable result. Visual UI comparison and
  spacing/session-policy checks remain regression concerns; this runner is now the deterministic anchor.

## Visual inspection

The browser was loaded with the exact fixture and query. At fit-to-view scale both providers are very tall,
thin drawings because the view contains 512 parallel cells rather than a small cone. Simple visibly uses
two shared trunks for `clk` and `rst_n`, but carries a large empty horizontal gulf between the hubs and the
cell bank. ELK uses a narrower, evenly spaced bank of orthogonal channels and more balanced row ordering.

Focusing `clk` in the ELK result also exposed an adapter mismatch: focus navigation selected geometry near
a projected data input rather than a clean `clk` trunk. Together with the four endpoint-validation errors,
this confirms that ELK is the visual placement/order reference, not an exact routing-coordinate oracle.

The crossing and length counters are diagnostic rather than a perceptual beauty score. In particular,
ELK's shared channel geometry and symmetry can look clearer while producing more pairwise segment
crossings under the repository's current analyzer.
