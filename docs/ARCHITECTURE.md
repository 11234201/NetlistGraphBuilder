# 架构设计

本文记录现行实现与已建立的约束。面向后续功能和 AIG 的目标边界、数据契约与迁移决策见
[可扩展工作台架构](architecture_evolution.md)，实施顺序与进度见 [阶段 7](STAGE_7_PLAN.md)。
阶段 7 的模块化单体基线已经落地；以下同时记录现行实现和仍有明确移除条件的兼容层。

## 产品范围决策（2026-09-14）

Group collapse/expand 已从产品路线中移除。后续功能、性能优化、mapped 基线和验收不得以折叠图
为目标，也不再新增折叠交互或专用路由逻辑；大图统一沿 full graph、Search-first 或 Focused
路径处理。现有 `collapseLargeGroups`、`expandedGroupIds` 字段和历史解析仅作为旧 session/golden
的兼容边界保留，除非另有明确的删除任务。

## 分层原则

项目采用清晰的数据流分层，避免 UI、parser 和布局逻辑互相耦合。

```text
parser -> netlist IR -> inference -> graph extraction -> layout -> render -> UI
```

每层只依赖左侧稳定数据结构，不直接读取 Verilog 原文，除非它就是 parser 层。

公共工作台把这条 Netlist 数据流包在稳定边界内：`contracts/` 定义 ObjectRef、领域和视图契约，
`application/` 拥有 Document/ViewSession/commands 与任务协调，`domains/netlist/` 负责领域投影，
`diagram/` 和 `render/` 消费中性显示图与 Scene，`bootstrap/` 组装具体领域。公共 application、layout
和 render 不得反向读取 Netlist/AIG 私有字段；静态边界测试固定这一依赖方向。

## 模块边界

### `src/parser/`

负责把 structural Verilog 文本解析成原始语法信息。

职责：

- 处理注释。
- 处理 escaped identifier。
- 解析 module、port、net declaration、assign、cell instance。
- 保留必要 source span，方便错误定位。

不负责：

- 推断 gate 类型。
- 推断 pin 方向。
- 决定图怎么画。

### `src/netlist/`

负责稳定 IR 和图分析基础结构。

建议核心类型：

```text
Design
  modules: Module[]

Module
  name
  ports
  nets
  cells
  assigns

Port
  name
  direction: input | output | inout | unknown

Net
  name
  declaredKind: port | wire | implicit

Cell
  type
  instance
  pins: PinConnection[]

PinConnection
  pin
  net
```

### `src/infer/`

负责无 `.lib` 推断。

职责：

- cell type -> gate kind。
- pin name -> input/output/inout。
- assign alias 处理建议。
- 标记推断置信度。

规则必须可配置，长期放入类似：

```text
src/infer/defaultCellRules.ts
```

后续可以加载：

```text
config/cell_rules.json
```

### `src/layout/`

负责把图模型转成布局引擎输入，再把布局结果规范化。

布局 provider 设计：

```text
LayoutProvider
  layout(graph, options) -> PositionedGraph
```

长期 provider：

- `SimpleLayeredLayoutProvider`：内置 fallback，方便测试和离线最小原型。
- `ElkLayoutProvider`：长期主力。

当前实现：

- `src/layout/layoutProvider.js` 维护 provider registry 和 fallback 选择。
- `SimpleLayeredLayoutProvider` 封装现有 `simpleLayered.layoutGraph`，应用层不再直接依赖具体布局函数。
- provider 的 `layout(graph, options)` 允许返回 positioned graph 或 Promise；应用编排层统一检测并提交最新 request，过期的异步结果不会覆盖新状态。
- `src/app/compareWorkspace.js` 负责组合 compare 的 graph extraction、alias、cone、provider layout 和统计，不持有 DOM 或全局应用状态。
- `ElkLayoutProvider` 使用 `vendor/elkjs-0.11.1/lib/elk.bundled.js`，把内部 graph 转换为 ELK layered 输入并规范化回 positioned graph。
- `src/layout/positionedRouting.js` 在 positioned graph 上应用手动位置/尺寸 override，并重建 ports、graph bounds 和带障碍检查的 Manhattan edge；ELK Adjust 拖动期间复用缓存的自动布局结果，不重复运行 ELK。
- `src/render/progressiveSvgRenderer.js` 只负责将 renderer plan 分批提交 DOM，不参与布局或图分析。
- SVG wire-bridge detection uses the shared segment spatial index. Render complexity must not switch from
  indexed to all-pairs behavior at an arbitrary edge-count threshold.
- Interactive drag previews may disable decorative wire bridges for the frame; gesture completion always
  restores one full render. Routing geometry, labels and hit areas remain present in previews.
- `src/analysis/fanoutHub.js` 和 `src/analysis/groupCollapse.js` 是布局前的可逆显示图变换，不修改 Netlist IR。
- `src/app/sessionState.js` 负责 session snapshot 的序列化边界；用户输入网表仅保存在当前标签页的 `sessionStorage`。

手动布局校准不改变 Netlist IR，也不替代 layout provider。实现时应把用户拖动得到的节点位置作为 layout override/golden 叠加在 positioned graph 上，再让路由和渲染层基于覆盖后的节点位置工作。

wire routing 策略属于 layout 层，不放到 render 层。layout 输出的 edge 可以携带 `routeKind`、`labelPoint` 和后续调试所需的 routing metadata；render 只负责按这些结果绘制 path 与文字。

adjust 模式的 snap 计算属于 UI/layout 边界：UI 负责把 pointer movement 转成候选节点位置，layout helper 负责根据 grid 和相连 pin 关系给出吸附后的坐标。snap 结果仍保存为普通 node position override。

Layout policy:

- `src/layout/layoutPolicy.js` owns the named layout policy used by the demo.
- Layout spacing and feature values are normalized once at the policy boundary. Algorithms consume the
  normalized policy and must not add their own conflicting ranges or string/boolean coercion.
- `src/layout/nodeGeometry.js` owns node measurement, pin placement, connection points, and graph bounds.
- `src/layout/nodeOverrides.js` is the input boundary for manual node position and size overrides. It
  normalizes supported collection shapes and owns numeric validation and size limits.
- `src/layout/nodeAlignment.js` owns topology-driven vertical alignment and branch lanes.
- `src/layout/nodeLocality.js` owns external-input and fanout-hub locality policies.
- `src/layout/nodeSpacing.js` owns layer X spacing and node-overlap resolution.
- `src/layout/nodePlacementShared.js` contains deterministic ordering and free-space helpers used by those
  placement policies. `nodePlacement.js` remains only as a compatibility export barrel.
- `src/layout/layoutTopology.js` owns stable edge ordering and net grouping keys. Layering, layout intent
  and lane planning must produce the same result when graph node/edge arrays are permuted.
- Placement modules may improve routing, but must not encode wire collision rules.
- `src/layout/orthogonalRouting.js` is the shared routing contract used by Simple and Adjust routing. It
  owns port-side entry, endpoint-body protection, segment conflict semantics and route-point normalization.
- Route-point normalization removes duplicate and collinear pseudo-bends before scoring, labels, hit
  testing or rendering. Providers must not maintain private polyline simplifiers.
- `src/layout/routeCandidateValidation.js` applies that contract to candidate paths. Simple and Adjust
  share its orthogonality, node-clearance and endpoint checks; overlap rejection is an explicit option.
- `src/layout/routeLaneCandidates.js` owns stable local Y-lane collection from node and reserved-wire
  boundaries. Simple and Adjust must not maintain separate obstacle-boundary ordering rules.
- `src/layout/simpleRoutingPlan.js` converts layout intent and level distance into stable channel/lane
  reservations; it does not inspect pixel geometry or generate route points.
- `src/layout/simpleLayering.js` owns cycle-safe level assignment and topology ordering.
  Cycle breaking selects a stable node order and must not depend on parser statement order.
- `src/layout/simpleOrthogonalRouter.js` owns Simple candidate selection, scoring and segment reservation.
  It consumes the shared routing contract and returns positioned edges; it does not move nodes.
- `src/layout/simpleRouteCandidates.js` owns Simple-specific candidate geometry and global fallback lanes.
  The router chooses and reserves candidates without embedding their coordinate formulas. Global fallback
  candidates have a fixed budget; their count must not grow unbounded with graph node count.
- `src/layout/localOrthogonalRouter.js` owns Adjust candidate validation and scored selection. It reuses
  the shared route costs so a later local, conflict-free path can beat an earlier crossing path. It
  returns the selected candidate strategy as well as points, accepts immutable route context plus shared
  indexes, and does not apply node overrides or place labels.
- `src/layout/localRouteCandidates.js` lazily yields local, obstacle and outer-lane Adjust candidates in
  policy order. Local candidates include nearby reserved-wire boundaries before outer lanes; the router
  validates candidates without owning coordinate formulas.
- `src/layout/layoutValidator.js` audits a completed positioned graph. Tests and golden cases use its stable
  violation codes instead of repeating one-off geometric assertions.
- `src/layout/wireLabelPlacement.js` is the only wire-label collision and visibility policy. Simple,
  Adjust and ELK may choose different segment ordering, but share label sizing and collision checks.
  Label collision ownership uses an explicit stable edge priority and never raw graph array order.
- `src/layout/spatialIndex.js` provides the dynamic segment and static node indexes used by routing and
  label placement. Geometry predicates remain authoritative; the index only narrows candidate sets.
  Simple computes graph node bounds once and queries local X corridors instead of rescanning every node
  for every difficult edge.
- `src/layout/routeSegmentIndex.js` attaches edge ownership, segment order and orientation before indexing.
  Renderer bridges, label collision and reroute invalidation share this metadata boundary.
- `src/layout/layoutQuality.js` turns soft layout goals into comparable metrics: straight-line ratio,
  bends, length, detour, crossings, overlaps, outer-lane use and hidden labels. Golden comparisons report
  metric deltas; repository fixtures cap outer/global fallback routes independently of hard legality.
- `src/domains/netlist/layout_golden.js` version 3 stores stable node order plus per-edge route geometry,
  strategy, view state and source identity while preserving v1/v2 import compatibility.
  Golden diffs report changed edges so one bad net cannot disappear inside aggregate quality metrics.
- `src/layout/routeScoring.js` owns named route costs and candidate comparison. Candidate generators must
  not embed crossing/bend/length magic numbers.
- `src/layout/routeSearchPolicy.js` owns bounded candidate-search limits shared by Simple and Adjust.
  Candidate generators must not add graph-size-proportional retry loops or private hard limits.
- `src/layout/simpleLayered.js` is the pipeline orchestrator. It composes layering, placement and routing,
  but owns none of their algorithms. New geometry invariants must go into `orthogonalRouting.js`, not here.
- `src/layout/simplePlacementPipeline.js` owns the stable order of placement passes and exposes an optional
  stage hook for diagnostics. Individual passes remain in their alignment, locality and spacing modules.
- `src/layout/positionedRouting.js` orchestrates node overrides, reroute invalidation, local routing, bounds
  and labels. It contains no candidate-generation geometry. Adjust reroutes single-load nets first and
  uses a stable topology key so reservation order cannot drift with parser edge order. Rerouted edges keep
  `routeKind: positioned-override` for origin and record the chosen candidate in `routeStrategy`.
  Unaffected physical net groups and their completed label placements are reused when edge membership is
  unchanged; missing or incompatible artifacts fall back to the complete route/label build.
- `src/layout/rerouteInvalidation.js` owns Adjust route invalidation. It indexes existing route segments
  and queries changed node boxes; batch overrides must not scan every changed-node/edge pair.
- `schematic-readable-v1` is a readable schematic policy, not a general graph optimizer.
- The policy separates spacing from feature switches:
  - spacing: wire lane pitch, cell pin pitch, branch lane origin and pitch.
  - features: driven-link alignment, branch-aware lanes, localized single-fanout inputs.
- `simpleLayered` accepts `layoutPolicy` as the preferred API and keeps legacy options for compatibility.
- Policy passes should be topology-based, not instance-name-based. They may use pin order and node kinds, but must not depend on fixture-specific cell names.

布局流水线保持以下固定阶段：

```text
graph
  -> layout intent（单/多负载、主分支、深度）
  -> layer assignment + topology order
  -> node measurement + port geometry
  -> placement passes
  -> route candidate generation + scoring
  -> shared route contract validation
  -> label placement
  -> positioned graph
```

路由规则分为两类，不能混写：

- **硬约束**：正交线、pin 侧进入、端点 cell 不可穿越、非端点 cell 不可穿越、不同 net
  不可共线重叠。硬约束集中在共享内核和 validator。
- **软目标**：直线优先、局部折线优先、少折点、少交叉、单负载紧凑、多负载留通道。软目标由
  candidate generator 和 score 决定。

增加新 case 时，先判断它改变的是硬约束还是软目标。硬约束必须先增加共享内核单元测试，再让
Simple 和 Adjust 同时消费；软目标应增加 route score/golden 测试，不允许通过 instance 名称或单个
坐标特判修复。

Repository Verilog fixtures are also a hard-invariant gate: every module must remain orthogonal, attached
to the correct pin side, clear of node bodies, and free of different-net collinear overlap.
The same fixture pass enforces broad soft budgets for straight-route ratio, maximum bends and crossings;
case-specific golden tests may impose tighter budgets.
The checked-in 1024-cell chain also gates the interactive Adjust path: cached override, incremental reroute
and bridge-free SVG preview must complete within the large-example smoke budget.

### `src/render/`

负责把 positioned graph 变成 SVG。

职责：

- gate symbol。
- port 节点。
- wire/edge。
- label。
- highlight class。
- marker 和 arrow。

渲染层不解析网表，不计算 cone。

### `src/timing/`

负责可选时序信息的解析和图注释，保持两个边界：

- `timingParser.js` 只把 LocResyn 文本解析为 timing records，不读取 graph。
- `timingAnnotation.js` 负责层级 instance 后缀匹配、默认 badge 选择和 graph node 注释，不解析原始文本。

时序记录保留完整 instance path；图注释采用最长层级后缀匹配，避免同叶子名 cell 误匹配。

### `src/ui/`

`src/ui/viewport.js` owns pure zoom, pan, coordinate-conversion and SVG-transform calculations. App event
handlers provide DOM measurements and commit state, but do not duplicate viewport math.
`src/ui/nodeDrag.js` owns provider-independent drag delta, boundary and position equality calculations used
by both Single and Compare canvases.
`src/ui/pointerSession.js` owns pointer capture plus move/up/cancel lifecycle cleanup shared by sidebar
resize, canvas pan and Single/Compare node drag interactions.
`src/ui/frameScheduler.js` coalesces high-frequency pan/drag updates to one latest task per animation frame
and flushes the final pointer position on gesture completion.

负责用户交互。

职责：

- 文件拖入/打开。
- module 选择。
- 视图模式切换。
- 搜索。
- 高亮。
- 缩放平移。
- 导出。

UI 通过明确 API 调用 application command、领域 feature 和共享 pipeline，不直接操作 parser IR
或 renderer 内部临时结构。`bootstrap/default_domains.js` 是产品领域实现的静态注册点；界面按
feature 的 capabilities/contributions 决定可用操作，未来 AIG 不需要复制 Netlist 主流程。

当前面板边界：

- `timingPanel.js` 负责时序表格、badge 多选和位置控件的 HTML/DOM 绑定。
- `adjustPanel.js` 负责节点尺寸、属性和 pin direction 控件的 HTML/DOM 绑定。
- `html.js` 只提供共享的安全转义和数值/definition list 格式化。

面板模块不持有全局应用状态；状态更新通过回调交给 `src/app/main.js`。

### `src/app/`

- `DocumentStore` 和共享 `ViewSessionStore` 是文档、画布及其 revision 的所有者；Single/Compare
  bridge 只负责 ObjectRef 与旧 UI/session 字段之间的兼容投影，并在 projected graph 中保留
  `occurrencePath`；重复 hinst 的 selection/Focused root 回读按 occurrence identity 匹配，旧的无路径
  ref 仍兼容。Focused root 的 canonical refs 同步保存在 app state、module/View History 与 session
  codec 中；恢复时先以 canonical occurrence ref 为准，再回落到旧的 node-id mirror，避免重复 hinst
  在刷新或前进/后退后串线。
- `view_commands.js` 统一处理 unit、Focused roots、selection、viewport、layout policy 与 overrides，
  并显式返回 query/layout/render/viewport/persist effects。纯 viewport 或相同值提交不会错误推进
  computation revision。
- `view_pipeline.js` 固定 `query -> project -> measure -> layout -> overrides -> scene` 顺序；
  Netlist 与测试用内存 AIG 都经该路径，公共层不含领域类型分支。
- `JobCoordinator` owns asynchronous/synchronous workspace computation identity through document and
  ViewSession revisions; stale success, failure and progress are discarded before the workspace is
  committed. `render/renderGeneration.js` is the separate monotonic guard for progressive DOM batches:
  it invalidates a previous mount when a replacement workspace render starts, including small
  synchronous graphs and Search-first empty views. The old application-wide `workspaceRequest.js`
  guard has been retired so DOM cancellation no longer doubles as computation cancellation.
- `focusedSelection.js` owns shared root actions and active-root fallback. Add rejects capacity
  overflow without evicting an existing root. Single/Compare adapters retain their own state scopes.
- `src/ui/searchControls.js` owns search result markup and keyboard/click dispatch through injected
  index/action callbacks. `spacingControls.js` owns spacing input parsing and control synchronization.

- `appState.js` 定义应用初始状态，以及 design/module/timing 三种生命周期 reset。
- `moduleWorkspace.js` composes graph extraction, timing, aliases, cone/group transforms, provider layout
  and manual overrides for the single-module view without reading DOM or global application state.
- Single 画布始终只投影当前 module：Focused Fanin/Fanout 到 module port 或 hinst 边界即停止，
  不把相邻 occurrence 混入本层 layout graph。详情面板的 `Connections / Current module` 只显示
  当前 definition 内的 pin、net、driver 和 load；`Hierarchy / Parent occurrence` 仅在对象连接到
  当前 module 的 input/output boundary 且存在明确 parent occurrence 时，显示向父层继续的 net。
  hinst 的 child port 属于向实例内部的连接，不标记为 Hierarchy；进入 child occurrence 使用 hinst
  双击。点击父层 target 后切换 module，并用该对象替换原 Focused roots。这样层次导航仍使用 canonical
  `ObjectRef`，同时保持每张画布的 module 边界稳定；root occurrence 没有 parent，因此 Hierarchy 为空。
- Focused query 在 workspace 边界应用稳定的可见节点/frontier 上限。调节深度只更新当前
  Focused query；不得再次进入 view-mode 切换路径，也不得因 net root 投影失败回退到 Whole。
- `graphWorkspace.js` 是旧调用方的兼容导出；实现位于
  `domains/netlist/netlist_graph_projection.js`，避免领域 feature 反向依赖应用层。
- `layoutWorkspace.js` is the shared provider/override boundary. It preserves both the automatic graph
  and the adjusted graph so manual edits never become implicit provider behavior.
- `workspaceArtifactCache.js` is the bounded LRU boundary for immutable full-graph and automatic-layout
  artifacts. Its identity includes document/source/session/module/query/provider/layout dependencies;
  viewport and selection are intentionally excluded, and document/session invalidation is explicit.
- `startupController.js` sequences the versioned localhost startup manifest through injected handlers;
  decoding belongs to `persistence/startup_codec.js`. Cell Config storage, session and Golden codecs also
  live behind `persistence/` boundaries. It sequences Cell Config,
  netlist, timing, module and focus actions through injected handlers. It has no DOM dependency; browser
  bindings remain in `main.js`.
- Single and Compare Adjust drags call `applyWorkspaceOverrides` on cached automatic graphs for every
  provider, including Simple Layered. Pointer movement must not invoke a layout provider; provider
  execution belongs to workspace rebuilds only.
- `main.js` 当前仍承担浏览器事件绑定和一部分 legacy 状态桥接；新状态变化进入 ViewSession
  commands，Single/Compare 的图形计算共同经过 view pipeline，完成态屏幕、渐进渲染和导出消费同一 Scene。
- `viewHistoryTransaction` 是 application/UI 之间的轻量事务边界：复合的 Compare pair、view-mode
  和 nested command/render 调用只在外层操作完成后提交一个快照；历史本身仍只保存可序列化的视图
  状态，不保存 graph/Scene。
- `command_bus.js` 在 handler 成功提交后通过可选 `onDispatch` observer 把 command type、session
  scope 和 effect metadata 交给 View History；main 仍允许在渲染完成后补充一次显式 metadata，避免
  在异步布局完成前截取不完整 viewport。
- `JobCoordinator`、`ArtifactStore` 与 `ComparisonCoordinator` 现在位于 Single/Compare 的 workspace
  提交边界：Simple Layered 通过同步 `runSync()`，ELK Single/Compare 通过异步 job；Compare 仍保留
  per-side abort/status 与 controller identity 校验。Compare 先执行一次共享的 full-graph/analysis
  preparation，再为 left/right 分别以 `compare-left-workspace` / `compare-right-workspace` 提交
  layout、override 与 Scene artifact，单侧取消或过期不会借由另一侧 job 提交旧结果。
  `workspaceArtifactCache` 负责有界的 full graph/automatic-layout 复用，`ArtifactStore` 保存每个
  session/kind 的最后完成 artifact，`renderGeneration` 只负责最后的 DOM mount 生命周期。

Node、Python 与 Windows launcher 只负责 localhost 静态服务、参数/文件校验和启动 manifest 传输。
业务 parser、inference、graph、layout 与 render 逻辑不复制到 server；Node 预校验直接复用项目 parser。
`/__ngb_startup__.json` 仅在 loopback 服务上暴露显式启动输入，ready stdout 只包含文件名和目标摘要，
不包含网表、时序或 Cell Config 原文。

## 数据模型原则

- net 名称使用 canonical form 存储，同时保留 display name。
- `ObjectRef` 可选携带 `occurrencePath`；同一 module definition 的不同 hinst occurrence 不得共享
  selection、Focused root 或跨层查询身份。
- escaped identifier 要在 parser 层规范处理。
- assign alias 不在 parser 层消除，在 netlist/infer 或 graph extraction 阶段处理。
- 每个 cell/pin 的推断来源要可追踪：
  - `library`
  - `rule`
  - `fallback`
  - `unknown`

## 错误处理原则

- parser 错误给出 module 名、行列范围和附近 token。
- unknown cell 不算错误。
- unknown pin direction 不算错误，但在 UI 中可提示。
- 单个 module 解析失败不应阻止其他 module 展示，除非文件整体语法不可恢复。
