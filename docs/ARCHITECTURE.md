# 架构设计

本文记录项目现行架构实现与工程约束。面向多领域与 AIG 扩展的目标边界、数据契约及迁移决策见 [可扩展工作台架构](architecture_evolution.md)，具体实施顺序与验收进度见 [阶段 7](STAGE_7_PLAN.md)。目前阶段 7 的模块化单体基线已经全面落地；下文同时记录现行实现架构与具有明确移除条件的向后兼容边界。

## 产品范围决策（2026-09-14）

结构分组折叠（Group collapse/expand）已从产品路线中正式移除。后续功能开发、性能优化、映射网表（mapped cases）基线回归与产品验收均不再以折叠图为目标，也不再新增折叠交互或专用折叠路由逻辑；大规模网表统一沿完整图（Whole）、搜索优先（Search-first）或局部聚焦（Focused）路径处理。现有的 `collapseLargeGroups`、`expandedGroupIds` 字段及历史解析逻辑仅作为旧版 Session / Golden 存档的向后兼容边界保留，除非另有明确的移除任务获批。

## 分层原则

项目采用严格的单向数据流分层架构，避免 UI 交互、语法解析与几何布局逻辑相互耦合：

```text
parser -> netlist IR -> inference -> graph extraction -> layout -> render -> UI
```

每一层仅依赖其左侧生成的稳定数据结构；除 `parser` 层外，后续任何层均不得直接读取或解析 Verilog 原文。

公共图形工作台将上述 Netlist 数据流封装在清晰的多领域契约边界之内：
- `contracts/`：定义统一的 `ObjectRef`、领域接口与视图查询契约。
- `application/`：管理 `Document`、`ViewSession`、命令总线（Command Bus）与异步任务协调（Job Coordinator）。
- `domains/netlist/`：负责 Netlist 领域语义分析、视图投影及领域专属用例。
- `diagram/` 与 `render/`：仅消费领域中性的显示图（Diagram）与渲染场景（Scene）。
- `bootstrap/`：负责静态注册并组装具体领域实现。

公共 `application`、`layout` 与 `render` 层严禁反向读取 Netlist 或 AIG 的领域私有字段；这一单向依赖方向由静态架构门禁测试强制守护。

## 模块边界与静态依赖门禁

开发门禁通过 `tools/module_graph.mjs` 扫描 `src/` 下全部嵌套目录以构建完整的运行时模块依赖图，并借助离线 Acorn AST 精确识别静态 `import`、重导出（re-export）、字面量动态 `import()` 以及 `Worker` / 模块 URL。每条依赖边均记录来源文件、行号与引用类型；所有相对路径引用必须精确解析到真实源码模块，任何无法静态解析的不透明请求都会直接报错。

`npm run test:architecture` 与常规单元测试会按各层允许的依赖白名单校验全部依赖边，并对完整模块图执行深度优先搜索（DFS）环路检测，一旦发现违规或循环依赖即输出具体的引用路径链（代码注释、普通字符串或正则表达式中的伪 import 不会产生误报）。Acorn 解析器仅作为开发期门禁工具依赖，不进入运行时或离线发布包（其来源、许可证与说明见 `tools/vendor/acorn/README.md`）。

---

### 1. `src/parser/`

负责将结构化 Verilog（Structural Verilog）文本解析为原始语法结构信息。

**核心职责**：
- 剥离单行与块注释。
- 规范化处理转义标识符（escaped identifier）。
- 解析 `module`、`port`、线网声明（net declaration）、`assign` 连续赋值、单元实例化（cell instance）及位选择/拼接表达式。
- 保留源码行列范围（source span），便于精确定位语法错误。

**职责边界（不负责）**：
- 不推断逻辑门类型（gate kind）。
- 不推断引脚方向（pin direction）。
- 不消除 `assign` 别名，也不决定图形如何排布或绘制。

---

### 2. `src/netlist/`

负责维护稳定的 Netlist 中间表示（IR）与基础图提取结构。

**核心数据结构**：

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
  connection?    # concat {kind, items}; unsupported expressions retain text
```

- **引脚连接与拼接表达式**：单线网连接保留 `net` / `netDisplayName` 兼容字段；拼接（concatenation）连接则通过 `connection` 保存有序、可嵌套的 `concat` / `reference` 树结构，每个引用同时保留规范化名称（canonical name）与显示名称（display name）。拼接结构本身不是一个单独的 net。
- **统一引用枚举**：`getPinNetReferences` 在 IR 边界统一枚举引脚关联的线网引用，图构建、层次连接模板与详情面板均消费同一套结果；遇到不支持的复杂表达式时保留原文并生成诊断信息，绝不截取首个标识符伪造成合法连接。
- **独立拼接显示端点**：显示图通过 `getPinConnectionEndpoints` 为拼接成员分配独立的 `A{ordinal}` 虚拟引脚端点，避免不同线网共用同一个引脚几何坐标（其中 `ordinal` 表示拼接成员顺序，不冒充源引脚的物理 bit 下标），且绝不修改源 Netlist IR。

---

### 3. `src/infer/`

负责在缺乏 Liberty（`.lib`）库文件时的启发式语义推断。

**核心职责**：
- 根据 `cell type` 推断逻辑门类别（`gate kind`）。
- 根据 `pin name` 推断引脚方向（`input` / `output` / `inout`）。
- 提供 `assign` 别名折叠建议。
- 标记每个推断结果的来源与置信度（`library` / `rule` / `fallback` / `unknown` / `user-config`）。

内置推断规则集中维护在 `src/infer/defaultCellRules.js`，用户自定义单元配置由 `src/infer/cellConfig.js` 管理并支持 JSON 导入导出。

---

### 4. `src/layout/`

负责将显示图模型转换为布局引擎输入，并将布局与正交布线结果规范化为统一的 `PositionedGraph`。

```text
LayoutProvider
  layout(graph, options) -> PositionedGraph | Promise<PositionedGraph>
```

**布局引擎体系**：
- **`Native Layered H08`（默认主力）**：基于 `src/layout/elk_native/` 的纯静态 ES 模块分层布局与边界超边正交布线引擎。
- **`ElkLayoutProvider`（内置离线备选）**：封装 `vendor/elkjs-0.11.1/lib/elk.bundled.js`，将内部图转换为 ELK Layered 格式并规范化回 `PositionedGraph`。
- **`SimpleLayeredLayoutProvider`（轻量兜底）**：封装 `simpleLayered.layoutGraph`，作为同步轻量布局与最终兜底回退引擎。

**当前实现与协作边界**：
- `src/layout/layoutProvider.js` 维护布局引擎注册表（registry）与降级策略。
- `layout(graph, options)` 支持同步返回 `PositionedGraph` 或异步返回 `Promise`；应用编排层统一通过修订号（revision）校验并仅提交最新请求，过期的异步结果绝不会覆盖当前最新视图状态。
- `src/app/compareWorkspace.js` 负责组合双模块对比（Compare）的图提取、别名规范化、逻辑锥裁剪、布局调用与统计计算，不直接持有 DOM 或全局应用状态。
- `src/layout/positionedRouting.js` 在自动布局生成的 `PositionedGraph` 之上叠加手动节点位置与尺寸覆盖（overrides），并重新计算引脚坐标、图边界与带障碍物避让的正交（Manhattan）导线路径；在 Adjust 模式拖拽期间直接复用缓存的自动布局结果，不会重复运行自动布局引擎。
- `src/render/progressiveSvgRenderer.js` 仅负责将渲染计划（render plan）按帧分批提交至 DOM，不参与任何几何布局或图拓扑分析。
- SVG 跨线桥（wire-bridge）检测统一使用共享线段空间索引（spatial index），严禁在任意边数阈值处从空间索引退化为全图两两扫描（all-pairs scan）。
- 交互拖拽预览帧允许临时省略装饰性跨线桥以提升帧率，但手势结束后的完成态渲染必须完整恢复全部几何路径、跨线桥、文本标签与点击热区。
- `src/analysis/fanoutHub.js` 与 `src/analysis/groupCollapse.js`（兼容保留）均为布局前的纯函数派生显示图变换，绝不原地修改源 Netlist IR。
- `src/app/sessionState.js` 负责会话快照的序列化边界；用户导入的网表文本仅保存在当前浏览器标签页的 `sessionStorage` 中。

#### Native Layered H08 产品路径（2026-10-15）

- **默认注册与自动降级**：`native-layered` 注册项采用 `elk_native_layout_provider.js` 的 `H08` 配置（内部完整相位实现位于 `src/layout/elk_native/`）。自 `v1.1.1` 起由 `providerDefaults.js` 将新会话、无参数注册表查询及 EDA 启动的默认引擎统一设为 `H08`。当 UI 布局失败时，按 `H08 -> ELK -> Simple` 顺序依次降级，`Simple` 仍失败则停止重试；用户主动取消任务不会触发降级。自动降级仅改变当前这一次运行的引擎，会话持久化仍保留用户原始首选项，避免将临时回退固化为下次启动的默认设置。对于缺少首选项版本号且保存为 `Simple` 的旧版会话，首次加载时会一次性迁移回 `H08`；新版会话均记录首选项版本号，此后用户主动选择的 `Simple` 或 `ELK` 会被持久尊重。
- **静态离线入口与异步 Worker 隔离**：离线直接调用入口为 `src/layout/elk_native/h08.js`（`index.js` 基础 profile 仅用于受控相位对比测试）。Provider 通过 `executionMode: "async"` 显式声明异步执行特性，供 Single 与 Compare 工作区统一消费。在浏览器环境中，H08 相位计算运行在独立的离线 ES Module Worker（`native_layout_worker.js`）中：每次请求独占一个 Worker，一旦取消即刻执行 `worker.terminate()` 强制中断并释放资源，任务成功或失败后亦立即销毁 Worker；在 CLI 或带相位观察回调的测试调用中则使用进程内执行，并在相位检查点按时间预算让出事件循环。
- **旧版代码归档隔离**：原 `src/layout/native_layered/` 下的 22 个早期文件已归档至 `tests/reference/retired_native_layered/`，仅供历史测试追溯，不进入生产依赖或 Windows 发布包，且由架构测试严禁运行时反向导入。H08 的版本化 profile、支持范围与适配契约详见 [静态包说明](design/elk_h08_package.md)。

#### Native Layered 早期规划基线（历史背景留存，2026-09-20）

以下保留早期独立分层引擎规划阶段的隔离约束作为架构演进背景（完整历史路线见 [`docs/plans/native_layered_development.md`](plans/native_layered_development.md)，Simple 冻结基线见 [`docs/plans/simple_layout_freeze_baseline.md`](plans/simple_layout_freeze_baseline.md)）：

- `SimpleLayeredLayoutProvider` 的输出、默认策略与内部流水线保持冻结；新分层引擎不得导入 `simpleLayered.js`、`simplePlacementPipeline.js`、`simpleLayering.js`、`simpleRoutingPlan.js`、`simpleOrthogonalRouter.js` 或 `simpleRouteCandidates.js`。
- 两个引擎仅共享顶层 provider 契约、节点几何测量、正交硬约束、几何校验器（validator）、物理线网规范化、标签排布、空间索引、渲染器及工作区/任务协调边界。
- 虚拟节点（dummy）、反转边（reversed edge）、对齐块（alignment block）与通道需求等中间结构仅存在于布局引擎内部模型中，绝不泄漏至 Netlist IR 或 UI 节点图。

#### 布局策略与各子模块职责边界（Layout Policy & Modules）

- `src/layout/layoutPolicy.js`：拥有命名布局策略（如 `schematic-readable-v1`）并负责在入口边界一次性完成间距与功能开关的数值归一化；下游算法直接消费归一化后的策略，严禁各自编码冲突的默认范围或类型转换。策略将间距参数（`wire lane pitch`、`cell pin pitch`、`branch lane origin/pitch`）与拓扑特征开关（驱动对齐、分支通道、单扇出局部输入）解耦，且仅依赖引脚顺序与节点类别等拓扑特征，绝不按特定测试用例的实例名硬编码。
- `src/layout/nodeGeometry.js`：负责节点尺寸测量、引脚排布、连接点计算与全图外框边界（bounds）计算。
- `src/layout/nodeOverrides.js`：作为手工节点位置与尺寸覆盖（overrides）的唯一归一化入口，负责集合形态转换、数值合法性校验与尺寸上下限约束。
- `src/layout/nodeAlignment.js`：负责拓扑驱动的垂直对齐与分支通道分配。
- `src/layout/nodeLocality.js`：负责外部输入端口与高扇出中继节点（fanout hub）的局部就近放置策略。
- `src/layout/nodeSpacing.js`：负责层间水平间距（layer X spacing）计算与同层节点重叠消解。
- `src/layout/nodePlacementShared.js`：提供上述放置策略共用的确定性排序与空闲区间查找辅助函数（`nodePlacement.js` 仅作为向后兼容导出桶保留）。
- `src/layout/layoutTopology.js`：定义稳定的边排序键与线网分组键；确保分层、布局意图分析与通道规划对输入节点/边数组的排列顺序完全不敏感（Permutation invariant）。
- `src/layout/orthogonalRouting.js`：Simple 与 Adjust 共用的正交布线核心契约，统一掌管引脚侧向接入规则、端点本体保护、线段冲突判定语义以及路径点规范化（自动剔除重复点与共线伪折点，禁止各引擎私自维护折线简化器）。
- `src/layout/routeCandidateValidation.js`：将上述正交契约应用于候选路径校验，Simple 与 Adjust 共享其正交性、节点避障与端点接入检查。
- `src/layout/routeLaneCandidates.js`：负责从节点外框与已占用导线边界提取稳定的局部水平通道（Y-lane）候选。
- `src/layout/simpleRoutingPlan.js`：将布局意图与层间跨度转换为稳定的通道预留计划，不直接操作像素坐标。
- `src/layout/simpleLayering.js`：负责抗环路的层级分配与拓扑排序，破环顺序严格保持确定性且不依赖解析器语句顺序。
- `src/layout/simpleOrthogonalRouter.js` 与 `src/layout/simpleRouteCandidates.js`：前者负责 Simple 布线的候选评估、打分与线段占用登记；后者负责候选几何坐标生成与有界全局兜底通道（严禁候选数量随图节点规模无界增长）。
- `src/layout/localOrthogonalRouter.js` 与 `src/layout/localRouteCandidates.js`：负责 Adjust 模式下的增量局部重布线。按策略顺序惰性生成局部直连、障碍物边缘及外围通道候选，并复用共享打分成本选出最优无冲突正交路径。
- `src/layout/layoutValidator.js`：负责对最终生成的 `PositionedGraph` 执行权威几何审计，输出稳定的违规代码（violation codes）供测试与 Golden 门禁断言。
- `src/layout/wireLabelPlacement.js`：唯一的导线文本标签避障与可见性裁决模块；基于显式稳定的边优先级（而非数组原始顺序）执行碰撞检测。
- `src/layout/spatialIndex.js` 与 `src/layout/routeSegmentIndex.js`：提供动态线段空间索引与静态节点空间索引。空间索引仅用于高效缩小候选集，最终合法性仍由精确几何谓词裁决；`routeSegmentIndex.js` 在入库前附加边归属、线段序号与方向元数据，供渲染器跨线桥、标签避障与增量重布线失效分析共用。
- `src/layout/layoutQuality.js`：将软性可读性目标量化为可对比指标（直线率、折点数、总长、绕行率、交叉数、重叠数、外围通道使用率及隐藏标签数）。
- `src/domains/netlist/layout_golden.js`：管理 Golden v3 格式（记录稳定节点顺序、逐边路径几何、路由策略、视图状态与源码内容指纹，同时兼容导入 v1/v2）。
- `src/layout/routeScoring.js` 与 `src/layout/routeSearchPolicy.js`：统一管理具名路由打分权重与有界候选搜索上限，禁止在算法内部散落魔法数字或按图规模倍增的重试循环。
- `src/layout/simpleLayered.js` 与 `src/layout/simplePlacementPipeline.js`：作为 Simple 流水线的顶层编排器，按固定阶段顺序组合分层、放置与布线模块：

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

- `src/layout/positionedRouting.js` 与 `src/layout/rerouteInvalidation.js`：编排手工节点覆盖、空间索引失效查询、局部重布线与标签更新。Adjust 重布线优先处理单负载线网并采用稳定拓扑键排序；未受节点移动影响的物理线网组及其已完成标签直接复用缓存。

**硬约束与软目标的严格分离**：
- **硬约束（Hard Constraints）**：线段严格正交、沿引脚声明侧接入、严禁穿越端点或非端点单元本体、不同物理线网严禁共线重叠。硬约束集中实现于共享内核与 `layoutValidator.js` 中，所有仓库内置网表与 47 个综合映射用例均以此作为零容忍门禁。
- **软目标（Soft Objectives）**：直线优先、局部短折线优先、少折弯、少交叉、单负载紧凑、多负载预留通道。软目标由候选生成器与打分器控制，严禁通过实例名或坐标特判来修补单个测试图形（1024 级缓冲器长链同时作为 Adjust 增量重布线的性能门禁）。

---

### 5. `src/render/`

负责将领域展示层生成的结构化场景（`Scene`）渲染为交互式 SVG。

**核心职责**：
- 绘制标准矩形或约定逻辑门符号（gate symbol）、端口节点、导线路径与跨线桥、文本标签、时序徽标以及箭头标记。
- 管理选中、扇入/扇出、搜索命中与结构差异等可叠加高亮样式类（highlight classes）。
- 渲染层严格保持无领域耦合：不解析 Verilog 网表，不读取私有推断规则，也不重新计算逻辑锥或布局坐标。

---

### 6. `src/timing/`

负责可选时序报告的文本解析与图节点时序标注，严格划分为两个独立阶段：

- `src/timing/timingParser.js`：仅负责将传统 LocResyn 行格式或新版 Global/Local 边界表格文本规范化解析为时序中间记录（timing IR，将 `rat` 统一归一为 `rt` 并保留扩展指标列），绝不读取图结构或 DOM。
- `src/timing/timingAnnotation.js`：负责将时序作用域（scope）与模块/实例路径进行最长无歧义层次后缀匹配、选择默认徽标（badge）并向图节点附加时序注释，绝不解析原始文本。

---

### 7. `src/ui/`

负责浏览器 DOM 交互、手势收敛与面板渲染：

- `src/ui/viewport.js`：封装纯数学的缩放、平移、屏幕/SVG 坐标换算与矩阵变换计算，事件处理器仅提供 DOM 测量值并提交状态，不重复编写视口数学逻辑。
- `src/ui/nodeDrag.js`：提供与具体布局引擎无关的节点拖拽位移、边界保护与坐标相等性计算，由 Single 与 Compare 画布共用。
- `src/ui/pointerSession.js`：统一管理指针捕获（pointer capture）及 `move` / `up` / `cancel` 生命周期清理，供侧栏拖拽调宽、画布平移与节点拖拽共用。
- `src/ui/frameScheduler.js`：将高频指针移动与滚轮事件合并为每动画帧（`requestAnimationFrame`）最多执行一次轻量更新，并在手势结束时精确刷新最终位置。
- `src/ui/timingPanel.js`、`src/ui/adjustPanel.js`、`src/ui/cellDefinitionPanel.js`、`src/ui/objectDetailsPanel.js`、`src/ui/processLogPanel.js`、`src/ui/module_hierarchy_panel.js`：分别负责各功能面板的 HTML 渲染与事件绑定；面板自身不持有全局应用状态，状态变更统一通过注入的窄接口回调或命令触发。
- `src/ui/html.js`：提供全项目共用的 HTML/SVG 安全字符转义与格式化工具。

**UI 层依赖约束**：UI 通过显式 API 调用 `application` 命令、领域特性（`DomainFeature`）与共享流水线，不直接操作解析器 IR 或渲染器内部临时结构。`bootstrap/default_domains.js` 是产品领域的静态注册点。静态依赖门禁仅允许 `ui/` 引用 `app/quickInput.js` 与 `app/processLog.js` 两个无副作用纯工具兼容模块（且这两个模块自身仅依赖 `contracts/` 与 `foundation/`），严禁 UI 反向依赖其他 `app/` 控制器。

---

### 8. `src/application/` 与 `src/app/`

- **入口收敛与职责归属**：`src/app/main.js` 仅作为浏览器端依赖组装与顶层事件绑定入口（受架构门禁 611 行上限与单职责模块 520 行上限约束，详见 [入口收敛计划](plans/main_entry_modularization.md)）。共享的同步/异步任务调度与过期结果隔离由 `src/application/workspace_execution.js` 统一掌管，Single 与 Compare 工作区通过注入任务与渲染回调共用同一套执行机制；`src/app/workspace_inputs.js` 仅负责将旧版状态投影为不可变请求对象。
- **文档与视图会话存储（`DocumentStore` & `ViewSessionStore`）**：作为文档、画布会话及其修订号（revision）的唯一权威所有者。Single 与 Compare 桥接器（bridge）仅负责在 `ObjectRef` 与旧版 UI/存档字段之间做兼容投影，并在投影图中完整保留层次路径 `occurrencePath`；同一模块定义在不同实例路径（`hinst`）下的选中项与聚焦根均按精确的 occurrence 身份隔离与恢复。
- **统一视图命令与流水线（`view_commands.js` & `view_pipeline.js`）**：`view_commands.js` 统一处理模块切换、Focused roots、选中项、视口、布局策略与手工覆盖，并显式返回 `query` / `layout` / `render` / `viewport` / `persist` 副作用标记（纯视口变换或幂等相同值提交不会错误推进计算修订号）。`view_pipeline.js` 固定执行 `query -> project -> measure -> layout -> overrides -> scene` 流水线，Netlist 与测试用内存 AIG 均经由此公共路径完成渲染，公共层不含任何按领域 ID 分支的硬编码。
- **作业协调与渲染代际隔离（`JobCoordinator` & `renderGeneration.js`）**：`JobCoordinator` 基于文档与会话修订号管理同步/异步工作区计算身份，在结果提交前自动丢弃已过期的成功、失败或进度回调；`src/render/renderGeneration.js` 则作为渐进式 DOM 批次提交的独立单调守卫，当新一次画布渲染启动时立即终止上一轮未完成的 DOM 批次挂载。
- **单模块与双模块工作区（`moduleWorkspace.js` & `compareWorkspace.js`）**：Single 画布始终仅投影当前打开的模块定义（Focused 扇入/扇出追踪到达模块端口或子模块实例边界即停止，不将相邻层级的实例混入当前层布局图）；跨层次导航通过 `Selection` 面板的 `Hierarchy / Parent occurrence` 或双击子模块实例（`hinst`）触发。Compare 工作区先执行一次共享的全图提取与对比统计准备，再为左右两侧分别以独立任务作用域（`compare-left-workspace` / `compare-right-workspace`）提交布局、覆盖与场景构建，单侧取消或过期绝不会干扰另一侧。
- **有界工作区产物缓存（`workspaceArtifactCache.js` & `ArtifactStore`）**：采用带容量权重上限的 LRU 缓存复用不可变的全图与自动布局产物；缓存键完整包含文档、源码指纹、会话、模块、查询、布局引擎及布局策略依赖（排除视口与选中状态），上游图或单元配置变更会自动使下游几何缓存失效。
- **不可变会话快照與事务化视图历史（`viewHistoryTransaction.js`）**：`ViewSession` 中的策略与手工覆盖均为深冻结的不可变快照（含嵌套 `Map` / `Set`），任何状态修改必须经过 store 命令更新。复合视图操作通过 `viewHistoryTransaction` 在最外层操作完成时一次性提交单条历史快照。
- **启动协议与持久化边界（`startupController.js` & `src/persistence/`）**：`startupController.js` 通过注入的处理器按序执行 `Cell Config`、网表、时序、目标模块与初始聚焦动作，相关的编解码器统一收敛于 `src/persistence/`。Node.js、Python 与 Windows 启动器仅提供本地回环（`127.0.0.1`）静态资源服务、参数校验与 `/__ngb_startup__.json` 清单传输，绝不在服务端复制前端业务算法。

---

## Linux 单文件启动器与 EDA 集成边界（2026-10-21）

- `native/` 编译生成独立的 Linux 单文件服务进程 `ngb`，不将 Verilog 解析器、布局引擎或 HTTP 服务静态链接进宿主 EDA 主程序。
- 顶层 `CMakeLists.txt` 与 `native/CMakeLists.txt` 共享 `ngb` 构建目标；构建期自动扫描并嵌入全部前端静态资源，运行时无需外部 `src/` 目录。
- 原生进程在监听端口前仅校验输入文件可读性，网表语法与配置语义交由浏览器前端校验；`ready` 消息仅表示本地监听与启动清单就绪。
- 会话状态管理采用 `<state-file>.lock` 独占文件锁防止并发冲突，结合可执行文件 inode、精确命令行状态路径与进程启动时间戳（`processStartTicks`）严格校验 `stop` / `--replace` 的进程所有权，并通过 `0600` 权限临时文件加原子 `rename` 写入状态。
- 内置 HTTP 服务对并发连接数、请求头大小与读写超时均设有严格上限；`tools/eda/ngb.tcl` 通过解析 `ready` 消息等待服务就绪并保持管道，将所有异常真实抛回 EDA 宿主。详见 [Linux 指南](LINUX_SINGLE_FILE_LAUNCHER.md)。

## 数据模型与错误处理原则

### 数据模型核心不变量
- **双名称保留**：线网、端口与实例统一使用规范化名称（canonical name）作为内部标识，同时独立保留显示名称（display name）。
- **层次实例身份隔离**：`ObjectRef` 可携带 `occurrencePath`；同一模块定义在不同层次实例路径下的对象拥有独立的选中状态、聚焦根身份与跨层连接上下文。
- **职责归属明确**：转义标识符在 `parser` 层完成规范化；`assign` 别名保留在 Netlist IR 中，仅在后续图提取/展示变换阶段按策略折叠；每个单元与引脚的推断来源（`library` / `rule` / `fallback` / `unknown` / `user-config`）全程可追溯。

### 错误处理与容错原则
- **精准语法定位**：解析错误需提供所在模块名、源码行列范围及上下文附近词法标记（token）。
- **未知单元优雅降级**：未知单元类型（unknown cell）渲染为黑盒（blackbox），未知引脚方向在界面中给出诊断提示，均不中断整体绘图流程。
- **模块级故障隔离**：只要文件整体语法结构可恢复，单个模块内部的解析异常不应阻止同一文件中其他正常模块的浏览。
