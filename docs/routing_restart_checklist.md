# 布线问题恢复检查清单

本清单只在用户明确重新启动布线工作后使用。当前全部项目均为未启动状态。

## A. 上下文与工作区

- [ ] 阅读 `docs/routing_restart_handoff.md`。
- [ ] 阅读 `docs/routing_pause_snapshot_and_code_audit.md`。
- [ ] 阅读项目和 netlist-schematic 指令要求的文档。
- [ ] 记录当前 branch、HEAD、`git status`；保留用户已有改动。
- [ ] 比较 `1e4a220..HEAD` 的布线、布局、门禁和测试变化。

## B. 重新建立基线

- [ ] `npm test`
- [ ] eq012 Focused `_2021_` + `_2406_` spacing 矩阵：`4,8,16,32,64,84,88,160,320`
- [ ] `npm run test:mapped-cases`
- [ ] `npm run test:mapped-hard`
- [ ] PowerShell 下设置 `$env:MAPPED_CASE_NO_COLLAPSE = "1"` 后运行 mapped gate，并在完成后移除该环境变量。
- [ ] `npm run benchmark`
- [ ] 单独记录 dp020、sop015 的 logical missing-route、失败 physical-net、overflow-corridor、layout time 和 peak heap。

所有结果都应标注 HEAD、运行环境、命令和时间；不得直接沿用暂停文档中的数字作为新结论。

## C. 第一阶段只修诊断真实性

- [ ] `routedEdges` 不再包含 `routeKind: "unroutable"`。
- [ ] ordinary/hard gate 对 complete、provider status 和 violation 的含义一致。
- [ ] 空 physical wire route 的 `reachableTargetCount` 和 `treeFallback` 正确。
- [ ] logical edge、physical net、capacity overflow 三种计数可相互解释。
- [ ] 为上述语义添加 focused unit tests；不改变 route geometry。

## D. 选择一个容量切片

以下项目一次只启动一个：

- [ ] dense row-gap 超过 demand 上限时产生明确诊断和有界退化。
- [ ] outerTop/outerBottom 从 capacity allocation 到 placement expansion 闭环。
- [ ] blocked inter-layer edge 保留其他合法 corridor/lane 信息。
- [ ] physical-net tree 覆盖 reverse、same-column、mixed-alignment fanout。
- [ ] Adjust/ELK 与 Simple 对齐最低连通和原子提交合同。

被选项目必须先写清：拥有该约束的模块、失败 fixture、预期诊断、固定搜索上限和内存/时间预算。

## E. 每次实现后的门禁

- [ ] focused boundary test 通过。
- [ ] layout determinism 和 fixture invariants 通过。
- [ ] `npm test` 通过。
- [ ] mapped ordinary、hard 和 no-collapse 结果没有被隐藏或放宽。
- [ ] benchmark 无新的 edge-count cliff、无图规模 retry、无明显 heap 回退。
- [ ] eq012 原有零 hard violation 结果未回归。
- [ ] 文档记录成功、失败和性能数字，不只记录通过项。

## F. 停止条件

出现以下任一情况时停止扩大修改范围并重新评审：

- validator 需要被放宽才能通过；
- 候选数、lane 数或 retry 随图规模增长；
- 修复一个 fixture 导致其他 provider 或 no-collapse 明显回归；
- placement expansion 与 capacity allocation 无法给出一致几何解释；
- 指标无法区分真实未布通与门禁统计错误。

