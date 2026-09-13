# eq012 Focused 导航与末级输出布局修改方案

- 方案日期：2026-09-13
- 状态：方案已定义，尚未启动实现
- 复现场景：`tests/fixtures/mapped/equal/eq_012_mapped.v`
- Focused roots：`_1471_`、`_1746_`
- 深度：`faninDepth=3`、`fanoutDepth=3`
- 主要测量：Simple provider、`cellSpacing=88`、不折叠 group、strict routing
- 关联审计：[routing_plan_conformance_audit.md](routing_plan_conformance_audit.md)

## 1. 问题范围

本方案处理两个独立问题：

1. 在 Focused 左侧 Connection 面板点击 cone 外 connected cell 时，Single 视图自动切换到 Whole，触发全图布局、渲染和视口复位。
2. 末级 DFF 的 Q 与 Focused output 本可在相邻列水平直连，但 placement 先对齐、后分别重排两列，导致大量长竖线、全图顶部 `obstacle-lane` 和 `unroutable`。

两项修改必须分开提交和验收。导航修复不得依赖布局修改；terminal 布局修复不得在 UI handler 中加入特例。

## 2. 已确认的复现数据

指定场景在不折叠时得到：

- Focused graph：800 个 node、1102 条 edge；布局后因 fanout hub 为 803 个 node、1105 条 edge。
- Focused output 在 layout 前后均为 155 个，说明 derived boundary node 没有在数据层丢失。
- DFF 驱动 Focused output 的 edge 为 134 条，其中 128 条是单扇出，6 条是多扇出。
- 134 条中只有 2 条为 `direct`；132 条 source/target pin 未对齐。
- pin 的纵向距离中位数为 6710 px，最大为 13970 px。
- 49 条为 `obstacle-lane`，35 条为 `unroutable`；至少 9 条使用 `y<=224` 的顶部走廊。

代表边 `_1786_.Q -> y_out[40]` 的 placement stage trace：

| 阶段 | source Q y | output pin y | 结果 |
| --- | ---: | ---: | --- |
| `align-driven-links` | 5726 | 5726 | 正确对齐 |
| `resolve-level-overlaps` | 15680 | 8750 | 相差 6930 px |
| 后续全部 placement stages | 15680 | 8750 | 没有恢复约束 |
| routing | - | - | `unroutable` |

这证明主要问题不是 router 没有生成一个额外折点，而是 placement pipeline 破坏了自己刚建立的 source-target 对齐关系。

## 3. 问题一：Connection 导航为什么进入 Whole

### 3.1 当前路径

详情面板通过 `inspectGraphNode(state.fullGraph || state.graph, node)` 展示完整模块中的 connected cell。因此，Connection 列表出现 cone 外对象是有意行为。

点击目标后，`navigateSingleSelectionTarget()`：

1. 先调用 `focusSingleSelectionTarget()` 在当前 positioned graph 中查找；
2. 目标不在 cone 内时，只要它存在于 `fullGraph`，就执行 `setSingleViewMode("whole")`；
3. transform 复位并重新运行 Whole graph layout/render；
4. 完成后再定位目标。

这一行为是 UI handler 中写死的 fallback，不是 ViewSession 或 graph projection 的必要限制。Search 入口已经使用 application 层 `selection.reveal` 在 Focused 中显示隐藏 cell，Connection 入口没有复用该能力。

### 3.2 目标行为

| 点击目标 | 默认行为 |
| --- | --- |
| 已在当前 Focused graph | 只 select + center，不重布局 |
| cone 外 cell，root 数未满 | 保持 Focused，将目标加入 roots 并设为 active |
| cone 外 cell，两个 root 已满 | 保持 Focused，用目标替换 active root，保留另一个 root |
| 已是非 active root | 只切换 active + center |
| cone 外 net | 保持当前图，展示 net 详情；由具体 peer cell 完成 drill-through |
| 用户明确选择 Open in Whole | 才进入 Whole |

fanin/fanout depth、provider、spacing、collapse policy 和未被替换的 root 必须保留。重新计算范围应保持为 Focused 子图，禁止先构造 Whole positioned graph 再裁剪。

### 3.3 实现边界

1. 在 application command 层新增 connection traversal 语义，或扩展 `selection.reveal` 使调用者可以明确传入 `replace-active` 策略。
2. root replacement 必须使用 canonical object ref；当 roots 已满时按 active ref 定位替换槽，不按数组末尾猜测。
3. `main.js` 只派发 command、消费 effects、在 render 完成后 select/center；删除 Connection handler 的隐式 Whole fallback。
4. Compare 保持“不自动扩大为 Whole”的现有安全行为，并与 Single 共享目标解析 helper。
5. Whole 入口保留为显式按钮或明确的二级 action。

### 3.4 导航验收

- Focused 中点击 cone 外 cell 后 `viewMode` 仍为 `focused`。
- 双 root 场景只替换 active root，另一个 root 不变。
- 不调用 Whole provider，不把 full graph 送入 layout/render。
- visible target 只触发 viewport effect，不增加 computation revision。
- 目标不存在、位于 collapsed group 或超过跨 module 边界时返回明确状态，不静默切 Whole。
- Single/Compare、搜索和 Connection navigation 的纯 command tests 均通过。

## 4. 问题二：为何 `obstacle-lane` 先走到顶部

### 4.1 `obstacle-lane` 的实际几何

`createGlobalLaneRoute()` 固定生成：

```text
source pin
  -> source escape X
  -> global lane Y
  -> target escape X
  -> target pin Y
  -> target pin
```

当 `global lane Y` 是整图上边界时，视觉结果就是“从 Q 向上到最顶端、向右、再向下接 output”。

### 4.2 为什么会选择整图顶部

route selection 的顺序是：

1. `direct`、`local-dogleg`、普通 channel；
2. local obstacle candidates；
3. reservation detour 和有限 lane shift；
4. global fallback；
5. 无合法候选则 `unroutable`。

global Y candidates 明确包含：

- preferred/capacity lane；
- `minTop - margin - index * pitch`；
- `maxBottom + margin + index * pitch`；
- 节点间 gap lanes；
- 最终兜底再次尝试整图 top/bottom。

`findObstacleAvoidingRoute()` 返回遇到的第一条通过 node、endpoint 和 foreign-net hard validation 的候选，并不把所有 global 候选交给统一质量评分。更根本的是，当前没有“只要局部包围盒内存在 hard-valid 路径，就禁止进入 outer lane”的候选等级合同。`crossing` 虽然名义上是软成本，但默认代价为 `100000`，ordinary routing 又只容忍有限的额外交叉；它实际上可以驱使一条无节点障碍的局部路线输给跨越整图的 top/bottom 路线。

这条优先级本身不合理。垂直爬到画布顶部不是“更少交叉的普通优化”，而是局部区域不可达后的逃生路线。只要 source-target 相邻区域内存在不穿节点、不与异 net 共线/近共线重叠、端点方向正确的正交路线，outer candidate 就不应进入比较集合。普通垂直/水平线交叉是软问题，可以画 bridge，不能仅为减少它而把线拉到全图边界。

### 4.3 为什么“直接到 output 高度”没有被采用

router 已经会生成 source pin 水平离开、在中间 X 竖到 output 高度、再水平接入的 `local-dogleg`。它在单条 edge 上并非缺失。

但当前 placement 将 128 对单扇出 DFF/output 的 Y 坐标大幅拆开。每一条原本水平的线都变成需要一条长竖段的 dogleg，并在只有约一个层间间距宽度的区域争抢不同 X lane。随着 reservation 增加，后面的 dogleg 可能与已布 foreign net 共线/近共线重叠，或者产生较多普通交叉。前一种必须由 hard validator 拒绝；后一种只应影响同一局部等级内的质量排序，不应把路线升级到全图顶部。当前实现没有严格区分这两种情况。

所以存在两层问题：

1. **上游根因**：placement 制造了不必要的纵向通道需求。
2. **下游候选等级错误**：global fallback 不理解 local reachability 和 terminal locality，允许语义上荒谬但几何合法的全图绕行参与普通择优。

只修改第二层会把大量 edge 从顶部绕行改成 `unroutable`，不能恢复本来应有的水平直连。

## 5. terminal-aware placement 合同

### 5.1 新建 TerminalAttachmentIntent

在 topology/layout-intent 边界识别 terminal edge，不按 DFF 名称或实例名判断。候选条件为：

- target kind 是 `output` 或 `focus-output`；
- source pin 是真实 output direction；
- source、target 属于同一 canonical physical net；
- 记录 source/target side、fanout、source pin、稳定 topology key。

建议数据：

```js
{
  edgeId,
  physicalNetKey,
  sourceNodeId,
  sourcePin,
  targetNodeId,
  targetPin,
  preferredAxis: "horizontal",
  preferredPinY,
  minimumHorizontalSpan,
  fanout,
  stableRank
}
```

这是 derived layout intent，不修改 parser IR 或 source graph。

### 5.2 调整 placement pass 顺序

当前 `align-driven-links` 在 `resolve-level-overlaps` 之前，后者按每个 level 独立移动节点，导致约束失效。目标流水线为：

```text
topology + SCC levels
  -> place core nodes
  -> resolve core overlap/locality
  -> place terminal nodes from final source-pin geometry
  -> pack terminal attachments as coupled pairs/bands
  -> capacity plan and one bounded expansion
  -> reserve/route terminal stubs
  -> route remaining physical nets
  -> final validator
```

不得简单把旧 `align-driven-links` 在结尾再调用一次，因为它会在多个 terminal 竞争同一位置时重新制造 node overlap，也没有形成可供 router 消费的 corridor。

### 5.3 单扇出 terminal

对单扇出 cell-output edge：

1. output 放在 source 右侧相邻 terminal column；
2. target input pin Y 与 source output pin Y 相等；
3. 两者间水平矩形 corridor 在 placement 阶段登记；
4. route 阶段首先验证并提交两点 `terminal-direct` route；
5. 只有真实 obstacle/override 破坏 corridor 时才进入局部 terminal fallback。

eq012 中的 128 条单扇出 DFF/output 应走该合同，但实现不得检查 `DFF`、`Q`、`y_out` 或 `_1746_` 等名称。

### 5.4 多扇出 terminal

6 条多扇出 DFF/output 不能被拆成互相独立的 net：

- output branch 优先保留同 Y 水平 terminal stub；
- 其他 loads 从同一个 physical-net tree/trunk 分支；
- 整棵 net 继续原子 validation/commit；
- 不重复登记共享 trunk。

### 5.5 terminal packing

terminal 输出按 `preferredPinY`、physical-net key、target key 稳定排序。若两个 terminal body 真实重叠：

1. 优先使用 source rows 已有的空隙；
2. 在固定大小邻域内做最近可用 row 分配；
3. 必要时把 source-terminal 作为耦合 component 一起位移，而不是只压缩 output 列；
4. 超过命名上限时产生 `terminal-placement-capacity`，不进入无界迭代。

### 5.6 分层修正

不折叠复现中 DFF 为 level 10、outputs 为 level 11，X 层级正确；主要错误是 Y 约束被破坏。但 collapsed/feedback 图的 `assignSimpleLevels()` 会在 Kahn queue 耗尽时选择任意未处理节点打断 cycle，可能先处理 downstream output，使 sink 留在 level 1。

后续应以 SCC condensation DAG 分层：

- 先求 cell feedback SCC；
- 在 SCC DAG 上计算稳定 level；
- input/focus-input 是 source anchor；
- output/focus-output 是 sink，至少为所有 predecessor level 的最大值加一；
- collapse/group 节点不能使 terminal 回到 source 左侧。

## 6. terminal routing policy

1. terminal direct corridor 是 placement 保证，route 只做验证和提交，不通过全局搜索重新猜测。
2. terminal fallback 只允许固定数量的相邻 X dogleg，范围限制在 source/target 相邻列及命名 clearance 内。
3. terminal route 不得直接进入 generic outer top/bottom fallback。
4. 如果局部 corridor 因 override 或真实 obstacle 不可满足，返回：
   - `terminal-placement-conflict`；
   - `terminal-corridor-occupied`；或
   - `terminal-route-unroutable`。
5. 路由选择改成严格的候选等级，而不是把所有路径放进同一加权分数：
   - Tier 0：两点 direct；
   - Tier 1：不离开 source-target 局部包围盒（加命名 clearance）的 L/Z/local dogleg；
   - Tier 2：已分配的相邻层 channel/corridor；
   - Tier 3：outer top/bottom escape。
6. 只要 Tier 0--2 中存在 hard-valid candidate，Tier 3 不得生成或不得被选择。perpendicular crossing、bend 和 length 只在同一 tier 内排序。
7. `routeOverlapsReserved()` 所代表的异 net 共线/近共线重叠继续是 hard rule；普通垂直-水平 crossing 是 soft rule，并通过 bridge 表达。两者不能继续共享一个会把 outer route 提升为首选的模糊冲突分数。
8. terminal edge 默认禁止 generic outer top/bottom。若局部区域真的被节点或 hard overlap 封死，应回到 terminal placement 重新选择有界 row，或明确返回 terminal capacity failure；不能绕完整张图。
9. 一般跨层 net 只有在 Tier 0--2 全部因硬约束不可达时才能使用 `obstacle-lane`。outer penalty/detour ratio 只能在 Tier 3 内排序，不能代替等级门禁。

## 7. 文件级修改地图

| 文件/边界 | 修改方向 |
| --- | --- |
| `src/application/view_commands.js` | 增加 connection traversal 的 `replace-active` Focused 语义 |
| `src/app/single_view_session_bridge.js` | 投影 roots/active/selection，保持 Focused 状态 |
| `src/app/main.js` | Connection click 改为 command dispatch；Whole 仅显式进入 |
| `src/layout/simpleLayering.js` | 用 SCC DAG 和 terminal sink 约束替换任意 cycle breaker 的副作用 |
| `src/layout/layoutIntent.js` | 生成 `TerminalAttachmentIntent` 和稳定 terminal rank |
| `src/layout/simplePlacementPipeline.js` | core placement 后再执行 terminal placement/packing |
| `src/layout/nodeAlignment.js` | 将普通 driven alignment 与 terminal attachment 分开 |
| `src/layout/nodeSpacing.js` | 增加耦合 terminal packing，不再独立压缩 output column |
| `src/layout/channelCapacity.js` | 接收已预留 terminal corridor，避免把水平 terminal stub 算成长 net lane demand |
| `src/layout/simpleOrthogonalRouter.js` | terminal routes 优先原子提交；隔离 generic outer fallback |
| `src/layout/simpleRouteCandidates.js` | terminal bounded local candidates；建立 local/channel/outer 候选等级与 outer 可达门禁 |
| `src/layout/routeScoring.js` | crossing/bend/length 只在同一候选等级内排序，不用巨大 crossing 权重跨等级选择 outer |
| `src/layout/routeSearchPolicy.js` | 命名 local envelope、outer eligibility 和 terminal outer 禁止策略 |
| `tests/unit/eq012-focused-routing.test.js` | 加入 `_1471_` + `_1746_` terminal 回归 |
| application/UI tests | 加入 cone 外 Connection 点击不切 Whole 的回归 |

## 8. 分阶段实施

### T0：先锁定失败

- 固定 eq012 双 root、depth 3、collapse off、spacing 4/88。
- 记录 terminal edge 数、pin delta、route kind 和 unroutable 数。
- 增加 navigation command 测试，证明当前 Connection fallback 会进入 Whole。

### T1：修复 Connection navigation

- 实现 Focused drill-through 和 active-root replacement。
- UI 改用 application command。
- 单独提交并执行 view/session/UI tests；不得触及 layout。

### T2：拆分 core 与 terminal placement

- 建立 terminal intent。
- core overlap 收敛后再放 terminal。
- 加入稳定 terminal packing 和 permutation tests。

### T3：terminal corridor 与优先路由

- placement 预留水平 corridor。
- 单扇出先提交 `terminal-direct`。
- 多扇出纳入 physical-net atomic tree。
- terminal 禁止 generic outer fallback。
- 一般 edge 只有 local/channel hard-infeasible 时才允许 outer tier。

### T4：SCC、provider 与全量门禁

- 修正 cyclic/collapsed 分层。
- 明确 Simple 的 terminal contract；Adjust override 后复用 shared terminal validator；ELK 输出规范化后检查同一约束。
- 运行 focused、determinism、fixtures、`npm test`、mapped ordinary/hard/no-collapse 和 benchmark。

## 9. 验收标准

### 9.1 导航

- Connection 点击 cone 外 cell 后仍是 Focused。
- 两 root 满载时稳定替换 active root，其他 root 保留。
- 没有 Whole layout/render，也不先构造 Whole positioned graph。
- 用户仍可通过明确操作进入 Whole。

### 9.2 eq012 terminal

- 128 条单扇出 DFF -> Focused output 的 source/target pin Y 全部相等。
- 上述 128 条全部为 `terminal-direct`/等价两点水平 route。
- 上述集合 `obstacle-lane=0`、`unroutable=0`。
- 6 条多扇出 net 的 output branch 保持局部水平接入且 physical tree 连通。
- 不出现 terminal edge 到全图 top/bottom 的路径。
- 任意 edge 只要局部包围盒内存在 hard-valid route，就不得选择 top/bottom outer route。
- 普通 perpendicular crossing 不得单独触发 outer tier；foreign-net collinear/near-parallel overlap 仍为零。
- Focused output node 数在 transform、layout、render scene 中保持一致。
- node/edge 输入排列变化后 normalized terminal placement 和 route 不变。

### 9.3 性能

- terminal intent 构建为 `O(E)`；packing 为 `O(T log T)`，其中 T 为 terminal 数。
- placement/capacity 固定 pass，不引入 route -> move -> reroute 循环。
- Focused navigation 只布局新 cone；不得触发 Whole 大图 provider。
- 1024/4096/8192 benchmark 中位数回退不超过 15%，p95 不超过 25%；否则停止扩展并记录原因。

## 10. 明确不采用的修复

- 提高 top lane 数量或扩大画布来容纳错误 placement。
- 只提高 direct/local route 的评分。
- 放宽 foreign-net overlap、node crossing 或 endpoint validator。
- 在流水线末尾无条件再跑一次旧 alignment。
- 为 DFF、Q、`y_out`、eq012 实例或坐标加特例。
- 用更大的默认 `cellSpacing` 掩盖 terminal pairing 丢失。
- 增加随 terminal/edge 数增长的 candidate retry。
