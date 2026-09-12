# eq012 Focused 路由异常调查报告

- 调查日期：2026-09-12
- 调查对象：`tests/fixtures/mapped/equal/eq_012_mapped.v`
- 复现场景：Focused 根节点 `_2021_`、`_2406_`，`faninDepth=3`，`fanoutDepth=3`，`cellSpacing=4`
- 文档状态：调查完成；实现已进入阶段 0/1，残余问题与门禁持续跟踪
- 配套方案：[eq012_focused_routing_remediation_plan.md](eq012_focused_routing_remediation_plan.md)

## 1. 结论摘要

这三个现象不是三个独立的小缺陷，也不是 ELK、渲染层或输入顺序造成的随机结果。它们来自同一组长期存在、彼此叠加的路由体系问题：

1. 路由器没有在统一边界上强制执行“不得穿节点、不同物理 net 不得共线重叠、端点必须连通、路径必须在画布范围内”等硬约束。
2. 局部候选、全局候选和兜底候选走不同的检查路径，多个提前返回及最终兜底可以绕过完整冲突检查。
3. Focused 边界节点完成局部搬移后仍保留原拓扑层级；路由规划按旧层级选通道，放置和路由看到的是两个不同的空间模型。
4. 放置只保证 cell 外框不相交，没有为引脚逃逸段和正交通道预留容量。`cellSpacing=4` 时，`_1314_` 与 focus-input `_0198_` 之间只有 4 px，低于当前 8/9/24 px 的路由安全距离，局部问题在几何上已经不可满足。
5. `simpleRoutingPlan` 计算了顶层/侧边车道需求，但放置阶段没有消费这些容量；因此名义上的 top lane 落进节点区域，随后只能向画布顶部或底部绕行。
6. 路由候选过少、同分排序有方向偏置、搜索截断较早，并且垂直通道主要按固定比例生成。这会系统性地产生“先上/下走到很远，再折返”和垂直线重叠，而不是偶发现象。
7. 物理 net 的分组身份与冲突检测身份不一致，逐 edge 预留还会重复登记同一 fanout trunk，导致漏检与虚高惩罚同时存在。
8. 现有单测和 mapped-case 门禁没有覆盖 Focused 小间距、跨物理 route 重叠、端点连通和 bounds；所以当前 387 项测试全过并不能证明路由结果安全。

因此，继续调整单个权重、增加某个特例、提高默认间距或扩大搜索次数，只会改变症状出现的位置，不能根治。修复必须先统一硬约束和 net 身份，再让放置容量、Focused 局部化、候选生成和树路由使用同一套几何合同。

## 12. 实施后的复核结论（2026-09-12）

本轮提交已经把报告中的“身份不一致、重复 reservation、无界搜索、provider 无状态出口、bounds 未统一”等结构性原因分别收敛到共享模块，并新增 `npm run test:mapped-hard` 作为零容忍入口。单元测试当前为 `395/395`，eq012 focused 双根 spacing 矩阵通过。

但这不等于 full mapped corpus 已完成。严格运行 eq012 全图仍会报告 `net-overlap` 与部分 `node-crossing`；稠密 datapath/sop 图的主要残余不是 validator 漏报，而是如下真实几何问题：

- collapsed group 的多个 boundary edge 在没有独立 escape corridor 时，会从不同 pin 进入相同外围 y lane；
- `allocateIntervalLanes()` 已经能按 interval 分配 lane，但当前 placement 尚未把 outer band 的 `requiredSpan` 应用到节点集合，lane 坐标可能落在已占用的 node/route 几何附近；
- router 为避免“找不到候选”仍保留 node-safe fallback，因此在 reservation 饱和时会保留合法正交但 foreign-net overlap 的线路；这正是严格门禁需要继续阻断的状态，不应再被评分权重掩盖；
- 对这些路径简单开启全量 reservation 检查会触发大量候选重试，dp005/sop004 曾出现数量级的时间回退。因此性能约束和通道容量实现是正确性修复的一部分，不能最后再补。

下一阶段的最小实现单元是 boundary-cluster corridor：先按 physical net 合并同一 group boundary 的 escape 区间，分配有限 row/side lane，再让候选只消费已分配 channel。完成该单元后，才允许把 strict overlap 检查提升为默认 mapped 门禁；在此之前，普通 runner 的 32/120 预算仅是趋势观测，不能解释为硬合同通过。

## 2. 复现范围与事实

### 2.1 输入和图规模

相关 Verilog 锚点如下：

- 输入 `clk`：`eq_012_mapped.v:1171`
- 输入 `rst_n`：`eq_012_mapped.v:1179`
- net `_0179_`：`eq_012_mapped.v:183`
- net `_0198_`：`eq_012_mapped.v:202`
- cell `_1314_`：`eq_012_mapped.v:2015`
- cell `_2021_`：`eq_012_mapped.v:6268`
- cell `_2406_`：`eq_012_mapped.v:8963`

完整 netlist IR 为 2380 个节点、4143 条边；上述 Focused 参数得到 21 个节点、23 条逻辑边和 17 条物理 wire route。直接调用 Simple provider 和经过 `buildModuleWorkspace()` 的完整 UI 数据流，均能复现同类错误，说明问题位于共享放置/路由边界，而不是某一个 canvas handler。

### 2.2 校验器的确定性报错

`validateLayoutGraph()` 在 `cellSpacing=4` 下稳定报告三项：

1. `_0179_` 的逻辑 route 穿过 focus-input `_0198_`；
2. `clk` 与 `rst_n` 存在 `net-overlap`；
3. `_0179_` 的物理 wire route 穿过 focus-input `_0198_`。

反转 root 顺序、节点数组顺序和边数组顺序，输出几何不变。因此这是确定性策略缺陷，不是 parser statement order 或数组迭代顺序抖动。

### 2.3 关键坐标

| 对象 | 几何或 pin 坐标 |
| --- | --- |
| `input:clk` | 节点 `(48,227,92,28)`，输出点 `(140,241)` |
| `input:rst_n` | 节点 `(48,340,92,28)`，输出点 `(140,354)` |
| `_2021_` | 节点 `(436,128,128,144)`；`CK=(436,164)`，`RN=(436,236)` |
| `focus-output:clk` | 节点 `(436,300,154,36)`；pin `y=318` |
| `_2406_` | 节点 `(436,364,128,144)`；`CK=(436,400)`，`RN=(436,472)` |
| `focus-output:rst_n` | 节点 `(436,536,154,36)`；pin `y=554` |
| `_1314_` | 节点 `(1212,282,128,108)`；`Z=(1340,336)` |
| `_0198_` | focus-input 节点 `(1344,302,154,28)`；输出点 `(1498,316)` |
| `_0309_` | 纵向范围 `338..366` |
| `_0314_` | 纵向范围 `374..402` |
| `_1450_` | 节点 `(1518,244,128,180)`；`A1=(1518,280)`，`A2=(1518,316)` |

这些坐标直接暴露了两个不同层面的不可行性：

- `_1314_` 右边界为 `x=1340`，`_0198_` 左边界为 `x=1344`，cell 外框间距只有 4 px；
- 当前候选校验的节点 padding 为 8 px，局部通道常用 9 px，全局 clearance 为 24 px。

也就是说，放置结果按“外框不相交”是合法的，但按路由合同并不合法。

### 2.4 三条代表性错误路径

#### A. `clk` 与 `rst_n` 水平重叠

`clk -> _1893_` 使用水平段 `y=38, x=164..1188`；`rst_n -> _1893_` 使用水平段 `y=38, x=168..1192`。两者是不同 net，却在同一 y 上发生长距离共线重叠。

`rst_n` 的全局候选首选 `y=192`，搜索到的第一个 node-safe 候选是 `y=38`。全局搜索只在部分竖直腿上查询 reservation，并在找到第一个不穿节点的完整路径后立即返回，没有对整条路径执行 `routeOverlapsReserved()`。因此它没有继续尝试仍可用的 `y=14` 等候选。

#### B. `clk -> _2406_` 和紫色 focus-output 先下绕再返回

`clk -> _2406_` 实际路径为：

```text
(140,241) -> (164,241) -> (164,644) ->
(268,644) -> (268,400) -> (436,400)
```

到紫色 focus-output 的路径复用同一底部走廊，再返回 `y=318`。两条 route 均被标记为 `obstacle-lane`。

本地 dogleg 候选中：

- `x=288` 有共线重叠；
- `x=226` 和 `x=350` 没有共线重叠，但各有一次垂直相交；
- 三者综合分数都约为 `100535`。

候选按固定生成顺序选择同分项。已选 local route 有 overlap 时，当前 outer-detour 例外条件 `!localHasOverlap` 又不成立，结果反而选择了更长的全局底部绕行。

计划中的共享 fanout trunk 也无法发挥作用。Focused 搬移后的 focus-input 仍保留 `level=0`，`computeLevelBounds()` 因此把 level 0 右边界扩到 `x=1498`，使 `clk` 的规划 trunk 变成约 `x=1570`，远在目标 `_2406_` 的 `x=436` 右侧，方向已经错误。

#### C. `_0179_` 穿过 `_0198_` 后再折返

实际路径为：

```text
(1340,336) -> (1364,336) -> (1364,24) ->
(1494,24) -> (1494,280) -> (1518,280)
```

其中 `x=1364` 的竖直段穿过 `_0198_` 的外框 `x=1344..1498, y=302..330`。直观路径若按零 padding 可以是：

```text
(1340,336) -> (1506,336) -> (1506,280) -> (1518,280)
```

但在 padding 为 4、8 或更大时，`_0198_`、`_0309_`、`_0314_` 组成了局部障碍墙；4 px 的 cell gap 也容不下安全逃逸段。普通 cell-source 的局部候选固定从 `source.x+24` 起步，只改变 y，不生成足够的扩展 x 候选。所有候选失败后，Simple 路由器的最终 fallback 会直接返回未通过校验的 base route，所以穿节点结果仍被输出。

### 2.5 路由质量数据

`cellSpacing=4` 时：

| 指标 | 值 |
| --- | ---: |
| direct route ratio | 0.522 |
| 总 route 长度 | 8933 |
| 去重后 wire 长度 | 7668 |
| 消除的重复长度 | 1265 |
| bend 数 | 32 |
| crossing count | 19 |
| overlap count | 1 |
| outer route | 5 / 23（21.7%） |

原始 Simple 图声明高度为 620，但 route 最大 y 为 644；完整 UI 管线增加顶部 headroom 后，高度为 780，route 最大 y 仍达到 804。两者都超出 SVG viewBox 24 px，说明 graph bounds 未包含 wire extents。

### 2.6 cell spacing 扫描

| cellSpacing | 校验结果 | outer routes | 代表性行为 |
| ---: | --- | ---: | --- |
| 4 | `_0179_` node-crossing、`clk/rst_n` overlap、物理 crossing | 5 | `clk` 走底部 `y=644`；`_0179_` 到 `y=24` |
| 8 | 同上三项 | 5 | `clk` 改走顶部 `y=24`；`_0179_` 仍到 `y=24` |
| 16 | 仅 `clk/rst_n` overlap | 5 | 穿节点暂时消失 |
| 32 | 仅 `clk/rst_n` overlap | 4 | `_0179_` 能走局部通道 |
| 84 | 无当前硬违规 | 1 | `clk` 使用局部 dogleg |
| 160 | 无当前硬违规 | 4 | `clk -> _2406_` 又走顶部 `y=24` |
| 320 | 无当前硬违规 | 4 | 仍有顶部外绕 |

结果对 spacing 不单调。增大间距会让某些候选暂时可行，也会改变候选排序和通道选择，使外绕在更大间距下重新出现。因此“把 cell spacing 调大”只能作为临时规避，不能作为修改方案。

## 3. 根因树

### 3.1 硬约束没有统一执行

当前不同路径执行的合同不同：

- `routeCandidateValidation.js` 只有在调用方显式传入 `rejectReservedOverlaps` 时才拒绝 reservation overlap；
- local、global、outer 和 fallback 的调用方式并不一致；
- Simple、Adjust 和 ELK 没有共同的最终硬校验/重试边界；
- `layoutValidator.js` 的物理 route 检查只检查单条 route 内部，没有检查不同物理 route 之间的重叠；
- 校验器没有覆盖端点吸附、目标可达、连通分量、树 fallback 完整性和 wire bounds。

所以当前系统可以产生“搜索器知道候选不好，但 provider 最后仍返回”的结果。

### 3.2 多个提前返回绕过统一评分

以下流程会在完整候选集合形成前结束：

- local obstacle 搜索遇到第一个零冲突候选立即返回；
- global 搜索遇到第一个 node-safe 候选立即返回；
- Adjust 遇到第一个零冲突候选立即返回。

这意味着调整评分权重并不能影响这些路径。历史上虽然统一了 conflict score，实际控制流仍没有统一使用它。

### 3.3 穿节点 fallback 是显式行为

Simple 在所有候选失败后返回未经验证的 base route；outer 搜索可返回“第一个 node-safe 但仍与 reservation 重叠”的候选；Adjust 可返回最后一个无论是否合法的候选；ELK 也没有 provider 后的共享校验。

这不是漏掉一个 `if`，而是 API 没有表达“无合法 route”这一状态。只要函数必须返回 path，非法 path 就会被包装成成功结果。

### 3.4 Focused 局部化发生得太晚

当前主要顺序是：

```text
levels -> layout intent -> routing plan -> placement -> locality -> routing
```

focus-input 先按外部边界节点参与层级与车道规划，随后才被搬到其内部目标附近。搬移后它仍带着旧 `level=0`，导致：

- `computeLevelBounds()` 看到错误的列范围；
- fanout trunk 被规划到目标右侧；
- long-edge/top-lane 判断继续按搬移前拓扑执行；
- 实际路由空间与预计算 capacity 不一致。

### 3.5 放置合法性弱于路由可行性

`nodeSpacing.js` 的 post-locality 检查只修复实际外框相交，不检查：

- port 方向上的 escape corridor；
- 正交线宽、padding 与 wire lane pitch；
- 多个相邻 focus boundary 节点形成的通道墙；
- 目标 pin 前的最小接入长度。

eq012 的 4 px gap 是最直接证据。只要 placement 可以输出路由不可行的几何，后续 bounded router 就必然需要非法穿越或远距离外绕。

### 3.6 路由容量计划未被放置消费

`simpleRoutingPlan.js` 已计算：

- `longLaneCount`；
- `maxSideLanes`；
- 每条边的 top/source/target lane。

但 `simpleLayered.js` 下游主要只消费 `edges`，顶部空间仍固定为 80。eq012 中 `longLaneCount=8`、`maxSideLanes=8`、pitch 为 24，需要的通道规模远大于固定 headroom。`clk -> _1893_` 的 top lane 6 对应首选 `y=168`，`rst_n` 的 top lane 7 对应 `y=192`，而 cell 已从 `y=128` 开始；名义 top lane 实际位于节点区域。

此外，`layoutIntent.boundaryPressure` 取现有值与 fanout 的最大值，而 `simpleRoutingPlan.channelLanes` 按 net/edge 分配独立车道。放置容量和路由需求使用了两个不一致的模型。

### 3.7 候选空间过窄且存在确定性方向偏置

普通 local X 候选只有 `[0.5, 0.25, 0.75]` 三个固定比例。列对齐或坐标重复时，不同 edge 会反复得到相同竖直段；扩大 cell spacing 只会把同一模式拉长，不能增加通道多样性。

`collectLocalLaneYs()` 的主要距离项在 source/target 区间内是常数；同分后按 y 升序，因此系统性偏向上方候选。这解释了 `_0179_` 先上到很高位置的稳定趋势。

Focused 的扩展 local 候选又只对 `source.kind === "focus-input"` 且 secondary fanout 生效。普通输入 `clk` 不满足条件，所以无法使用原本为类似拥塞场景加入的补救搜索。

### 3.8 候选截断把“找得到”变成“永远看不到”

当前关键上限包括：

- local alternatives 最多 8 个；
- 计入评分的冲突最多 8 个。

稠密区域中，前 8 个候选可能都不合法，而后续合法候选根本不会进入评分。冲突数封顶还会把差异较大的候选压成同分，再由生成顺序决定方向。

限制搜索规模本身是正确的性能要求，问题在于候选生成没有按空间拓扑和独立通道做覆盖保证，截断前也没有区分硬冲突与软代价。

### 3.9 穿越与共线重叠被混成一个软分数

`routeScoring.js` 把垂直相交和共线重叠都累加到 `crossings`。但二者性质不同：

- 垂直相交可以在渲染层通过 bridge 表达，通常是软质量问题；
- 不同 net 的共线重叠无法区分电气归属，必须是硬禁止；
- 穿节点同样必须是硬禁止。

三者共用一个可权衡分数后，短但非法的候选可能与长但合法的候选进入同一排序；再叠加提前返回，最终行为难以预测。

### 3.10 逐 edge 路由与物理 net 树不一致

Simple 按逻辑 edge 逐条选 route 并登记 segment，同一 fanout net 的共享 trunk 会被重复登记。`RouteSegmentIndex` 没有几何去重，后续 net 因此可能对同一 trunk 计多次冲突。eq012 中 `clk -> focus-output` 对 reservation 的原始冲突数为 5，但只有 2 段独立几何。

之后的 `netTreeRouter` 只对 provider 已输出的路径做并集和树选择；其设计前提就是输入 route 已经合法。它能消除重复长度，但不能把穿节点或重叠路径修成合法路径。设计文档也明确记录“native net topology generation”仍未完成。

### 3.11 net 身份在不同边界不一致

`wireRoutes.js` 用 `(source, net)` 形成物理分组，冲突检测和 validator 却主要使用 `segment.net`，同名 net 会被当成同一对象跳过冲突。对于同名但不同 driver 的组，这可能漏报重叠，也会让 renderer 的 bridge 判定产生歧义。

正确的冲突身份应使用 canonical physical net group key；display net name 只能用于标签，不能用于电气或几何等价判断。

### 3.12 bounds 不包含 wire extents

`simpleLayered.js` 的图宽高主要来自节点与固定 margin，`svgRenderer.js` 直接使用该 bounds 生成 viewBox。outer route 可以到达节点 bounds 之外，但没有统一的 route extent 合并步骤，所以线段可被裁切，鼠标 hit area 也可能与可视区域不一致。

### 3.13 ELK 和 Adjust 仍有平行缺口

虽然 eq012 当前主要由 Simple 复现，但共享合同必须覆盖所有 provider：

- ELK 将所有非 RIGHT port 映射为 WEST，TOP/BOTTOM 信息丢失；
- `attachToExactPorts()` 总是假设水平 `±24` escape trunk；
- 缺失 section 时会生成经过 `(0,0)` 的 fallback；
- ELK 输出后没有共享硬校验；
- Adjust 在无法找到合法候选时返回 `lastCandidate`。

如果只修 Simple，同一类错误仍会在 provider 切换、手动布局或 Compare 模式中复发。

### 3.14 策略归一化仍有私有范围

`topWireLanePitch` 在局部实现中被私自限制为 `8..48`，而公共 policy 允许 `wireLanePitch=4..96`。这违反“在 owning boundary 归一化”的项目约束，也会在高 wire spacing 下低估实际通道间距。

## 4. 为什么这些问题反复修复仍会回来

历史修改多数解决了一个症状，但没有收敛合同：

| 变更 | 解决内容 | 保留的缺口 |
| --- | --- | --- |
| `c6d2612`（2026-07-15） | 统一 route conflict scoring | 多个提前返回绕过评分；硬/软冲突仍混合 |
| `651fd2e` | 增加可选 `rejectReservedOverlaps` | Simple 并非所有路径都启用；不是 provider 强制合同 |
| `7f7537c`（2026-08-07） | 将 local 搜索从 16 收敛到 8 并限制冲突计数 | 候选覆盖不足，合法候选可能被截断；mapped runner 默认关闭 overlap 检查 |
| `075aa41`（2026-08-18） | 加入垂直 lane reservation | 测试只覆盖一段竖线；完整 route 和水平共线重叠仍可漏过 |
| `e4e3f96` / `cc571a9` | 增加 node-safe outer/compare 路由 | 最终仍允许非法 fallback |
| `618e2d3`（2026-09-03） | 为 Focused secondary fanout 增加扩展搜索 | 仅覆盖 focus-input 特例；回归 fixture 使用 `cellSpacing=84`，未触发 eq012 小间距问题 |

共同模式是：新增策略放在某个候选分支，而硬约束没有放到所有 provider 必经的最终边界。后续优化搜索、缩小上限或增加新 provider 时，同类错误就从另一个出口重新出现。

## 5. 普遍性抽样

为判断问题是否局限于 eq012，对远端镜像中的 47 个 mapped fixture 做了目标抽样：每个 case 最多选择 4 对 clock/reset 双根，`faninDepth=3`、`fanoutDepth=3`，走 UI 默认 Focused transforms；超过 500 节点的场景跳过 2 个。每个 spacing 有 179 个有效场景。

| spacing | 有硬违规的场景 | 受影响 case | net-overlap 对数 | 水平 / 垂直 | logical+physical node-crossing 报告 | outer/global fallback >10% | route 越界 |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 4 | 169 / 179 | 45 / 47 | 5637 | 2481 / 3156 | 1707 | 142 | 144 |
| 8 | 160 / 179 | 44 / 47 | 5359 | 2443 / 2916 | 211 | 135 | 113 |
| 84 | 142 / 179 | 44 / 47 | 6469 | 1818 / 4651 | 59 | 130 | 100 |
| 160 | 135 / 179 | 44 / 47 | 7006 | 1021 / 5985 | 111 | 122 | 93 |

解释边界：

- overlap pair 可能因多段共线而呈二次增长，适合比较趋势，不等同于独立缺陷数；
- logical 和 physical node-crossing 可能重复报告同一几何穿越；
- 这是针对 clock/reset Focused 的抽样，不是所有 root 组合的穷举；
- spacing 4 时 crossing 多数发生在 focus-input，报告中约 1458 项属于该节点类型；
- spacing 160 时 node crossing 较少，但问题转为 local-dogleg 和大量垂直共线重叠；
- 所有抽样中 `treeFallbackRuns=0`，证明该指标不能代表 route 几何安全。

抽样结果确认：现象覆盖 44 至 45 个 fixture，不是 eq012 特例；增加 spacing 只改变违规类型，并没有稳定降低总 overlap。

## 6. 已排除或不是主因的方向

### 6.1 parser 和 inference

相关 canonical net、cell、pin 连接在 IR 中正确。错误发生在确定的几何阶段，没有证据指向 parser statement 或 pin inference。

### 6.2 renderer

renderer 会放大重叠和裁切的可见影响，但输入 polyline 已经非法。只修改 SVG path、bridge 或 z-order 会掩盖问题，不能恢复电气可读性。

### 6.3 root / 数组顺序

排列反转后几何不变，符合稳定排序要求。问题不是非确定性，而是稳定地选择了错误候选。

### 6.4 overrides 和 Golden/Adjust

复现中没有 node override，也不需要 Golden/Adjust。它们不是 eq012 的触发源，但其输出边界存在同类合同缺口，需要在统一修复中覆盖。

### 6.5 hub threshold 和 collapse

`clk` 的当前 fanout 为 4，不触发相关 hub 阈值。collapse 也不是三条代表性错误路径的必要条件。

## 7. 当前测试为何没有阻止回归

远端 `npm test` 共 387 项全部通过，但存在以下覆盖空洞：

1. `tests/unit/layout-fixtures.test.js` 只覆盖少量示例和两个 fixture，没有 mapped Focused 小间距用例。
2. `tests/unit/sop-focused-layout.test.js` 只测 sop015、root `_4558_`、`cellSpacing=84`，避开了最拥塞条件。
3. `tools/test-one-mapped-case.mjs` 对 validator 传入 `checkOverlaps:false`，并使用整图与默认 group collapse，无法捕获本报告场景。
4. `tools/test-mapped-cases.mjs` 允许单 case 32 项、总计 120 项违规，不符合硬约束应为零的目标。
5. 物理 validator 没有跨 route overlap、端点 attachment、连通性和 bounds 检查。
6. 没有测试证明 `longLaneCount`、`maxSideLanes` 会转化为 placement headroom/side space。
7. 现有 reservation 测试偏重单条竖线，没有水平共线、重复 fanout trunk 和不同 driver 同名 net。

因此，当前测试更像“算法能返回且结果大致可用”的回归，而不是“所有输出满足路由合同”的门禁。

## 8. 代码责任边界

| 责任 | 当前主要文件 |
| --- | --- |
| provider 总流程、bounds | `src/layout/simpleLayered.js` |
| 放置与 Focused 局部化顺序 | `src/layout/simplePlacementPipeline.js`、`src/layout/nodeLocality.js` |
| post-locality spacing | `src/layout/nodeSpacing.js` |
| route order、reservation、候选选择 | `src/layout/simpleOrthogonalRouter.js` |
| local/global/outer 候选 | `src/layout/simpleRouteCandidates.js` |
| 候选硬校验 | `src/layout/routeCandidateValidation.js` |
| 冲突计数和几何相交 | `src/layout/orthogonalRouting.js`、`src/layout/routeScoring.js` |
| routing capacity plan | `src/layout/simpleRoutingPlan.js`、`src/layout/layoutIntent.js` |
| lane 候选与排序 | `src/layout/routeLaneCandidates.js` |
| reservation index | `src/layout/spatialIndex.js` |
| canonical physical net 分组 | `src/layout/layoutTopology.js`、`src/layout/wireRoutes.js` |
| 物理树后处理 | `src/layout/netTreeRouter.js` |
| Adjust / ELK 输出 | `src/layout/localOrthogonalRouter.js`、`src/layout/elkLayoutProvider.js` |
| 最终 validator | `src/layout/layoutValidator.js` |
| SVG bounds 消费 | `src/render/svgRenderer.js` |

## 9. 风险分级

### P0：必须先消除的正确性风险

- route 穿过节点；
- 不同物理 net 共线重叠；
- route 端点不连接或目标不可达；
- provider 返回未经验证的 fallback；
- wire 超出声明 bounds。

### P1：导致反复回归的结构风险

- Focused 搬移后层级/规划信息未重算；
- placement 不消费 routing capacity；
- net identity 不统一；
- provider 各自拥有不同的最终合同；
- 逐 edge 路由后才拼物理树。

### P2：质量和可维护性风险

- 候选固定比例与向上偏置；
- 同分由生成顺序决定；
- reservation 重复计数；
- 垂直 crossing 与共线 overlap 混分；
- outer route 比例高、线长和折点过多。

## 10. 最终判断

用户观察到的三种现象属于同一条因果链：

```text
Focused 局部化与旧层级不一致
        + placement 未预留真实路由容量
        + 候选覆盖不足/排序偏置
        + 分支式、可选式硬校验
        + 非法 fallback
        = 穿节点、共线重叠和远距离折返
```

eq012 只是能清楚展示这条链的最小代表案例。抽样结果表明它已是 mapped Focused 的系统性问题。下一步不应再加入坐标、实例名或单 fixture 特例；应按配套方案把硬约束、容量、net tree 和 provider 输出收敛到共享边界。

## 13. 2026-09-12 最新实现复核

本轮提交后又复核了三条实现边界：

1. `RouteSegmentIndex` 的 owner replacement 已从“过滤后完整 rebuild”改成 tombstone。活动项仍保留在 `items`，旧桶记录通过 `inactiveSegments` 过滤，`queryBox`、`queryVerticalSegment`、`countBox` 和迭代器不会看到失效 owner；只有显式 `compact()` 才回收旧桶。这解决的是 Adjust/增量 reroute 的更新成本，不是初次 route 的 overlap 算法。
2. reservation lane shift 现在在固定的 6 个水平偏移和 12 个 source/target 纵向组合内尝试，并且每个组合都经过 endpoint side、node obstacle 和 foreign-net overlap 合同。它不会把候选次数变成 edge 数量的函数，也不会把非法 fallback 伪装成成功。
3. 远端 1024/4096/8192 长链中位数 layout 约为 `132.7/894.2/3232.3 ms`，SVG 约为 `61.2/239.5/717.6 ms`；这些数据用于复杂度回归。全量普通 mapped 门禁仍有 `dp_018/019/020`、`sop_015` 四个失败（`380/120` 违规），严格 collapsed eq012 仍有截断后的 `net-overlap`。因此剩余问题不是测试遗漏，而是 collapsed group boundary 的真实 corridor/outer lane 尚未被 placement 完整消费。

### 13.1 未完成问题的具体定义

对每个 `group -> group` 的反向 skip-level demand，当前 allocator 只有 `outer-top/outer-bottom` 的 lane index；它没有同时给出：

- source group 的可用 escape x 区间；
- target group 的可用 escape x 区间；
- 该 boundary cluster 在 top/bottom band 中的 y corridor；
- 与同一 cluster 的其它 physical net 的不可共享 owner 集合。

于是 route candidate 可能拿到一个合法的单 edge 外框，但多个不同 physical net 仍会回到相同的水平 y 或 source/target 竖直 x。若强制所有 candidate reservation-free，当前布局又没有足够的 node-safe x corridor，会退化为 node crossing 或极长搜索。正确修复必须先由 placement 为发生 demand 的 boundary cluster 增加有限 row/escape 空间，再由 router 消费同一个 cluster token；不能仅提高全局 `topWireSpace`、`cellSpacing` 或 outer retry 次数。

### 13.2 下一实现切片

下一切片应保持固定上限，按以下顺序推进：

1. 从 `buildRoutingCapacityPlan()` 输出 stable `boundaryClusterKey`、source/target escape side 和 cluster demand count；不改变现有 route 选择。
2. 在 placement 只对有 demand 的 cluster 做 row/escape expansion，并在 `routingCapacity.metrics` 记录 expansion 前后 span。
3. 让 `applyCapacityLane()` 同时消费 cluster y token 与 source/target escape interval；route candidate 必须验证该 token 的 node-safe corridor。
4. 加入一个 synthetic group-boundary 单测，再逐个复测 eq012、dp005、sop004、sop015 及 1024/4096/8192 benchmark；任何 node-crossing 或 P95 超预算都停止扩展。

### 13.3 本轮已实现的窄 row-gap corridor

本轮将第 13.2 节的第一步落成了一个受限实现，而不是把所有跨层 net 复制到每个节点间隙：

1. `buildRoutingCapacityPlan()` 先按 intermediate level 建 physical-net demand index，再检查同一层相邻节点的 x 投影；只有实际形成 corridor 的 pair 才生成 `row-gap:<level>:<upper>-><lower>` channel。
2. 已经至少容纳一条 lane 的 gap 不再枚举所有长 net；窄 gap 才进入 `allocateIntervalLanes()`。单个 gap 的 demand 上限为 64，超过上限时保留原有 inter-layer/outer 策略，避免把全图 edge 数转换成 row lane 数。
3. `requiredRowGap(k)=2*C+(k-1)*P`，扩容只对同一 level 中 lower node 及其下方 suffix 一次性下移；实现使用 level 分组和 suffix event 累加，复杂度为 `O(N+R)`，不对每个 channel 重扫全部 node。
4. row-gap assignment 进入 `allocationByNet` 和 `routingMetrics.capacity`，但不会被不带 level 匹配的 edge 盲选为全局 `preferredLaneY`。一个 skip-level edge 可能跨越多个 row gap，当前仍由 inter-layer/outer assignment 选择主坐标，避免词法首个 gap 改变普通 Focused route。
5. 因此这一步解决的是“窄 group boundary gap 没有最小开放高度”的 placement 缺口，不宣称已解决 dense collapsed 图的 outer top/bottom 共享段。

验证结果：新增 `tests/unit/channel-capacity.test.js` 的 synthetic group corridor 与宽 gap demand 上限用例；本地 `npm test` 为 403/403；eq012 Focused spacing matrix、sop015 Focused 三项均通过。远端长链 benchmark 为 1024/4096/8192 layout `132.9/784.0/3334.6 ms`、SVG `60.4/247.1/715.8 ms`；dp020 单 case 约 `25.1 s`，相较上一轮未出现由 row-gap pass 引起的通道数/内存爆炸。普通 mapped 仍有 `dp_018`、`dp_019`、`dp_020`、`sop_015` 四个失败；cap=32 的试验曾将总违规由 `380/120` 降至 `369/120`，但把 top band 推到 800 px、最大堆推至约 337 MiB，已收紧为 cap=8。cap=8 只保留 224 px bounded headroom，四个残留 case 没有稳定的硬违规下降，因此不能宣称 outer band 已解决。

### 13.4 本轮新增的 bounded top headroom 与 strict 出口

本轮继续补齐阶段 2/5 的两个边界，但保留兼容开关，避免 corridor/tree 完成前改变普通图：

1. `planSimpleRouting()` 的 `longLaneCount` 只在存在 collapsed group 时作为 top-band demand；`computeTopWireHeadroom()` 将 demand 转成 `margin + requiredOuterBand(lanes)`，并以 `MAX_PLACEMENT_OUTER_LANES=8` 封顶。超过 8 条的部分记录 `overflowLaneCount`，不通过放大画布掩盖容量不足。
2. `routingCapacity.metrics.topWireHeadroom`、`placementCapacity.topWireHeadroom` 暴露 demand、保留 lane、overflow、headroom，供 UI/报告诊断；普通无 group 图保持既有 80 px 下限，避免层次图坐标无谓漂移。
3. Simple router 支持 `strictRouting:true`：当候选没有 node-safe 且 foreign physical-net overlap-free 的结果时生成 `routeStatus:"unroutable"`、空 points 与诊断，不将非法 global fallback 交给 renderer。默认 workspace 仍保持兼容，`tools/test-one-mapped-case.mjs --hard` 显式启用该出口，便于逐步收紧门禁。

严格模式在 sop015 上的复测会把约 2,897 条无法同时满足现有 reservation/obstacle 合同的边明确标为 `unroutable`，而不是输出非法 polyline；这证明出口语义生效，也说明 cluster corridor 尚未完成，不能将此数字当作质量改善。

### 13.5 后续必须补齐的实现问题

下一步不能简单把 row-gap 上限从 64 调大。要完成方案，还必须补齐：

- **cluster-to-route binding**：把 `boundaryClusterKey` 解析成 source/target escape x interval、row corridor y span 和不可共享 physical owners，并让 candidate 只消费同 cluster token；
- **真实 outer band placement**：top/bottom lane 当前仍主要是 lane preference，不能让所有 long demand 共享同一外框水平段；需要固定一次的 band expansion 和 bounds 合并；
- **native physical-net tree**：当前 tree 是 provider route 的后处理，dense fanout 仍逐 logical edge 选择 candidate；需要 source-rooted trunk/branch 一次生成后再给 edge 投影；
- **硬失败提交语义**：当上述 corridor 和 outer band 都没有合法候选时，provider 应提交 `unroutable` 诊断而不是保留可渲染但非法的 fallback polyline；
- **provider 一致性**：ELK 四向 port、Adjust override 和 shared final validator 仍要消费同一 cluster/band contract。

每一项都必须保留固定候选上限、spatial index 查询和 physical-net owner 去重；若增加 row/outer 空间导致 layout P95 超过基线 25%，应退回 placement 设计，而不是关闭 hard validation。
