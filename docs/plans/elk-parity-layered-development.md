# ELK-parity 开发方案（proper layering 流水线）

Date: 2026-09-15. Branch: `dev`.
Companion documents: `docs/research/elk-layered-layout-routing.md`（算法调研）、
`docs/plans/elk-parity-layered-pipeline.md`（总体方案与验收）、
`docs/experiments/eq012-1471-depth3-baseline.md`（场景二基线）。

This file is the executable development design: which files change, what each new module exports, the
algorithm each stage runs, the tests that ship with it, and the revert point if it fails.

## 1. 验收门槛（现状 → 目标）

场景 A — eq012 Focused net `clk`，深度 1/1（1540 节点 / 2050 边）

| 指标 | 现状 | 目标 |
| --- | ---: | ---: |
| missing routes | 0 | 0（不得回退） |
| 硬违规 | 0 | 0（不得回退） |
| 宽度 | 1,043 | ≤ 8,524（ELK 参考） |

场景 B — eq012 Focused `cell:_1471_`，深度 3/3（787 节点 / 1085 边）

| 指标 | 现状 | ELK | 目标 |
| --- | ---: | ---: | ---: |
| missing routes | 6 | 0 | 0 |
| 硬违规 | 12 | 6 | 0 |
| outer route 占比 | 19.7% | 0% | < 5% |
| 总层跨度 | 5,237 | 3,686 | ≤ 3,686 |
| 交叉数 | 62,959 | 31,878 | ≤ 47,817（1.5×） |
| 平均绕行比 | 1.250 | 1.031 | ≤ 1.15 |

全局：排列不变性（节点/边数组换序后坐标与折线完全一致）、`npm test`、
`layout-determinism`、`layout-fixtures`、mapped-case 回归、benchmark 无尺寸悬崖。

## 2. 现状代码地图

| 文件 | 职责 | 本方案中的处置 |
| --- | --- | --- |
| `src/layout/simpleLayered.js` | 编排：levels → intent → routePlan → buckets → x → 初始放置 → 放置流水线 → 容量 → 布线 | 改为调用新的 layered 流水线；保留 `layoutGraph` 导出签名 |
| `src/layout/simpleLayering.js` | `assignSimpleLevels` 最长路径分层；`orderSimpleLayers` 计分扫描排序 | 分层被 S1 取代；排序在 S3 演进（保留 `countLayerCrossings` Fenwick 实现） |
| `src/layout/nodeSpacing.js` | `computeLevelXs` 预算 x；`resolveLevelOverlaps` 等压缩 | `computeLevelXs` 在 S5 退役；`compactLevelTowardPreferredRows` 保留为 BK 的压缩原语 |
| `src/layout/simplePlacementPipeline.js` | 11 步领域后处理编排 | 保留，默认关闭 x 位移类步骤（S6） |
| `src/layout/channelCapacity.js` | `buildPhysicalNetDemands` / `allocateIntervalLanes` / `requiredInterLayerGap` / `buildRoutingCapacityPlan` | 全部保留，S5 改为在扫描中逐 gap 调用 |
| `src/layout/simpleOrthogonalRouter.js` | `routeSimpleEdges(graph, nodes, options)` 逐边几何生成 | 保留为几何生成器；S5 改为按 gap 分组调用 |
| `src/layout/layoutIntent.js` | `analyzeLayoutIntent(graph, levels)` → `getEdge/getNodeFanout/getBoundaryPressure` | 保留；S2 后需能处理虚链段 |
| `src/layout/simpleRoutingPlan.js` | `planSimpleRouting(graph, levels, layoutIntent)` → lanes / netDemands | 保留；`levelDistance <= 1` 分支在 S2 后覆盖所有边 |
| `src/layout/layoutPolicy.js` | `DEFAULT_LAYOUT_POLICY` / `normalizeLayoutPolicy` | 新增 feature 开关与 layering 参数 |
| `src/layout/nodeLocality.js` / `nodeAlignment.js` | hub 局部化、单扇出输入局部化、端点对齐 | S6 默认 y-only |

## 3. 新增模块：`src/layout/layered/`

| 文件 | 导出 | 说明 |
| --- | --- | --- |
| `layeredGraph.js` | `buildLayeredGraph(graph, levels)`、`levelKeysOf(layered)`、`LAYERED_DIAGNOSTICS` | 层视图与节点引用，real/dummy 统一抽象 |
| `minSpanLayering.js` | `relaxToMinimalSpan(graph, levels, policy)`、`DEFAULT_MINIMAL_SPAN_POLICY` | S1 |
| `longEdgeDummies.js` | `splitLongEdges(layered)`、`joinLongEdgeChains(layered, segmentsByEdge)` | S2 |
| `bkPlacement.js` | `placeWithAlignmentBlocks(layered, sizes, policy)`、`markTypeOneConflicts(layered)`、`buildAlignmentBlocks(...)`、`compactBlocks(...)` | S4 |
| `gapRouting.js` | `assignLayerXByRouting(layered, positioned, context)` | S5 |

### 数据结构

```
LayeredGraph {
  layers: Array<Array<NodeRef>>,      // 已排序，索引 = 层号
  levelOf: Map<nodeId, number>,
  nodeRefs: Map<nodeId, NodeRef>,
  segments: Array<SegmentEdge>,       // S2 之后全部单位跨度
  realEdges: Array<Edge>,             // 原始边，未被修改
  diagnostics: Array<{code, detail}>
}

NodeRef (real)  = { kind:"real",  id, node, level, order, size }
NodeRef (dummy) = { kind:"dummy", id, level, order, size,
                    realEdgeId, chainIndex, chainLength,
                    longEdgeSource, longEdgeTarget }

SegmentEdge = { id, source, target, realEdgeId, level, chainIndex }
```

- dummy 的 `id` 必须是拓扑键：`dummy:${realEdgeId}:${level}`，不得含数组下标或随机量，否则排列不变性失效。
- `layers` / `segments` 的构造顺序一律由 `(level, id)` 决定，不依赖入参数组顺序。

## 4. 阶段实施

### S0 — 诊断工具（已完成，本轮补齐入口）

- `tools/compare_eq012_layouts.mjs`（已有）
- `tools/inspect_layer_spans.mjs`、`tools/inspect_long_edges.mjs`、`tools/inspect_unroutable.mjs`（已有）
- `package.json` 已加 `analyze:layer-spans` / `analyze:long-edges` / `analyze:unroutable`
- 待补：`npm run analyze:layer-spans -- _1471_ 3 20` 输出纳入 CI 断言（proper-layering 不变量）
- 回退点：无风险，工具独立。

### S1 — 最小总跨度分层

目标：把 `Σ w_e (l_target − l_source)` 从 5,237 降到 ≤ 3,686，并让边界输入不再全部堆在第 0 层。

算法（`relaxToMinimalSpan`）：

```
back = { e | l[t] − l[s] < 1 }              // 环被断开的边，不参与约束
for sweep in 0 .. R−1:                       // R = policy.layering.relaxationSweeps (默认 8)
  order = nodes.sort by (sweep 偶数 ? +l : −l, id)   // 规范序
  moved = false
  for v in order:
    LB = max(l[u] + 1) over in-edges  (无入边则 LB = l[v])
    UB = min(l[w] − 1) over out-edges (无出边则 UB = l[v])
    Win = Σ w(in),  Wout = Σ w(out)
    if Win > Wout and l[v] > LB: l[v] = LB; moved = true
    elif Win < Wout and l[v] < UB: l[v] = UB; moved = true
  if !moved: break
normalize: 平移使 min(l) = 0
```

终止性依据：目标函数对单个 `l[v]` 是线性的，系数为 `(Win − Wout)`，因此单坐标改进值位于当前可行区间
`[LB, UB]` 的端点；只有严格降低目标的移动才被接受，且每次至少降低 1（整数权、整数 δ），故终止。
这是坐标下降启发式，只保证得到规范、可行且不劣于初始解的结果，不保证达到 network simplex 的全局最优解。

`isExternalLevelSource()` 的硬钉 0 改为 `policy.layering.boundaryAnchor`：
`constrained`（默认，由优化决定）/ `source`（旧行为，兜底）。

- 改动：新增 `layered/minSpanLayering.js`；`simpleLayered.js` 在 `assignSimpleLevels` 之后插入调用；
  `layoutPolicy.js` 增加 `layering.relaxationSweeps` 与 `layering.boundaryAnchor`。
- 测试：`tests/unit/min-span-layering.test.js`（7 项，全绿）
- 验收：场景 B 总跨度 ≤ 3,686 且场景 A 三项不回退。
- **状态：已落地、实测并改为默认关闭（2026-09-16）**。场景 B 总跨度 5,237 → **3,154**（优于 ELK 的 3,686），
  missing 6 → 4，violations 12 → 10，outer 214 → 182，crossings 62,959 → 46,097。
  场景 A crossings 261,632 → **196,608**（ELK 261,888），0 missing / 0 violations。
- 遗留：`tests/unit/graph-render.test.js` 的 sop015 Focused 用例回归（详见场景 B 实验文档末节），
  根因与 hub 长边相同。S2b 完成且全套测试恢复之前，S1 不得进入默认运行路径。
- 回退点：若排列不变性无法保证，把 `boundaryAnchor` 设为 `source` 并只保留一环松弛；最坏情况整体关闭
  `policy.features.minimalSpanLayering`。

### S2 — 长边虚节点（承重的第二步）

目标：建立 proper layering，消除外通道。

```
splitLongEdges(layered):
  for each realEdge with span > 1:
    for level in s+1 .. t−1:
      创建 dummy（拓扑键 id），链入 layers[level]
    生成 segments: s→d1, d1→d2, ..., dk→t
    dummy.longEdgeSource = s, dummy.longEdgeTarget = t
  若 dummy 总数 > policy.layering.maxDummyNodes:
    记录诊断 layered-dummy-cap-exceeded，按 (realEdgeId, level) 规范序截断

joinLongEdgeChains(layered, segmentsByEdge):
  按 chainIndex 顺序拼接折线 → 压缩共线点 → 写回 realEdge.points
```

- 改动：新增 `layered/longEdgeDummies.js`；`simpleLayered.js` 在排序前 split、在 `buildWireRoutes` 前 join；
  `simpleRoutingPlan.js` 的 `levelDistance <= 1` 分支自动覆盖全部段。
- 测试：`tests/unit/long-edge-dummies.test.js`（**已落地，9 项全绿**）
  - **proper-layering 不变量**：split 之后每条 segment 的列跨度恒为 1；
  - 长边影响其跨越的每个中间列的排序；
  - dummy id 在边数组换序后不变；
  - 上限触发时产生诊断且不抛异常、且不半拆边；
  - strip 之后 bucket 内无 dummy，且真实节点相对顺序不变。
- 验收：场景 B outer route < 5%、missing routes 0。
- 回退点：`policy.features.longEdgeDummies = false` 回到现状。

#### S2a — 哑元只参与排序：已完成，但默认关闭

**状态：已实现并实测，因净收益为负而默认关闭。**

实测（场景 B，S1 已开启）：

| 指标 | S1 | S1 + S2a | ELK |
| --- | ---: | ---: | ---: |
| crossings | 46,097 | **31,003** | 31,878 |
| 平均线长 | 6,316 | **4,663** | 5,709 |
| missing | 4 | **68** | 0 |
| violations | 10 | **75** | 6 |

排序收益巨大（crossings 已略优于 ELK），但 68 条 unroutable 中 **59 条是跨 9 列的 `hub->cell` 长边**。
原因是：排序优化的是"链是直的"这一前提下的交叉数，而放置阶段没有为链预留任何竖直通道，
这个几何从未被生产出来。

补充诊断（说明 S1 无法消除这些长边）：`hub:clk`/`hub:rst_n` 位于 level 1，扇出 139 中
11 个目标在 level 2、128 个在 level 10；最小跨度上界 `min(level(target)) − 1` 被浅目标钉死，
故 128 条长边必然存在。ELK 的网络单纯形受同一约束（其 span 直方图同样有 `10:256` 桶），
它靠哑元在每一层占用保留通道来吸收。

#### S2b — 哑元参与放置 + 链式布线候选（承重，进行中）

已完成内部模型的第一段：carrier 现在按物理网/边界唯一化，记录本边界结束与继续的逻辑分支、
前后 carrier 链接，并按右侧逻辑 dummy/目标锚点的中位秩得到稳定槽位顺序。放置视图会删除逐边
logical dummy，只保留每个物理网/边界一个带最小跨度的 carrier slot。该模型尚未接入默认 Simple
放置与路由；2026-09-16 本地全量单测 568/568 通过，远端 Linux 因 SSH 超时待补跑。

1. 逻辑 dummy 继续参与排序，但放置与容量必须按现有 `physicalNetKey` 合并：每个
   `(physicalNetKey, boundary)` 只能有一个 carrier 槽位。不得让 clk/rst_n 的每条逻辑分支各占一条通道。
2. carrier 保留到放置结束，记录每个跨层物理网的逐列 y 锚点；逻辑 dummy 本身不产生独立间距。
3. 路由器新增**物理网链候选族**：一棵物理网树经过 carrier 锚点，所有逻辑目标连接到这棵树，
   仍由既有 `candidateIsUsable` / `routeOverlapsReserved` 校验（几何校验保持权威），
   现有 outer lane 作为兜底。
   - 落点必须在 physical-net group 提交边界，而不是逐边 `routeEdge()`；否则同网分支会重复占槽并失去原子提交。
4. 打开 `policy.features.longEdgeDummies`，重测场景 A/B。

- 验收：场景 B missing = 0、outer < 5%，crossings 不高于 31,003；场景 A 三项不回退；
  sop015 回归用例恢复通过。

### S3 — 排序演进

在 `orderSimpleLayers` 上叠加三点（保持现有 best-of-sweeps 计分与 Fenwick 交叉计数）：

1. 邻居标量用**中位数**，均值作为稳定 tie-break；
2. 计入**固定端口秩**（`node.ports` 的 y 序）；
3. 虚链耦合：同一条链相邻两段的目标偏好绑定，等价于 BK 的 type-1 冲突。

- 改动：`simpleLayering.js`（`sortLevelByNeighbors` 增加 median/portRank/chainPreference）。
- 测试：沿用 `tests/unit/simple-layering.test.js` 并扩展交叉数不回退、排列不变、链偏好生效。
- 复杂度：仍为 `O(R (V log V + E log E))`，R ≤ 7 固定。

### S4 — BK 放置

```
for variant in 4 个 (层遍历方向 × 层内方向) 组合:
  conflicts = markTypeOneConflicts(layered)      // 偏好拉直虚链
  blocks    = buildAlignmentBlocks(layered, conflicts, sizes)   // 中位邻居 + 端口锚偏移
  compactBlocks(blocks, separation, margins)     // 复用 compactLevelTowardPreferredRows 的 PAV 原语
  if 违反层序或重叠: 该 variant 作废
选可行中高度最小的 variant（favorStraightEdges = true）
```

- 改动：新增 `layered/bkPlacement.js`；`simpleLayered.js` 用其替换 `placeInitialNodes` + 若干压缩步骤；
  `nodeSpacing.js` 的 `compactLevelTowardPreferredRows` 提为共享原语。
- 测试：无重叠、无边距违规、层序保持、虚链保持直、高度不显著增长、排列不变。
- 回退点：保留当前放置路径作为 `policy.features.bkPlacement = false` 分支。

### S5 — 布线驱动层 x

删除 `computeLevelXs` 的预算，改为 ELK 的扫描：

```
x = 0
for level in 0 .. n−1:
  placeNodesHorizontally(layer[level], x)
  x += layerWidth(level)
  demands = 该 gap 的物理网需求          // buildPhysicalNetDemands 已有
  lanes   = allocateIntervalLanes(demands, padding, pitch, MAX)   // 已有
  gap = max(nodeNodeSpacing, requiredInterLayerGap(lanes, geometry))  // 已有
  routeSimpleEdges(该 gap 的 segments, ...)
  x += gap
```

- 改动：新增 `layered/gapRouting.js`；`nodeSpacing.js` 的 `computeLevelXs` 退役（保留导出为空实现或直接删除并
  更新 `nodePlacement.js` 的 re-export）；`simpleLayered.js` 把 x 分配移到布线之后。
- 测试：真实多 lane 的通道在 wire spacing 增大时变宽；高扇出边界不再产生与逻辑边数成正比的间距；路由保持合法。
- 复杂度：单趟，`O(Σ gap 需求)`，沿用既有 lane 上限。

### S6 — 领域后处理改为非破坏性

`applyFanoutHubLocality`、`applySingleFanoutInputLocality`、`placeTerminalOutputs` 默认只做层列内的 y 位移；
x 位移保留在 `policy.features.crossColumnLocality = false`（默认）之后。

- 依据：场景 B 的 6 条 unroutable 中有 3 条是 focus-input 被移到 x = 236 / 260 后造成的 2,500px 垂直跳跃。
- 改动：`nodeLocality.js` / `nodeAlignment.js` / `simplePlacementPipeline.js` + policy 开关。
- 测试：开启/关闭开关的 A/B 对比（两个场景各跑一次），hub 可读性不回退。

## 5. 全局契约（任何阶段都不得违反）

- **排列不变性**：所有遍历顺序由 `(level, id)` 或其他拓扑键决定；禁止依赖 `graph.nodes` / `graph.edges`
  数组顺序；禁止 `Math.random`；dummy id 必须是拓扑键。
- **有界复杂度**：禁止图规模比例的回退重试、全配对扫描、按边数增长的候选。lane 上限沿用
  `MAX_CHANNEL_LANES_PER_SCOPE` 等既有常量；dummy 数量有硬上限 + 诊断。
- **硬约束 / 软目标分层**：正交性、端口侧进入、端点保护、节点避障、不同 net 不共线重叠属于
  `orthogonalRouting` + `layoutValidator`；折点数、长度、交叉、outer 使用属于 candidate/score/policy。
- **不改 Netlist IR**：dummy 只存在于 layered 视图；`realEdges` 原样返回。
- **人工 override 最后生效**，且不作为任何自动阶段的输入。
- **不用 instance 名 / fixture 名 / 绝对坐标修特例**。

## 6. 验证矩阵

| 阶段 | 命令 |
| --- | --- |
| 每次改动 | `npm test` |
| S1–S5（布局） | `npm test` + `layout-determinism` + `layout-fixtures` + 本阶段新单测 |
| S2 / S5 | `npm run analyze:layer-spans -- _1471_ 3 20`、`npm run analyze:unroutable _1471_ 3` |
| 每阶段收尾 | `npm run analyze:eq012-layouts -- --focus-cell=_1471_ --fanin-depth=3 --fanout-depth=3 --compact` 与 `--focus-net=clk --fanin-depth=1 --fanout-depth=1 --compact` |
| 复杂度敏感 | `npm run benchmark`（阶段前后各一次，记录时间/内存） |
| 综合网表 | `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases` |

## 7. 提交与分支

- 全程在 `dev`；每阶段一个提交，只 stage 该阶段拥有的路径。
- 不 stage：`dc_runs/`、release 产物、`.vscode/settings.json`（用户自有改动）。
- 阶段提交信息前缀：`feat(layering): S1 minimal-span layering` 等。

## 8. 待确认

1. `dist/` 仍是 2026-09-14 的 v1.0.1 旧构建，不含任何当前 `dev` 布局改动。验收是否需要在每个阶段重建
   release 包，还是只用根目录 `index.html`（直连 `src/`）+ headless 工具判定？
2. 长边虚节点会让中间层节点数显著上升（场景 B 约 3,700 个虚节点）。渲染层是否需要同步确认虚链不产生
   额外 label / 命中区域？
3. S6 关闭跨列局部化后，hub 可读性可能需要另行补偿（例如 hub 列内聚）。是否接受在该阶段之后单独立项？
