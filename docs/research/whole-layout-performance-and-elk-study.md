# Whole 布局性能与 ELK Layered 对比调研

日期：2026-09-16

## 结论

Whole 模式当前不是单一的“算法偏慢”问题，而是布局质量与路由复杂度互相放大的结构性问题：

- Simple 在小图和部分大图上比 ELK 快，但层间距过度膨胀、跨层长线缺少虚拟节点参与排序，导致画布过宽、线长和交叉数明显偏高。
- `eq012` Whole 出现拓扑敏感的路由悬崖。Simple 的 115.4 秒中约 111.3 秒（96.5%）在路由阶段，并且仍有 177 条缺失路由和 185 个校验错误。
- 当前已经用于 Focused 视图的长边 dummy、physical-net carrier、routing-driven spacing 等能力被显式限制在 `hasFocusedBoundary`；Whole 仍走旧的端点排序、逐边候选、局部失败后全局回退路径。
- ELK 的优势不来自某一个“更聪明的拐弯规则”，而来自完整的分层流水线：长边被拆成逐层 dummy，dummy 与端口共同参与 crossing minimization，节点放置主动对齐连接，最后按层间 gap 一次性完成正交通道分配。

因此不建议继续给 Whole 的单条失败边增加候选。正确方向是把 Whole 提升为统一的 layered graph，再按层间 gap/physical net 批量分配有限通道，使候选数量和图规模保持可控。

## 对比方法

新增只读诊断命令：

```text
npm run analyze:whole-layouts -- tests/fixtures/mapped/equal/eq_012_mapped.v
```

它在同一进程、同一输入图上顺序执行 `simple-layered` 和 vendored `elkjs 0.11.1`，分别记录布局、校验和质量分析耗时，并报告尺寸、缺失路由、校验错误、物理交叉/重叠、平均线长、平均拐点数与外绕比例。测量环境为远端 Linux、Node.js 24.16.0；数值用于定位和相对比较，不作为跨机器绝对时限。

ELK 适配器当前只显式设置 Layered、RIGHT、ORTHOGONAL、节点/层间距和固定端口位置，其余使用 ELK Layered 默认策略。因此这组数据比较的是产品实际使用的 ELK 配置，而不是单独调优的 ELK 配置。

## 实测结果

| 用例 | 节点 / 边 | Provider | 布局耗时 | 宽 × 高 | 缺失 / 违规 | 物理交叉 | 平均线长 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| eq001 | 31 / 30 | Simple | 47.8 ms | 1,232 × 1,028 | 0 / 0 | 6 | 131 |
| eq001 | 31 / 30 | ELK | 179.3 ms | 1,130 × 1,242 | 0 / 0 | 0 | 165 |
| eq006 | 180 / 311 | Simple | 257.2 ms | 11,448 × 12,952 | 0 / 0 | 1,720 | 4,000 |
| eq006 | 180 / 311 | ELK | 566.4 ms | 1,556 × 12,366 | 0 / 0 | 256 | 1,554 |
| eq007 | 2,411 / 4,483 | Simple | 11.99 s | 152,964 × 128,266 | 2 / 3 | 75,970 | 62,732 |
| eq007 | 2,411 / 4,483 | ELK | 21.09 s | 2,854 × 123,409 | 0 / 0 | 5,655 | 18,598 |
| eq012 | 2,380 / 4,143 | Simple | 115.36 s | 182,852 × 120,908 | 177 / 185 | 157,940 | 59,294 |
| eq012 | 2,380 / 4,143 | ELK | 23.33 s | 30,660 × 133,100 | 0 / 0 | 27,858 | 22,043 |

主要比值：

- eq006：Simple 快约 2.2 倍，但宽 7.4 倍、交叉 6.7 倍、平均线长 2.6 倍。
- eq007：Simple 快约 1.8 倍，但宽 53.6 倍、面积 55.7 倍、交叉 13.4 倍。
- eq012：Simple 慢约 4.9 倍，同时宽 6.0 倍、面积 5.4 倍、交叉 5.7 倍，且没有满足可路由性契约。

这说明不能用节点数给 Simple 建立一个统一的性能模型。eq007 和 eq012 节点规模接近，耗时却相差近十倍；决定因素是物理网扇出、长边、容量溢出和逐边预留冲突组合。

## 当前实现的具体问题

### 1. Whole 没有让长边参与逐层排序

`simpleLayered.js` 只有图中存在 `focus-input` / `focus-output` 时才调用 `buildLayeredGraph()`。Whole 的长边只在源、目标层参与 barycenter 排序，中间经过的所有层看不到它；因此节点顺序无法为长线保留连续走廊。

后果是边路由阶段才发现阻塞，被迫走局部 detour 或画布外侧。此时再增加路由候选只能缓解个别边，不能修复由排序产生的系统性拥塞。

### 2. x 间距由端点压力推高，却没有转化为共享通道

`computeLevelXs()` 根据 boundary pressure、fanout spacing、lane pitch 和 congestion 扩大层间距。Whole 又没有启用 routing-driven spacing，所以高压力 gap 会直接扩宽。空间虽然增加，后续仍按 edge 独立搜索并预留折线，没有把这些空间先建模成有限、可共享的 gap lanes。

这解释了 eq006/eq007 中“运行不慢但图极宽”：算法用水平距离购买了可路由性，却没有获得 ELK 式紧凑通道。

### 3. 路由采用逐边多级候选，失败代价受既有线段影响

当前每条边依次经历 basic、local obstacle、reserved detour、可选 expanded local、lane shift 和 global fallback。每批候选都要查询节点空间索引、目标入口占用和已预留线段；随着路由推进，预留集合变大，后续边更容易失败并进入更贵的阶段。

eq007 的路由指标已经显示 2,777 次 local fallback、22,216 个 local candidates、524 次 global fallback，以及 145 个 capacity-overflow nets。eq012 的 111.3 秒路由时间和 177 条 unroutable 表明该拓扑把这个反馈环推过了悬崖。

空间索引避免了直接的全量扫描，但不能消除“很多边 × 多批候选 × 多段校验”的组合成本。

### 4. 交叉最小化与正交布线目标脱节

Whole 的层内排序主要看真实边端点。端口次序、长边 dummy、physical-net trunk 和通道容量没有共同进入排序成本；路由器只能在已经固定的节点坐标上补救。因此即使每一条线都正交，整体仍会出现大量来回穿越、超长横线和外绕。

### 5. 性能基准尚未覆盖产品实际 ELK 对照

现有大图 benchmark 只运行 Simple；mapped benchmark 的 provider 调用仍按同步接口编写，不能直接运行异步 ELK。此前又含有已退出产品路线的 collapse 指标。新增诊断脚本先提供可复现的双 provider Whole 数据，后续应把精简后的相对指标接入正式 benchmark，但不要把 ELK 的环境波动写成脆弱的单元测试硬时限。

## ELK Layered 的实现机制

ELK 官方将 Layered（Sugiyama）划分为五个主阶段，并允许在阶段之间插入预处理/后处理模块：[Layered overview](https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html)、[algorithm structure](https://eclipse.dev/elk/documentation/algorithmdevelopers/algorithmimplementation/algorithmstructure.html)。官方源码也按 `p1cycles` 至 `p5edges` 组织，并由 `LayeredLayoutProvider` 组装处理链：[ELK Layered source tree](https://github.com/eclipse-elk/elk/tree/master/plugins/org.eclipse.elk.alg.layered/src/org/eclipse/elk/alg/layered)。

1. Cycle breaking：默认 GREEDY，把图变成 DAG，同时保留反向边以便最终恢复。
2. Layer assignment：默认 NETWORK_SIMPLEX，目标不是简单 BFS 深度，而是在约束下减少总边跨度/图宽；长边随后以 dummy chain 表示。
3. Crossing minimization：默认 LAYER_SWEEP，用 barycenter 在相邻层反复扫动，并以 TWO_SIDED greedy switch 后处理。真实节点、dummy、端口/边次序在同一个相对顺序问题里处理。
4. Node placement：默认 BRANDES_KOEPF。它沿无冲突边建立垂直对齐块，再做水平压紧/平衡；这正是 ELK 图中连续水平主干、上下分支和视觉对称性的主要来源，而不是渲染器美化。
5. Edge routing：ORTHOGONAL 最后按相邻层之间的 gap 生成通道和 bend points，并据通道占用反推必要的层间 x 距离。节点放置阶段先确定 y，对齐关系和 dummy 链已经为路由建立了全局一致性。

当前产品配置对应的主要 ELK 默认值包括 NETWORK_SIMPLEX layering、LAYER_SWEEP crossing minimization、BRANDES_KOEPF node placement、ORTHOGONAL routing、DUMMY_NODE_OVER long-edge ordering、thoroughness 7；完整默认值见 [ELK Layered reference](https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-layered.html)。vendored elkjs 也支持返回模块列表和分阶段执行时间，后续可用 `logging` 与 `measureExecutionTime` 对齐阶段画像。

ELK 并不保证每个选项都适合本项目。例如 high-degree treatment 默认关闭，post compaction 默认 NONE；我们应借鉴阶段边界和数据模型，而不是逐项复刻 Java 实现或追求像素一致。

## 与 Simple 的能力差距

| 阶段 | ELK 默认思路 | Simple Whole 现状 | 优先补齐 |
| --- | --- | --- | --- |
| Cycle breaking | 全局 DAG 化并记录 reversed edge | 已有确定性层级处理，但目标较局部 | 保持稳定键，补齐反向边意图 |
| Layer assignment | Network simplex，降低跨度 | 基础层级 + 压力扩距 | 先做有界 min-span 改善，不必立即完整 simplex |
| Long-edge model | 每层 dummy chain | Whole 未启用 | 第一优先级 |
| Crossing minimization | dummy/port-aware layer sweep + greedy switch | 真实端点 barycenter 为主 | 第一优先级 |
| Node placement | BK 对齐块与压紧 | 多轮启发式 y placement | 第二优先级 |
| Orthogonal routing | 按 gap 批量分配通道 | 每 edge 多级候选与全局回退 | 第一优先级 |
| High fanout | edge/port order，可选 high-degree treatment | physical-net 能力仅 Focused 完整使用 | 第一优先级 |

## 实施方案

### 阶段 A：先建立可解释的性能画像

- 给 Simple 主流水线增加稳定的阶段计时：layering、dummy/order、placement、capacity planning、routing、finalization。
- 记录每个 physical net 的 edge 数、候选数、fallback 层级、空间索引查询候选数和最大值，不记录实例名特例。
- 给诊断脚本增加一组固定 mapped Whole 用例；输出 JSON 供人工/CI 趋势比较。

### 阶段 B：Whole 使用统一 layered graph

- 移除 `longEdgeDummies && hasFocusedBoundary` 的能力门，改为由统一 policy 和明确的 dummy 总量上限控制。
- dummy chain 贯穿 ordering、placement、routing，最后只在 provider 边界还原为原始逻辑边。
- 以 canonical topology key 排序，新增 node/edge 输入排列置换测试。
- 先复用现有 carrier graph 能力；遇到上限时采用可诊断的降级策略，不允许按图规模反复重试。

### 阶段 C：dummy/port-aware layer sweep

- 固定次数执行 left-to-right / right-to-left barycenter sweeps。
- crossing cost 同时考虑真实节点、dummy chain、端口位置和 physical-net trunk。
- 每次 sweep 后做有界 adjacent greedy switch；用增量的相邻层 crossing counter，避免全图重复计数。
- 对相同 cost 使用稳定拓扑键，不使用 parser/node array 顺序。

### 阶段 D：按 gap 和 physical net 分配正交通道

- 先将所有逐层 segment 按 layer gap 分组，再在每个 gap 内用区间扫描分配 lane。
- 同一 physical net 优先共享 trunk，分支在靠近端点的位置接入；高扇出网使用有界树高/分组策略。
- gap 所需宽度由实际 lane count 反推，取代 pressure × pitch 的预估式扩宽。
- hard rules 继续统一走共享 geometry validator；交叉数、弯折和偏离首选方向只作为 named scoring policy。
- global outer lane 仅作为有界的最后可达性回退，并设置每网/每边硬候选上限和明确的 unroutable 原因。

### 阶段 E：BK 风格对齐与压紧

- 在四个方向上构造 vertical alignment blocks，屏蔽会造成冲突的边。
- 计算四组紧凑坐标后取平衡结果，保留主链水平连接和上下分支的对称性。
- placement 只决定 y 和相对对齐；最终 x 由 gap routing 的实际容量确定，避免布局与路由互相反复推开。

## 验收标准

第一阶段以相对 ELK 指标为准，并同时约束正确性、尺寸、质量与耗时：

- 所有目标 Whole 用例：missing routes = 0、layout violations = 0、physical overlaps = 0。
- eq012：Simple 布局耗时先达到不超过 ELK 1.5 倍，稳定后收紧到 1.2 倍；宽度不超过 ELK 1.5 倍；物理交叉不超过 ELK 2 倍。
- eq007：保持不慢于 ELK；宽度从 53.6 倍降到 2 倍以内；缺失/违规归零。
- eq001/eq006：不得因统一流水线产生明显小图回退；eq001 的绝对耗时与画布尺寸需保留轻量快速路径。
- 全部布局结果通过 permutation determinism、fixture invariants、mapped full-node（`MAPPED_CASE_NO_COLLAPSE=1`）与常规测试。
- 路由搜索必须有与单 edge/net 相关的常量上限；禁止新增 graph-size-proportional retry 或 all-pairs 扫描。

性能目标应在固定远端环境重复至少三次取中位数。任何“更快”结果若通过遗漏路线、跳过校验或把线路推到超大画布获得，均不计为通过。

## 推荐开发顺序

先完成 A+B+C+D，再评估 E。对 Whole 最关键的是统一 dummy/physical-net 数据模型和 gap router；完整复刻 network simplex 或 BK 不是开始开发的前置条件。这样可以先消除 eq012 的候选悬崖和不可布线，再逐步逼近 ELK 的紧凑与对称性。
