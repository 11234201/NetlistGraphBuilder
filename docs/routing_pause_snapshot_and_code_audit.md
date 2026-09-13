# 布线修复暂停快照与代码审计

- 记录日期：2026-09-13
- 状态：已暂停；等待后续明确指令后再启动修改
- 代码基线：`b3da191`（最近的布线实现提交为 `60040a0`）
- 关联报告：[eq012_focused_routing_investigation_report.md](eq012_focused_routing_investigation_report.md)
- 历史方案：[eq012_focused_routing_remediation_plan.md](eq012_focused_routing_remediation_plan.md)

## 1. 暂停边界

本文件固定当前实现、验证结果和代码风险。自本记录起，历史方案中的后续阶段仅作为 backlog 保留，不表示正在执行。恢复开发前不得据此继续调整候选、代价、容量或放置算法；应先重新确认目标、验收门槛和基准数据。

本次只审计和记录，不修改布线行为。

## 2. 当前已经成立的结果

1. eq012 Focused `_2021_` + `_2406_`，`faninDepth=3`、`fanoutDepth=3`，在 `cellSpacing=4/8/16/32/64/84/88/160/320` 的聚焦矩阵中，本地 hard validator 均为零违规。
2. `cellSpacing=88` 时，进入 `_2406_` 的关键路径为：
   - `clk`：`(140,316) -> (226,316) -> (226,534) -> (436,534)`；
   - `rst_n`：`(140,432) -> (350,432) -> (350,606) -> (436,606)`；
   - 两条目标侧垂直段相差 124 px，满足当前 10 px target-entry 隔离策略。
3. 本地测试基线为 429/429。
4. 当前路由边界已经具备若干必要基础：physical-net canonical key、共享 hard candidate validator、显式空 route/`unroutable` 失败出口、固定上限候选搜索、route/node spatial index，以及 Simple/Adjust/ELK 共用的最终验证。

这些结果只证明已覆盖的局部场景和边界成立，不能证明整个 mapped corpus 已经完成布线。

## 3. 当前仍未解决的事实

- 普通 mapped runner：47 个 case 中 40 个失败，累计 `35154` 个 error、`120` 个 warning，`hardInvariants=false`；最大 layout 22.391 s，最大 heap 286 MiB。
- strict `dp020`：1933 条 missing-route，1664 个不可布物理 net，其中 1346 个为 overflow-unroutable，413 个 `capacity-overflow-corridor`；layout 12.876 s，heap 209 MiB。
- strict `sop015`：3193 条 missing-route，2235 个不可布物理 net，其中 2029 个为 overflow-unroutable，362 个 overflow corridor；layout 12.605 s，heap 208 MiB。
- 最近一次 benchmark：1024/4096/8192 规模普通 layout 分别为 205.8/1385.7/4874.2 ms，SVG 为 60.4/261.8/620.2 ms；collapsed layout 为 10.7/11.8/26.0 ms。

`missing-route` 表示最终 edge 没有可接受的连通正交几何，系统用空 route 和 `unroutable` 明确失败，而不是继续输出已知会穿越、重叠或越界的线。数量很大主要来自 dense collapsed group 的真实通道不足，以及一个物理 net 中某条分支失败后原子提交会使多条 logical edge 一起成为 missing-route。它不是本轮 eq012 `clk/rst_n` 重叠修复新增的问题。

## 4. 当前路由数据流

Simple 主路径为：

`simpleLayered placement -> routing plan -> channel capacity plan -> placement expansion -> simple orthogonal router -> physical wire-tree normalization -> final route validator`

Adjust 使用局部 reroute；ELK 消费 provider section；二者最后也进入共享 final validator。当前安全性主要由候选验证和最终验证兜底，但三种 provider 的候选能力并不等价。

## 5. 代码审计结论

### 5.1 高优先级正确性与容量问题

1. **mapped 完成度指标语义不正确。** `tools/test-one-mapped-case.mjs` 用 `edge.routeKind` 是否存在统计 `routedEdges`，而 `routeKind: "unroutable"` 也会被计为 routed；`tools/test-mapped-cases.mjs` 的普通门禁因此可能把显式失败计入“完成”。hard 模式会继续检查 graph-level `layoutStatus`，但两个指标的含义仍然冲突。
2. **最密集 row-gap 的容量需求会被静默跳过。** `src/layout/channelCapacity.js` 将 `MAX_ROW_GAP_DEMANDS` 固定为 64；某个 gap 超过该数量时直接 `continue`，既不分配 channel，也不产生对应 overflow 诊断。容量盲区恰好出现在最需要诊断和退化策略的 dense collapsed 场景。
3. **outer capacity 已计算但没有形成完整的放置合同。** capacity plan 生成 `outerTop/outerBottom`，而 `applyRoutingCapacityExpansion()` 只消费 row-gap 和 inter-layer expansion；top headroom 又只保留最多 8 条 lane，outer allocator 可分配更多 lane。需求、分配和实际几何空间并未闭环。
4. **一个 inter-layer assignment 被阻塞时会丢掉同 edge 的其他有效容量提示。** `simpleOrthogonalRouter.js` 的 blocked 分支清空 `capacityLaneYs` 和 `rowGapLanes`，已有 outer/row-gap 信息不能继续参与受限 fallback，只能由通用 overflow 候选重新发现路径。
5. **native physical-net tree 的适用范围过窄。** 当前只接受所有 target 位于 source 右侧、没有近似同 X/Y 对齐的树，并只尝试 3 个 trunk X。reverse、same-column、混合对齐、跨 group boundary fanout 会回退到逐 edge 路由；tree geometry 也没有完整消费 capacity corridor/row-gap assignment。
6. **物理 net 的原子失败会放大 logical missing-route 数量。** 这是防止同一物理 net 被部分提交成错误树的正确安全语义，但目前任何一条分支因容量失败，都可能使整组 edge 输出 `unroutable`，因此 edge 级 missing-route 会显著高于失败物理 net 数。

### 5.2 诊断与 provider 一致性问题

1. **空 physical wire route 的树统计会误报可达。** `src/layout/netTreeRouter.js` 在没有 usable route 时仍把 `reachableTargetCount` 设为 edge 数，并把 `treeFallback` 设为 false。edge validator 仍会报 `missing-route`，但 wire-tree telemetry 会掩盖失败。
2. **target-entry guard 是有意限定的局部策略。** 它只在存在 Focused root 时建立 lane map，也只保护“外部 source 进入 focused-root target”的场景；Whole、非 root target 和 cell-driven net 仍主要依赖通用 2 px foreign-wire separation。eq012 的修复成立，但不能外推为全局 pin-entry 保证。
3. **Adjust 的生成能力弱于 Simple。** Adjust 按 edge 顺序局部重布，未完整复用 target-entry lane 和 physical-net atomic commit；最终 validator 能检测错误，却不能补足候选能力。
4. **ELK 只消费第一段 section。** `getEdgePoints()` 使用 `edge.sections[0]`，没有拼接多 section 输出。最终验证可能拒绝不连通结果，但 provider edge 在此之前仍可能标记为 routed。

### 5.3 性能风险

1. `simpleRouteCandidates.js` 的 `getOuterLaneXs()` 扫描全部节点，并在困难 edge 的 global fallback 内反复调用，存在接近 `O(E*N)` 的重复工作。
2. `localRouteCandidates.js` 在每条局部 reroute 上重新计算全体节点纵向 bounds；Adjust 范围通常较小，但高扇出或批量 override 时仍会重复付出全图扫描成本。
3. 当前 bounded candidate、固定 lane 上限和 spatial index 必须保留；恢复开发时不能用随图规模增长的 retry、全对全扫描或无限扩大画布来换取通过率。

## 6. 审计判断

eq012 的特定垂直重叠已经有稳定回归保护，但系统性问题尚未结束。剩余失败不是单纯“搜索不够多”，而是容量模型、放置空间、物理树生成、provider 一致性和门禁统计之间仍未形成同一份可证明合同。继续微调权重很可能只移动失败位置，并增加性能不确定性。

## 7. 后续恢复开发的入口（当前不执行）

恢复时先重新确认以下顺序，而不是直接沿历史 phase 自动继续：

1. 修正 routed/missing/unroutable 指标定义和空树 telemetry，使门禁先准确描述事实。
2. 定义 dense row-gap、inter-layer、outer corridor 从需求、分配到 placement 的统一合同，并明确容量耗尽时的可观测失败。
3. 让 physical-net tree 消费同一容量合同，覆盖 reverse/same-column/mixed fanout，同时保持原子提交。
4. 对齐 Simple、Adjust、ELK 的最低安全与连通语义。
5. 在 focused matrix、determinism、mapped strict/no-collapse 和 benchmark 上共同验收；不得只用单一 fixture 或单次性能数据判定完成。

上述内容现在全部处于暂停状态。
