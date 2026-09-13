# 布线问题重新启动交接说明

- 创建日期：2026-09-13
- 当前状态：搁置、可归档
- 暂停点提交：`1e4a220`
- 恢复条件：用户明确要求重新启动布线问题处理

## 1. 重新启动前先读

按以下顺序恢复上下文：

1. [routing_pause_snapshot_and_code_audit.md](routing_pause_snapshot_and_code_audit.md)：暂停时的事实、指标和代码审计结论。
2. [routing_plan_conformance_audit.md](routing_plan_conformance_audit.md)：历史方案与当前代码的逐阶段符合性审计。
3. [eq012_focused_routing_investigation_report.md](eq012_focused_routing_investigation_report.md)：问题历史、复现过程和已验证结果。
4. [eq012_focused_routing_remediation_plan.md](eq012_focused_routing_remediation_plan.md)：历史设计与实施台账；它是 backlog，不是恢复后的默认执行顺序。
5. `AGENTS.md`、`docs/skills/netlist-schematic/SKILL.md` 及其要求的架构、设计和阶段文件。

不要从聊天记录推断最新状态；以仓库文件和恢复时重新测得的数据为准。

## 2. 已冻结的结论

- eq012 Focused `_2021_` + `_2406_` 的已知 `clk/rst_n` 目标侧垂直重叠已有回归保护，spacing 4--320 的既定矩阵在暂停时为零 hard violation。
- 全量 mapped corpus 尚未完成：暂停前普通门禁仍有 47 个 case 中 40 个失败；dp020、sop015 strict 存在大量显式 missing-route。
- `missing-route` 是拒绝非法几何后的明确失败，不应通过放宽 validator、恢复非法 fallback 或隐藏计数来消除。
- 根因范围已经收敛到：指标语义、dense row-gap/inter-layer/outer capacity、placement corridor、physical-net tree、provider 一致性和有界性能。

## 3. 恢复时的第一批工作

恢复后先建立新的短期计划，只处理下列顺序中的一项，不要直接同时展开全部历史阶段：

1. 复核工作区和暂停点之后的提交，判断布线相关代码是否已经发生变化。
2. 重跑最小基线，确认暂停文档中的数字是否仍有效。
3. 优先修正统计真实性：区分 `routed`、`unroutable`、`missing-route`，修复空 wire-tree 可达 telemetry。
4. 再选择一个容量合同切片，例如 dense row-gap 的显式 overflow 或 outer capacity 到 placement 的闭环。
5. 为所选切片定义 focused test、determinism、mapped strict 和 benchmark 的验收阈值，然后才允许改算法。

## 4. 明确禁止的恢复方式

- 不增加实例名、fixture 名或绝对坐标特例。
- 不靠提高默认 cell spacing 掩盖容量问题。
- 不恢复会穿节点、跨 net 共线重叠或端点不连通的 fallback。
- 不增加随图规模增长的 retry、lane 或全图扫描。
- 不只看 eq012，也不只看普通 mapped violation budget。
- 不把历史方案中的“下一阶段”视为已批准任务。

## 5. 恢复完成的最小产物

重新启动的第一轮应产生：

- 一份基于当时 HEAD 的差异审计；
- 一份新的短期实施计划，限定单一问题切片；
- 更新后的基准结果；
- 明确的正确性、确定性和性能验收标准；
- 是否继续实施的决策记录。

在这些产物形成前，不应修改布线算法。
