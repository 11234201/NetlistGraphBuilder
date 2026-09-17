# Simple 向 ELK 靠近：平衡分层放置实施计划

日期：2026-09-17  
状态：执行中  
分支：`dev`

## 1. 当前结论

Simple 已具备稳定分层、长边 dummy、物理网 carrier、容量规划和有界正交路由，但节点的初始
纵向坐标仍由 `placeInitialNodes()` 对每一层独立执行“从顶部开始顺序紧凑堆叠”。随后
`resolveLevelOverlaps()` 主要向下消除重叠。这两个阶段共同造成以下结果：

- 短层与长层的顶部对齐，图的视觉重心不一致；
- 相邻层的节点中心和端口难以自然对齐，直连边减少；
- 分支在局部修正后出现“先向右、再向下、再向右”的不一致折线；
- 空白集中在各层底部，而不是分配到逻辑分支之间，整体缺少 ELK layered 的平衡和对称感。

这不是单纯增大间距能解决的问题。后续放置改为“排序固定、对齐成块、双向压缩、整体居中”，
路由只消费放置结果，不承担修复层内结构的职责。

## 2. Golden 与验收场景

ELK layered 作为视觉和结构 golden，但不要求逐坐标一致。固定使用：

1. eq012，Focused net `clk`，fanin/fanout 深度 1/1；
2. eq012，Focused cell `_1471_`，fanin/fanout 深度 3/3；
3. eq007 Whole；
4. eq012 Whole；
5. 小型分叉、汇聚、菱形和长边单元测试。

硬门槛：

- eq007/eq012 Whole 保持 missing route = 0、layout violation = 0；
- mapped full-node 失败数不得高于当前基线 14/47；
- 节点不重叠、层内顺序不反转、布局与输入数组排列无关；
- 路由搜索仍有界，不增加图规模比例的重试或全配对扫描；
- `npm test`、layout determinism、layout fixtures 全部通过。

质量指标：总高度/面积、直连边比例、边总垂直位移、折点数、交叉数、层中心离散度、outer route
比例。性能用 `npm run benchmark` 记录，不以牺牲正确性换取单项视觉分数。

## 3. 实施阶段

### P1 — 平衡初始放置（当前阶段）

- 新增独立 layered placement 模块；
- 先按实际节点高度和间距计算每层高度，再围绕全图共同中轴放置，不再顶部对齐；
- 正向/反向读取相邻层端口锚点，以中位数形成 preferred y；
- 在保持层内顺序和最小间距的前提下，从上下两个方向压缩并择优；
- 由 `policy.features.balancedLayerPlacement` 控制，保留原路径作为回退点。

### P2 — BK alignment blocks

- 标记 type-1 conflict，长边 dummy/carrier 链优先保持垂直坐标连续；
- 使用端口偏移而不是节点中心构造 alignment block；
- 计算四个方向组合（层遍历方向 × 层内方向）；
- 选择高度、垂直位移和直连收益综合最优的可行 variant。

### P3 — 对称分支与连通分量

- 围绕主链/Focused 锚点放置上下分支，而不是统一向下展开；
- 弱连通分量先独立布局，再按确定性 packing 合并；
- 共享时钟/复位网只影响其相关 block，不把整个层拉到同一顶部。

### P4 — 放置与路由一致性

- 水平优先的直连边保留 source/target port 同 y；
- 同一物理网的 trunk/branch 使用一致方向和共享 carrier；
- gap routing 消费 placement 给出的 block 与锚点，outer lane 只作有界兜底；
- 将“右—下—右”仅保留给确有障碍或容量约束的边。

### P5 — 默认开启与收尾

- 完成两组 Focused golden 的 Simple/ELK 对照报告；
- 跑 Whole、mapped、benchmark 回归并记录前后指标；
- 删除仅为旧顶部堆叠补偿的冗余局部修正；
- 分阶段提交到 `dev`，验收后合并 `master`。

## 4. 实现边界

- 排序只使用稳定拓扑键和 canonical id，不依赖输入数组顺序；
- 放置偏好与几何硬约束分离，最终合法性仍由共享 validator 判定；
- 不使用 eq012、`clk`、`_1471_`、实例名或绝对坐标特判；
- 不修改 parser/Netlist IR；dummy、block、carrier 都是派生布局数据；
- 手工 override 最后生效，不参与自动算法反馈。

## 5. 当前执行记录

- [x] 定位顶部紧凑堆叠的根因与后处理放大机制；
- [x] 固定 golden、Whole 回归和性能门槛；
- [x] P1 平衡初始放置原语与单元测试（策略开关下验证，默认开启待 P2 回归）；
- [x] P2 BK alignment blocks（四方向、type-1 冲突、block-aware compaction 与择优已完成）；
- [x] P3 对称分支/分量 packing；
- [ ] P4 路由一致性；
- [ ] P5 全量验收、提交、推送与合并。

### 2026-09-17 P1 A/B

| 场景 | 策略 | W × H | crossing | physical crossing | outer | missing / violation |
| --- | --- | ---: | ---: | ---: | ---: | ---: |
| clk 1/1 | legacy | 1,311 × 88,344 | 196,608 | 512 | 0 | 0 / 0 |
| clk 1/1 | balanced | 1,311 × 88,344 | 196,608 | 512 | 0 | 0 / 0 |
| `_1471_` 3/3 | legacy | 6,370 × 26,008 | 89,511 | 2,844 | 6 | 0 / 0 |
| `_1471_` 3/3 | balanced | 6,346 × 25,984 | 89,259 | 2,831 | 4 | 0 / 0 |

结论：平衡原语对 `_1471_` 有小幅全面收益，但 `clk` 的列中心离散度从 8,084 增加到
18,748，说明全层中位数压缩会破坏高扇出结构已经形成的全局对称轴。P2 不得直接扩大 P1 的
启用范围；必须以 alignment block 为移动单元，并把列中心离散、端口垂直位移和直连保持计入
variant 评分。任何候选只要不优于 legacy 几何就回退。

### 2026-09-17 候选择优上线

- Simple 在 feature 开启时分别完成 legacy 与 balanced placement，再以高度、列中心离散、端口
  垂直位移和对齐边数量评分；
- balanced 若令列中心离散恶化超过 5%（且超过两个最小 gap）则无条件回退；
- `clk` 1/1 自动选择 legacy，最终指标与原结果逐项一致；
- `_1471_` 3/3 自动选择 balanced，保留 P1 的宽高、crossing 和 outer 改善；
- 策略已改为默认开启，旧路径仍是逐图自动回退点；全量单元回归 597/597 通过。
- 双候选择优当前只作用于 Focused：8192-cell Whole benchmark 首轮从约 5.24 s 增至 5.90 s，
  证明 Whole 双跑 placement 不满足性能目标。Whole 继续单路径，待 P2 block 原地计算后再开放。
- Whole 单路径修正后的远端 benchmark（1024/4096/8192 cells）为 200.5 ms / 1,278.3 ms /
  5,109.1 ms，恢复并略优于此前约 207 ms / 1.40 s / 5.24 s 的基线；
- `MAPPED_CASE_NO_COLLAPSE=1 npm run test:mapped-cases`：47 个 case 中失败 14，与进入本阶段前
  基线一致；eq007、eq012 Whole 均 PASS 且 violation = 0。

### 2026-09-17 P2 alignment block 起步

- 按既有层内顺序为每个 target 选择中位 predecessor，构造每层至多一个成员的确定性 path block；
- block 使用真实端口 y offset，不假设节点中心等价于连接点；
- 高扇出 source 标记为冲突，不绑定任意单个 branch，继续作为软中位数偏好；
- Focused 同时保留 legacy、balanced、balanced+block 三个候选，block 只能在既有 P1 最优结果上
  继续改善，不能替换或吞掉已经验收的 balanced 收益；
- `_1471_` 3/3：6,322 × 25,984，physical crossing 2,844 → 2,813，outer 6 → 4，
  missing/violation 保持 0/0；逻辑 crossing 暂为 90,009，后续四方向 variant 需将其纳入择优。

### 2026-09-17 四方向 variant

- 已实现层遍历 forward/backward × 层内 forward/backward 四种 block 构造；
- 四个 variant 只执行轻量的居中、block 对齐和有序压缩，用 placement score 选出最多一个进入
  完整 locality/overlap pipeline，完整后处理仍最多运行 legacy、balanced、block 三次；
- 若四种 block 都不优于 balanced，直接复用 balanced 对象，不重复运行第三次 pipeline；
- 当前两张 golden 最终仍由既有最优候选胜出：`clk` 指标不变，`_1471_` 保持
  6,346 × 25,984、crossing 89,259、physical crossing 2,831、outer 4、0/0。
- `layoutMetrics.placement` 现在记录选择结果及所有 variant 的 height、center spread、port delta、
  aligned edge count 和 score；对比工具在 compact 报告中直接输出这些诊断。
- `_1471_` 诊断显示当前 block variant 仅保留 18 条对齐边，而完整 balanced placement 为 452；
  port delta 也从约 2.78M 增至 7.13–7.18M。根因是 block 建立后仍被逐层 compaction 拆散，
  下一步必须实现 block-aware compaction，不通过调低权重让坏候选胜出。

### 2026-09-17 block-aware compaction

- 同一 block 使用一个共享 anchor，成员坐标由真实端口 offset 派生；
- 同层相邻节点转为 block 间差分约束，拓扑求解最小可行坐标，检测到环则 variant 作废；
- type-1 conflict 用层边界上的单调 rank 过滤，交叉 alignment edge 不进入同一组约束；
- 四个 raw variant 先彼此择优，只有一个进入完整 pipeline；最终仍与 balanced 同阶段比较；
- `_1471_` 当前选择 balanced，保持 6,346 × 25,984、89,259 crossings、outer 4、0/0；
  block 能完整运行但尚未优于 balanced，后续不再以调权重作为优化手段。

### 2026-09-17 P3 对称 fanout 候选

- 相邻层同源 fanout 按既有 target 顺序围绕 source 真实端口上下对称展开；
- 多 source 对同一 target 的偏好取中位数，node/edge 数组排列不影响结果；
- symmetric 与 balanced 分离：raw score 先筛选，胜出者才进入完整 pipeline，最终再次和 balanced
  比较；因此该实验能力不能吞掉 P1 已验收收益。
- 弱连通分量按稳定拓扑 id 独立纵向 packing，保持分量内部几何；多分量结果若扩大画布会在同一
  raw score 门槛被淘汰。
- P3 收尾全量测试 610/610；两张 golden 保持 `clk` legacy、`_1471_` balanced 的既有最优结果。
