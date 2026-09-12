# Focused 正交路由系统修改方案

- 方案日期：2026-09-12
- 方案状态：待实施
- 问题报告：[eq012_focused_routing_investigation_report.md](eq012_focused_routing_investigation_report.md)
- 首要回归场景：eq012 Focused `_2021_` + `_2406_`，`faninDepth=3`，`fanoutDepth=3`，`cellSpacing=4`

## 1. 目标

本方案的目标不是让 eq012 的三条线“看起来顺一些”，而是建立所有 layout provider 必须遵守的路由合同，使同类问题不能通过其他候选分支、其他 provider 或未来优化重新出现。

### 1.1 硬目标

完成后，每个已提交 layout 必须满足：

1. route 不穿过非端点节点及其规定 clearance；
2. 不同 canonical physical net group 不得共线重叠；
3. route 的起点和终点精确连接声明的 source/target pin；
4. 每个物理 net 的所有 target 从 source 可达；
5. polyline 只包含正交、非零长度且已规范化的 segment；
6. graph bounds 包含所有 node、wire、label 和 hit area 的必要范围；
7. Simple、Adjust、ELK、Single、Compare 和 Focused 走同一个最终校验边界；
8. provider 找不到合法 route 时返回明确失败/诊断，不得把非法 fallback 当作成功结果。

### 1.2 质量目标

在满足硬约束后，依次优化：

1. 避免无必要的 outer detour；
2. 优先“直接向右/向下再向右”等局部可读路径；
3. 同一 net fanout 使用共享 trunk，减少重复长度；
4. 将不同 net 的垂直交叉作为软成本，将共线重叠保持为硬禁止；
5. 保持 route 对输入语句、节点数组和 edge 数组排列不敏感。

### 1.3 非目标

- 不通过 `_2021_`、`_2406_`、`_1314_`、`_0179_` 等实例/net 名称加特例；
- 不用固定坐标补丁修 fixture；
- 不把提高默认 `cellSpacing` 当作根治；
- 不引入 graph-size-proportional 重试、全量 all-pairs 扫描或新运行时依赖；
- 不把完整几何问题下沉到 renderer 掩盖。

## 2. 总体设计

修改分成五道连续边界：

```text
canonical physical net identity
        -> route-aware placement capacity
        -> bounded candidate generation and scoring
        -> native physical net-tree routing
        -> shared final validation + bounds normalization
```

任何 provider 可以用自己的初始布局或候选策略，但必须输出同一结构，并通过同一硬校验后才能进入 render/UI。

## 3. 核心数据合同

### 3.1 统一物理 net 身份

新增或集中一个 canonical helper，例如：

```js
GetPhysicalNetKey({ source, net })
```

实际命名遵循现有 JavaScript 风格，但语义必须固定为 `(canonical source id, canonical net id)`。以下位置统一使用该 key：

- logical edge 的 `netGroupKey`；
- reservation segment 的 owner；
- `wireRoutes` 分组；
- conflict skip-same-net；
- validator；
- renderer bridge 判定；
- quality metrics 和 diagnostics。

display name 只用于标签，不能参与几何等价判断。

### 3.2 分开硬冲突和软成本

候选评估结果建议统一为：

```js
{
  hardViolations: {
    nodeCrossings,
    foreignNetOverlaps,
    invalidSegments,
    detachedEndpoints,
    disconnectedTargets,
    outOfBounds
  },
  softCosts: {
    perpendicularCrossings,
    bends,
    length,
    outerDetour,
    congestion,
    directionChange
  },
  route
}
```

选择规则必须先过滤 `hardViolationCount === 0`，再比较 soft cost。禁止通过大权重把硬冲突伪装成“很贵但可选”的候选。

### 3.3 明确失败状态

候选搜索和 provider 输出必须能表达：

```js
{ status: "routed", route, diagnostics }
{ status: "unroutable", diagnostics }
```

`unroutable` 不能自动降级为穿节点路径。UI 可显示诊断或保持上一个有效 layout，但不得把无效几何提交为最终结果。

## 4. 实施阶段

### 阶段 0：先建立可失败的回归门禁

目的：在动算法前，把 eq012 和普遍性问题固化为测试，避免修改过程中再次“只修一个图”。

#### 修改项

1. 新增 eq012 双根 Focused fixture test，固定参数：
   - roots：`cell:_2021_`、`cell:_2406_`；
   - `faninDepth=3`、`fanoutDepth=3`；
   - spacing：至少覆盖 `4, 8, 16, 32, 84, 160, 320`。
2. 在测试 helper 中输出每条违规的：
   - physical net key；
   - source/target；
   - route kind；
   - segment 坐标；
   - candidate/fallback 原因。
3. 扩展 validator 单测：
   - 水平和垂直共线重叠；
   - 不同 source 的同名 net；
   - 重复 fanout trunk；
   - endpoint 脱离；
   - target 不可达；
   - route 超 bounds；
   - TOP/BOTTOM/LEFT/RIGHT port attachment。
4. 将 mapped-case Focused 检查作为独立命令或测试层，不能继续用 `checkOverlaps:false` 隐藏硬错误。

#### 主要文件

- `tests/unit/eq012_focused_routing.test.js`（新增）
- `tests/unit/layout-validator.test.js`
- `tests/unit/orthogonal-routing.test.js`
- `tools/test-one-mapped-case.mjs`
- `tools/test-mapped-cases.mjs`

#### 阶段完成标准

- 新测试在当前实现上稳定失败，且恰好捕获报告中的三项 eq012 硬违规和 bounds 越界；
- root、node、edge 排列反转后，诊断集合保持一致；
- 测试不依赖完整 route 的像素快照，只断言合同和有限的方向/局部性指标。

### 阶段 1：统一硬校验、net 身份和 provider 出口

目的：先堵住所有非法结果出口，再优化路径形状。

#### 修改项

1. 把 `routeCandidateValidation.js` 改为完整 route 的强制硬校验：
   - 所有 segment 对 node obstacles；
   - 所有 segment 对 foreign physical net reservations；
   - exact port attachment；
   - orthogonal/non-zero/normalized；
   - 可选 bounds 检查。
2. 删除调用方可选择是否拒绝 overlap 的语义。若预览模式需要放宽，只能放宽软质量，不能放宽穿节点和异 net 共线重叠。
3. `orthogonalRouting.js` 分开：
   - perpendicular crossing；
   - collinear overlap；
   - same physical net sharing。
4. `routeScoring.js` 只接收已经通过硬过滤的候选；删除把 overlap 混入 crossings 的逻辑。
5. `RouteSegmentIndex` 以 `(physicalNetKey, normalized segment geometry)` 去重 reservation，避免同一 trunk 多次计数。
6. Simple、Adjust、ELK 返回前统一调用 final validator；删除：
   - Simple 未校验 base-route fallback；
   - outer 的 overlap fallback；
   - Adjust 的 `lastCandidate` fallback；
   - ELK `(0,0)` 伪 route fallback。
7. 扩展 `layoutValidator.js`：
   - 跨物理 route overlap；
   - endpoint attachment；
   - source 到全部 target 的可达性；
   - wire extents；
   - provider diagnostics。

#### 主要文件

- `src/layout/layoutTopology.js`
- `src/layout/wireRoutes.js`
- `src/layout/routeCandidateValidation.js`
- `src/layout/orthogonalRouting.js`
- `src/layout/routeScoring.js`
- `src/layout/spatialIndex.js`
- `src/layout/simpleOrthogonalRouter.js`
- `src/layout/simpleRouteCandidates.js`
- `src/layout/localOrthogonalRouter.js`
- `src/layout/elkLayoutProvider.js`
- `src/layout/layoutValidator.js`
- `src/render/svgRenderer.js`

#### 阶段完成标准

- 人工构造的非法 fallback 均返回 `unroutable`，不会进入 render；
- 不同 source 的同名 net 能互相报告 overlap；
- 同一 physical net 的共享 trunk 不报冲突且只登记一次；
- Simple、Adjust、ELK 运行同一组 provider-contract tests。

### 阶段 2：让放置消费路由容量

目的：避免把几何上不可路由的节点排布交给 router。

本阶段的数据结构、容量公式、lane 分配和固定 pass 顺序见本文第 11 节。实现不得自行换成
“路由失败后不断加间距重试”的循环。

#### 修改项

1. 把 `simpleRoutingPlan` 的容量输出升级为放置输入：
   - `requiredTopLanes`；
   - `requiredBottomLanes`；
   - `requiredLeftLanes` / `requiredRightLanes`；
   - 每个 layer gap 的独立 channel demand；
   - 每个 boundary cluster 的 escape demand。
2. lane 数按 physical net/tree demand 计算，不按每条 logical edge 重复累加。
3. `simpleLayered.js` 删除固定 `topWireSpace=80`，改为：

   ```text
   topHeadroom = margin + requiredTopLanes * normalizedWireLanePitch
   ```

   side/bottom/channel 同理，并受公共 route-limit policy 控制。
4. `layoutIntent.boundaryPressure` 使用可组合的容量模型，不再只取最大 fanout。
5. Focused boundary placement 必须保留：
   - port escape length；
   - node padding；
   - 至少一个可用正交通道；
   - 相邻 focus boundary 节点之间的 lane capacity。
6. `nodeSpacing.js` 的 post-locality pass 从“外框不重叠”提升为“外框 + routing clearance 可满足”。若空间不足，移动 boundary node 或扩大对应 channel，而不是让 router 穿越。
7. 所有 pitch、padding、clearance 只在 layout policy boundary 归一化一次；删除 `topWireLanePitch` 的私有 `8..48` clamp。

#### 主要文件

- `src/layout/simpleRoutingPlan.js`
- `src/layout/layoutIntent.js`
- `src/layout/simpleLayered.js`
- `src/layout/simplePlacementPipeline.js`
- `src/layout/nodeSpacing.js`
- `src/layout/nodeLocality.js`
- layout policy normalization 所在模块

#### 阶段完成标准

- eq012 spacing 4 中 `_1314_` 与 `_0198_` 不再形成小于合同 clearance 的封闭墙；
- 8 条 top/side lane 需求能在 node placement 前形成真实空间，不落入节点区域；
- capacity 单测证明 physical fanout trunk 不会按 logical edge 重复占 lane；
- 调整 wire spacing 后，headroom 和 channel capacity 单调响应，没有私有 clamp 分叉。

### 阶段 3：重排 Focused 管线并生成拓扑覆盖的候选

目的：让候选基于最终几何，而不是搬移前层级，并消除固定比例和方向偏置。

#### 修改项

1. 将 Focused locality intent 提前到 routing plan 之前，推荐顺序：

   ```text
   topology levels
       -> focused boundary intent
       -> route-aware placement capacity
       -> final placement/locality
       -> recompute spatial columns and channels
       -> routing
   ```

   不一定要改 canonical topology level，但必须为路由产生独立的 final spatial column/channel 信息，禁止用已失真的 `levelBounds`。
2. fanout trunk 按 source/target 的最终空间关系验证方向：
   - LR 输出 trunk 必须位于 source 右侧且不越过最左 target；
   - 若无这样的共享通道，切换到分支树方案，而不是把 trunk 放到全部 target 右侧。
3. 重写 local candidate 枚举，使 bounded 候选覆盖不同拓扑类别：
   - source escape 后的最近合法 x lane；
   - target escape 前的最近合法 x lane；
   - source/target 中间的独立空 corridor；
   - obstacle 左/右边界加 clearance 的 lane；
   - 已有同 net trunk lane；
   - 必要时 top/bottom outer lane。
4. 候选上限按“每类至少保留一个”再截断，不能让固定比例的前 8 个占满名额。
5. `collectLocalLaneYs()` 的 tie-break 改为稳定但无方向偏置：
   - 先比较 detour/crossing/congestion；
   - 再比较离 source-target 中线的距离；
   - 最后用 stable topology key；
   - 不再简单按 y 升序偏向顶部。
6. 删除只针对 `focus-input secondary fanout` 的能力孤岛，把扩展 corridor 搜索作为所有 source kind 可用的命名策略；策略是否启用由拥塞/可行性决定，不由节点名称或类型特例决定。
7. 保持全局候选数量有硬上限，但先生成完整 route，再统一校验/评分；取消“第一个 node-safe 就返回”。

#### 主要文件

- `src/layout/simplePlacementPipeline.js`
- `src/layout/nodeLocality.js`
- `src/layout/simpleRoutingPlan.js`
- `src/layout/simpleOrthogonalRouter.js`
- `src/layout/simpleRouteCandidates.js`
- `src/layout/routeLaneCandidates.js`

#### 阶段完成标准

- eq012 中 `clk -> _2406_` 和 `clk -> focus-output` 选择局部合法通道，不再到画布顶/底后折返；
- `_0179_` 要么获得局部合法 corridor，要么 placement 为它扩大 corridor；不得穿 `_0198_`；
- spacing 扫描中 outer-route ratio 不再非单调地大幅反弹；
- root/node/edge permutation 测试保持完全一致的规范化 route 集合。

### 阶段 4：从逐 edge 路由升级为原生 physical net-tree 路由

目的：消除“先各自走线、再把重叠路径拼成树”的根本限制。

#### 修改项

1. 以 physical net group 为最小路由单元：一个 source、多个 targets、共享 obstacle/reservation 视图。
2. 先选择合法 trunk/corridor，再将 targets 按稳定空间 key 接入；每次新增 branch 后更新同一 net tree，而不是重复预留相同 trunk。
3. tree 构建过程必须维护：
   - source-rooted connectivity；
   - target coverage；
   - trunk/branch junction；
   - normalized segment ownership；
   - 同 net 共享合法、异 net overlap 禁止。
4. `netTreeRouter.js` 从“provider route 的后处理器”转为 native tree router 或树规范化器。若保留旧 edge router 作为过渡，只能作为候选生成器，不能决定最终物理拓扑。
5. `wireRoutes.js` 直接消费 tree 结果，不再依赖事后猜测共享段。

#### 主要文件

- `src/layout/netTreeRouter.js`
- `src/layout/wireRoutes.js`
- `src/layout/simpleOrthogonalRouter.js`
- `src/layout/layoutTopology.js`
- `src/layout/spatialIndex.js`

#### 阶段完成标准

- eq012 `clk` fanout 只有一个 canonical trunk owner；
- reservation 中重复 trunk 几何为零；
- 每个 target 从 source 可达，且移除任一 branch 不影响无关 target；
- quality metrics 以 tree 的 unique wire length 为主，不再以 logical edge 重复长度误导排序。

### 阶段 5：provider 适配、bounds 和发布门禁

目的：将新合同推广到所有输出路径，并用 mapped corpus 证明问题不是转移到别处。

#### 修改项

1. ELK 保留并正确映射四个 port side；`attachToExactPorts()` 根据 side 生成 escape，不再一律水平 `±24`。
2. ELK section 缺失时返回诊断，不生成 `(0,0)` polyline。
3. Adjust/manual override 路由进入相同 final validation；无合法 route 时保留 override 状态和明确报错，不提交非法线。
4. graph bounds 统一合并：
   - node bounds；
   - wire extents；
   - label bounds；
   - bridge/hit-area margin。
5. renderer 只消费已规范化 bounds，不自行补几何特例。
6. 把 Focused mapped corpus 的硬违规预算从“允许若干项”迁移到零；质量阈值单独设置，不能与硬违规共用预算。

#### 主要文件

- `src/layout/elkLayoutProvider.js`
- `src/layout/localOrthogonalRouter.js`
- `src/layout/layoutValidator.js`
- `src/layout/layoutQuality.js`
- `src/render/svgRenderer.js`
- `tools/test-mapped-cases.mjs`

#### 阶段完成标准

- 所有 provider 通过同一 contract suite；
- eq012 route 全部落在声明 bounds 内；
- mapped Focused 门禁的 node crossing、foreign-net overlap、detached endpoint、disconnected target、out-of-bounds 全为零；
- Windows 离线运行路径不新增依赖。

## 5. 文件级修改地图

| 文件 | 修改方向 | 禁止继续保留的行为 |
| --- | --- | --- |
| `src/layout/layoutTopology.js` | 提供 canonical physical net key | 仅用 display net name 判断同网 |
| `src/layout/wireRoutes.js` | 消费原生 net tree、保留 group key | 事后按松散标签猜共享路径 |
| `src/layout/simpleRoutingPlan.js` | 输出物理 net 级容量 | 按每条 logical edge 重复计算 lane |
| `src/layout/layoutIntent.js` | 聚合 boundary/channel demand | 只取 max fanout |
| `src/layout/simpleLayered.js` | 消费动态 headroom/side space；合并 wire bounds | 固定 `topWireSpace=80` |
| `src/layout/simplePlacementPipeline.js` | Focused intent 和 route-aware capacity 提前 | 用搬移前层级直接规划最终 route |
| `src/layout/nodeLocality.js` | 生成 final spatial relation | 搬移后仍让 route 使用失真 `levelBounds` |
| `src/layout/nodeSpacing.js` | 校验 routing clearance/corridor | 只保证 node body 不相交 |
| `src/layout/simpleRouteCandidates.js` | 拓扑类别候选、完整 route 搜索 | 首个 node-safe 返回；最终非法 base route |
| `src/layout/simpleOrthogonalRouter.js` | 统一过滤/评分；按 physical net 路由 | 分支专用检查和逐 edge 重复 reservation |
| `src/layout/routeLaneCandidates.js` | 无方向偏置的稳定 tie-break | 同分按 y 升序固定向上 |
| `src/layout/routeCandidateValidation.js` | 强制 hard contract | 可选 `rejectReservedOverlaps` |
| `src/layout/orthogonalRouting.js` | 区分 cross、overlap、same-net share | 把不同几何冲突混为一类 |
| `src/layout/routeScoring.js` | 只排序合法候选的软质量 | 用权重容忍硬违规 |
| `src/layout/spatialIndex.js` | owner+geometry 去重，保持有界查询 | 同 trunk 重复登记和全量扫描 |
| `src/layout/routeSegmentIndex.js` | 为 indexed segment 附加 physical owner、revision 和规范化 geometry key | 只附加 edge/display-net 元数据 |
| `src/layout/netTreeRouter.js` | 原生 source-rooted tree | 假定 edge routes 已合法后再拼接 |
| `src/layout/localOrthogonalRouter.js` | 明确 unroutable | 返回非法 `lastCandidate` |
| `src/layout/elkLayoutProvider.js` | 四向 port 和共享 final validation | 非 RIGHT 全按 WEST；`(0,0)` fallback |
| `src/layout/layoutValidator.js` | 全图物理合同、连通与 bounds | 只检查单 route 内部 |
| `src/layout/layoutQuality.js` | hard/soft 指标拆分 | 用综合质量数掩盖硬错误 |
| `src/render/svgRenderer.js` | 消费规范化 bounds 与 physical key | 用显示名判断 bridge/same-net |

## 6. 测试矩阵

### 6.1 精确回归

eq012 双根 Focused 在 spacing `4, 8, 16, 32, 84, 160, 320` 上全部断言：

- `nodeCrossings.length === 0`；
- `foreignNetOverlaps.length === 0`；
- `detachedEndpoints.length === 0`；
- `disconnectedTargets.length === 0`；
- `outOfBounds.length === 0`；
- `clk -> _2406_` 不使用无必要的 top/bottom outer lane；
- `_0179_` 不穿 `_0198_`；
- `clk` 与 `rst_n` 不共享同一物理 segment；
- `clk` fanout 的共享 trunk 在 reservation/tree 中只出现一次。

“直接向下向右”不应断言成唯一坐标快照；建议断言 detour 不越过 source/target 包围盒加一个命名 clearance，且 route length/bends 不超过最短合法候选的规定容差。

### 6.2 几何单测

至少覆盖：

1. 水平共线、垂直共线、端点接触、部分包含、完全相等 segment；
2. 垂直 crossing 可计软成本，但 foreign overlap 必须 hard reject；
3. same physical net trunk 可共享；
4. display name 相同、source 不同必须视为不同 physical net；
5. expanded obstacle corridor 的左侧、右侧、顶部、底部候选；
6. 候选数达到上限时，每个拓扑类别仍有代表；
7. 冲突数超过 8 时不会因封顶变成错误同分；
8. padding、wire pitch 的最小/最大 policy 值；
9. route normalization 去除零长度和重复点；
10. source/target pin 的四向 attachment。

### 6.3 变形与确定性测试

对同一图进行：

- parser statement permutation；
- node array reverse/shuffle；
- edge array reverse/shuffle；
- root order reverse；
- 等价 canonical display-name 变化。

比较规范化后的 physical net tree，而不是未排序对象数组。结果必须一致。

### 6.4 corpus 门禁

使用报告中的 47 个 mapped fixtures 和同一 clock/reset Focused 抽样，先作为专项 CI，再评估纳入常规 `npm test` 或 `npm run test:mapped-cases`：

| 指标 | 门禁 |
| --- | ---: |
| node crossing | 0 |
| foreign physical-net overlap | 0 |
| detached endpoint | 0 |
| disconnected target | 0 |
| out of bounds | 0 |
| invalid fallback committed | 0 |

outer route ratio、perpendicular crossing、bend、length 属于质量趋势，可设置回归阈值，但不能替代上述零容忍门禁。

### 6.5 provider 合同测试

同一组小图分别交给 Simple、Adjust、ELK：

- 正常可路由；
- placement 不可行；
- section 缺失；
- 四向 port；
- manual override 造成障碍；
- 多 target fanout；
- 同名不同 driver。

每个 provider 要么返回合法 layout，要么返回明确 `unroutable`，不得返回“可渲染但非法”的第三种状态。

## 7. 性能边界

修改不能用无限搜索换正确性。建议采用以下约束：

具体候选预算、索引改造、复杂度目标和增量重布线规则见第 11.8 至 11.11 节。

1. obstacle 和 reservation 查询继续使用共享 spatial index；几何校验是最终权威。
2. 候选生成按固定拓扑类别和 policy 上限，不能随总 edge 数线性增加重试轮数。
3. 每个 physical net 的 tree 构建以本 net targets 和空间索引命中项为界，不做全图 all-pairs。
4. reservation 去重在插入时使用规范化 key，避免后续查询和评分膨胀。
5. hard validation 可复用 route search 的索引，不重复构建全图索引。
6. benchmark 至少记录：
   - layout 总时长；
   - candidate 数 p50/p95/max；
   - spatial query 命中数；
   - physical net tree 数和 branch 数；
   - route validation 时长；
   - outer-route ratio 和 unique wire length。
7. 在相同 corpus 上，如中位时长回退超过 15% 或 p95 回退超过 25%，必须给出原因和优化记录；不得通过关闭硬校验恢复性能。

## 8. 推荐提交顺序

为降低一次性重写风险，建议按以下可独立审查的提交推进：

1. `test: lock eq012 focused routing failures`
   - 只加失败回归、诊断 helper 和 permutation test。
2. `fix: unify physical net identity and hard route validation`
   - 统一 key、冲突分类、跨 route validator、删除非法 fallback。
3. `fix: make placement consume routing capacity`
   - 动态 headroom/channel、route clearance、policy normalization。
4. `fix: route focused graphs from final spatial channels`
   - 重排 locality/plan，扩展拓扑候选，取消方向偏置和提前返回。
5. `refactor: build native physical net trees`
   - fanout trunk/branch 一次生成，reservation 去重。
6. `fix: enforce provider contract and wire bounds`
   - Adjust/ELK、四向 port、bounds、renderer identity。
7. `test: make mapped focused hard invariants blocking`
   - corpus 零容忍门禁和 benchmark 记录。

每个提交都应运行相关 focused tests、determinism tests；涉及最终布局/路由输出的提交还应运行 `npm test`、`npm run test:mapped-cases`，并按项目要求运行 benchmark。

## 9. 风险与应对

### 9.1 删除非法 fallback 后出现更多 `unroutable`

这是预期的短期暴露，不应恢复 fallback。先用 diagnostics 区分：

- placement 无容量；
- 候选覆盖不足；
- policy 上限过紧；
- provider 数据缺失。

按类别修 owning boundary，避免在 router 尾部吞错。

### 9.2 动态 headroom 导致画布变大

优先按 physical net 合并 lane、使用共享 trunk 和实际独立通道需求，避免按 logical edge 过度估算。画布增大是容量真实需求的表现，但需要通过 tree routing 和 lane packing 控制。

### 9.3 候选增加导致性能回退

按拓扑类别保留代表候选，比单纯增大 `MAX_LOCAL_ALTERNATIVES` 更有效。用空间索引、候选去重和早期硬过滤控制成本，但不要在候选集合未覆盖前按生成顺序返回。

### 9.4 路径变化影响 snapshot 或用户手调布局

合同修复优先于旧非法几何。对 manual override 保留节点位置，但 route 必须重算并校验；若 override 造成不可路由，应提供明确诊断，不应静默穿越。

### 9.5 provider 行为不一致

先建立共享 contract suite，再逐个适配。禁止通过复制 Simple 的内部逻辑到 Compare/Adjust handler 解决，应复用 workspace/provider 边界。

## 10. 完成定义

只有同时满足以下条件，才能认为这轮问题被“完全排除”，而不是再次局部缓解：

1. eq012 指定场景在全部 spacing 矩阵上无硬违规、无越界，且两条代表性 net 不再无必要地外绕；
2. 报告中的 179 场景专项抽样在全部选定 spacing 上硬违规为零；
3. Simple、Adjust、ELK 通过共享 provider contract tests；
4. physical net identity 在 grouping、reservation、validator、renderer 和 metrics 中一致；
5. 所有非法 fallback 已删除，`unroutable` 可被上层显式处理；
6. placement 真实消费 routing capacity，Focused 路由使用最终空间 channel；
7. fanout 由原生 physical net tree 生成，重复 trunk reservation 为零；
8. graph bounds 包含完整 wire geometry；
9. `npm test`、mapped-case、determinism、fixture invariants 和 benchmark 均通过；
10. 没有 instance-name、net-name、fixture-name或固定坐标特例。

在阶段 1 完成前，不建议继续调 `routeScoring` 权重；在阶段 2 完成前，不建议用扩大 spacing 作为默认产品行为；在阶段 4 完成前，应把 `netTreeRouter` 的“零 fallback”仅视为后处理成功指标，不能视为路由正确性指标。

## 11. 通道容量与性能实现规格

本节把前述方向收敛为可编码的合同。字段名称可在实现时按仓库现有 JavaScript 风格微调，但字段
语义、责任边界、固定 pass 数量和失败行为不得改变。

### 11.1 当前实现需要直接处理的性能和通道问题

| 位置 | 当前具体问题 | 实现要求 |
| --- | --- | --- |
| `simpleRoutingPlan.js` | `longLaneCount` 按 logical edge 增长；返回的 `maxSideLanes` 没被 placement 消费 | 以 physical net demand 为单位规划，并输出可直接应用的 channel capacity plan |
| `simpleLayered.js` | `topWireSpace` 固定为 80；`topWireLanePitch` 又私自 clamp 到 `8..48` | 删除固定顶部空间和私有 pitch；统一消费 normalized policy 与 capacity plan |
| `layoutIntent.js` | `boundaryPressure` 只取最大 fanout，不能表达多个独立 net 同时过边界 | 输出每个 layer boundary 的独立 physical-net demand，不再用一个标量替代容量 |
| `nodeSpacing.js` | 只处理 node body gap；没有 row corridor、escape corridor 和 lane 数概念 | 在 placement 中应用命名 channel expansion，并验证开放跨度 |
| `nodeLocality.js` | Focused source 被搬移但旧 `level` 仍参与路由列计算 | 保存 locality anchor，并在最终列坐标确定后重新锚定；路由使用 `spatialColumn` 而非失真 level bounds |
| `simpleRouteCandidates.js` | local X 主要来自固定比例；expanded local 最多 512 次笛卡尔组合；global Y 最多 512 项 | 候选来自已分配 channel/lane；每类配额固定，删除笛卡尔扩展和按节点数增加的 outer 尝试 |
| `simpleOrthogonalRouter.js` | 每条 logical edge 单独路由、重复预留 trunk；最多只计 8 个 conflict | 按 physical net 路由；硬冲突不截断，软 crossing 可截断；共享 trunk 只登记一次 |
| `spatialIndex.js` / `routeSegmentIndex.js` | `RouteSegmentIndex.push()` 不去重、不支持 owner 替换；metadata 仍以 logical edge/display net 为中心 | 增加 physical owner、规范化 geometry key、`pushUnique`、`removeOwner`/`replaceOwner` |
| `wireRoutes.js` | `splitSegmentsAtJunctions()` 对同一组 segment 两两比较 | native tree 直接输出 junction；兼容 provider 使用轴向索引/扫描线，禁止保留二次复杂度 |
| `layoutValidator.js` | 单 route 内 segment 两两比较；完整违规列表可能二次膨胀 | commit 模式 fail-fast；audit 模式输出有界样本和 truncated 标志；共享 segment index 判定 |
| `positionedRouting.js` | Adjust 每次从全部未失效 edge 重建 reservation index | 支持按 physical owner 替换；只重布受影响 net group，并保留定期压实策略 |
| `computeNodeCollectionBox()` 等 | 对大集合使用 `Math.min(...array)` / `Math.max(...array)` 有参数数量断崖 | 触及相关代码时改为单次循环累计，避免十万级图的调用栈/参数上限 |

### 11.2 统一术语和输出模型

#### PhysicalNetDemand

`PhysicalNetDemand` 是通道规划和原生树路由的最小单位：

```js
{
  netGroupKey,
  sourceNodeId,
  sourcePortRef,
  targetPortRefs,
  sourceLevel,
  targetLevels,
  minimumLevel,
  maximumLevel,
  traversedBoundaryIds,
  fanout,
  stableRank
}
```

规则：

1. 用共享 `getPhysicalNetKey()` 按 `(canonical source id, canonical net id)` 分组；
2. 一个 physical net 不因 target 数量增加而重复占 trunk lane；
3. `targetPortRefs` 按 `target node id + canonical pin + edge id` 稳定排序；
4. 同名、不同 source 必须形成两个 demand；
5. 一个组若出现多个 source，不能静默合并，应输出 `multiple-physical-sources` 诊断；
6. demand 是派生产物，不修改 graph edge 或 Netlist IR。

#### RoutingChannel

通道不是一个裸坐标，而是带作用域的可分配资源：

```js
{
  id,
  kind,
  axis,
  scopeKey,
  currentSpan,
  requiredSpan,
  expansion,
  laneCount,
  lanes,
  demandKeys
}
```

`kind` 第一版固定为：

- `inter-layer`：相邻空间列之间的垂直 lane；
- `row-gap`：x 范围相交节点之间的水平 lane；
- `outer-top` / `outer-bottom`：跨多列的水平外围 lane；
- `side-left` / `side-right`：反向 edge、特殊 port side 或外围竖直 escape lane；
- `endpoint-escape`：pin 到首个 trunk/branch 拐点的保护矩形，不作为可共享 lane。

#### ChannelDemand

一个 net 在一个 channel 中最多产生一项 demand：

```js
{
  channelId,
  netGroupKey,
  intervalStart,
  intervalEnd,
  preferredCoordinate,
  priorityClass,
  endpointRefs
}
```

同一 physical net 的多个 target 若经过同一 channel，应合并区间并共享 lane。`priorityClass` 只决定
稳定分配顺序，不允许覆盖硬可行性。

#### ChannelCapacityPlan

`planSimpleRouting()` 的新输出应升级为：

```js
{
  netDemands,
  channels,
  allocationByNet,
  nodeEscapeReservations,
  expansion,
  diagnostics,
  metrics
}
```

旧的 `edges` lane 信息在迁移期可以由 `allocationByNet` 投影生成，但不得继续成为真实容量来源。

### 11.3 路由几何参数的唯一来源

保留 `layoutPolicy.spacing.wireLanePitch` 作为 lane 中心距。把目前散落的 8、9、16、24 收敛到
`ROUTE_GEOMETRY_POLICY` 的命名字段，并由 provider 入口一次性组合为只读 `routingGeometry`：

```js
{
  nodeClearance: 8,
  targetApproachClearance: 9,
  minimumVisibleTargetCornerGap: 16,
  portEscapeLength: 24,
  outerLaneClearance: 24,
  laneReusePadding: 4,
  wireLanePitch
}
```

初始值沿用当前实际常量，避免在结构改造时同时改变视觉尺度。定义：

```text
C = max(nodeClearance, targetApproachClearance)
E = max(portEscapeLength, C + minimumVisibleTargetCornerGap)
P = wireLanePitch
R = laneReusePadding
```

约束：

- `wireLanePitch` 只使用 `normalizeLayoutPolicy()` 的结果，删除 `topWireLanePitch` 的第二次 clamp；
- candidate、placement、validator、ELK attachment 和 bounds 都接收同一 `routingGeometry`；
- 不允许某个算法内部再次把 pitch 或 clearance 限制到私有范围；
- 如果以后允许用户调整 clearance，应加入 `layoutPolicy` 及公共 limits，而不是读取未校验 option。

### 11.4 通道需求如何生成

#### 11.4.1 拓扑需求

在 node placement 前先按 physical net 生成不含像素坐标的拓扑需求：

1. `minimumLevel..maximumLevel` 覆盖的每个相邻层边界登记一次 `inter-layer` demand；
2. fanout 的多个 target 在同一边界合并为一个 demand；
3. 跨层 net 只登记一个 outer 候选需求，不按 target edge 增加 `longLaneCount`；
4. source/target port side 不是 LR 时，登记对应 side/escape 能力需求；
5. Focused boundary node 同时记录其 anchor target 和期望 pin corridor，供最终重锚使用。

这个 pass 只做分组、稳定排序和边界登记，不读 node x/y，复杂度目标为
`O(E log E)`，其中 `E` 是当前显示图的 logical edge 数。

#### 11.4.2 几何需求

完成基础 placement 和 Focused locality 后，再从最终 pin y 与 node box 生成几何区间：

1. `inter-layer` demand 的 interval 是该 net 在此边界所有 branch endpoint y 的并集；
2. `outer-top/bottom` demand 的 interval 是 source 与全部相关 target x 的包围区间；
3. `row-gap` 先按扩大 `C` 后仍在 x 方向相交的 node box 建立 x-overlap component；
4. 每个 component 内按 y 排序，相邻 node 之间形成稳定 `row-gap`，id 使用相邻 node stable key，
   不能使用数组下标；
5. 对每个 net，使用 source y、target y、中位 y 和被查询到的 obstacle 上/下边界作为 preferred y；
6. preferred y 落在某个现有 gap 时直接登记；落在 node body/clearance 内时，登记到距离最近且使
   Manhattan detour 最小的上/下 gap；完全同分时用 stable net rank 在上下两侧交替，避免固定向上偏置；
7. 一个 net 在同一 row gap 中无论有多少 logical edge 都只计一项 demand。

几何需求只查询 endpoint 包围盒和相交 obstacle，不遍历全图节点。`nodeIndex.query()` 返回的候选仍须
用精确 box 谓词确认。

### 11.5 容量公式

设通道内有 `k` 条不能复用中心线的 lane。开放跨度定义为：

```text
LaneSpan(k, padding) =
  0,                              k = 0
  2 * padding + (k - 1) * P,      k > 0
```

各通道的最小尺寸：

```text
requiredRowGap(k)        = LaneSpan(k, C)
requiredInterLayerGap(k) = 2 * E + (k - 1) * P
requiredTopBand(k)       = k == 0 ? 0 : C + (k - 1) * P
requiredBottomBand(k)    = requiredTopBand(k)
requiredLeftBand(k)      = k == 0 ? 0 : outerLaneClearance + (k - 1) * P
requiredRightBand(k)     = requiredLeftBand(k)
expansion                = max(0, requiredSpan - currentSpan)
```

解释：

- row gap 两边都有 node body，因此需要两侧 clearance；
- inter-layer gap 要在左右 endpoint 前各保留一个完整 escape；
- outer band 的外侧已有 graph margin，内侧仍须与 node collection 保持 clearance；
- `cellSpacing` 是最低视觉间距，不是 route capacity。最终 gap 取
  `max(cellSpacing, requiredChannelSpan)`；
- label 不参与 hard lane count，但 bounds 必须在 label placement 后扩展；
- wire stroke/hit area 若将来大于 `C`，必须提高统一的 effective clearance，而不是只改 renderer。

### 11.6 lane 复用和稳定分配算法

不同 physical net 可以复用同一个 lane 坐标，但只能在其投影区间真正分离时复用。同一 channel 中，
两个 demand 的扩展区间 `[start-R, end+R]` 相交即冲突，不能分到同一 lane；同一 physical net 的区间
先合并，不参与自冲突。

每个 channel 使用稳定区间着色：

1. demand 按 `intervalStart`、`intervalEnd`、`priorityClass`、`netGroupKey` 排序；
2. `activeHeap` 按区间结束位置维护当前占用 lane；
3. 当 `active.end + 2R <= next.start` 时释放 lane；
4. `freeLaneHeap` 总是取最小 lane index；没有空闲项才创建新 lane；
5. 输出 `laneIndex` 后再根据 channel origin 和 `P` 计算实际坐标；
6. lane 坐标和 demand 排序都不读取 edge/node 原始数组顺序。

该算法对区间通道得到稳定、最少 lane 数分配，复杂度为 `O(D log D)`，`D` 为该 channel 的 demand 数；
不允许用“每项扫描所有已有 lane”的 `O(D * laneCount)` 实现。

坐标定义：

- `inter-layer`：`leftNodeBoundary + E + laneIndex * P`；
- `row-gap`：`upperNodeBoundary + C + laneIndex * P`；
- `outer-top`：从 graph top margin 向下编号；
- `outer-bottom`：从 node collection bottom + C 向下编号；
- `side-left/right`：从 node collection side + outer clearance 向外编号。

上/下 outer side 不能固定全部选 top。对每个长 net 分别试算加入 top 和 bottom 后增加的 band span：

1. 先选新增 span 更小的一侧；
2. 再选估算 Manhattan 长度更短的一侧；
3. 再选当前 lane count 更少的一侧；
4. 仍同分时按 physical net 的 stable rank 奇偶交替 top/bottom。

这样既稳定，又不会恢复当前按 y 升序导致的系统性顶部偏置。

### 11.7 固定 pass 的 placement 与通道扩容

禁止“route -> 失败 -> 加间距 -> 全量重排 -> 再 route”的不定次数循环。Simple 第一版固定执行以下
pass，每个 pass 最多一次：

```text
1. group physical nets + build topology demand
2. measure nodes/ports + base level columns
3. execute y-affecting placement/locality passes
4. build row-gap demand + allocate row lanes
5. expand row gaps once
6. rebuild final y intervals; allocate inter-layer and outer/side lanes
7. apply x/band expansion once + re-anchor Focused boundary nodes
8. rebuild ports, node index and channel coordinates
9. route each physical net once from allocated channels
10. shared final validation + wire/label bounds normalization
```

扩容规则：

- inter-layer：按 boundary 顺序计算 prefix x shift；边界右侧空间列整体右移；
- row-gap：在 x-overlap component 内把 gap 下方节点作为 suffix 整体下移，不能逐节点找空位造成新重叠；
- top：所有节点统一下移 `requiredTopBand`，保持内部相对 y；
- bottom/right：不移动已有节点，只扩展最终 bounds；
- left：所有节点统一右移 left band，保证 margin 和坐标非负；
- Focused input/output 保存 `{ anchorNodeId, anchorPortRef, side, rank }`，最终列移动后按 anchor 重算 x，
  y 只应用所属 row component 的同一 suffix shift；
- 每一步产生新 positioned node 集合或受控工作副本，不能修改 provider 输入 graph。

扩容优先级固定为：

1. 使用当前 gap 中已经存在的可复用 lane；
2. 在同一 local/inter-layer channel 增加 lane 并只扩大该 channel；
3. 扩大 Focused boundary cluster 的 row/escape corridor；
4. 使用更远但仍在 node collection 内的已分配 channel；
5. 最后才分配 top/bottom/side outer lane；
6. 达到命名 capacity limit 时返回 `capacity-limit`，禁止穿节点或共线重叠。

完成第 8 步后执行一次 `assertPlacementCapacity()`：检查 node body、endpoint escape rectangle、channel
开放跨度和 lane 坐标。失败说明 planner/expander 有 bug，不能进入候选搜索。

### 11.8 候选预算与搜索行为

通道分配完成后，候选生成不再通过 512 次 X/Y 组合“碰运气”。每个 physical net 按下列类别生成：

1. exact direct；
2. 已分配 same-net trunk；
3. source-nearest inter-layer lane；
4. target-nearest inter-layer lane；
5. 已分配 row-gap lane；
6. obstacle 上/下边界的最近合法 lane；
7. 已分配 top/bottom/side outer lane。

`routeSearchPolicy.js` 增加下列命名上限，建议初始值为：

```js
{
  maximumCandidatesPerClass: 4,
  maximumLocalCandidatesPerNet: 24,
  maximumCandidatesPerPhysicalNet: 64,
  maximumOuterCandidatesPerNet: 16,
  maximumSoftConflictSamples: 16,
  maximumDiagnosticSamplesPerCode: 64,
  maximumChannelLanesPerScope: 256
}
```

这些初始值必须经过 eq012、47 个 mapped fixture 和 large benchmark 验证后才固化。控制规则：

- 先让每个适用类别至少保留一个候选，再按综合 soft lower-bound 填充剩余额度；
- hard validation 检查到第一个 hard violation 即淘汰，不能受 `maximumSoftConflictSamples` 限制；
- soft perpendicular crossing 计数可以在 16 处截断，因为只用于排序；
- outer 类只在 local 类没有合法候选时评估，避免为普通 edge 支付外围搜索成本；
- `maximumChannelLanesPerScope` 超限返回明确 capacity diagnostic，并建议 upstream 使用 Focused、collapse
  或 hub；不能自动提高到与 graph size 相同；
- 删除或退役当前 `maximumExpandedLocalCandidateAttempts=512`、`maximumGlobalLaneCandidates=512` 和
  `outerAttempts = max(4, nodes.length)` 路径；迁移期若仍保留，必须记录调用次数并保证不会成为最终 fallback。

候选比较键固定为：

```text
hardViolationCount
-> namedSoftCostTotal
-> foreignPerpendicularCrossings
-> outerLaneUsed
-> bends
-> length
-> channelId
-> stable candidate key
```

`namedSoftCostTotal` 由 `routeScoring.js` 的命名 policy 计算，必须同时包含 crossing、outer detour、bend
和 length，避免“只少一次 crossing 就绕完整张图”，也避免“只要是 local 就容忍任意多 crossing”。
由于 hard violation 在进入评分前必须为零，第一项主要用于诊断和测试，不能通过权重抵消。

### 11.9 segment index、tree 和最终校验的复杂度

#### RouteSegmentIndex

segment record 至少包含：

```js
{
  physicalNetKey,
  ownerRouteId,
  geometryKey,
  orientation,
  start,
  end,
  revision,
  active
}
```

`geometryKey` 使用规范化方向和量化后的端点：同一线段反向输入也得到同一 key。索引提供：

- `pushUnique(...segments)`；
- `querySegment()` / `queryBox()`；
- `removeOwner(ownerRouteId)`；
- `replaceOwner(ownerRouteId, segments)`；
- `activeLength`、`duplicateInsertions`、`tombstoneRatio`。

删除可以先使用 tombstone，查询必须过滤 inactive record；当 `tombstoneRatio > 0.25` 或一次变更涉及
超过 10% physical net owner 时执行一次命名的 `compact()`。阈值放入共享 index policy，不得散落在
Adjust handler。

#### wire tree

原生 tree router 已知 trunk、branch 和 junction，不应再调用 `splitSegmentsAtJunctions()` 的 segment
两两相交。ELK 等兼容输入若仍需推导 junction：

- 同方向 segment 按 `orientation + coordinate` 分桶并排序合并，`O(S log S)`；
- 水平/垂直相交使用 segment index 查询，复杂度 `O((S + I) log S)`，`I` 是实际交点数；
- 不能恢复每组 `O(S²)` 循环。

#### final validator

validator 分为两种模式：

- `commit`：任何 hard violation 出现即使该 route/net 失败，保留每类有限样本；用于 provider 提交；
- `audit`：继续扫描并输出计数，但每类 detail 最多保留 64 项，额外项通过
  `{ truncated: true, omittedCountLowerBound }` 表达。

判断“是否为零”不需要列举所有冲突对。foreign overlap 使用 line bucket + active interval 或
`RouteSegmentIndex` 查询；单 physical route 内重复/重叠也使用相同索引。最终目标：

```text
preprocess/channel allocation: O((N + E + D) log(N + E + D))
routing: O(PN * CANDIDATE_LIMIT * indexed-query-cost)
tree normalization: O((S + I) log S)
final validation: O((N + S + H) log(N + S))
```

其中 `PN` 为 physical net 数、`S` 为 unique segment 数、`H` 为实际 index hit 数。不得出现按
logical edge 数乘全部已布 segment 数的主循环。

### 11.10 Adjust 和增量重布线

自动 layout 的 capacity plan 以以下内容作为缓存 key：

```text
graph/query identity
+ provider
+ normalized layout policy
+ Cell Config / pin geometry revision
+ Focused locality revision
```

失效规则：

| 操作 | channel plan | segment index | 允许工作 |
| --- | --- | --- | --- |
| selection、pan、zoom、已显示搜索 | 复用 | 复用 | DOM/viewport only |
| label 显示切换 | 复用 | 复用 | label/Scene 更新 |
| cell spacing、wire pitch、provider 改变 | 全失效 | 全失效 | 重做 placement/capacity/routing |
| Focused roots/depth 改变 | 复用 full graph；局部 plan 失效 | 局部图重建 | query 后重做局部 layout |
| 单节点 move/resize commit | 自动 plan 保留为基线 | 替换受影响 owner | 只重布 incident、穿过 changed box 及同 physical group |
| batch override | 基线保留 | 受影响 owner 比例超过阈值时 compact | 一次合并 invalidation 后重布 |

手动 override 后不允许自动移动其他未选节点来扩大通道，因为这会把 Adjust 变成隐式 provider rerun。
如果用户位置使 corridor 不可行：

1. preview 可以弱化旧 wire；
2. commit 只对受影响 physical net 运行有界路由；
3. 无合法路径时返回 `override-blocks-routing`，保留 node override 和上一份有效 wire 或显示明确未布线；
4. 不得穿节点，也不得触发全图 placement；
5. Reset 仍恢复缓存的 automatic positioned graph。

`collectRerouteEdgeIds()` 和 `expandRerouteEdgeIdsByNetGroup()` 保留为 invalidation 入口，但结果应尽早
转换为 physical owner set；后续循环不再逐 edge 重复路由同一组。

### 11.11 观测指标和失败诊断

扩展现有 `onRoutingStage` / `onRoutingProgress`，阶段至少包括：

```text
demand-plan
row-channel-allocation
capacity-expansion
outer-channel-allocation
physical-net-routing
tree-normalization
final-validation
labels
```

指标至少包括：

- `logicalEdgeCount`、`physicalNetCount`、`channelDemandCount`；
- 各 channel kind 的数量、lane 总数和最大 lane 数；
- `expandedX`、`expandedY`、top/bottom/left/right band 大小；
- 各 candidate class 的 generated/validated/hardRejected/softScored 数；
- node/segment index query 次数、总 hit、p95 hit、最大 hit；
- unique/duplicate/tombstone segment 数；
- unroutable physical net 数及原因；
- 每阶段 elapsed time。

测量仅进入 diagnostics/progress，不写入 session、Golden 或 parser IR。

稳定失败码：

| code | 必带字段 |
| --- | --- |
| `routing-capacity-limit` | `channelId`、`requestedLanes`、`limit`、`netGroupKey` |
| `routing-placement-capacity-mismatch` | `channelId`、`requiredSpan`、`actualSpan` |
| `routing-search-budget-exhausted` | `netGroupKey`、各 class 尝试数、`candidateLimit` |
| `routing-no-legal-candidate` | `netGroupKey`、blocking node/net 样本、hard violation 分类 |
| `routing-final-contract-failed` | provider、physical route id、validator code |
| `override-blocks-routing` | moved node ids、affected net groups、blocking object 样本 |

不得用 `treeFallback=false`、`routeKind` 或“生成了 points”推断成功；唯一成功口径是 final hard contract
通过且全部 target reachable。

### 11.12 eq012 中的预期分配结果

实现完成后，eq012 指定场景应体现以下机制，而不是固定坐标：

1. `clk` 和 `rst_n` 是两个 physical net demand，在共同 layer boundary/outer interval 相交时必须分配
   不同 lane；因此不能再次共享 `y=38` 或同一竖直 x 段。
2. `clk` 的 `_2021_`、`_2406_` 和 focus-output loads 在同一 physical net tree 中共享一个 trunk，
   trunk 只占一个 channel demand 和一个 reservation owner。
3. Focused input 搬移后，trunk 根据最终 `spatialColumn` 和 anchor target 规划；不得继续从被扩大到
   `x=1498` 的旧 level-0 bounds 推导 `x=1570`。
4. `_1314_` 与 `_0198_` 的 4 px 水平 gap 小于 `requiredInterLayerGap(1)`，必须在 route 前扩到合同尺寸。
5. `_0198_` 与相邻 focus boundary nodes 的 row gap 若承担 `_0179_`，其开放高度至少达到
   `requiredRowGap(1)=2C`；线从分配的 gap 通过，不穿 node padding。
6. local channel 可行时，`clk -> _2406_` 不产生 outer demand；只有所有 local/channel 类硬失败时
   才能使用 top/bottom lane。
7. spacing 从 4 改到 84 只改变 `currentSpan` 和所需 expansion，不改变 physical net identity、lane
   冲突关系或候选类别顺序。

测试应断言这些关系和 hard contract，不保存 `x=某值/y=某值` 的 fixture 特例。

### 11.13 可直接拆分的实现任务

| ID | 任务 | 主要输出 | 依赖 |
| --- | --- | --- | --- |
| CH-01 | 收敛 route geometry/pitch policy | `routingGeometry`、删除私有 clamp、policy tests | 阶段 0 |
| CH-02 | 统一 physical net demand | `PhysicalNetDemand` builder、stable grouping tests | CH-01 |
| CH-03 | 实现 interval lane allocator | heap allocator、reuse/稳定/最少 lane 单测 | CH-02 |
| CH-04 | 实现 channel capacity plan | channel model、公式、capacity diagnostics | CH-03 |
| CH-05 | placement 应用 row/inter-layer/band expansion | 固定 pass、prefix/suffix shift、输入不变性 | CH-04 |
| CH-06 | Focused anchor/spatial column | locality 重锚、eq012 4 px corridor test | CH-05 |
| CH-07 | 候选按已分配 channel 生成 | class quota、删除笛卡尔/global 节点数循环 | CH-04、CH-06 |
| CH-08 | physical net-tree 原生路由 | trunk/branch/junction、target reachability | CH-07 |
| CH-09 | dynamic unique segment index | owner replace、tombstone/compact、指标 | CH-02 |
| CH-10 | shared final validator/bounds | commit/audit、跨 route、连通、wire extents | CH-08、CH-09 |
| CH-11 | Adjust 增量适配 | physical owner invalidation、override failure UI contract | CH-09、CH-10 |
| CH-12 | provider 适配 | Simple/Adjust/ELK contract suite | CH-10、CH-11 |
| CH-13 | corpus 和 benchmark 门禁 | eq012 matrix、47-case Focused、large/Adjust benchmark | 全部 |

CH-03、CH-09 可以在 CH-02 后并行开发；CH-05 与 CH-07 不应在 channel model 未冻结前各自创造私有
lane 结构。每项完成时必须在本方案的提交顺序下记录实际指标和与初始预算的偏差。

### 11.14 性能验收场景

除第 6 节的正确性矩阵外，性能至少分四类测量：

1. **低拥塞长链**：现有 1K/4K/8K buffer chain，防止新 planner 给简单图增加不必要成本；
2. **高 fanout**：同一 source 具有大量 targets，验证按 physical net 一次规划，候选数不随 logical
   target 数成倍增长；
3. **多 net 稠密通道**：多个独立 net 穿过相同 boundary，验证 interval allocator、lane expansion 和
   foreign-overlap validator；
4. **Focused/Adjust**：eq012 双根及 1024-cell 单节点 override，验证局部 plan/index 复用。

每项至少 warm-up 一次、采样三次并报告 median；CI 的绝对秒数只保留现有宽松 smoke limit，主要门禁
使用相同 commit 环境的相对变化和操作计数：

- 简单长链 `physicalNetCount` 近似 logical edge 数时，单 net candidate 数仍受固定上限控制；
- 高 fanout 的 trunk planning/reservation 次数为 1，不随 target 数增长；
- 同一图扩大 `cellSpacing` 不增加 candidate 类别和搜索上限；
- Adjust 单节点提交的 provider 调用数为 0；
- final validator 不调用 segment all-pairs helper；
- 候选生成不得读取 `nodes.length` 来决定尝试次数；
- 整体中位数和 P95 使用第 7 节阈值，若超标必须通过 profiler 定位，不能减少 hard checks。
