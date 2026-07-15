# 架构设计

## 分层原则

项目采用清晰的数据流分层，避免 UI、parser 和布局逻辑互相耦合。

```text
parser -> netlist IR -> inference -> graph extraction -> layout -> render -> UI
```

每层只依赖左侧稳定数据结构，不直接读取 Verilog 原文，除非它就是 parser 层。

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
- `src/analysis/fanoutHub.js` 和 `src/analysis/groupCollapse.js` 是布局前的可逆显示图变换，不修改 Netlist IR。
- `src/app/sessionState.js` 负责 session snapshot 的序列化边界；用户输入网表仅保存在当前标签页的 `sessionStorage`。

手动布局校准不改变 Netlist IR，也不替代 layout provider。实现时应把用户拖动得到的节点位置作为 layout override/golden 叠加在 positioned graph 上，再让路由和渲染层基于覆盖后的节点位置工作。

wire routing 策略属于 layout 层，不放到 render 层。layout 输出的 edge 可以携带 `routeKind`、`labelPoint` 和后续调试所需的 routing metadata；render 只负责按这些结果绘制 path 与文字。

adjust 模式的 snap 计算属于 UI/layout 边界：UI 负责把 pointer movement 转成候选节点位置，layout helper 负责根据 grid 和相连 pin 关系给出吸附后的坐标。snap 结果仍保存为普通 node position override。

Layout policy:

- `src/layout/layoutPolicy.js` owns the named layout policy used by the demo.
- `src/layout/nodeGeometry.js` owns node measurement, pin placement, connection points, and graph bounds.
- `src/layout/nodePlacement.js` owns placement passes. Placement may improve routing, but must not encode
  wire collision rules.
- `src/layout/orthogonalRouting.js` is the shared routing contract used by Simple and Adjust routing. It
  owns port-side entry, endpoint-body protection, segment conflict semantics and route-point normalization.
- `src/layout/simpleRoutingPlan.js` converts layout intent and level distance into stable channel/lane
  reservations; it does not inspect pixel geometry or generate route points.
- `src/layout/simpleLayering.js` owns cycle-safe level assignment and topology ordering.
- `src/layout/simpleOrthogonalRouter.js` owns Simple-specific candidate generation and scoring. It consumes
  the shared routing contract and returns positioned edges; it does not move nodes.
- `src/layout/layoutValidator.js` audits a completed positioned graph. Tests and golden cases use its stable
  violation codes instead of repeating one-off geometric assertions.
- `src/layout/wireLabelPlacement.js` is the only wire-label collision and visibility policy. Simple,
  Adjust and ELK may choose different segment ordering, but share label sizing and collision checks.
- `src/layout/spatialIndex.js` provides the dynamic segment and static node indexes used by routing and
  label placement. Geometry predicates remain authoritative; the index only narrows candidate sets.
- `src/layout/simpleLayered.js` is the pipeline orchestrator. It composes layering, placement and routing,
  but owns none of their algorithms. New geometry invariants must go into `orthogonalRouting.js`, not here.
- `src/layout/positionedRouting.js` generates local reroutes after overrides. It may use different candidate
  generation from Simple, but must apply the same shared routing contract.
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

负责用户交互。

职责：

- 文件拖入/打开。
- module 选择。
- 视图模式切换。
- 搜索。
- 高亮。
- 缩放平移。
- 导出。

UI 通过明确 API 调用 parser/netlist/layout/render，不直接操作内部临时结构。

当前面板边界：

- `timingPanel.js` 负责时序表格、badge 多选和位置控件的 HTML/DOM 绑定。
- `adjustPanel.js` 负责节点尺寸、属性和 pin direction 控件的 HTML/DOM 绑定。
- `html.js` 只提供共享的安全转义和数值/definition list 格式化。

面板模块不持有全局应用状态；状态更新通过回调交给 `src/app/main.js`。

### `src/app/`

- `appState.js` 定义应用初始状态，以及 design/module/timing 三种生命周期 reset。
- `main.js` 负责应用编排、状态变更、布局/渲染调用和画布交互，不内嵌面板 HTML。

## 数据模型原则

- net 名称使用 canonical form 存储，同时保留 display name。
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
