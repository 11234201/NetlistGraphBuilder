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
- [ ] P2 BK alignment blocks；
- [ ] P3 对称分支/分量 packing；
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
