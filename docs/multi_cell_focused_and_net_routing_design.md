# 多 Cell Focused、局部边界与多扇出 Net 路由设计

## 1. 文档状态

- 状态：实施中。Multi-Focused、Focused boundary 与唯一物理 wire contract 已落地；原生 net-tree
  candidate router、Compare 交互同步和完整浏览器回归仍在后续批次。
- 范围：多 Cell Focused、Focused 截断边界显示、多扇出 net 的物理路由与渲染。
- 关联现有能力：阶段 6 的 Focused neighborhood、Search-first、Focus selected cell、fanout hub、
  Simple/Adjust/ELK 布局与 SVG 渲染。
- 不改变 parser 和 Netlist IR；本文中的 Focused graph、边界节点和 wire route 均为派生数据。

### 1.1 当前实现进度（2026-09-02）

- 已实现：`focusedRootNodeIds` / `activeFocusedRootNodeId` 状态、旧 `coneRootNodeId` 迁移、module
  history/session/Golden/startup manifest 数组 round trip。
- 已实现：稳定多源 fanin/fanout BFS、induced local graph、cut edge 分析、`focus-input` /
  `focus-output` 投影及布局/渲染/详情适配。
- 已实现：roots chips、Add/Remove/Clear/Replace、chip 激活定位、Shift-click 切换 root、搜索结果
  `Focus only` / `+ Focus`。
- 已实现：Simple、Adjust 和 ELK 输出 `wireRoutes`；同一 `(source, net)` 的完全相同或共线重叠
  segment 在 layout 边界做区间规范化，保留逐段 `logicalEdgeIds`，renderer 只消费唯一 segment，
  并绘制 junction、单一 net label 与逻辑 edge hit metadata。
- 已实现：`netTreeRouter` 在 wire route 边界对每个 net group 做一次多源最短路径树选择；只重用
  provider 已产生的合法 segment，不新增穿过 node 的几何；所有 target endpoint 均可达时移除
  provider 环路并沿物理树重标注逻辑 edge ownership，不连通时保留原几何并标记 `treeFallback`。
- 已实现：wire route 重复/重叠 validator，以及 unique wire length、junction、eliminated duplicate
  length、rendered duplicate length 等质量指标；规范化后的 `renderedDuplicateLength` 为 0。
- 已实现：Adjust 失效粒度提升到 `(source, net)` 整组；任一分支移动或被障碍阻挡时，同组旧 trunk/
  branch 不再作为保留路径，避免新旧几何混绘。
- 已实现：Compare workspace 接受左右两侧独立的 root 数组与 active root，并共享同一 Focused 提取、
  边界投影和布局入口；未提供 roots 时继续兼容 output cone。
- 已实现：Compare active side 的 Focused roots 交互（Set/Add/Remove/Clear、chip 激活、Shift-click、
  Whole/Focused 切换）；“Sync pan / zoom”仍只控制 viewport，不隐式改变另一侧 roots。
- 待实现：直接从 net topology 和 node obstacle 生成 trunk/tree candidate。目前的 `netTreeRouter`
  仍以 provider 已生成的逻辑 edge 路径为候选，已能净化公共 trunk 和 provider 环路，但尚未替代
  逐 edge 的 candidate 搜索与 lane 预留。
- 待实现：直接按 net 生成有界 trunk/tree candidate、Compare 两侧 roots 的显式匹配同步、root 上限
  策略与完整交互浏览器回归。
- 当前验证：单进程 unit/determinism/fixture 共 257 项通过；47/47 mapped fixtures 通过，累计
  violations 为 83/120；1024/4096/8192-cell benchmark 完成，pipeline 中位数约为
  65.2/430.7/1295.7 ms。Windows 沙箱中的默认并行 `npm test` 和 mapped runner 会因子进程
  `spawn EPERM` 失败，因此 unit 使用 `--test-isolation=none`，mapped cases 使用同一 worker 顺序执行。

## 2. 当前问题与结论

### 2.1 多扇出 net 仍有严重视觉重叠

现有路由已经禁止不同 net 的非法共线重叠，并通过空间索引为后续走线选择其他垂直通道。但多扇出
net 仍按逻辑 edge 分别生成完整折线路径。同一 net 的分支共享相同 lane，每条 edge 都重复携带并
绘制公共 trunk。

这会产生两个不同层面的问题：

1. 几何合法但视觉重复：同一 net 的公共段被多次绘制。现有 validator 有意忽略同 net 重叠，
   因此 hard-invariant 测试通过并不表示画面中没有重复线段。
2. 多组 fanout net 争用通道：每组 net 虽有独立 lane 规划，但复杂图中会形成密集的平行 trunk、
   大量交叉和 fallback。继续增加 Wire spacing 只能放大图，不会消除重复几何。

`simplifyFanoutWithHubs()` 默认只处理 fanout 不小于 8 的组。fanout 为 2～7 的大量 net 保持原始
edge；即使插入 hub，hub 到 loads 的多条 edge 仍可能重复一部分公共路径。因此降低 hub 阈值只能
缓解，不能作为根治方案。

### 2.2 Focused 下 module 输入输出不保证显示

当前 Focused graph 是单个 root 的 fanin cone 与 fanout cone 的有限深度并集。module port 只有在
BFS 深度范围内真正到达时才保留；超出深度的节点和 edge 被直接过滤。截断处没有生成局部边界
节点，因此用户无法判断某条线是到此结束，还是继续连接到图外逻辑或 module port。

这不是 SVG renderer 单独漏画，而是 Focused 派生图没有表达 cut boundary。

### 2.3 新需求：多 Cell Focused

用户需要同时选择多个关注 cell，在一张局部图中查看它们各自的 fanin/fanout 以及重叠、连接和差异。
它不能通过反复替换单 root 实现，也不应把 selection、搜索命中和 Focus root 混成同一种状态。

## 3. 设计目标

1. 一个 Focused 视图支持多个 cell root，并对所有 roots 计算统一的双向局部图。
2. roots 的添加顺序、原始 node/edge 数组顺序不影响派生图、布局和路由结果。
3. 重叠 cone 自动去重；共享节点和 edge 只出现一次。
4. 深度截断位置必须显示明确的局部输入/输出边界，不伪装成真实 module port。
5. 真正位于深度范围内的 module INPUT/OUTPUT 保持原节点、名称和时序信息。
6. 多扇出 net 按 net 生成一棵物理路由树；公共 trunk 只布局、预留和绘制一次。
7. 保留逻辑 edge，用于图分析、Selection、Compare 和连接详情；物理 route 不反向污染 Netlist IR。
8. 搜索、route candidate 和 reroute 工作量保持有界，不引入 all-pairs 或随图规模增长的重试。
9. Single 和 Compare 使用同一 Focused graph、边界投影和 route contract。

## 4. 非目标

- 不做任意多端 rectilinear Steiner tree 的全局最优求解。
- 不在 Focused 中默认显示 module 的全部 ports；只显示实际到达的 ports 和与局部图相关的 cut boundary。
- 第一版不支持每个 root 独立的 fanin/fanout depth；所有 roots 使用同一组深度。
- 不把 Focus root 集合等同于多对象属性编辑 selection。
- 不用降低 validator 标准、增加无限 fallback 或按 fixture/instance 名称特判来换取可读性。

## 5. 总体数据流

```text
Netlist IR
  -> full schematic graph
  -> timing / alias normalization
  -> multi-source Focused extraction
  -> Focus boundary projection
  -> optional fanout hub / group transforms
  -> provider node placement
  -> net-level physical routing
  -> positioned graph（logical edges + unique wire routes）
  -> SVG render
```

顺序必须保持：Focused 提取基于 full graph 的真实拓扑；边界投影在提取后进行；fanout hub 和 group
collapse 只作用于派生 display graph；net-level routing 只处理 positioned graph 的物理几何。

## 6. 多 Cell Focused 状态模型

### 6.1 状态结构

```text
FocusedViewStateV2
  rootNodeIds: string[]
  activeRootNodeId: string | null
  faninDepth: number
  fanoutDepth: number
  boundaryMode: cut | none
```

约束：

- `rootNodeIds` 只接受 full graph 中存在的 `cell` 节点。
- 在 app/view 状态边界去重并按 canonical node id 稳定排序。
- `activeRootNodeId` 只影响 UI 强调和 Focus selected viewport，不影响子图结果。
- root 数量上限属于命名的 `FocusedViewPolicy.maximumRoots`，不在算法中写私有限制。
- `faninDepth`、`fanoutDepth` 延续当前语义；0 表示关闭对应方向。
- `boundaryMode` 默认 `cut`。`none` 只用于兼容或诊断，不作为默认体验。

### 6.2 Selection 与 roots 分离

现有 `selectedNodeId` 继续表示属性面板当前对象，并保持单选。新增 `rootNodeIds` 表示局部图查询条件。
这样可以避免把多选语义扩散到 timing、属性编辑、拖动和 Compare 面板。

核心操作：

- **Focus selected**：保持现有行为，用当前 cell 替换全部 roots。
- **Add selected to Focus**：将当前 cell 加入 roots，不删除已有 roots。
- **Remove selected from Focus**：仅从 roots 删除当前 cell。
- **Clear Focus roots**：清空 roots。大图返回 Search-first，小图返回 Whole，复用现有大小策略。
- 在画布上 `Shift + click cell` 切换其 root 状态；普通 click 仍只改变 selection。
- 搜索结果提供 `Focus only` 和 `Add to Focus` 两个动作。

侧栏显示稳定排序的 root chips。每个 chip 可激活、定位或删除。root cell 在画布上使用独立轮廓标识；
active root 再增加更强的非纯颜色强调。

### 6.3 历史、session 和启动接口

以下状态从单值迁移为数组：

```text
coneRootNodeId       -> focusedRootNodeIds
startup target.focus -> startup target.focus[]
```

兼容规则：

- 旧 session/history/golden 中的 `coneRootNodeId` 自动迁移为单元素数组。
- 旧启动 manifest 的字符串 `focus` 继续接受；新版本接受字符串数组。
- CLI 可重复使用 `--focus <instance>`，不使用逗号分隔，避免 escaped/hierarchical 名称歧义。
- 序列化时 roots 使用稳定顺序，保证 round trip 和 diff 确定。

## 7. 多源 Focused 子图算法

### 7.1 算法选择

不对每个 root 分别扫描整图再拼接。对 fanin 和 fanout 各执行一次多源 BFS：

1. 从稳定排序、去重后的所有 roots 以 depth 0 入队。
2. fanin 使用反向邻接，fanout 使用正向邻接。
3. 每个节点保存距任一 root 的最小深度。
4. 到达全局方向深度后停止扩展。
5. 两个方向的节点集合取并集。
6. 保留两个端点都在集合内的逻辑 edge，形成 induced local graph。

当所有 roots 使用相同方向深度时，多源 BFS 与逐 root cone 并集等价，但遍历复杂度从最坏的
`O(rootCount * (V + E))` 降为 `O(V + E)`。邻接索引可按 full graph 数组身份和长度缓存；数组替换
或长度变化时必须重建。

### 7.2 返回模型

```text
MultiFocusedAnalysis
  rootNodeIds
  faninDepth
  fanoutDepth
  nodeIds
  edgeIds
  faninDepthByNode
  fanoutDepthByNode
  cutEdges
```

`cutEdges` 是 full graph 中恰好跨越 included/excluded 集合边界的 edge，供下一阶段投影边界节点。
分析函数只返回派生结果，不修改 full graph。

### 7.3 环路、重叠 cone 和不连通 roots

- 环路由 visited/min-depth 终止。
- 多个 roots 的 cone 重叠时，节点和 edge 只保留一次。
- roots 之间有连接时，完整保留 included 集合内部的交叉连接，不只保留 BFS tree edge。
- roots 互不连通时允许产生多个局部 component；布局 provider 按稳定 component key 排列。
- 无效 root 返回诊断并从查询中排除；全部无效时不提交空布局覆盖当前有效视图。

## 8. Focused 截断边界投影

### 8.1 边界类型

边界投影不能把“局部图之外”冒充成“module 顶层端口”，因此区分：

- `input` / `output`：full graph 中真实 module port，且已被 BFS 到达。
- `focus-input`：隐藏逻辑通过 cut edge 驱动局部图。
- `focus-output`：局部图通过 cut edge 驱动隐藏逻辑。

显示建议：

- `focus-input` 放在局部图左侧，标题为 `FANIN CONTINUES`。
- `focus-output` 放在局部图右侧，标题为 `FANOUT CONTINUES`。
- label 使用 net display name；tooltip 显示隐藏端点数量和“Focused boundary”。
- 真实 module port 继续使用 INPUT/OUTPUT 外观，不改变 timing annotation。

### 8.2 投影规则

对每个 cut edge：

```text
excluded source -> included target
  => focus-input -> included target

included source -> excluded target
  => included source -> focus-output
```

同一 `netGroupKey + direction` 的 cut edges 合并为一个边界节点；到多个局部 load 时仍保留逻辑
branch 关系。派生节点和 edge 使用稳定 ID，例如：

```text
focus-boundary:in:<escaped-net-group-key>
focus-boundary:out:<escaped-net-group-key>
```

派生 edge 保存 `derivedFromEdgeIds`、`hiddenEndpointCount` 和原始 net/display name，供 Selection、
高亮和调试使用。canonical name 与 display name 分开保存，所有 SVG/HTML 输出继续转义。

### 8.3 深度语义

边界节点不消耗额外逻辑深度；它们是截断结果的展示，不参与下一轮 BFS。调整 depth 时必须重新从
full graph 派生：

- 增加深度后，原 boundary 可能被真实 cell 或 module port 替代。
- 减少深度后，新的 cut edge 产生 boundary。
- depth 为 0 的方向不生成该方向 boundary，表示用户明确关闭这一侧，而不是“未知连接”。

## 9. 多扇出 Net 的物理路由树

### 9.1 逻辑 edge 与物理 wire 分离

`graph.edges` 继续表达 driver/load 语义。布局结果新增可选的 net-level 物理路由：

```text
PositionedGraph
  nodes[]
  edges[]                  # 逻辑连接，兼容现有分析与详情
  wireRoutes[]             # 唯一物理几何，renderer 优先消费

WireRoute
  id
  netGroupKey
  net
  sourceNodeId
  logicalEdgeIds[]
  segments[]
  junctions[]
  labelPoint

WireSegment
  id
  start
  end
  kind: source | trunk | branch | endpoint
  logicalEdgeIds[]
```

当 provider 暂未提供 `wireRoutes` 时，renderer 可以回退到现有 `edge.points`；迁移完成后所有 provider
都应规范化为相同 contract。renderer 不自行合并路径，也不计算路由。

### 9.2 路由组与确定性

使用现有稳定 `getNetGroupKey(edge)` 按 `(source, net)` 分组。每组 targets 按 topology key、target
node id 和 target pin 稳定排序，不能依赖 parser statement order 或 edge 数组顺序。

- 单 load net 可以继续走现有单 edge candidate 流程。
- 多 load net 生成一棵确定性的正交分配树。
- 同名 net 若存在多个实际 driver，必须按 source 分组并保留诊断，不能错误合并。

### 9.3 有界正交分配树

第一版不求全局最优 Steiner tree，采用适合 left-to-right schematic 的有界 trunk 模型：

1. 从 source pin 生成一次 source escape segment。
2. 根据 targets 的层级、Y 分布和通道压力生成有限个 trunk X 候选。
3. 每个候选包含一条唯一的纵向 distribution trunk。
4. 从 trunk 的 junction 分别生成到 target pin 的局部 branch；相同共线路段先做区间 union。
5. 对整棵树统一检查 node clearance、pin side、不同 net overlap、crossing、bend、length 和 outer lane。
6. 选择得分最好的合法候选，并将唯一 segments 一次性加入共享 `RouteSegmentIndex`。

候选数量由 `routeSearchPolicy` 的命名上限控制。若合法 tree 不存在，降级顺序为：

1. 局部多 trunk 分区，将 targets 按层或稳定 Y gap 分成有限组。
2. bounded outer lane tree。
3. 保持 node clearance 的最佳候选并记录显式 routing violation/diagnostic。

任何降级都不能恢复全图 all-pairs 扫描，也不能静默把不同 net 共线当成合法。

### 9.4 公共段规范化

同一 net 可以拓扑上共享 trunk，但物理模型中不得存在重复 segment：

- 完全相同 segment 合并。
- 同一直线且区间相交的 segment 做 interval union。
- T junction 在合并后拆为无重叠的最小 segment 集合，并记录 junction。
- `logicalEdgeIds` 取参与该 segment 的 edge id 稳定并集。

这使“同 net 可共享主干”从 validator 的例外变为显式 route topology。新增硬规范：
`wireRoutes` 内同一 net 不得含重复或相互覆盖的物理 segment。

### 9.5 渲染与交互

- renderer 每个 `WireSegment` 只绘制一次 visible path 和一次 hit area。
- T junction 绘制 junction dot；普通交叉仍按现有 bridge policy 处理。
- bridge detection 基于唯一 segment index，同 net junction 不画 bridge。
- 选择任一 segment 默认选择 net；详情面板仍可通过 `logicalEdgeIds` 列出全部 loads。
- 高亮 net 时整棵 `WireRoute` 高亮；高亮 cell 时只强调与该 cell 相关的 branch，并可同时弱化 trunk。
- 每个 net tree 默认只放置一个 label；必要时可在远端 branch 增加受策略控制的重复 label。

### 9.6 Adjust 与 ELK

- Adjust 中移动一个节点时，以受影响的 `netGroupKey` 为失效单位重路由整棵 tree，不能只修补一条
  branch 后留下重复 trunk。
- `rerouteInvalidation` 继续通过空间索引查找受影响 route；不扫描所有 moved-node/edge 组合。
- Simple 原生生成 `wireRoutes`。
- ELK sections 先规范化、合并为 net-level route；节点 override 后使用共享本地 net-tree router。
- 自动 provider graph 与 adjusted graph 继续分开保存；拖动 preview 不运行 provider。

## 10. Multi-Focused 与 Net 路由的结合

先生成 Focused + boundary display graph，再按 display graph 的 net groups 路由。这样：

- 位于 Focused 内的真实 fanout 保持一棵 tree。
- 一个 net 的部分 loads 被裁掉时，保留的 loads 与 `focus-output` 共同作为该 tree 的 targets。
- 多个 roots 共享同一 net 时只生成一个 `WireRoute`。
- depth 变化导致 display graph 改变时，只对新 display graph 重新 layout/routing，不修改 full graph。

边界投影与 net tree 必须共享 `netGroupKey`，避免同一 net 在 boundary 附近被错误拆成多条重叠 trunk。

## 11. Single、Compare 与导航行为

### 11.1 Single

- roots 列表属于当前 module 的 view state。
- 切换 module 时按 module history 保存和恢复 roots、depth、selection 和 viewport。
- Focus selected cell：目标已在 display graph 中只更新 viewport；不在时用它替换 roots 并重建。
- Add selected to Focus：目标不在 display graph 也从 full graph 查找并加入 roots。

### 11.2 Compare

底层 helper 和 workspace 必须从一开始支持 root 数组，不能复制 Single 算法。Compare 每侧保存自己的
canonical root 集合：

- 未启用同步时，只修改 active side。
- 启用同步时，按现有 Compare 匹配规则向另一侧添加对应 cell。
- 找不到匹配 cell 时保留 active side root，并在另一侧显示非阻塞诊断。
- 两侧独立计算 geometry 和 viewport，不复制坐标。

## 12. 代码边界建议

### `src/analysis/`

- 扩展 `graphCone.js` 或新增 `multiFocusedGraph.js`：多源 BFS、induced subgraph、cut edge 分析。
- 新增 `focusBoundary.js`：把 cut edges 投影为派生边界节点和 edge。
- `fanoutHub.js` 保留为可选的显示简化，不负责消除物理重复 segment。

### `src/app/`

- `appState.js`：`focusedRootNodeIds`、`activeFocusedRootNodeId` 和迁移。
- `graphWorkspace.js` / `moduleWorkspace.js` / `compareWorkspace.js`：统一消费 root 数组和 boundary policy。
- `moduleHistory.js` / `sessionState.js` / `startupController.js`：数组状态 round trip 和旧格式兼容。
- `main.js`：只编排 Add/Remove/Replace/Clear，不实现 BFS、边界或路由算法。

### `src/layout/`

- 新增 `netTreeRouter.js`：按 net group 生成有界物理树。
- 新增 `wireRouteNormalization.js`：共线区间 union、junction 和 ownership metadata。
- 扩展 `layoutValidator.js`：route topology 连通性、唯一 segment、不同 net 重叠。
- 扩展 `layoutQuality.js`：unique wire length、junction、tree fallback 和 rendered duplicate length。
- `simpleOrthogonalRouter.js`、`positionedRouting.js` 和 ELK adapter 统一输出 `wireRoutes`。

### `src/render/` 与 `src/ui/`

- renderer 优先消费 `wireRoutes`，保留 legacy edge fallback 直至迁移完成。
- wire bridge、label、hit area、selection/highlight 基于唯一 segment metadata。
- View 面板增加 roots chips 和 Add/Remove/Clear；不在 pointer hot path 中重建图。

## 13. 测试设计

### 13.1 多 Cell Focused

- 1 个 root 与旧单 root 输出兼容。
- 2 个和多个 roots 的 fanin/fanout 并集正确。
- 重叠 cones 的节点、edge、boundary 去重。
- root 添加顺序、node/edge 数组排列变化后结果一致。
- faninDepth/fanoutDepth 为 0、不同有限值和 Infinity。
- 环路、互不连通 roots、无效 root、重复 root。
- full graph 输入未突变，canonical/display name 保留。
- roots 上限在 policy 边界规范化，并产生用户可见诊断。

### 13.2 Focused 边界

- 深度范围内真实 module INPUT/OUTPUT 正常保留。
- 深度截断产生正确的 `focus-input` / `focus-output`。
- 同 net 多个 cut edges 合并边界节点但不丢失 loads。
- 增减 depth 后 boundary 与真实节点相互替换。
- alias、vector port、escaped identifier、implicit/constant source。
- timing 只附着真实 module port，不误附到 Focus boundary。

### 13.3 Net-level routing

- fanout 2、7、8、64 均只有一份公共 trunk。
- 多个 fanout net 使用不同物理 lane，不发生不同 net 共线重叠。
- `renderedDuplicateLength === 0`。
- logical edge 到 wire tree 的连通性完整，每个 load 可从 source 到达。
- 正交、pin side、endpoint body、node clearance 和 bounded fallback。
- route/tree 结果对 node/edge/target 顺序排列不敏感。
- Adjust 移动 source、单个 load、多个 loads 后整棵受影响 net 正确失效与重建。
- Simple、Adjust、ELK normalized output 通过同一 validator。
- Focus boundary 作为 target/source 时 tree 拓扑正确。

### 13.4 回归与性能

- focused unit tests、graph workspace 不变性测试。
- `layout-determinism`、`layout-fixtures`、`npm test`。
- `npm run test:mapped-cases`；必要时使用 `MAPPED_CASE_NO_COLLAPSE=1`。
- `npm run benchmark` 增加多组中等 fanout、单组高 fanout、多 roots 重叠 cone 场景。
- 记录候选 tree 数、唯一 segment 数、重复消除长度、route fallback 数和最大局部查询候选数。

## 14. 分批实施建议

### 第一批：Multi-Focused graph 与兼容状态

1. 定义 `FocusedViewStateV2` 和迁移。
2. 实现多源 BFS、cut edge 结果和不变性测试。
3. workspace、history、session、startup 接入 root 数组。
4. 增加 roots chips、Add/Remove/Replace/Clear 交互。

### 第二批：Focused boundary

1. 实现 focus boundary 派生变换。
2. 补充 node geometry、render style、Selection 详情和 tooltip。
3. 覆盖真实 module ports、depth 变化、alias/vector/escaped name 测试。

### 第三批：Net-level route contract

1. 增加 `wireRoutes` 数据结构、segment normalization 和 validator。
2. Simple 为多 load net 生成有界正交 tree；单 load 保持兼容路径。
3. renderer、bridge、label、hit area 切换到唯一 segment。
4. 增加复杂 fanout fixture、determinism、quality 和 benchmark 门槛。

### 第四批：Adjust、ELK 与 Compare 收敛

1. Adjust 以 net group 为失效和 reroute 单位。
2. ELK route sections 规范化为 `wireRoutes`。
3. Compare roots 同步与不匹配诊断。
4. 完成 mapped cases、全量测试、性能和交互实测。

实施顺序不能倒置：先建立 Multi-Focused 与边界语义，再建立物理 wire contract，最后迁移所有 provider
和 Compare。不能只在 SVG 层去重 path，否则 layout、bridge、hit test、label 和 Adjust 仍会消费错误的
重复几何。

## 15. 验收标准

1. 用户可将至少两个 cell 加入 Focus roots，并稳定查看所有 roots 的双向局部图。
2. 单 root 行为保持兼容；roots 顺序和输入数组排列不影响结果。
3. Focused 截断处均有明确边界，深度范围内的真实 module INPUT/OUTPUT 正常显示。
4. 多扇出 net 的公共 trunk 在 positioned graph 和 SVG 中都只存在一次。
5. 不同 net 无非法共线重叠，wire 不穿越非端点 node，所有逻辑 loads 与 driver 保持连通。
6. Single 与 Compare 通过共享 helper/workspace 获得一致语义。
7. 多 roots 和多 fanout benchmark 保持有界，没有 root-count 倍增的全图扫描或 all-pairs routing。
8. focused、determinism、fixtures、mapped cases、benchmark 和 `npm test` 达到仓库既有门槛。
