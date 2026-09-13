# 布线方案实现符合性审计

- 审计日期：2026-09-13
- 审计基线：`6800cc3`
- 对照方案：[eq012_focused_routing_remediation_plan.md](eq012_focused_routing_remediation_plan.md)
- 状态：审计完成；不启动修复

## 1. 总体判断

当前实现没有偏离“非法几何必须明确失败、搜索必须有界、physical net 是所有权单位”这三条核心方向，但尚未达到方案的完成定义。更重要的是，存在三项实际实现与阶段声明不一致：

1. 阶段 0 被记为完成，但 mapped runner 的 `routedEdges` 统计仍会把 `routeKind: "unroutable"` 计作 routed。
2. 阶段 2 已进入容量实现，但 dense row-gap 超过 64 个 demand 时被静默跳过，违反“容量耗尽必须显式诊断”的规格。
3. 阶段 4 已出现 native physical-net tree 路径，但它仍是有限拓扑特例，`netTreeRouter.js` 仍主要是 provider route 后处理器，没有达到方案要求的统一 native tree router。

因此，当前状态应描述为“基础合同部分落地，容量和树路由处于过渡实现”，不能描述为方案基本完成后只剩调参。

## 2. 逐阶段对照

| 方案阶段 | 当前状态 | 符合部分 | 偏离或缺口 |
| --- | --- | --- | --- |
| 阶段 0：可失败回归门禁 | 部分符合，阶段声明偏乐观 | 有 `--hard`、eq012 focused matrix、最终 validator 和显式失败 | `tools/test-one-mapped-case.mjs` 以 truthy `routeKind` 统计 routed；普通 runner 又不要求 provider status，因此完成度指标不真实 |
| 阶段 1：统一硬校验、net 身份、provider 出口 | 大体符合但未完整验收 | canonical physical-net key、共享 final validator、ELK 非法 section 不再生成 `(0,0)`、Adjust 重新 finalize | 未发现覆盖 Simple/Adjust/ELK 同一输入集的完整共享 provider-contract suite；三者只共享最终拒绝边界，生成能力仍不同 |
| 阶段 2：放置消费容量 | 部分实现，合同未闭环 | inter-layer 和有限 row-gap expansion 已进入 placement；capacity overflow 可记录 | outerTop/outerBottom expansion 没有由 `applyRoutingCapacityExpansion()` 消费；row-gap 超 64 demand 静默跳过；8/128/256 等上限分别作用于不同层，尚未形成需求—分配—放置的单一证明 |
| 阶段 3：Focused 管线与候选 | 局部符合 | eq012 双根和 target-entry lane 有专门回归；候选仍有固定上限 | target-entry guard 只覆盖外部 source 进入 Focused root，Whole、非 root、cell-driven target 不具备同等 10 px 合同；这是性能保护下的有意缩小范围，不是全局硬目标的完成实现 |
| 阶段 4：native physical-net tree | 过渡实现 | capacity-blocked fanout 可原子尝试共享 trunk；提交前验证整组 physical net | 仅支持 target 全部向右、无近似同 X/Y 对齐，并只试 3 个 trunk X；reverse、same-column、mixed alignment 回退逐 edge；tree 未完整消费 corridor；`netTreeRouter.js` 仍是后处理器 |
| 阶段 5：provider、bounds、发布门禁 | 部分符合 | Simple/Adjust/ELK 都进入 final validator；失败能变成 graph-level `unroutable` | mapped hard 仍大规模失败；ordinary gate 允许质量预算且统计语义有缺陷；Adjust 未复用完整 target-entry/atomic-tree 能力；ELK 只消费第一段 section |

## 3. 与核心设计一致的部分

以下实现方向与计划一致，应在未来恢复时保留：

- canonical physical-net identity 已贯穿 grouping、reservation、wire route 和多数诊断。
- candidate 与最终布局均有硬几何验证；找不到合法路线时返回空 route/`unroutable`，没有恢复已知非法 fallback。
- physical-net tree 尝试采用原子验证、原子提交，避免部分 branch 成功后留下断树。
- route search 和 lane hint 数量有明确上限；已有 node/segment spatial index。
- Adjust 使用 owner tombstone/compact，避免每次完整重建 reservation index。
- Simple、Adjust、ELK 最终都进入 `finalizeLayoutGraph()`，graph-level 状态可表达失败。
- eq012 `_2021_` + `_2406_` 的目标侧 `clk/rst_n` 间隔修复不是实例坐标特例，并有 spacing matrix 回归。

## 4. 实际偏离详情

### 4.1 阶段 0 的完成度统计不符合合同

`tools/test-one-mapped-case.mjs` 当前使用：

```js
const routedEdges = laidOut.edges.filter((edge) => edge.routeKind).length;
```

而不可布 edge 会带有 `routeKind: "unroutable"`。因此该 edge 仍计入 routed。`tools/test-mapped-cases.mjs` 的 ordinary 模式只比较 `routedEdges === edges`，不要求 `layoutStatus === "routed"`。这与计划中“合法 layout 或明确失败，不存在第三种成功状态”的门禁含义不一致。

这是实际偏差，不只是尚未完成的新功能。

### 4.2 dense row-gap 被静默跳过

`src/layout/channelCapacity.js` 定义 `MAX_ROW_GAP_DEMANDS = 64`，当某 gap 的 demand 超过该值时直接 `continue`。该 gap 没有 channel、assignment 或专门 overflow diagnostic。

方案要求达到容量上限时产生命名的 capacity failure，并禁止通过缺省候选跨越未建模通道。当前行为在最密集场景丢失容量事实，属于实现偏差。

### 4.3 outer capacity 没有形成 placement 闭环

capacity plan 会计算 `expansion.outerTop` 和 `expansion.outerBottom`，但 `applyRoutingCapacityExpansion()` 只处理 row-gap 与 inter-layer channel。另一路 `computeTopWireHeadroom()` 最多保留 8 条外围 lane，而 allocator 每 scope 最多 256 条，group inter-layer placement 又限制为 128 条。

固定上限本身符合有界性能原则，但这些上限没有由一个统一的 normalized capacity policy 解释，且 outer 分配不等于实际预留空间。这是阶段 2 的未完成项，也偏离第 11 节“需求、容量、placement 使用同一几何来源”的目标结构。

### 4.4 blocked edge 会抹掉其他容量提示

`simpleOrthogonalRouter.js` 发现任一 blocked inter-layer assignment 后，会返回 `capacityLaneYs: []`、`rowGapLanes: []`，并清除 corridor/escape。这样做保证不会误用已封顶 lane，但也丢掉同一 physical net/edge 的其他合法 row-gap 或 outer assignment。

这不违反安全原则，却偏离“路由消费已分配 channel”的设计意图；后续 generic overflow fallback 只能重新碰撞候选，不能基于已证明的剩余 corridor 工作。

### 4.5 native tree 仍是拓扑特例

当前 tree builder 在以下任一情况直接返回失败并回退：

- 任一 target 与 source 的 X 或 Y 在 4 px 内对齐；
- 任一 target 不在 source 右侧；
- 3 个 trunk X 均未通过验证。

它主要用 edge capacity plan 判断 blocked 和记录诊断，没有按方案直接从完整 channel allocation 构造 trunk/branch/junction。`src/layout/netTreeRouter.js` 的注释也明确其作用是把 provider 已有 logical routes 归约为 tree，而不是生成新几何。

因此阶段 4 的提交属于安全的中间切片，不等于完成原生 physical-net tree 架构。

### 4.6 provider 共享的是拒绝边界，不是完整能力

- Simple 有 capacity plan、target-entry lane 和 atomic tree 尝试。
- Adjust 主要逐 affected edge 局部 reroute，再执行 shared final validator。
- ELK 的 `getEdgePoints()` 只消费 `edge.sections[0]`，没有组合多 section。

三者都能拒绝非法结果，这是阶段 1 的重要成果；但它们不能对同一可布输入提供等价最低能力。当前测试也没有形成方案要求的完整 shared provider contract matrix。

### 4.7 target-entry 修复范围小于全局硬目标

target-entry lane map 仅在图中存在 `isFocusedRoot` 时创建，validator 又要求 target 本身是 Focused root 且 source 在 Focused 外部。该范围是为了避免 Whole dense graph 的内存与容量回退，属于经过性能权衡的局部实现。

它符合 eq012 当前修复目标，但若把方案目标解释为所有 provider、所有 target pin 的统一 entry separation，则实现范围明显不足。未来文档和测试必须明确它是 Focused policy，或把共享硬合同扩展到其他路径；不能两种说法并存。

### 4.8 性能实现仍有与计划不一致的重复扫描

- `simpleRouteCandidates.js` 的 `getOuterLaneXs()` 每次扫描全部 nodes，并在困难 edge 的 global fallback 循环中调用。
- `localRouteCandidates.js` 的局部 reroute 会为每条 edge 重新计算全部节点纵向 bounds。

已有固定候选上限使风险仍然有界，但其复杂度接近重复 `E*N` 扫描，不符合计划“共享空间索引/预计算，避免每 edge 全图扫描”的目标。

## 5. 不是偏离、但尚未完成的项目

以下现象已经在方案中预期为过渡状态，不应误判为意外偏航：

- 删除非法 fallback 后 missing-route 激增；这是安全出口生效，不是质量完成。
- ordinary mapped gate 保留历史 violation budget；只要它不被当作 hard 合同证明，这一观察门禁可以保留。
- bounded headroom 和 lane caps 会主动产生 overflow；这符合性能边界，但必须有准确诊断和真实 placement 对应。
- physical-net 原子失败会使多个 logical edge 同时 missing；这是保持树一致性的代价，计量时应同时报告 physical-net 数。

## 6. 归档结论

当前实现遵守了方案的安全方向，但在阶段声明、容量闭环和 native tree 架构上存在实质差距。未来恢复时应先修复阶段 0 的指标与 telemetry，使门禁可信；之后重新定义阶段 2/4 的最小可交付切片。未经重新启动，不继续实施这些修复。

