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

## 实施记录

### 2026-09-16：阶段 A 完成，阶段 B 进入受控实验

- `layoutGraph()` 现在返回各主阶段的增量/累计时间，以及 dummy、split edge、carrier 和 layered diagnostic 数量；回调同时取得同一份 timing 数据。
- `analyze:whole-layouts` 会输出这些阶段指标。设置 `SIMPLE_WHOLE_PROPER_LAYERING=1` 可运行 Whole proper-layering 实验；产品默认路径尚未切换。
- Whole 实验已接通现有 dummy/carrier/routing-driven spacing，并保持 `maxDummyNodes` 硬上限、稳定拓扑键和输入排列不变性。
- carrier 预验证复用单个 node spatial index，并在候选阶段遇到首个硬错误即停止收集重复诊断；Whole 每个 physical net 只生成一个规范 carrier 变体，Focused 保留九个有界修复偏移。

实测表明阶段 B 还不能默认启用：eq006 宽度 11,448 → 3,540，仍为 0 missing / 0 violation；但 eq007 虽然宽度 152,964 → 14,796，却出现 235 missing。将 Whole carrier 变体从九个收敛到一个后，eq007 总耗时由 97.2 秒降至 59.8 秒，carrier 构建由 40.2 秒降至 4.7 秒；旧逐边路由仍占 47.6 秒。这个证据确认下一步必须实现阶段 D 的 gap/physical-net 批量路由，不能把紧凑放置继续交给旧逐边 router。`wholeProperLayering` 因此默认 `false`，避免把已知回退带入产品路径。

### 2026-09-16：方向感知节点索引消除高画布查询悬崖

阶段细分确认 legacy edge 路径的主要成本是长竖段避障查询。旧二维 spatial hash 会沿一条约 10 万像素竖段枚举大量空 row bucket；新的 node index 额外维护 x/y 方向桶，竖段只查询相邻 x 桶、横段只查询相邻 y 桶，之后仍使用原几何谓词作权威判定。候选集合、评分和 hard rule 没有改变。

- eq007 Whole proper-layering：59.8 秒 → 34.7 秒；legacy edge 阶段 41.6 秒 → 17.6 秒；几何指标不变。
- eq012 默认 Whole：115.4 秒 → 37.0 秒；missing 仍为 177，几何指标不变。
- eq012 Whole proper-layering：34.7 秒，已经约为 ELK 23.3 秒的 1.49 倍，达到第一阶段性能门槛；但 compact geometry 下 missing 增至 441，仍不能启用。

### Stage D 失败分布（2026-09-16）

`analyze:whole-layouts` 现在会按物理网汇总 missing route 的扇出、最大跨层跨度、容量溢出和诊断码。eq012 Whole proper-layering 的 441 条 missing 属于 202 条物理网：其中 132 条是单扇出网，136 条物理网跨越至少三层，97 条物理网发生容量溢出。最大单项是 `clk`：832 扇出中仍有 128 条 missing，且不是容量溢出。

这组数据排除了“只提高高扇出 carrier 阈值”作为完整解法。低扇出长网才是未布通物理网的主体；同时，容量溢出只能解释约一半物理网，不能解释 `clk` 的剩余失败。

曾验证过直接把 inter-layer 容量分配连接成整网候选。eq012 上没有任何候选通过硬校验，并额外消耗约 5.8 秒，因此未保留。原因是 inter-layer allocation 只保证相邻列间隙中的竖向轨道，不保证横穿中间节点列的线段无障碍；它不是 ELK dummy slot 的替代物。Stage D 后续必须让长边 dummy 在放置阶段保留真实层内占位，再由这些占位生成物理网树，不能在 dummy 排序后立即全部剥离。

随后检查发现 carrier X 轨道生成器只采样 65 个位置，与容量规划器每 scope 最多 256 lane 的边界不一致。将它改为固定、命名的 256-track 上限，并把 Whole proper-layering 的 carrier 最小扇出从 8 独立降为 2（Focused 继续使用 8）后：

- eq012：missing 441 → 270，失败物理网 202 → 142，总布局 34.7 秒 → 28.2 秒；宽度仍为 41,399。
- eq007：missing 235 → 219，总布局约 34.7 秒 → 33.3 秒；宽度仍为 14,796。
- eq012 采用 carrier 的边数由 128 增至 634，legacy routing 阶段约 31.1 秒降至 24.3 秒。

该改动仍未达到正确性验收：eq012 剩余 270 条 missing 中，127 条仍来自 `clk`，另有 140 条失败物理网是跨至少三层的单扇出网。下一步需要解决超过 256 个同时活动 carrier 的边界分段/复用，以及高扇出 `clk` 的分层分支树，不能继续简单提高固定上限。

后续修正了对称采样在靠近边界时只能产生约一半有效 X 坐标的问题；采样次数仍固定为 256，但越界的一侧不再提前耗尽预算。eq012 missing 小幅降至 267、carrier edge 增至 654，`clk` 仍缺 127 条。高扇出优先实验没有改变 `clk`，因此未保留；这证明问题是 carrier 候选只覆盖长边子集，无法与同一物理网的 unit-span 分支一起原子提交，而不是 `clk` 在轨道排序中被饿死。

验证方面，单元测试 585/585 通过；远端规模基准的 1024/4096/8192-cell 布局中位数约为 167 ms / 1.15 s / 4.90 s。`MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases` 完整执行，但默认（未开启 Whole proper-layering）基线仍有 30/47 case 因既有 missing-route、violation budget 或 45 秒超时失败，因此不能把该结果作为本轮 proper-layering 的通过证据。

因此 Whole 当前已经从“性能悬崖”转为“路由正确性/批量通道模型”问题。下一项工作仍是按 gap 统一提交 physical nets，不能以放宽校验或接受 missing 换取默认启用。

### 2026-09-17：边界局部 X 轨恢复高扇出整网 carrier

新增的 carrier 覆盖摘要按物理网报告 fanout、所需 carrier、X/Y 锚点和缺失边界，并单独统计真正启用但锚点不完整的物理网。它揭示此前“候选只覆盖长边子集”的推断不准确：eq012 的 `clk` 与 `rst_n` 都有 9 个 Y 槽，唯独 boundary 0 缺 X，因此整个物理网候选在生成前被丢弃。

根因有两层：边界范围曾由该层所有节点决定，已经局部化到后续逻辑旁边的 input 会把 `leftEdge` 推过 `rightEdge`；X 安全检查又曾把候选竖线当作贯穿全图高度，其他层同 X 的节点也会误杀轨道。现实现只用实际启用 carrier 的 source/terminating target 定义水平通道，并按这些 carrier 真正覆盖的 Y 区间查询节点索引。候选数仍受共享 256-track 上限约束，最终几何仍由整物理网原子 validator 判定，不放宽任何 hard rule。

固定远端环境结果：

- eq012：missing 267 → 140，`clk` 的 127 条 missing 全部消失；布局 27.9 秒 → 24.2 秒，legacy edge routing 24.1 秒 → 11.6 秒；outer route ratio 7.9% → 0.9%。宽度保持 41,399，剩余 140 条全部是单扇出网。
- eq007：missing 219 → 215，布局约 33.3 秒 → 32.2 秒，宽度保持 14,796；`clk`/`rst_n` carrier 均完整。
- 单元测试 587/587 通过；1024/4096/8192-cell 布局中位数约为 165 ms / 1.16 s / 4.55 s。

高扇出树被接受后，eq012 的平均 bends 从约 1.89 上升到 2.94，但这是用边界内共享 carrier 取代逐边 outer fallback 的结果；物理 overlap 仍为 0，且画布宽度没有扩大。下一瓶颈已经明确转为 fanout=1 的长跨层网：它们目前被 Whole 的 `wholeCarrierMinimumFanout=2` 排除，eq012 剩余失败主要跨 3 至 7 层；eq007 剩余失败则主要是相邻层单网。下一步需要为单扇出长网提供不按每网永久扩高画布的共享 dummy/gap 轨道，并另行处理相邻层局部拥塞。

随后为单扇出长网增加了独立 span 门槛：Whole 仅为 source 不在 leading boundary、且跨至少 6 层的单网保留 carrier；高扇出网仍按 fanout 门槛进入。边界 X 轨不足时先按 fanout、span 和稳定 order 选择，确保 `clk/rst_n` 不被大量单网挤出。选择 span 6 来自对照实验：span 2 会把 eq007 的 span-4 单网也纳入，但其真实失败全是 unit-span，结果只增加 crossing；span 6 则不改变 eq007 几何。

- eq012：missing 140 → 94，总布局 24.2 秒 → 20.5 秒，routing 14.9 秒 → 11.1 秒；宽度保持 41,399，`clk/rst_n` 保持全链完整。
- eq007：保持 215 missing、宽 14,796、physical crossings 56,516，约 32.5 秒；没有因 eq012 的长网策略扩大画布或 crossing。
- 剩余 eq012 94 条均为 span-7 单扇出网，其中 53 条有容量溢出；当前边界 1 只有 247 个几何可用 X，仍有 135 个启用物理网链不完整。下一步应做按真实 Y 区间复用 X 轨道或分段 carrier，而不是继续提高固定轨道数。
